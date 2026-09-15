<script setup lang="ts">
import { computed, reactive } from "vue";
import { useSchedulingStore } from "../../scheduling/store";
import { productName } from "../../scheduling/engine";
import type { Plan, PlanStatus, ShiftStop } from "../../scheduling/types";
import ExecuteDialog from "./ExecuteDialog.vue";
import LogTimeline from "./LogTimeline.vue";

const props = defineProps<{ planId: string }>();
const emit = defineEmits<{
  (e: "back"): void;
  (e: "toast", message: string, kind: "ok" | "error"): void;
}>();

const store = useSchedulingStore();

const plan = computed<Plan | undefined>(() => store.plans.find((p) => p.id === props.planId));
const analysis = computed(() => (plan.value ? store.analysisOf(plan.value) : null));

const statusText: Record<PlanStatus, string> = {
  draft: "草稿",
  in_review: "待评审",
  locked: "已锁定",
  completed: "已完成"
};
const statusClass: Record<PlanStatus, string> = {
  draft: "st-draft",
  in_review: "st-review",
  locked: "st-locked",
  completed: "st-done"
};

const editable = computed(() => plan.value?.status === "draft");

function vehicleName(id: string) {
  const v = store.vehicles.find((x) => x.id === id);
  return v ? `${v.name}（${v.plate}）` : id;
}

async function run(action: () => Promise<void> | void, okMessage?: string): Promise<boolean> {
  if (!plan.value) return false;
  try {
    await action();
    if (okMessage) emit("toast", okMessage, "ok");
    return true;
  } catch (err) {
    emit("toast", err instanceof Error ? err.message : String(err), "error");
    return false;
  }
}

function regenerate() {
  void run(
    () => store.regenerate(props.planId, plan.value!.rev),
    "已按当前库存重新生成，人工调整已保留"
  );
}
function submitReview() {
  void run(() => store.submitForReview(props.planId, plan.value!.rev), "已提交评审");
}
function withdraw() {
  void run(() => store.withdraw(props.planId, plan.value!.rev), "已撤回，计划回到草稿");
}
function approve() {
  void run(() => store.approve(props.planId, plan.value!.rev), "评审通过，计划已锁定");
}
function reopen() {
  void run(() => store.reopen(props.planId, plan.value!.rev), "已改单，计划回到草稿");
}
function remove() {
  void run(() => {
    store.removePlan(props.planId);
    emit("back");
  }, "计划已删除");
}

// ---- 编辑 ----
function onQty(stop: ShiftStop, event: Event) {
  const qty = Number((event.target as HTMLInputElement).value);
  void run(() => store.updateStopQty(props.planId, stop.id, qty, plan.value!.rev));
}
function onArrive(stop: ShiftStop, event: Event) {
  const arrive = (event.target as HTMLInputElement).value;
  if (/^\d{2}:\d{2}$/.test(arrive)) {
    void run(() => store.updateStopArrive(props.planId, stop.id, arrive, plan.value!.rev));
  }
}
function onReassign(shiftId: string, event: Event) {
  const vehicleId = (event.target as HTMLSelectElement).value;
  void run(() => store.reassignVehicle(props.planId, shiftId, vehicleId, plan.value!.rev), "已改派并实时重算");
}
function onMove(stop: ShiftStop, event: Event) {
  const vehicleId = (event.target as HTMLSelectElement).value;
  if (!vehicleId) return;
  void run(() => store.moveStop(props.planId, stop.id, vehicleId, plan.value!.rev), "已调整班次并实时重算");
  (event.target as HTMLSelectElement).value = "";
}
function onRemove(stop: ShiftStop) {
  void run(() => store.removeStop(props.planId, stop.id, plan.value!.rev), "任务已移除");
}

// ---- 执行登记 ----
const dialog = reactive({ open: false, stop: null as ShiftStop | null });
function openExecute(stop: ShiftStop) {
  dialog.stop = stop;
  dialog.open = true;
}
async function confirmExecute(payload: { actualQty: number; diffReason: string; diffNote: string; completedAt: string }) {
  if (!dialog.stop) return;
  const stopId = dialog.stop.id;
  const ok = await run(
    () =>
      store.registerExecution(
        props.planId,
        stopId,
        {
          actualQty: payload.actualQty,
          diffReason: payload.diffReason,
          diffNote: payload.diffNote,
          completedAt: payload.completedAt ? new Date(payload.completedAt).toISOString() : undefined
        },
        plan.value!.rev
      ),
    "实收已登记，缺口已实时重算"
  );
  if (ok) dialog.open = false;
}
function undoExec(stop: ShiftStop) {
  void run(() => store.undoExecution(props.planId, stop.id, plan.value!.rev), "已撤销执行登记");
}

// ---- 回看表（按生成快照 vs 计划 vs 实收） ----
const reviewRows = computed(() => {
  if (!plan.value) return [];
  const planned = new Map<string, number>();
  const actual = new Map<string, number>();
  for (const shift of plan.value.shifts) {
    for (const stop of shift.stops) {
      const k = `${stop.stationId}|${stop.productCode}`;
      planned.set(k, (planned.get(k) ?? 0) + stop.qty);
      if (stop.executedAt) actual.set(k, (actual.get(k) ?? 0) + (stop.actualQty ?? 0));
    }
  }
  return plan.value.demandSnapshot.map((d) => {
    const planQty = planned.get(`${d.stationId}|${d.productCode}`) ?? 0;
    const actualQty = actual.get(`${d.stationId}|${d.productCode}`);
    const stop = plan.value!.shifts
      .flatMap((s) => s.stops)
      .find((st) => st.stationId === d.stationId && st.productCode === d.productCode);
    return {
      ...d,
      planned: planQty,
      actualQty,
      diffReason: stop?.diffReason ?? null,
      diffNote: stop?.diffNote ?? "",
      completedAt: stop?.executedAt ?? null,
      unfilled: Math.max(d.gap - (actualQty ?? planQty), 0)
    };
  });
});

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
</script>

<template>
  <div v-if="plan" class="plan-detail" :data-testid="`plan-detail-${plan.id}`">
    <div class="toolbar plan-head">
      <div>
        <button type="button" class="secondary" data-testid="plan-back" @click="emit('back')">← 返回计划列表</button>
        <h2 class="plan-title">
          {{ plan.code }}
          <span class="plan-status" :class="statusClass[plan.status]" data-testid="plan-status">{{ statusText[plan.status] }}</span>
          <span class="plan-rev">v{{ plan.rev }}</span>
        </h2>
        <p class="plan-meta">{{ plan.area }} · {{ plan.date }}</p>
      </div>
      <div class="actions" data-testid="plan-actions">
        <template v-if="plan.status === 'draft'">
          <button type="button" class="secondary" data-testid="plan-regenerate" @click="regenerate">重新生成建议</button>
          <button type="button" data-testid="plan-submit" :disabled="!!analysis && analysis.blocking.length > 0" @click="submitReview">
            提交评审
          </button>
          <button type="button" class="danger" data-testid="plan-delete" @click="remove">删除</button>
        </template>
        <template v-else-if="plan.status === 'in_review'">
          <button type="button" class="secondary" data-testid="plan-withdraw" @click="withdraw">撤回</button>
          <button type="button" data-testid="plan-approve" :disabled="!!analysis && analysis.blocking.length > 0" @click="approve">
            评审通过
          </button>
        </template>
        <template v-else-if="plan.status === 'locked'">
          <button type="button" data-testid="plan-reopen" @click="reopen">改单（回到草稿）</button>
        </template>
        <template v-else>
          <span class="done-flag">计划已完成，可在下方回看实收与差异</span>
        </template>
      </div>
    </div>

    <section class="metrics mini-metrics" data-testid="plan-metrics">
      <article class="metric"><span>计划补货量</span><strong data-testid="metric-planned">{{ analysis?.totalPlanned ?? 0 }}L</strong></article>
      <article class="metric"><span>剩余缺口</span><strong data-testid="metric-remaining">{{ analysis?.totalRemaining ?? 0 }}L</strong></article>
      <article class="metric"><span>待执行班次</span><strong data-testid="metric-pending">{{ analysis?.pendingShifts ?? 0 }}</strong></article>
      <article class="metric"><span>无法满足站点</span><strong data-testid="metric-unmet-stations">{{ analysis?.unmetStationCount ?? 0 }}</strong></article>
    </section>

    <section v-if="analysis && analysis.violations.length" class="violation-panel" data-testid="violations">
      <h3>校验结果（{{ analysis.violations.length }}）</h3>
      <ul>
        <li
          v-for="(v, i) in analysis.violations"
          :key="`${v.code}-${v.stopId ?? v.shiftId}-${i}`"
          class="violation-item"
          :class="v.level"
          :data-testid="`violation-${v.code}`"
        >
          <span class="violation-level">{{ v.level === "block" ? "阻断" : "提示" }}</span>
          {{ v.message }}
        </li>
      </ul>
    </section>

    <section v-if="analysis && analysis.unmetRows.length" class="unmet-panel" data-testid="unmet-panel">
      <h3>无法满足的缺口（{{ analysis.unmetRows.length }} 项 / {{ analysis.unmetStationCount }} 站）</h3>
      <ul>
        <li v-for="row in analysis.unmetRows" :key="`${row.stationId}-${row.productCode}`" class="unmet-item" data-testid="unmet-item">
          <strong>{{ row.stationName }} · {{ productName(row.productCode) }}</strong>
          缺口 {{ row.gap }}L（库容 {{ row.capacity }}L，库存 {{ row.stock }}L）
          <em v-if="row.reason">{{ row.reason }}</em>
        </li>
      </ul>
    </section>

    <section class="shifts-board">
      <h3>车辆班次（{{ plan.shifts.length }}）</h3>
      <p v-if="plan.shifts.length === 0" class="empty">暂无班次</p>
      <article v-for="shift in plan.shifts" :key="shift.id" class="shift-card" :data-testid="`shift-${shift.id}`">
        <div class="shift-head">
          <label class="vehicle-pick">
            车辆
            <select
              :value="shift.vehicleId"
              :disabled="!editable"
              :data-testid="`shift-vehicle-${shift.id}`"
              @change="onReassign(shift.id, $event)"
            >
              <option v-for="v in store.vehicles" :key="v.id" :value="v.id">
                {{ v.name }}（{{ v.plate }}）· {{ v.capacity }}L · {{ v.compatibleKinds.join("/") }}
              </option>
            </select>
          </label>
          <div class="load-meter" :data-testid="`load-meter-${shift.id}`">
            <span>
              装载
              <strong :class="{ overload: (analysis?.violations.some(v => v.shiftId === shift.id && v.code === 'over_capacity')) }">
                {{ shift.stops.reduce((s, x) => s + Number(x.qty || 0), 0) }}
              </strong>
              / {{ store.vehicles.find(v => v.id === shift.vehicleId)?.capacity ?? "-" }}L
            </span>
          </div>
        </div>

        <table class="stop-table" :data-testid="`stop-table-${shift.id}`">
          <thead>
            <tr>
              <th>站点</th><th>油品</th><th>补货量(L)</th><th>到站</th><th>执行/差异</th><th v-if="editable">调至车辆</th><th v-if="editable"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="stop in shift.stops" :key="stop.id" :data-testid="`stop-row-${stop.id}`">
              <td>{{ stop.stationName }}</td>
              <td>{{ productName(stop.productCode) }}</td>
              <td>
                <input
                  class="qty-input"
                  type="number"
                  min="0"
                  step="100"
                  :value="stop.qty"
                  :disabled="!editable"
                  :data-testid="`stop-qty-${stop.id}`"
                  @change="onQty(stop, $event)"
                />
              </td>
              <td>
                <input
                  class="time-input"
                  type="time"
                  :value="stop.arrive"
                  :disabled="!editable"
                  :data-testid="`stop-arrive-${stop.id}`"
                  @change="onArrive(stop, $event)"
                />
              </td>
              <td :data-testid="`stop-exec-${stop.id}`">
                <template v-if="stop.executedAt">
                  <span class="exec-done">实收 {{ stop.actualQty }}L · {{ stop.diffReason }}</span>
                  <span class="exec-time">{{ fmtTime(stop.executedAt) }}</span>
                  <div v-if="stop.diffNote" class="exec-note">{{ stop.diffNote }}</div>
                  <button
                    v-if="plan.status === 'locked' || plan.status === 'completed'"
                    type="button"
                    class="secondary small"
                    :data-testid="`stop-undo-${stop.id}`"
                    @click="undoExec(stop)"
                  >
                    撤销执行
                  </button>
                </template>
                <template v-else>
                  <span class="exec-pending">待执行</span>
                  <button
                    v-if="plan.status === 'locked'"
                    type="button"
                    class="small"
                    :data-testid="`stop-execute-${stop.id}`"
                    @click="openExecute(stop)"
                  >
                    登记实收
                  </button>
                </template>
              </td>
              <td v-if="editable">
                <select class="move-select" value="" :data-testid="`stop-move-${stop.id}`" @change="onMove(stop, $event)">
                  <option value="">调整…</option>
                  <option v-for="v in store.vehicles.filter(x => x.id !== shift.vehicleId)" :key="v.id" :value="v.id">
                    → {{ v.name }}
                  </option>
                </select>
              </td>
              <td v-if="editable">
                <button type="button" class="danger small" :data-testid="`stop-remove-${stop.id}`" @click="onRemove(stop)">移除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>

    <section class="review-panel">
      <h3>实时缺口与计划回看</h3>
      <table class="review-table" data-testid="review-table">
        <thead>
          <tr><th>站点</th><th>油品</th><th>生成时缺口</th><th>已安排</th><th>当前剩余缺口</th><th>实收</th><th>差异原因</th><th>完成时间</th><th>未补足</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in reviewRows" :key="`${row.stationId}-${row.productCode}`" :data-testid="`review-row-${row.stationId}-${row.productCode}`">
            <td>{{ row.stationName }}</td>
            <td>{{ productName(row.productCode) }}</td>
            <td>{{ row.gap }}</td>
            <td :data-testid="`review-planned-${row.stationId}-${row.productCode}`">{{ row.planned }}</td>
            <td
              :data-testid="`review-remaining-${row.stationId}-${row.productCode}`"
              :class="{ gap: (analysis?.remaining.find(r => r.stationId === row.stationId && r.productCode === row.productCode)?.gap ?? 0) > 0 }"
            >
              {{ analysis?.remaining.find(r => r.stationId === row.stationId && r.productCode === row.productCode)?.gap ?? 0 }}
            </td>
            <td>{{ row.actualQty ?? "—" }}</td>
            <td :data-testid="`review-diff-${row.stationId}-${row.productCode}`">
              <template v-if="row.completedAt">
                {{ row.diffReason }}<span v-if="row.diffNote" class="exec-note">{{ row.diffNote }}</span>
              </template>
              <template v-else>—</template>
            </td>
            <td :data-testid="`review-time-${row.stationId}-${row.productCode}`">{{ fmtTime(row.completedAt) }}</td>
            <td :class="{ gap: row.unfilled > 0 }">{{ row.unfilled }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="log-panel">
      <h3>操作日志</h3>
      <LogTimeline :logs="plan.logs" />
    </section>

    <ExecuteDialog :open="dialog.open" :stop="dialog.stop" @close="dialog.open = false" @confirm="confirmExecute" />
  </div>
  <div v-else class="empty">计划不存在或已被删除。<button type="button" class="secondary" @click="emit('back')">返回</button></div>
</template>
