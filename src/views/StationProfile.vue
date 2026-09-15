<script setup lang="ts">
// 油站资料页：由原 App.vue 1:1 搬迁，逻辑/样式/存储键保持不变
import { computed, reactive, ref } from "vue";
import {
  createBlank,
  fields,
  loadStationRecords,
  project,
  statuses,
  type RecordItem
} from "../data";

function loadRecords(): RecordItem[] {
  return loadStationRecords();
}

const records = ref<RecordItem[]>(loadRecords());
const form = reactive<Record<string, string | number>>(createBlank());
const note = ref("");
const filter = ref(project.filters[0]);

const filteredRecords = computed(() => {
  if (filter.value.startsWith("全部")) return records.value;
  return records.value.filter((record) => Object.values(record).includes(filter.value));
});

const metrics = computed(() => {
  const total = records.value.length;
  const second = records.value.filter((record) => record.status === statuses[1]).length;
  const third = records.value.filter((record) => record.status === statuses[2]).length;
  const numberValues = records.value.flatMap((record) =>
    fields.filter((field) => field.type === "number").map((field) => Number(record[field.key] || 0))
  );
  const sum = numberValues.reduce((acc, value) => acc + value, 0);
  return [total, second || sum, third || Math.round(sum / Math.max(total, 1))];
});

const chartRows = computed(() => statuses.map((status) => ({
  status,
  value: records.value.filter((record) => record.status === status).length
})));

const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

function persist() {
  localStorage.setItem(project.storageKey, JSON.stringify(records.value));
}

function nextStatus(status: string) {
  const index = statuses.indexOf(status);
  return statuses[(index + 1) % statuses.length];
}

function primaryText(record: RecordItem) {
  const first = fields[0];
  const second = fields[1];
  return [record[first.key], record[second.key]].filter(Boolean).join(" / ") || project.entityLabel;
}

function submit() {
  records.value = [
    {
      ...form,
      id: crypto.randomUUID(),
      status: statuses[0],
      notes: note.value || "暂无备注",
      createdAt: new Date().toISOString()
    } as RecordItem,
    ...records.value
  ];
  Object.assign(form, createBlank());
  note.value = "";
  persist();
}

function flow(record: RecordItem) {
  record.status = nextStatus(record.status);
  persist();
}

function remove(id: string) {
  records.value = records.value.filter((record) => record.id !== id);
  persist();
}
</script>

<template>
  <div class="station-view" data-testid="station-view">
    <section class="metrics">
      <article v-for="(label, index) in project.metricLabels" :key="label" class="metric">
        <span>{{ label }}</span>
        <strong>{{ metrics[index] }}</strong>
      </article>
    </section>

    <section class="workspace">
      <form class="panel" @submit.prevent="submit" data-testid="station-form">
        <h2>{{ project.formTitle }}</h2>
        <div class="form-grid">
          <label v-for="field in fields" :key="field.key">
            {{ field.label }}
            <select v-if="field.type === 'select'" v-model="form[field.key]" required>
              <option value="">请选择</option>
              <option v-for="option in field.options" :key="option">{{ option }}</option>
            </select>
            <input v-else v-model="form[field.key]" :type="field.type || 'text'" required />
          </label>
          <label>
            备注
            <textarea v-model="note" placeholder="填写处理说明或现场备注" />
          </label>
          <button type="submit">{{ project.primaryAction }}</button>
        </div>
      </form>

      <section class="list-panel">
        <div class="toolbar">
          <h2>{{ project.entityLabel }}列表</h2>
          <select v-model="filter" data-testid="station-filter">
            <option v-for="item in project.filters" :key="item">{{ item }}</option>
          </select>
        </div>

        <div class="record-grid" data-testid="station-list">
          <div v-if="filteredRecords.length === 0" class="empty">暂无匹配数据</div>
          <article v-for="record in filteredRecords" :key="record.id" class="record" :data-testid="`station-card-${record.id}`">
            <div class="record-head">
              <p class="record-title">{{ primaryText(record) }}</p>
              <span class="status">{{ record.status }}</span>
            </div>
            <div class="details">
              <span v-for="field in fields" :key="field.key">{{ field.label }}: {{ record[field.key] }}</span>
            </div>
            <p class="note">{{ record.notes }}</p>
            <div class="actions">
              <button type="button" @click="flow(record)" :data-testid="`station-flow-${record.id}`">流转状态</button>
              <button class="secondary" type="button" @click="navigator.clipboard?.writeText(primaryText(record))">复制摘要</button>
              <button class="danger" type="button" @click="remove(record.id)" :data-testid="`station-remove-${record.id}`">删除</button>
            </div>
          </article>
        </div>

        <div class="mini-chart">
          <div v-for="row in chartRows" :key="row.status" class="bar">
            <span>{{ row.status }}</span>
            <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
      </section>
    </section>
  </div>
</template>
