// 法医昆虫学样本记录 —— 领域模型

export type ID = string;

/** 发育阶段（实验室鉴定结论之一） */
export type Stage = "卵" | "幼虫" | "蛹" | "成虫";

export const STAGES: Stage[] = ["卵", "幼虫", "蛹", "成虫"];

/** 尸体暴露阶段（现场/鉴定描述） */
export const EXPOSURE_STAGES = [
  "新鲜期",
  "肿胀期",
  "腐败期",
  "干化期",
  "残骸期",
] as const;
export type ExposureStage = (typeof EXPOSURE_STAGES)[number];

/** 保存方式 */
export const PRESERVATIONS = ["乙醇保存", "冷冻保存", "干燥保存", "福尔马林固定"] as const;
export type Preservation = (typeof PRESERVATIONS)[number];

/** 温度读数来源 */
export type ReadingSource = "sensor" | "manual";

/** 案件：一次现场登记一个案件，案件下挂多个采样批次 */
export interface CaseRecord {
  id: ID;
  caseNo: string; // 案件编号
  title: string; // 案件名称
  location: string; // 现场地点
  occurredAt: number; // 案发时间（暴露开始），ms
  createdAt: number;
  notes: string;
  synced: boolean;
  updatedAt: number;
}

/** 采样批次：按案件登记，含采样点与采样时间 */
export interface Batch {
  id: ID;
  caseId: ID;
  batchNo: string; // 批次编号
  samplingPoint: string; // 采样地点 / 采样点
  collectedAt: number; // 采样时间
  preservation: string; // 保存方式
  quantity: number; // 样本数量
  notes: string;
  createdAt: number;
  synced: boolean;
  updatedAt: number;
}

/** 环境温度读数：传感器或人工录入，时间可能乱序、可能断档 */
export interface TempReading {
  id: ID;
  caseId: ID;
  ts: number; // 观测时间 ms
  value: number; // 温度 ℃
  source: ReadingSource;
  synced: boolean;
  updatedAt: number;
}

/** 鉴定结论：暴露阶段与昆虫种属由实验室鉴定；定稿后不可替换 */
export interface Identification {
  id: ID;
  batchId: ID;
  stage: Stage | ""; // 发育阶段
  species: string; // 昆虫种属
  exposureStage: string; // 尸体暴露阶段
  baseTemp: number; // 发育起点温度 ℃
  addValue: number; // 积温快照（定稿时）℃·日
  tempHash: string; // 定稿时温度记录指纹
  finalized: boolean; // 是否定稿
  finalizedAt: number | null;
  finalizedBy: string;
  notes: string;
  synced: boolean;
  updatedAt: number;
}

export type EntityKind = "case" | "batch" | "reading" | "identification";

export interface OutboxItem {
  id: ID;
  kind: EntityKind;
  op: "upsert" | "delete";
  entityId: ID;
  payload: unknown;
  createdAt: number;
}

export interface SyncReport {
  merged: number; // 合并记录数
  reordered: number; // 整理乱序读读数
  gaps: number; // 断档数
  at: number;
}

/** 温度记录断档区间 */
export interface Gap {
  startTs: number;
  endTs: number;
  hours: number;
}

export interface State {
  cases: CaseRecord[];
  batches: Batch[];
  readings: TempReading[];
  identifications: Identification[];
  outbox: OutboxItem[];
  online: boolean;
  lastSyncAt: number | null;
}
