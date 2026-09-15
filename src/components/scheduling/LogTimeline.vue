<script setup lang="ts">
import type { PlanLog } from "../../scheduling/types";

defineProps<{ logs: PlanLog[] }>();

function fmt(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
</script>

<template>
  <div class="log-timeline" data-testid="log-timeline">
    <div v-if="logs.length === 0" class="empty">暂无操作记录</div>
    <div v-for="entry in logs" :key="entry.id" class="log-entry" data-testid="log-entry">
      <div class="log-dot" />
      <div class="log-body">
        <div class="log-head">
          <strong>{{ entry.action }}</strong>
          <span>{{ fmt(entry.at) }} · {{ entry.actor }}</span>
        </div>
        <p v-if="entry.detail">{{ entry.detail }}</p>
      </div>
    </div>
  </div>
</template>
