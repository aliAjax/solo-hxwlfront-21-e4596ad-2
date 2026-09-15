import { PRODUCTS } from "./demo";
import type {
  DemandItem,
  Plan,
  PlanAnalysis,
  Priority,
  Shift,
  ShiftStop,
  StationTankProfile,
  UnmetDemand,
  Vehicle,
  Violation
} from "./types";

const TRAVEL_MINUTES = 30;

export function productOf(code: string) {
  return PRODUCTS.find((p) => p.code === code);
}

export function productName(code: string) {
  return productOf(code)?.name ?? code;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** 缺口 = 库容 - 当前库存；按需求优先级（高>中>低）、缺口率降序排序 */
export function computeGaps(profiles: StationTankProfile[]): DemandItem[] {
  const items: DemandItem[] = [];
  for (const profile of profiles) {
    for (const tank of profile.tanks) {
      const gap = tank.capacity - tank.stock;
      if (gap > 0) {
        items.push({
          stationId: profile.stationId,
          stationName: profile.stationName,
          productCode: tank.productCode,
          gap,
          capacity: tank.capacity,
          stock: tank.stock,
          priority: profile.priority
        });
      }
    }
  }
  return items.sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return b.gap / b.capacity - a.gap / a.capacity;
  });
}

interface DraftStop {
  stationId: string;
  stationName: string;
  productCode: string;
  qty: number;
  serviceMinutes: number;
}

interface DraftShift {
  vehicleId: string;
  stops: DraftStop[];
}

export function findProfile(profiles: StationTankProfile[], stationId: string) {
  return profiles.find((p) => p.stationId === stationId);
}

/**
 * 按到站窗给一条班次排序排时刻；任何一站无法在收货时段内完成则返回 null。
 * 同站多油品按连续卸油处理（不计路程），相邻站按 30 分钟路程。
 */
export function scheduleStops<T extends { stationId: string; serviceMinutes: number }>(
  stops: T[],
  profiles: StationTankProfile[]
): (T & { arrive: string })[] | null {
  const ordered = [...stops].sort((a, b) => {
    const pa = findProfile(profiles, a.stationId);
    const pb = findProfile(profiles, b.stationId);
    const wa = toMinutes(pa?.windows[0]?.start ?? "06:00");
    const wb = toMinutes(pb?.windows[0]?.start ?? "06:00");
    if (wa !== wb) return wa - wb;
    if (a.stationId !== b.stationId) return a.stationId.localeCompare(b.stationId);
    return 0;
  });

  let cursor = -1;
  const result: (T & { arrive: string })[] = [];
  for (const stop of ordered) {
    const profile = findProfile(profiles, stop.stationId);
    if (!profile || profile.windows.length === 0) return null;
    const feasible = profile.windows.some((w) => {
      const start = toMinutes(w.start);
      const end = toMinutes(w.end);
      let arrive: number;
      if (cursor < 0) {
        arrive = start;
      } else {
        const prev = result[result.length - 1];
        const travel = prev.stationId === stop.stationId ? 0 : TRAVEL_MINUTES;
        arrive = Math.max(cursor + travel, start);
      }
      return arrive + stop.serviceMinutes <= end;
    });
    if (!feasible) return null;

    const chosen = [...profile.windows].sort(
      (a, b) => toMinutes(a.start) - toMinutes(b.start)
    )[0];
    const start = toMinutes(chosen.start);
    const arrive = cursor < 0 ? start : Math.max(
      cursor + (result[result.length - 1].stationId === stop.stationId ? 0 : TRAVEL_MINUTES),
      start
    );
    result.push({ ...stop, arrive: fromMinutes(arrive) });
    cursor = arrive + stop.serviceMinutes;
  }
  return result;
}

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function timingFeasible(
  vehicle: Vehicle,
  stops: DraftStop[],
  candidate: DraftStop,
  profiles: StationTankProfile[]
) {
  if (stops.some((s) => s.stationId === candidate.stationId && s.productCode === candidate.productCode)) {
    return false;
  }
  const product = productOf(candidate.productCode);
  if (!product || !vehicle.compatibleKinds.includes(product.kind)) return false;
  return scheduleStops([...stops, candidate], profiles) !== null;
}

/**
 * 区域补货建议：按优先级把缺口贪心装箱到有限车辆。
 * 同一需求（站点+油品）只进一个班次；单车装不下时尽量满载、未覆盖部分落入 unmet。
 */
export function buildSuggestions(
  area: string,
  date: string,
  profiles: StationTankProfile[],
  vehicles: Vehicle[]
): { shifts: Shift[]; unmet: UnmetDemand[] } {
  const areaProfiles = profiles.filter((p) => p.area === area);
  const demands = computeGaps(areaProfiles);
  const drafts: DraftShift[] = [];
  const unmet: UnmetDemand[] = [];

  const usedVehicles = () => new Set(drafts.map((d) => d.vehicleId));

  for (const demand of demands) {
    const product = productOf(demand.productCode);
    if (!product) continue;
    const kind = product.kind;
    const compatible = vehicles.filter((v) => v.compatibleKinds.includes(kind));
    const candidateStop = (qty: number): DraftStop => ({
      stationId: demand.stationId,
      stationName: demand.stationName,
      productCode: demand.productCode,
      qty,
      serviceMinutes: findProfile(profiles, demand.stationId)?.serviceMinutes ?? 45
    });

    let qty = demand.gap;
    while (qty > 0) {
      const loadOf = (s: DraftShift) =>
        s.stops.reduce((sum, stop) => sum + stop.qty, 0);
      const vehicleOf = (id: string) => vehicles.find((v) => v.id === id)!;

      // 1) 已有班次能整单装下：best-fit（剩余容量最小者优先，尽量合并）
      const fullFit = drafts
        .filter((s) => {
          const v = vehicleOf(s.vehicleId);
          return (
            v.capacity - loadOf(s) >= qty &&
            timingFeasible(v, s.stops, candidateStop(qty), profiles)
          );
        })
        .sort((a, b) => {
          const ra = vehicleOf(a.vehicleId).capacity - loadOf(a);
          const rb = vehicleOf(b.vehicleId).capacity - loadOf(b);
          return ra - rb;
        })[0];

      if (fullFit) {
        fullFit.stops.push(candidateStop(qty));
        qty = 0;
        break;
      }

      // 2) 新开一辆车能整单装下：选满足条件的最小车
      const used = usedVehicles();
      const freshFull = compatible
        .filter((v) => !used.has(v.id) && v.capacity >= qty)
        .filter((v) => timingFeasible(v, [], candidateStop(qty), profiles))
        .sort((a, b) => a.capacity - b.capacity)[0];
      if (freshFull) {
        drafts.push({ vehicleId: freshFull.id, stops: [candidateStop(qty)] });
        qty = 0;
        break;
      }

      // 3) 无法整单满足：找可装载空间最大的班次（已有优先），尽量补一部分
      const partials = [
        ...drafts
          .filter((s) => timingFeasible(vehicleOf(s.vehicleId), s.stops, candidateStop(1), profiles))
          .map((s) => ({ shift: s, free: vehicleOf(s.vehicleId).capacity - loadOf(s) })),
        ...compatible
          .filter((v) => !used.has(v.id) && timingFeasible(v, [], candidateStop(1), profiles))
          .map((v) => ({ shift: null, free: v.capacity, vehicle: v }))
      ]
        .filter((c) => c.free > 0)
        .sort((a, b) => b.free - a.free);

      const best = partials[0];
      if (!best) {
        unmet.push({
          ...demand,
          gap: qty,
          reason:
            qty > Math.max(0, ...compatible.map((v) => v.capacity))
              ? `缺口 ${qty}L 超过区域内最大单车容量，需拆单协调`
              : "区域内车辆数量有限，已无可用车辆"
        });
        break;
      }

      const put = Math.min(qty, best.free);
      if (best.shift) {
        best.shift.stops.push(candidateStop(put));
      } else {
        drafts.push({ vehicleId: (best as { vehicle: Vehicle }).vehicle.id, stops: [candidateStop(put)] });
      }
      unmet.push({
        ...demand,
        gap: qty - put,
        reason: `车辆容量不足，仅安排 ${put}L / 缺口 ${qty}L`
      });
      qty = 0;
    }
  }

  const shifts: Shift[] = drafts.map((draft) => {
    const scheduled = scheduleStops(draft.stops, profiles)!;
    return {
      id: uid("shift"),
      vehicleId: draft.vehicleId,
      date,
      stops: scheduled.map((s) => ({
        id: uid("stop"),
        stationId: s.stationId,
        stationName: s.stationName,
        productCode: s.productCode,
        qty: s.qty,
        arrive: s.arrive,
        serviceMinutes: s.serviceMinutes,
        actualQty: null,
        diffReason: null,
        diffNote: "",
        executedAt: null
      }))
    };
  });

  return { shifts, unmet: unmet.filter((u) => u.gap > 0) };
}

/** 建议生成签名：同区域同日期同缺口下重复生成视为同一结果（幂等） */
export function generationSignature(area: string, date: string, profiles: StationTankProfile[]) {
  const demands = computeGaps(profiles.filter((p) => p.area === area));
  return [area, date, ...demands.map((d) => `${d.stationId}:${d.productCode}:${d.gap}`)].join("|");
}

/**
 * 重新生成建议时合并：
 * - 同 (站点, 油品) 已存在的 stop：保留人工调整（车辆/时刻/数量）与执行登记，不重复建班
 * - 需求已消失的未执行 stop：删除；已执行 stop：作为快照保留
 * - 新需求：并入同车辆已有班次，否则保留其生成班次
 */
export function mergeGenerated(
  existing: Shift[],
  generated: Shift[]
): { shifts: Shift[]; freshStopIds: Set<string> } {
  const key = (stationId: string, productCode: string) => `${stationId}|${productCode}`;
  const generatedStopMap = new Map(
    generated.flatMap((s) => s.stops.map((st) => [key(st.stationId, st.productCode), st] as const))
  );

  const kept: Shift[] = [];
  const claimedStopIds = new Set<string>();
  const freshStopIds = new Set<string>();

  for (const oldShift of existing) {
    const liveStops: ShiftStop[] = [];
    for (const oldStop of oldShift.stops) {
      const k = key(oldStop.stationId, oldStop.productCode);
      const matched = generatedStopMap.get(k);
      if (matched) {
        claimedStopIds.add(matched.id);
        liveStops.push({ ...oldStop });
      } else if (oldStop.executedAt) {
        liveStops.push({ ...oldStop });
      }
    }
    if (liveStops.length) kept.push({ ...oldShift, stops: liveStops });
  }

  for (const genShift of generated) {
    const freshStops = genShift.stops.filter((st) => !claimedStopIds.has(st.id));
    if (!freshStops.length) continue;
    for (const st of freshStops) freshStopIds.add(st.id);
    const target = kept.find((s) => s.vehicleId === genShift.vehicleId);
    if (target) {
      target.stops.push(...freshStops);
    } else {
      kept.push({ ...genShift, stops: freshStops });
    }
  }

  return { shifts: kept, freshStopIds };
}

/** 人工调整后实时重算：违规校验 + 剩余缺口 + 待执行班次 + 无法满足站点 */
export function analyze(
  plan: Plan,
  profiles: StationTankProfile[],
  vehicles: Vehicle[],
  otherPlans: Plan[] = []
): PlanAnalysis {
  const violations: Violation[] = [];
  const profileMap = new Map(profiles.map((p) => [p.stationId, p]));
  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

  const intervalOverlap = (
    a: { arrive: string; serviceMinutes: number },
    b: { arrive: string; serviceMinutes: number }
  ) => {
    const as = toMinutes(a.arrive);
    const bs = toMinutes(b.arrive);
    return as < bs + b.serviceMinutes && bs < as + a.serviceMinutes;
  };

  // 同一计划内 (站点, 油品) 至多一个有效 stop —— 重复提交/重复建班在此拦截
  const seenKeys = new Map<string, string>();
  const shiftVehicleName = (shiftId: string) =>
    vehicleMap.get(plan.shifts.find((s) => s.id === shiftId)?.vehicleId ?? "")?.name ?? "其他班次";
  for (const shift of plan.shifts) {
    for (const stop of shift.stops) {
      const k = `${stop.stationId}|${stop.productCode}`;
      const prev = seenKeys.get(k);
      if (prev) {
        violations.push({
          level: "block",
          code: "time_overlap",
          shiftId: shift.id,
          stopId: stop.id,
          message: `${stop.stationName} ${productName(stop.productCode)} 存在重复班次（${shiftVehicleName(prev)}），同站同油品只能安排一次`
        });
      } else {
        seenKeys.set(k, shift.id);
      }
    }
  }

  for (const shift of plan.shifts) {
    const vehicle = vehicleMap.get(shift.vehicleId);
    if (!vehicle) {
      violations.push({
        level: "block",
        code: "product_incompatible",
        shiftId: shift.id,
        message: "班次引用了不存在的车辆"
      });
      continue;
    }

    const load = shift.stops.reduce((sum, s) => sum + (Number(s.qty) || 0), 0);
    if (shift.stops.length === 0) {
      violations.push({
        level: "warn",
        code: "empty_shift",
        shiftId: shift.id,
        message: `${vehicle.name} 存在空班次`
      });
    }
    if (load > vehicle.capacity) {
      violations.push({
        level: "block",
        code: "over_capacity",
        shiftId: shift.id,
        message: `${vehicle.name} 装载 ${load}L 超过容量 ${vehicle.capacity}L（超 ${load - vehicle.capacity}L）`
      });
    }

    for (const stop of shift.stops) {
      const product = productOf(stop.productCode);
      if (!product || !vehicle.compatibleKinds.includes(product.kind)) {
        violations.push({
          level: "block",
          code: "product_incompatible",
          shiftId: shift.id,
          stopId: stop.id,
          message: `${vehicle.name}（${vehicle.compatibleKinds.join("/")}）不可配送 ${stop.stationName} 的 ${product?.name ?? stop.productCode}`
        });
      }
      if (!(Number(stop.qty) > 0)) {
        violations.push({
          level: "block",
          code: "invalid_qty",
          shiftId: shift.id,
          stopId: stop.id,
          message: `${stop.stationName} ${productName(stop.productCode)} 补货量必须大于 0`
        });
      }

      const profile = profileMap.get(stop.stationId);
      if (profile) {
        const arrive = toMinutes(stop.arrive);
        const inWindow = profile.windows.some((w) => {
          const start = toMinutes(w.start);
          const end = toMinutes(w.end);
          return arrive >= start && arrive + stop.serviceMinutes <= end;
        });
        if (!inWindow) {
          const windows = profile.windows.map((w) => `${w.start}-${w.end}`).join("、");
          violations.push({
            level: "block",
            code: "outside_window",
            shiftId: shift.id,
            stopId: stop.id,
            message: `${stop.stationName} 到站 ${stop.arrive} 不在收货时段 ${windows} 内（卸油 ${stop.serviceMinutes} 分钟）`
          });
        }
      }
    }

    // 同一车辆时刻重叠
    const ordered = [...shift.stops].sort((a, b) => toMinutes(a.arrive) - toMinutes(b.arrive));
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      const travel = prev.stationId === cur.stationId ? 0 : TRAVEL_MINUTES;
      if (toMinutes(cur.arrive) < toMinutes(prev.arrive) + prev.serviceMinutes + travel) {
        violations.push({
          level: "block",
          code: "time_overlap",
          shiftId: shift.id,
          stopId: cur.id,
          message: `${vehicle.name}：${prev.stationName}(${prev.arrive}) 与 ${cur.stationName}(${cur.arrive}) 到站时间冲突`
        });
      }
    }
  }

  // 跨计划占用：其他在审/已锁计划同日期同车辆的时段冲突（并发改派联检）
  const reservations = otherPlans
    .filter((p) => p.id !== plan.id && p.date === plan.date && (p.status === "in_review" || p.status === "locked"))
    .flatMap((p) =>
      p.shifts.flatMap((s) =>
        s.stops.map((st) => ({ planCode: p.code, vehicleId: s.vehicleId, stop: st }))
      )
    );
  for (const shift of plan.shifts) {
    for (const stop of shift.stops) {
      const hit = reservations.find(
        (r) =>
          r.vehicleId === shift.vehicleId &&
          intervalOverlap(
            { arrive: stop.arrive, serviceMinutes: stop.serviceMinutes },
            { arrive: r.stop.arrive, serviceMinutes: r.stop.serviceMinutes }
          )
      );
      if (hit) {
        violations.push({
          level: "block",
          code: "cross_plan_conflict",
          shiftId: shift.id,
          stopId: stop.id,
          message: `${vehicleMap.get(shift.vehicleId)?.name ?? "车辆"} 与 ${hit.planCode} 在 ${hit.stop.arrive} 已安排 ${hit.stop.stationName}，时段冲突`
        });
      }
    }
  }

  // 剩余缺口（以本计划生成时快照为基准，保证顶部指标与回看表口径一致）：
  // 已执行站点按实收量抵扣，未执行站点按计划量抵扣；撤销执行即恢复按计划量抵扣。
  const plannedMap = new Map<string, number>();
  const actualMap = new Map<string, number>();
  const executedKeys = new Set<string>();
  for (const shift of plan.shifts) {
    for (const stop of shift.stops) {
      const k = `${stop.stationId}|${stop.productCode}`;
      plannedMap.set(k, (plannedMap.get(k) ?? 0) + (Number(stop.qty) || 0));
      if (stop.executedAt) {
        executedKeys.add(k);
        actualMap.set(k, (actualMap.get(k) ?? 0) + (Number(stop.actualQty) || 0));
      }
    }
  }

  const reasonMap = new Map(plan.unmet.map((u) => [`${u.stationId}|${u.productCode}`, u.reason]));
  const remaining = plan.demandSnapshot.map((d) => {
    const k = `${d.stationId}|${d.productCode}`;
    const planned = plannedMap.get(k) ?? 0;
    // 执行后按实收抵扣；未执行按计划量抵扣
    const covered = executedKeys.has(k) ? actualMap.get(k) ?? 0 : planned;
    const left = Math.max(d.gap - covered, 0);
    return {
      stationId: d.stationId,
      stationName: d.stationName,
      productCode: d.productCode,
      planned,
      gap: left,
      capacity: d.capacity,
      stock: d.stock,
      reason: left > 0 ? reasonMap.get(k) : undefined
    };
  });
  const unmetRows = remaining.filter((r) => r.gap > 0);

  const pendingShifts = plan.shifts.filter((s) => s.stops.some((st) => !st.executedAt)).length;
  const unmetStationCount = new Set(unmetRows.map((r) => r.stationId)).size;

  return {
    violations,
    blocking: violations.filter((v) => v.level === "block"),
    remaining,
    unmetRows,
    pendingShifts,
    unmetStationCount,
    totalPlanned: Array.from(plannedMap.values()).reduce((a, b) => a + b, 0),
    totalRemaining: unmetRows.reduce((a, b) => a + b.gap, 0)
  };
}
