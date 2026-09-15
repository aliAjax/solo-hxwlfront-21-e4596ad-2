import type { Product, StationTankProfile, Vehicle } from "./types";

export const PRODUCTS: Product[] = [
  { code: "P92", name: "92#汽油", kind: "gasoline" },
  { code: "P95", name: "95#汽油", kind: "gasoline" },
  { code: "P98", name: "98#汽油", kind: "gasoline" },
  { code: "D0", name: "0#柴油", kind: "diesel" }
];

export const AREAS = ["东区", "西区", "机场线"];

export const DEFAULT_WINDOW = { start: "06:00", end: "20:00" };

export const DIFF_REASONS = ["足额", "运输损耗", "计量差异", "拒收"];

// 有限车队：汽油车 3 辆（兼容 92/95/98），柴油车 2 辆（仅 0# 柴油）
export const SEED_VEHICLES: Vehicle[] = [
  { id: "v-g1", name: "汽油1号车", plate: "京A·G1001", capacity: 30000, compatibleKinds: ["gasoline"] },
  { id: "v-g2", name: "汽油2号车", plate: "京A·G1002", capacity: 25000, compatibleKinds: ["gasoline"] },
  { id: "v-g3", name: "汽油3号车", plate: "京A·G1003", capacity: 25000, compatibleKinds: ["gasoline"] },
  { id: "v-d1", name: "柴油1号车", plate: "京A·D2001", capacity: 30000, compatibleKinds: ["diesel"] },
  { id: "v-d2", name: "柴油2号车", plate: "京A·D2002", capacity: 25000, compatibleKinds: ["diesel"] }
];

// 各站分油品库容、当前库存、需求优先级、收货时段
// key 与油站资料种子记录 id 对应
export const SEED_PROFILES: StationTankProfile[] = [
  {
    stationId: "seed-1",
    stationName: "东区一站",
    area: "东区",
    priority: "medium",
    windows: [{ start: "06:00", end: "20:00" }],
    serviceMinutes: 45,
    tanks: [
      { productCode: "P92", capacity: 30000, stock: 21000 },
      { productCode: "P95", capacity: 20000, stock: 16000 },
      { productCode: "P98", capacity: 10000, stock: 8000 },
      { productCode: "D0", capacity: 15000, stock: 13000 }
    ]
  },
  {
    stationId: "seed-2",
    stationName: "机场快线站",
    area: "机场线",
    priority: "high",
    windows: [{ start: "00:00", end: "23:59" }],
    serviceMinutes: 40,
    tanks: [
      { productCode: "P92", capacity: 30000, stock: 22000 },
      { productCode: "P95", capacity: 25000, stock: 21000 },
      { productCode: "P98", capacity: 15000, stock: 14000 },
      { productCode: "D0", capacity: 20000, stock: 8000 }
    ]
  },
  {
    stationId: "seed-3",
    stationName: "东区二站",
    area: "东区",
    priority: "high",
    windows: [{ start: "07:00", end: "19:00" }],
    serviceMinutes: 50,
    tanks: [
      { productCode: "P92", capacity: 30000, stock: 12000 },
      { productCode: "P95", capacity: 20000, stock: 15000 },
      { productCode: "P98", capacity: 10000, stock: 9000 },
      { productCode: "D0", capacity: 15000, stock: 12000 }
    ]
  },
  {
    stationId: "seed-4",
    stationName: "东区三站",
    area: "东区",
    priority: "medium",
    windows: [{ start: "08:00", end: "18:00" }],
    serviceMinutes: 45,
    tanks: [
      { productCode: "P92", capacity: 25000, stock: 18000 },
      { productCode: "P95", capacity: 20000, stock: 9000 },
      { productCode: "P98", capacity: 10000, stock: 7000 },
      { productCode: "D0", capacity: 15000, stock: 13000 }
    ]
  },
  {
    stationId: "seed-5",
    stationName: "西区一站",
    area: "西区",
    priority: "high",
    windows: [{ start: "06:30", end: "20:00" }],
    serviceMinutes: 55,
    tanks: [
      { productCode: "P92", capacity: 30000, stock: 20000 },
      { productCode: "P95", capacity: 20000, stock: 16000 },
      { productCode: "P98", capacity: 10000, stock: 8000 },
      { productCode: "D0", capacity: 30000, stock: 0 }
    ]
  },
  {
    stationId: "seed-6",
    stationName: "西区二站",
    area: "西区",
    priority: "medium",
    windows: [{ start: "07:00", end: "19:30" }],
    serviceMinutes: 50,
    tanks: [
      { productCode: "P92", capacity: 25000, stock: 17000 },
      { productCode: "P95", capacity: 20000, stock: 14000 },
      { productCode: "P98", capacity: 10000, stock: 6000 },
      { productCode: "D0", capacity: 20000, stock: 11000 }
    ]
  },
  {
    stationId: "seed-7",
    stationName: "机场服务站",
    area: "机场线",
    priority: "low",
    windows: [{ start: "05:00", end: "22:00" }],
    serviceMinutes: 40,
    tanks: [
      { productCode: "P92", capacity: 20000, stock: 15000 },
      { productCode: "P95", capacity: 15000, stock: 9000 },
      { productCode: "P98", capacity: 10000, stock: 8000 },
      { productCode: "D0", capacity: 15000, stock: 12000 }
    ]
  },
  {
    stationId: "seed-8",
    stationName: "西区三站",
    area: "西区",
    priority: "low",
    windows: [{ start: "08:00", end: "17:30" }],
    serviceMinutes: 45,
    tanks: [
      { productCode: "P92", capacity: 20000, stock: 16000 },
      { productCode: "P95", capacity: 15000, stock: 12000 },
      { productCode: "P98", capacity: 10000, stock: 8000 },
      { productCode: "D0", capacity: 20000, stock: 3000 }
    ]
  }
];
