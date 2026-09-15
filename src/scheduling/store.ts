import { ref } from "vue";
import { defineStore } from "pinia";
import { DEFAULT_WINDOW, PRODUCTS, SEED_PROFILES, SEED_VEHICLES } from "./demo";
import {
  analyze,
  buildSuggestions,
  generationSignature,
  mergeGenerated,
  productName,
  scheduleStops
} from "./engine";
import { loadStationRecords, STATION_STORAGE_KEY, type RecordItem } from "../data";
import type {
  DemandItem,
  Plan,
  PlanAnalysis,
  PlanLog,
  PlanStatus,
  Shift,
  ShiftStop,
  StationTankProfile,
  Vehicle
} from "./types";

const PROFILE_KEY = "hxwlfront-21-scheduling-profile";
const VEHICLE_KEY = "hxwlfront-21-scheduling-vehicles";
const PLAN_KEY = "hxwlfront-21-scheduling-plans";
const ACTOR = "调度员";

export class StaleVersionError extends Error {
  constructor() {
    super("计划已被修改（版本过期），已为你刷新");
    this.name = "StaleVersionError";
  }
}

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadJson<T>(key: string, fallback: () => T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback();
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback();
  }
}

function defaultProfileFor(record: RecordItem): StationTankProfile {
  return {
    stationId: record.id,
    stationName: String(record.station ?? "新建油站"),
    area: String(record.area ?? "东区"),
    priority: "medium",
    windows: [{ ...DEFAULT_WINDOW }],
    serviceMinutes: 45,
    tanks: PRODUCTS.map((p) => ({
      productCode: p.code,
      capacity: p.kind === "diesel" ? 15000 : 20000,
      stock: 18000
    }))
  };
}

export const useSchedulingStore = defineStore("scheduling", () => {
  const vehicles = ref<Vehicle[]>(loadJson<Vehicle[]>(VEHICLE_KEY, () => clone(SEED_VEHICLES)));
  const profiles = ref<StationTankProfile[]>(
    loadJson<StationTankProfile[]>(PROFILE_KEY, () => clone(SEED_PROFILES))
  );
  const plans = ref<Plan[]>(loadJson<Plan[]>(PLAN_KEY, () => []));

  function persistProfiles() {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles.value));
  }
  function persistPlans() {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plans.value));
  }

  /**
   * 与油站资料页对齐：新站补默认调度参数、改名/改区同步。
   * 已删除油站的调度参数保留（历史计划回看仍需要站名），不做物理删除。
   */
  function syncFromStationRecords() {
    const records = loadStationRecords();
    let changed = false;
    for (const record of records) {
      const existing = profiles.value.find((p) => p.stationId === record.id);
      if (!existing) {
        profiles.value.push(defaultProfileFor(record));
        changed = true;
      } else if (
        existing.stationName !== String(record.station ?? existing.stationName) ||
        existing.area !== String(record.area ?? existing.area)
      ) {
        existing.stationName = String(record.station ?? existing.stationName);
        existing.area = String(record.area ?? existing.area);
        changed = true;
      }
    }
    if (changed) persistProfiles();
  }

  function updateProfile(updated: StationTankProfile) {
    const index = profiles.value.findIndex((p) => p.stationId === updated.stationId);
    if (index >= 0) profiles.value[index] = clone(updated);
    persistProfiles();
  }

  // ---- 并发控制：跨标签页互斥锁（Web Locks）+ 乐观版本号 CAS ----
  const inTabLocks = new Map<string, Promise<unknown>>();

  function refreshPlansFromStorage() {
    const raw = localStorage.getItem(PLAN_KEY);
    if (raw) {
      try {
        mergeRemotePlans(JSON.parse(raw) as Plan[]);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 同一计划的写操作串行化：
   * - 同标签页：Promise 链
   * - 跨标签页：navigator.locks 命名锁（localStorage 无原子 CAS，必须靠系统级互斥）
   * 拿到锁后先重读持久化数据，保证后到方看到最新 rev，CAS 必然识别出过期写入。
   */
  function withLock<T>(planId: string, task: () => Promise<T> | T): Promise<T> {
    const run = async () => {
      refreshPlansFromStorage();
      try {
        return await task();
      } catch (err) {
        if (err instanceof StaleVersionError) refreshPlansFromStorage();
        throw err;
      }
    };
    if (typeof navigator !== "undefined" && typeof navigator.locks?.request === "function") {
      return navigator.locks.request(`hxwlfront-21-plan-${planId}`, run) as Promise<T>;
    }
    const prev = inTabLocks.get(planId) ?? Promise.resolve();
    const current = prev.then(run);
    inTabLocks.set(
      planId,
      current.catch(() => undefined)
    );
    return current;
  }

  function log(plan: Plan, action: string, detail?: string) {
    const entry: PlanLog = { id: uid("log"), at: nowIso(), action, detail, actor: ACTOR };
    plan.logs.unshift(entry);
  }

  function getPlan(planId: string): Plan {
    const plan = plans.value.find((p) => p.id === planId);
    if (!plan) throw new Error("计划不存在");
    return plan;
  }

  /** CAS 写入：expectedRev 过期则拒绝（并发改派/重复提交防护） */
  function commitPlan(plan: Plan, expectedRev: number) {
    if (plan.rev !== expectedRev) throw new StaleVersionError();
    plan.rev += 1;
    plan.updatedAt = nowIso();
    persistPlans();
  }

  function analysisOf(plan: Plan): PlanAnalysis {
    return analyze(plan, profiles.value, vehicles.value, plans.value);
  }

  function findStop(plan: Plan, stopId: string): ShiftStop {
    for (const shift of plan.shifts) {
      const stop = shift.stops.find((s) => s.id === stopId);
      if (stop) return stop;
    }
    throw new Error("站点任务不存在");
  }

  function requireDraft(plan: Plan) {
    if (plan.status !== "draft") throw new Error("计划已提交或锁定，请先撤回/改单回到草稿");
  }

  // ---- 幂等生成 ----
  const genTokens = new Map<string, string>();

  function computeDemandSnapshot(area: string): DemandItem[] {
    const items: DemandItem[] = [];
    const order = { high: 0, medium: 1, low: 2 };
    for (const profile of profiles.value.filter((p) => p.area === area)) {
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
    return items.sort(
      (a, b) => order[a.priority] - order[b.priority] || b.gap / b.capacity - a.gap / a.capacity
    );
  }

  /** 生成补货建议；同区域同日期的草稿唯一（重复点击/重复提交不产生重复计划） */
  function generateSuggestions(area: string, date: string, idempotencyKey?: string): Plan {
    if (idempotencyKey && genTokens.has(idempotencyKey)) {
      const cached = plans.value.find((p) => p.id === genTokens.get(idempotencyKey));
      if (cached) return cached;
    }
    const existingDraft = plans.value.find(
      (p) => p.area === area && p.date === date && p.status === "draft"
    );
    if (existingDraft) return existingDraft;

    const { shifts, unmet } = buildSuggestions(area, date, profiles.value, vehicles.value);
    const now = nowIso();
    const plan: Plan = {
      id: uid("plan"),
      code: `BH-${date.replace(/-/g, "")}-${area}`,
      area,
      date,
      status: "draft",
      rev: 1,
      shifts,
      unmet,
      demandSnapshot: computeDemandSnapshot(area),
      genSig: generationSignature(area, date, profiles.value),
      logs: [],
      createdAt: now,
      updatedAt: now
    };
    log(
      plan,
      "生成补货建议",
      `按缺口、库容、需求优先级与车队容量生成 ${shifts.length} 个班次${unmet.length ? `，${unmet.length} 项缺口无法完全满足` : ""}`
    );
    plans.value.unshift(plan);
    persistPlans();
    if (idempotencyKey) genTokens.set(idempotencyKey, plan.id);
    return plan;
  }

  /** 重新生成：保留人工调整与执行快照，按当前库存重建其余班次 */
  function regenerate(planId: string, expectedRev: number) {
    return withLock(planId, () => {
      const plan = getPlan(planId);
      requireDraft(plan);
      const { shifts, unmet } = buildSuggestions(plan.area, plan.date, profiles.value, vehicles.value);
      const merged = mergeGenerated(plan.shifts, shifts);
      // 只有并入了新生成任务的班次才重排时刻；纯保留的班次维持人工时刻
      plan.shifts = merged.shifts.map((shift) => {
        const hasFresh = shift.stops.some((s) => merged.freshStopIds.has(s.id));
        if (!hasFresh) return shift;
        const rescheduled = rescheduleShift(shift);
        return rescheduled ? { ...shift, stops: rescheduled } : shift;
      });
      plan.unmet = unmet;
      plan.genSig = generationSignature(plan.area, plan.date, profiles.value);
      log(plan, "重新生成建议", "保留人工调整与执行登记，重建其余班次");
      commitPlan(plan, expectedRev);
    });
  }

  function rescheduleShift(shift: Shift): ShiftStop[] | null {
    const scheduled = scheduleStops(shift.stops, profiles.value);
    if (!scheduled) return null;
    return shift.stops.map((stop) => {
      const hit = scheduled.find(
        (x) => x.stationId === stop.stationId && x.productCode === stop.productCode
      );
      return hit ? { ...stop, arrive: hit.arrive } : { ...stop };
    });
  }

  // ---- 草稿编辑 ----
  function updateStopQty(planId: string, stopId: string, qty: number, expectedRev: number) {
    return withLock(planId, () => {
      const plan = getPlan(planId);
      requireDraft(plan);
      const stop = findStop(plan, stopId);
      stop.qty = Math.max(0, Math.round(qty));
      commitPlan(plan, expectedRev);
    });
  }

  function updateStopArrive(planId: string, stopId: string, arrive: string, expectedRev: number) {
    return withLock(planId, () => {
      const plan = getPlan(planId);
      requireDraft(plan);
      const stop = findStop(plan, stopId);
      stop.arrive = arrive;
      commitPlan(plan, expectedRev);
    });
  }

  /** 改派车辆：若该车辆在本计划已有班次则合并（同站同油品合并数量），随后重排时刻 */
  function reassignVehicle(planId: string, shiftId: string, vehicleId: string, expectedRev: number) {
    return withLock(planId, () => {
      const plan = getPlan(planId);
      requireDraft(plan);
      const shift = plan.shifts.find((s) => s.id === shiftId);
      if (!shift) throw new Error("班次不存在");
      if (shift.vehicleId === vehicleId) return;

      const target = plan.shifts.find((s) => s.vehicleId === vehicleId && s.id !== shiftId);
      if (target) {
        for (const stop of shift.stops) {
          const duplicate = target.stops.find(
            (s) => s.stationId === stop.stationId && s.productCode === stop.productCode
          );
          if (duplicate) duplicate.qty += stop.qty;
          else target.stops.push({ ...stop });
        }
        plan.shifts = plan.shifts.filter((s) => s.id !== shiftId);
      } else {
        shift.vehicleId = vehicleId;
      }

      plan.shifts = plan.shifts.map((s) => {
        const rescheduled = rescheduleShift(s);
        return rescheduled ? { ...s, stops: rescheduled } : s;
      });
      log(
        plan,
        "改派车辆",
        `班次改派至 ${vehicles.value.find((v) => v.id === vehicleId)?.name ?? vehicleId}`
      );
      commitPlan(plan, expectedRev);
    });
  }

  /** 站点任务移动到另一辆车；同站同油品在目标班次已存在则合并（重复班次防护） */
  function moveStop(planId: string, stopId: string, targetVehicleId: string, expectedRev: number) {
    return withLock(planId, () => {
      const plan = getPlan(planId);
      requireDraft(plan);
      let moved: ShiftStop | null = null;
      let fromShift: Shift | null = null;
      for (const shift of plan.shifts) {
        const idx = shift.stops.findIndex((s) => s.id === stopId);
        if (idx >= 0) {
          [moved] = shift.stops.splice(idx, 1);
          fromShift = shift;
          break;
        }
      }
      if (!moved || !fromShift) throw new Error("站点任务不存在");

      if (fromShift.vehicleId !== targetVehicleId) {
        let target = plan.shifts.find((s) => s.vehicleId === targetVehicleId);
        if (!target) {
          target = { id: uid("shift"), vehicleId: targetVehicleId, date: plan.date, stops: [] };
          plan.shifts.push(target);
        }
        const duplicate = target.stops.find(
          (s) => s.stationId === moved!.stationId && s.productCode === moved!.productCode
        );
        if (duplicate) {
          duplicate.qty += moved.qty;
        } else {
          target.stops.push({ ...moved });
        }
        plan.shifts = plan.shifts.filter((s) => s.stops.length > 0);
      }

      plan.shifts = plan.shifts.map((shift) => {
        const rescheduled = rescheduleShift(shift);
        return rescheduled ? { ...shift, stops: rescheduled } : shift;
      });
      log(
        plan,
        "调整班次",
        `${moved.stationName} ${productName(moved.productCode)} 调至 ${vehicles.value.find((v) => v.id === targetVehicleId)?.name ?? targetVehicleId}`
      );
      commitPlan(plan, expectedRev);
    });
  }

  function removeStop(planId: string, stopId: string, expectedRev: number) {
    return withLock(planId, () => {
      const plan = getPlan(planId);
      requireDraft(plan);
      for (const shift of plan.shifts) {
        const idx = shift.stops.findIndex((s) => s.id === stopId);
        if (idx >= 0) {
          const [removed] = shift.stops.splice(idx, 1);
          log(plan, "移除任务", `${removed.stationName} ${productName(removed.productCode)} ${removed.qty}L`);
          break;
        }
      }
      plan.shifts = plan.shifts.filter((s) => s.stops.length > 0);
      commitPlan(plan, expectedRev);
    });
  }

  // ---- 状态机 ----
  /** 草稿 -> 待评审（有阻断性违规禁止提交）；重复调用幂等 */
  function submitForReview(planId: string, expectedRev: number) {
    return withLock(planId, () => {
      const plan = getPlan(planId);
      if (plan.status === "in_review") return; // 重复提交幂等
      if (plan.status !== "draft") throw new Error("仅草稿可提交评审");
      const result = analyze(plan, profiles.value, vehicles.value, plans.value);
      if (result.blocking.length > 0) {
        throw new Error(`存在 ${result.blocking.length} 项阻断性冲突，无法提交：${result.blocking[0].message}`);
      }
      plan.status = "in_review";
      log(plan, "提交评审", `提交 ${plan.shifts.length} 个班次待评审`);
      commitPlan(plan, expectedRev);
    });
  }

  /** 待评审 -> 草稿（撤回） */
  function withdraw(planId: string, expectedRev: number) {
    return withLock(planId, () => {
      const plan = getPlan(planId);
      if (plan.status !== "in_review") throw new Error("仅待评审计划可撤回");
      plan.status = "draft";
      log(plan, "撤回评审", "计划回到草稿，可继续调整");
      commitPlan(plan, expectedRev);
    });
  }

  /** 评审通过 -> 锁定（锁定前再次联检跨计划冲突） */
  function approve(planId: string, expectedRev: number) {
    return withLock(planId, () => {
      const plan = getPlan(planId);
      if (plan.status !== "in_review") throw new Error("仅待评审计划可评审通过");
      const result = analyze(plan, profiles.value, vehicles.value, plans.value);
      if (result.blocking.length > 0) {
        throw new Error(`评审时发现冲突：${result.blocking[0].message}`);
      }
      plan.status = "locked";
      log(plan, "评审通过并锁定", "计划已锁定，开始执行登记");
      commitPlan(plan, expectedRev);
    });
  }

  /** 已锁定 -> 草稿（改单）；已有执行登记的禁止改单 */
  function reopen(planId: string, expectedRev: number) {
    return withLock(planId, () => {
      const plan = getPlan(planId);
      if (plan.status !== "locked") throw new Error("仅已锁定计划可改单");
      const executed = plan.shifts.flatMap((s) => s.stops).filter((s) => s.executedAt);
      if (executed.length > 0) {
        throw new Error(`已有 ${executed.length} 个站点完成收货登记，请先撤销执行再改单`);
      }
      plan.status = "draft";
      log(plan, "改单", "锁定计划撤回草稿重新调整");
      commitPlan(plan, expectedRev);
    });
  }

  /** 执行登记：实收量、差异原因、完成时间；实收回补罐体库存（后续计划缺口实时重算） */
  function registerExecution(
    planId: string,
    stopId: string,
    payload: { actualQty: number; diffReason: string; diffNote?: string; completedAt?: string },
    expectedRev: number
  ) {
    return withLock(planId, () => {
      const plan = getPlan(planId);
      if (plan.status !== "locked") throw new Error("仅已锁定计划可登记执行");
      const stop = findStop(plan, stopId);
      if (stop.executedAt) throw new Error("该站点已登记，请勿重复登记");
      stop.actualQty = Math.max(0, Math.round(payload.actualQty));
      stop.diffReason = payload.diffReason;
      stop.diffNote = payload.diffNote ?? "";
      stop.executedAt = payload.completedAt || nowIso();

      const profile = profiles.value.find((p) => p.stationId === stop.stationId);
      const tank = profile?.tanks.find((t) => t.productCode === stop.productCode);
      if (profile && tank) {
        tank.stock = Math.min(tank.capacity, tank.stock + (stop.actualQty ?? 0));
        persistProfiles();
      }
      log(
        plan,
        "登记实收",
        `${stop.stationName} ${productName(stop.productCode)}：计划 ${stop.qty}L / 实收 ${stop.actualQty}L（${stop.diffReason}）`
      );
      const allDone = plan.shifts.every((s) => s.stops.every((st) => st.executedAt));
      if (allDone) {
        plan.status = "completed";
        log(plan, "计划完成", "所有站点均已登记实收");
      }
      commitPlan(plan, expectedRev);
    });
  }

  /** 撤销执行登记（改单前置），回退已回补库存 */
  function undoExecution(planId: string, stopId: string, expectedRev: number) {
    return withLock(planId, () => {
      const plan = getPlan(planId);
      if (plan.status !== "locked" && plan.status !== "completed") {
        throw new Error("当前状态不可撤销执行");
      }
      const stop = findStop(plan, stopId);
      if (!stop.executedAt) return;
      const profile = profiles.value.find((p) => p.stationId === stop.stationId);
      const tank = profile?.tanks.find((t) => t.productCode === stop.productCode);
      if (profile && tank) {
        tank.stock = Math.max(0, tank.stock - (stop.actualQty ?? 0));
        persistProfiles();
      }
      log(plan, "撤销执行登记", `${stop.stationName} ${productName(stop.productCode)}`);
      stop.actualQty = null;
      stop.diffReason = null;
      stop.diffNote = "";
      stop.executedAt = null;
      if (plan.status === "completed") plan.status = "locked";
      commitPlan(plan, expectedRev);
    });
  }

  function removePlan(planId: string) {
    const plan = getPlan(planId);
    if (plan.status === "in_review" || plan.status === "locked") {
      throw new Error("待评审/已锁定计划不能删除，请先撤回或改单");
    }
    plans.value = plans.value.filter((p) => p.id !== planId);
    persistPlans();
  }

  // ---- 跨标签页同步（CAS 失效的另一端会看到最新 rev） ----
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key === PLAN_KEY && event.newValue) {
        try {
          mergeRemotePlans(JSON.parse(event.newValue) as Plan[]);
        } catch {
          /* ignore */
        }
      }
      if (event.key === STATION_STORAGE_KEY) syncFromStationRecords();
    });
  }

  function mergeRemotePlans(remote: Plan[]) {
    for (const rp of remote) {
      const local = plans.value.find((p) => p.id === rp.id);
      if (!local) plans.value.push(rp);
      else if (rp.rev > local.rev) Object.assign(local, rp);
    }
    const ids = new Set(remote.map((p) => p.id));
    if (plans.value.some((p) => !ids.has(p.id))) {
      plans.value = plans.value.filter((p) => ids.has(p.id));
    }
  }

  return {
    vehicles,
    profiles,
    plans,
    syncFromStationRecords,
    updateProfile,
    analysisOf,
    generateSuggestions,
    regenerate,
    updateStopQty,
    updateStopArrive,
    reassignVehicle,
    moveStop,
    removeStop,
    submitForReview,
    withdraw,
    approve,
    reopen,
    registerExecution,
    undoExecution,
    removePlan
  };
});
