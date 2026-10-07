// 应用状态：所有写入先落 IndexedDB，再进发件箱；联网立即重放，断网暂存。
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  BatchDoc,
  CaseDoc,
  EntityDoc,
  ID,
  IdentificationDoc,
  OutboxOp,
  PhotoRec,
  PointDoc,
  ReadingDoc,
  SettingsDoc,
  SpeciesDoc,
} from "../types";
import {
  allOps,
  clearAll,
  deleteOp,
  getAll,
  getPhoto,
  putMeta,
  putOp,
  putPhoto,
  putDoc,
  STORE,
  storeFor,
} from "./db";
import {
  onRelayPush,
  pullFromRelay,
  pushToRelay,
  relayHasData,
  seedRelay,
} from "./relay";
import { buildSeed } from "./seed";
import { getMeta } from "./db";

export interface DataState {
  ready: boolean;
  cases: CaseDoc[];
  points: PointDoc[];
  batches: BatchDoc[];
  readings: ReadingDoc[];
  identifications: IdentificationDoc[];
  species: SpeciesDoc[];
  settings: SettingsDoc | null;
  pendingCount: number;
  lastSyncAt: string | null;
  toast: string | null;
}

const INITIAL: DataState = {
  ready: false,
  cases: [],
  points: [],
  batches: [],
  readings: [],
  identifications: [],
  species: [],
  settings: null,
  pendingCount: 0,
  lastSyncAt: null,
  toast: null,
};

const live = <T extends EntityDoc>(docs: T[]): T[] =>
  docs.filter((d) => !d.deleted);

class Store {
  state: DataState = INITIAL;
  private listeners = new Set<() => void>();
  private version = 0;
  private flushChain: Promise<void> = Promise.resolve();
  private flushQueued = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): number => this.version;

  private emit(patch?: Partial<DataState>): void {
    if (patch) this.state = { ...this.state, ...patch };
    this.version++;
    this.listeners.forEach((l) => l());
  }

  notify(msg: string): void {
    this.emit({ toast: msg });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.emit({ toast: null }), 3500);
  }

  async boot(): Promise<void> {
    const hasDocs = (await getAll<EntityDoc>(STORE.cases)).length > 0;
    if (!hasDocs) {
      if (relayHasData()) {
        // 本机已有"服务端"数据（其他标签页先开过）：直接全量拉取
        await pullFromRelay(null);
      } else {
        await seedRelay(buildSeed().docs);
      }
      await putMeta("lastPullAt", new Date().toISOString());
    }
    await this.reload();
    onRelayPush(() => {
      if (this.state.settings?.online) void this.syncFromRelay();
    });
    // 启动时若有积压（上次断网），联网后自动合并
    if (this.state.settings?.online && this.state.pendingCount > 0) {
      void this.flushOutbox(true);
    }
  }

  private async reload(): Promise<void> {
    const [cases, points, batches, readings, identifications, species, settings, ops, lastPull] =
      await Promise.all([
        getAll<CaseDoc>(STORE.cases),
        getAll<PointDoc>(STORE.points),
        getAll<BatchDoc>(STORE.batches),
        getAll<ReadingDoc>(STORE.readings),
        getAll<IdentificationDoc>(STORE.identifications),
        getAll<SpeciesDoc>(STORE.species),
        getAll<SettingsDoc>(STORE.settings),
        allOps(),
        getMeta<string>("lastPullAt"),
      ]);
    this.emit({
      ready: true,
      cases: live(cases),
      points: live(points),
      batches: live(batches),
      readings: live(readings),
      identifications: live(identifications),
      species: live(species),
      settings: settings[0] ?? null,
      pendingCount: ops.length,
      lastSyncAt: lastPull ?? null,
    });
  }

  /** 统一变更入口：更新 updatedAt → 落本地 → 进发件箱 → 联网即合并 */
  mutate<T extends EntityDoc>(
    doc: { [K in keyof T as K extends "updatedAt" ? never : K]: T[K] },
    message?: string,
  ): void {
    const stamped = { ...doc, updatedAt: new Date().toISOString() } as T;
    if (stamped.type === "identification" && stamped.status === "final") {
      // 定稿文档任何更新都必须走"新建修订版"，这里是最后一道防线
      const existing = this.state.identifications.find((i) => i.id === stamped.id);
      if (existing && existing.status === "final") {
        throw new Error("已定稿的鉴定结论不可修改，请新建修订版");
      }
    }
    void putDoc(storeFor(stamped), stamped);
    const op: OutboxOp = {
      id: `op-${stamped.id}-${Date.now()}`,
      at: new Date().toISOString(),
      doc: stamped as unknown as EntityDoc,
    };
    void putOp(op);
    this.patchLocal(stamped as unknown as EntityDoc);
    this.emit({ pendingCount: this.state.pendingCount + 1 });
    if (message) this.notify(message);
    if (this.state.settings?.online) this.scheduleFlush();
  }

  private patchLocal(doc: EntityDoc): void {
    // 按 id 替换（保留顺序），删除的文档直接移出活跃集合
    const upsert = <T extends { id: ID }>(list: T[], incoming: T): T[] => {
      const next = list.filter((d) => d.id !== incoming.id);
      if (!(incoming as unknown as EntityDoc).deleted) next.push(incoming);
      return next;
    };
    const s = this.state;
    switch (doc.type) {
      case "case":
        s.cases = upsert(s.cases, doc as CaseDoc);
        break;
      case "point":
        s.points = upsert(s.points, doc as PointDoc);
        break;
      case "batch":
        s.batches = upsert(s.batches, doc as BatchDoc);
        break;
      case "reading":
        s.readings = upsert(s.readings, doc as ReadingDoc);
        break;
      case "identification":
        s.identifications = upsert(s.identifications, doc as IdentificationDoc);
        break;
      case "species":
        s.species = upsert(s.species, doc as SpeciesDoc);
        break;
      case "settings":
        s.settings = doc as SettingsDoc;
        break;
    }
  }

  /** 批量追加温度读数（CSV/传感器导入），每条独立进队列 */
  bulkAddReadings(docsRaw: Omit<ReadingDoc, "updatedAt">[]): void {
    if (docsRaw.length === 0) return;
    const now = new Date().toISOString();
    const docs: ReadingDoc[] = docsRaw.map((d) => ({ ...d, updatedAt: now }));
    const ops: OutboxOp[] = docs.map((d) => {
      void putDoc(STORE.readings, d);
      return { id: `op-${d.id}-${Math.random().toString(36).slice(2, 8)}`, at: now, doc: d };
    });
    for (const op of ops) void putOp(op);
    this.state = {
      ...this.state,
      readings: [...this.state.readings, ...docs],
      pendingCount: this.state.pendingCount + docs.length,
    };
    this.emit();
    this.notify(`已记录 ${docs.length} 条温度读数${this.state.settings?.online ? "" : "（离线待合并）"}`);
    if (this.state.settings?.online) this.scheduleFlush();
  }

  async softDelete(doc: EntityDoc): Promise<void> {
    if (doc.type === "identification" && doc.status === "final") {
      this.notify("已定稿结论不可删除");
      return;
    }
    this.mutate({ ...doc, deleted: true } as EntityDoc, "已删除（墓碑将同步到其他设备）");
  }

  async savePhoto(key: string, name: string, dataUrl: string): Promise<void> {
    const rec: PhotoRec = { key, name, dataUrl, updatedAt: new Date().toISOString() };
    await putPhoto(rec);
    this.notify("照片已保存在本机（照片不参与联网合并）");
  }

  loadPhoto(key: string): Promise<PhotoRec | undefined> {
    return getPhoto(key);
  }

  private scheduleFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      void this.flushOutbox(true);
    });
  }

  /** 断网时仅保留在本地；联网后按发件箱顺序合并 */
  async flushOutbox(pullAfter = false): Promise<void> {
    if (!this.state.settings?.online) return;
    this.flushChain = this.flushChain.then(async () => {
      const ops = await allOps();
      if (ops.length === 0 && !pullAfter) return;
      if (ops.length > 0) {
        const result = pushToRelay(ops.map((o) => o.doc));
        for (const op of ops) await deleteOp(op.id);
        if (result.reverted.length > 0) {
          for (const d of result.reverted) await putDoc(storeFor(d), d);
          this.notify(`${result.reverted.length} 项定稿内容被服务器拒绝覆盖，已保留原结论`);
        }
      }
      await this.syncFromRelay();
    });
    await this.flushChain;
  }

  private async syncFromRelay(): Promise<void> {
    const since = (await getMeta<string>("lastPullAt")) ?? null;
    const { merged, latest } = await pullFromRelay(since);
    if (latest) await putMeta("lastPullAt", latest);
    await this.reload();
    if (merged.length > 0) this.notify(`联网合并：接收 ${merged.length} 项更新`);
  }

  async setOnline(online: boolean): Promise<void> {
    const s = this.state.settings;
    if (!s || s.online === online) return;
    this.mutate({ ...s, online }, online ? "已联网：开始合并本地记录" : "已断网：变更先记在本机");
    if (online) await this.flushOutbox(true);
  }

  async setGapThreshold(min: number): Promise<void> {
    const s = this.state.settings;
    if (!s) return;
    this.mutate({ ...s, gapThresholdMin: min }, "断档阈值已更新，积温结论已重算");
  }

  async resetDemo(): Promise<void> {
    await clearAll();
    localStorage.removeItem("forensic-entomo.relay.v1");
    await seedRelay(buildSeed().docs);
    await putMeta("lastPullAt", new Date().toISOString());
    await this.reload();
    this.notify("已恢复演示数据");
  }
}

export const store = new Store();

interface StoreCtx extends DataState {}
const Ctx = createContext<StoreCtx>(INITIAL);

export function StoreProvider({ children }: { children: ReactNode }) {
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const booted = useRef(false);
  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      void store.boot();
    }
  }, []);
  const value = useMemo(() => ({ ...store.state, v: version }), [version]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useStore(): StoreCtx & { v?: number } {
  return useContext(Ctx) as any;
}

export function newId(prefix: string): ID {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}
