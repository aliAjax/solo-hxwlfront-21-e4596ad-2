<script setup lang="ts">
import { ref } from "vue";
import StationProfile from "./views/StationProfile.vue";
import Replenishment from "./views/Replenishment.vue";
import { project } from "./data";

const tab = ref<"stations" | "replenishment">("stations");
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ project.industry }}行业前端最小闭环</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <nav class="module-tabs" data-testid="module-tabs">
        <button
          type="button"
          :class="{ active: tab === 'stations' }"
          data-testid="tab-stations"
          @click="tab = 'stations'"
        >
          油站资料
        </button>
        <button
          type="button"
          :class="{ active: tab === 'replenishment' }"
          data-testid="tab-replenishment"
          @click="tab = 'replenishment'"
        >
          区域补货调度
        </button>
      </nav>

      <StationProfile v-if="tab === 'stations'" />
      <Replenishment v-else />
    </div>
  </main>
</template>
