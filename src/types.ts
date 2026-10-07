// 法医昆虫学采样记录工具 —— 领域数据模型
// 所有实体均为可合并文档：id + updatedAt 用于 LWW 合并，deleted 为墓碑。

export type ID = string;

interface BaseDoc {
  id: ID;
  updatedAt: string; // ISO，含毫秒，字典序即可比较新旧
  deleted?: boolean;
}

/** 案件（现场按案件登记） */
export interface CaseDoc extends BaseDoc {
  type: "case";
  caseNo: string;
  location: string;
  sceneType: string; // 现场类型：室内 / 室外 / 水边 ...
  foundAt: string; // 尸体发现时间 ISO
  examiner: string; // 现场勘验人
  notes?: string;
}

/** 采样点（案件下的具体方位） */
export interface PointDoc extends BaseDoc {
  type: "point";
  caseId: ID;
  name: string;
  microhabitat: string; // 微生境描述
  notes?: string;
}

export type PreservationKind = "ethanol" | "dry" | "freeze" | "live";

/** 采样批次 */
export interface BatchDoc extends BaseDoc {
  type: "batch";
  caseId: ID;
  pointId: ID;
  batchNo: string;
  sampledAt: string; // 采样时刻 ISO（积温估计窗口终点）
  ambientTempC: number | null; // 现场环境温度（人工读数）
  collectedBy: string;
  preservation: PreservationKind;
  notes?: string;
}

/** 传感器 / 人工温度读数（可乱序到达、可断档） */
export interface ReadingDoc extends BaseDoc {
  type: "reading";
  batchId: ID;
  t: string; // 测量时刻 ISO
  c: number; // 温度 ℃
  receivedAt: string; // 到达本机的时刻 ISO（乱序检测依据，晚到的补录不影响哈希）
  source: "sensor" | "manual";
  note?: string;
}

/** 定稿时刻的积温快照，用于日后判断结论是否过时 */
export interface ThermalSnapshot {
  readingsHash: string;
  speciesBaseTempC: number;
  stageTargetADH: number | null;
  gapThresholdMin: number;
  readingCount: number;
  cumulativeADH: number | null;
  ageHoursMin: number | null;
  ageHoursMax: number | null;
  computedAt: string;
}

/** 实验室鉴定结论（草稿可改；定稿不可变，修订只能新建版本） */
export interface IdentificationDoc extends BaseDoc {
  type: "identification";
  batchId: ID;
  versionOf: ID | null; // 首版为 null；修订版指向上一版 id
  status: "draft" | "final";
  stage: StageCode;
  speciesId: ID | "";
  exposureStage: ExposureCode;
  analyst: string;
  lab: string;
  basis: string; // 鉴定依据 / 备注
  finalizedAt?: string;
  snapshot?: ThermalSnapshot;
}

/** 种属发育参数（积温常数，实验室可校准） */
export interface SpeciesDoc extends BaseDoc {
  type: "species";
  scientificName: string;
  commonName: string;
  family: string;
  baseTempC: number; // 发育起点温度
  stageTargetsADH: Partial<Record<StageCode, number | null>>; // 各阶段目标 ADH
  referenceNote: string;
}

export interface SettingsDoc extends BaseDoc {
  type: "settings";
  id: "settings";
  online: boolean;
  gapThresholdMin: number; // 超过该分钟数的断点视为断档
  autoSeed: boolean;
}

export type EntityDoc =
  | CaseDoc
  | PointDoc
  | BatchDoc
  | ReadingDoc
  | IdentificationDoc
  | SpeciesDoc
  | SettingsDoc;

/** 发件箱条目：离线先落本地，联网后重放到中继 */
export interface OutboxOp {
  id: ID;
  at: string;
  doc: EntityDoc; // 删除即 updatedAt 更新的墓碑文档
}

export type StageCode =
  | "egg"
  | "instar1"
  | "instar2"
  | "instar3"
  | "postfeeding"
  | "pupa"
  | "adult";

export type ExposureCode =
  | "fresh"
  | "bloat"
  | "decay"
  | "advanced"
  | "skeleton";

export interface PhotoRec {
  key: string; // 业务键：batch:<id> / identification:<id>
  name: string;
  dataUrl: string;
  updatedAt: string;
}
