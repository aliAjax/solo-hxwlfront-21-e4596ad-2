<script setup lang="ts">
import { reactive, watch } from "vue";
import { DIFF_REASONS } from "../../scheduling/demo";
import { productName } from "../../scheduling/engine";
import type { ShiftStop } from "../../scheduling/types";

const props = defineProps<{
  open: boolean;
  stop: ShiftStop | null;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "confirm", payload: { actualQty: number; diffReason: string; diffNote: string; completedAt: string }): void;
}>();

const form = reactive({ actualQty: 0, diffReason: DIFF_REASONS[0], diffNote: "", completedAt: "" });

watch(
  () => props.stop,
  (stop) => {
    if (stop) {
      form.actualQty = stop.qty;
      form.diffReason = "足额";
      form.diffNote = "";
      form.completedAt = "";
    }
  }
);

function todayLocalInput() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
</script>

<template>
  <div v-if="open" class="modal-mask" data-testid="execute-dialog" @click.self="emit('close')">
    <div class="modal">
      <h3>登记实收</h3>
      <p v-if="stop" class="dialog-sub">
        {{ stop.stationName }} · {{ productName(stop.productCode) }} · 计划 {{ stop.qty }}L
      </p>
      <form class="form-grid" @submit.prevent="emit('confirm', { ...form })">
        <label>
          实收量 (L)
          <input v-model.number="form.actualQty" type="number" min="0" step="100" required data-testid="exec-actual-qty" />
        </label>
        <label>
          差异原因
          <select v-model="form.diffReason" data-testid="exec-diff-reason">
            <option v-for="reason in DIFF_REASONS" :key="reason">{{ reason }}</option>
          </select>
        </label>
        <label>
          差异说明
          <textarea v-model="form.diffNote" placeholder="运输损耗/拒收/计量差异说明（可选）" data-testid="exec-diff-note" />
        </label>
        <label>
          完成时间（留空取当前时间）
          <input v-model="form.completedAt" type="datetime-local" data-testid="exec-completed-at" :max="todayLocalInput()" />
        </label>
        <div class="actions">
          <button type="submit" data-testid="exec-confirm" :disabled="busy">确认登记</button>
          <button type="button" class="secondary" @click="emit('close')">取消</button>
        </div>
      </form>
    </div>
  </div>
</template>
