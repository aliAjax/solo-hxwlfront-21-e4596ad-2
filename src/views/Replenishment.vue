<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useSchedulingStore } from "../scheduling/store";
import { AREAS } from "../scheduling/demo";
import { productName } from "../scheduling/engine";
import type { Plan, PlanStatus } from "../scheduling/types";
import PlanDetail from "../components/scheduling/PlanDetail.vue";

const store = useSchedulingStore();
onMounted(() => store.syncFromStationRecords());

function today() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const createForm = reactive({ area: AREAS[0], date: today() });
const selectedId = ref<string | null>(null);

const toastState = reactive({ visible: false, message: "", kind: "ok" as "ok" | "error", timer: 0 });
function toast(message: string, kind: "ok" | "error" = "ok") {
  toastState.message = message;
  toastState.kind = kind;
  toastState.visible = true;
  window.clearTimeout(toastState.timer);
  toastState.timer = window.setTimeout(() => (toastState.visible = false), 3600);
}

function create() {
  const plan = store.generateSuggestions(createForm.area, createForm.date, `gen|${createForm.area}|${createForm.date}`);
  selectedId.value = plan.id;
  toast(
    `已生成 ${plan.shifts.length} 个班次${plan.unmet.length ? `，${plan.unmet.length} 项缺口无法完全满足` : ""}`,
    plan.unmet.length ? "error" : "ok"
  );
}

const statusText: Record<PlanStatus, string> = {
  draft: "草稿",
  in_review: "待评审",
  locked: "已锁定",
  completed: "已完成"
};
const statusOrder: PlanStatus[] = ["draft", "in_review", "locked", "completed"];

const groupedPlans = computed(() =>
  statusOrder.map((status) => ({
    status,
    items: store.plans.filter((p) => p.status === status)
  }))
);

function stopSummary(plan: Plan) {
  const stops = plan.shifts.reduce((n, s) => n + s.stops.length, 0);
  const executed = plan.shifts.reduce(
    (n, s) => n + s.stops.filter((x) => x.executedAt).length,
    0
  );
  return { stops, executed, shifts: plan.shifts.length };
}

function plannedQty(plan: Plan) {
  return plan.shifts.reduce((sum, s) => sum + s.stops.reduce((a, x) => a + Number(x.qty || 0), 0), 0);
}
</script>

<template>
  <div class="replenish" data-testid="replenish-view">
    <div v-if="!selectedId">
      <section class="panel create-panel" data-testid="create-panel">
        <h2>区域补货建议</h2>
        <p class="hint">选择区域与计划日期，按各站油品缺口、库容与需求优先级，把同区域任务合并到有限车辆（自动校验容量、到站时段、油品兼容）。</p>
        <div class="create-row">
          <label>
            区域
            <select v-model="createForm.area" data-testid="create-area">
              <option v-for="area in AREAS" :key="area">{{ area }}</option>
            </select>
          </label>
          <label>
            计划日期
            <input v-model="createForm.date" type="date" data-testid="create-date" />
          </label>
          <button type="button" data-testid="create-generate" @click="create">生成补货建议</button>
        </div>
      </section>

      <section class="plan-board">
        <div v-for="group in groupedPlans" :key="group.status" class="plan-column" :data-testid="`plan-column-${group.status}`">
          <h3>
            {{ statusText[group.status] }}
            <span class="count">{{ group.items.length }}</span>
          </h3>
          <div v-if="group.items.length === 0" class="empty small">暂无</div>
          <article
            v-for="plan in group.items"
            :key="plan.id"
            class="plan-card"
            :data-testid="`plan-card-${plan.id}`"
            @click="selectedId = plan.id"
          >
            <div class="plan-card-head">
              <strong>{{ plan.code }}</strong>
              <span class="plan-status" :class="`st-${plan.status}`">{{ statusText[plan.status] }}</span>
            </div>
            <p class="plan-card-meta">{{ plan.area }} · {{ plan.date }}</p>
            <p class="plan-card-stats">
              {{ stopSummary(plan).shifts }} 车 / {{ stopSummary(plan).stops }} 站次 ·
              计划 {{ plannedQty(plan) }}L
              <template v-if="plan.status === 'locked' || plan.status === 'completed'">
                · 已执行 {{ stopSummary(plan).executed }}/{{ stopSummary(plan).stops }}
              </template>
            </p>
          </article>
        </div>
      </section>

      <section class="panel params-panel" data-testid="params-panel">
        <h2>站点调度参数</h2>
        <p class="hint">分油品库容/库存、需求优先级与收货时段（只读，库存随执行登记实收量自动回补）。</p>
        <div class="params-grid">
          <article v-for="p in store.profiles" :key="p.stationId" class="param-card" :data-testid="`param-${p.stationId}`">
            <div class="param-head">
              <strong>{{ p.stationName }}</strong>
              <span class="pri" :class="`pri-${p.priority}`">
                {{ p.priority === "high" ? "高优先级" : p.priority === "medium" ? "中优先级" : "低优先级" }}
              </span>
            </div>
            <p class="param-meta">{{ p.area }} · 收货 {{ p.windows.map(w => `${w.start}-${w.end}`).join("、") }} · 卸油 {{ p.serviceMinutes }} 分钟</p>
            <ul class="tank-list">
              <li v-for="t in p.tanks" :key="t.productCode">
                {{ productName(t.productCode) }}：库存 {{ t.stock }} / {{ t.capacity }}L
                <span v-if="t.capacity - t.stock > 0" class="gap-tag">缺 {{ t.capacity - t.stock }}</span>
              </li>
            </ul>
          </article>
        </div>
      </section>
    </div>

    <PlanDetail v-else :plan-id="selectedId" @back="selectedId = null" @toast="toast" />

    <transition name="toast">
      <div v-if="toastState.visible" class="toast" :class="toastState.kind" data-testid="toast" role="status">
        {{ toastState.message }}
      </div>
    </transition>
  </div>
</template>
