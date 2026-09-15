// 油站资料共享定义：StationProfile.vue 与调度模块共用
// 字段、记录形状与存储键均与原 App.vue 保持一致

export type Field = {
  key: string;
  label: string;
  type?: "number" | "date" | "select";
  options?: readonly string[];
};

export type RecordItem = {
  id: string;
  status: string;
  notes: string;
  createdAt: string;
  [key: string]: string | number;
};

export const STATION_STORAGE_KEY = "hxwlfront-21-station-map";

export const project = {
  number: 21,
  folder: "hxwl/frontend/hxwlfront-21",
  framework: "vue",
  title: "油站网点地图管理",
  subtitle: "维护油站位置、营业状态和库存摘要。",
  industry: "石油",
  stack: ["Vue3", "Vite", "TypeScript", "Element Plus", "Leaflet"],
  storageKey: STATION_STORAGE_KEY,
  formTitle: "新增油站",
  primaryAction: "保存油站",
  entityLabel: "油站",
  statuses: ["营业中", "暂停营业", "库存紧张"],
  filters: ["全部区域", "东区", "西区", "机场线"],
  fields: [
    { key: "station", label: "油站名称" },
    {
      key: "area",
      label: "区域",
      type: "select",
      options: ["东区", "西区", "机场线"]
    },
    { key: "stock", label: "库存摘要L", type: "number" },
    { key: "manager", label: "负责人" }
  ],
  records: [
    { station: "东区一站", area: "东区", stock: 36000, manager: "刘站长", status: "营业中", notes: "库存正常" },
    { station: "机场快线站", area: "机场线", stock: 9000, manager: "王站长", status: "库存紧张", notes: "柴油待补" },
    { station: "东区二站", area: "东区", stock: 12000, manager: "陈站长", status: "库存紧张", notes: "92#待补" },
    { station: "东区三站", area: "东区", stock: 28000, manager: "赵站长", status: "营业中", notes: "95#偏低" },
    { station: "西区一站", area: "西区", stock: 14000, manager: "孙站长", status: "库存紧张", notes: "柴油缺口大" },
    { station: "西区二站", area: "西区", stock: 22000, manager: "周站长", status: "营业中", notes: "98#待补" },
    { station: "机场服务站", area: "机场线", stock: 31000, manager: "吴站长", status: "暂停营业", notes: "夜间可收货" },
    { station: "西区三站", area: "西区", stock: 11000, manager: "郑站长", status: "库存紧张", notes: "柴油待补" }
  ],
  metricLabels: ["油站数", "营业中", "库存紧张"]
} as const;

export const fields = project.fields as readonly Field[];
export const statuses = [...project.statuses];

export function createBlank() {
  return Object.fromEntries(fields.map((field) => [field.key, field.type === "number" ? 0 : ""]));
}

export function seedRecords(): RecordItem[] {
  return project.records.map((record, index) => ({
    ...record,
    id: `seed-${index + 1}`,
    createdAt: new Date(Date.now() - index * 86400000).toISOString()
  })) as RecordItem[];
}

export function loadStationRecords(): RecordItem[] {
  const raw = localStorage.getItem(STATION_STORAGE_KEY);
  if (!raw) return seedRecords();
  try {
    return JSON.parse(raw) as RecordItem[];
  } catch {
    return [];
  }
}
