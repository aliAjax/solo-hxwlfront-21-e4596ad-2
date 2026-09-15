// 区域补货调度领域类型

export type ProductKind = "gasoline" | "diesel";

export interface Product {
  code: string;
  name: string;
  kind: ProductKind;
}

export type Priority = "high" | "medium" | "low";

export interface TimeWindow {
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface TankState {
  productCode: string;
  capacity: number; // 罐体库容 L
  stock: number; // 当前库存 L
}

/** 站点的调度参数（分油品库容/库存、需求优先级、收货时段） */
export interface StationTankProfile {
  stationId: string;
  stationName: string;
  area: string;
  priority: Priority;
  windows: TimeWindow[];
  serviceMinutes: number;
  tanks: TankState[];
}

export interface Vehicle {
  id: string;
  name: string;
  plate: string;
  capacity: number; // 车辆容量 L
  compatibleKinds: ProductKind[];
}

export interface DemandItem {
  stationId: string;
  stationName: string;
  productCode: string;
  gap: number; // 缺口 = 库容 - 当前库存
  capacity: number;
  stock: number;
  priority: Priority;
}

export interface ShiftStop {
  id: string;
  stationId: string;
  stationName: string;
  productCode: string;
  qty: number; // 计划补货量 L
  arrive: string; // 到站时刻 HH:mm
  serviceMinutes: number;
  // 执行登记
  actualQty: number | null;
  diffReason: string | null; // 足额 / 运输损耗 / 拒收 / 计量差异
  diffNote: string;
  executedAt: string | null; // 完成时间 ISO
}

export interface Shift {
  id: string;
  vehicleId: string;
  date: string; // YYYY-MM-DD
  stops: ShiftStop[];
}

export interface UnmetDemand extends DemandItem {
  reason: string;
}

export type PlanStatus = "draft" | "in_review" | "locked" | "completed";

export interface PlanLog {
  id: string;
  at: string;
  action: string;
  detail?: string;
  actor: string;
}

export interface Plan {
  id: string;
  code: string;
  area: string;
  date: string;
  status: PlanStatus;
  rev: number;
  shifts: Shift[];
  unmet: UnmetDemand[]; // 生成建议时无法满足的缺口（快照射影）
  demandSnapshot: DemandItem[]; // 生成时的需求快照，用于按计划回看
  genSig: string; // 建议生成签名，重复生成幂等
  logs: PlanLog[];
  createdAt: string;
  updatedAt: string;
}

export type ViolationCode =
  | "over_capacity"
  | "invalid_qty"
  | "product_incompatible"
  | "outside_window"
  | "time_overlap"
  | "cross_plan_conflict"
  | "empty_shift";

export interface Violation {
  level: "block" | "warn";
  code: ViolationCode;
  message: string;
  shiftId?: string;
  stopId?: string;
}

export interface RemainingGap {
  stationId: string;
  stationName: string;
  productCode: string;
  planned: number;
  gap: number; // 重算后的剩余缺口
  capacity: number;
  stock: number;
  reason?: string;
}

export interface PlanAnalysis {
  violations: Violation[];
  blocking: Violation[];
  remaining: RemainingGap[];
  unmetRows: RemainingGap[];
  pendingShifts: number; // 待执行班次数
  unmetStationCount: number; // 无法满足的站点数
  totalPlanned: number;
  totalRemaining: number;
}
