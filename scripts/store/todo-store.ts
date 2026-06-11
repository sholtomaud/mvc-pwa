import { createDefaultHLC, HLC } from './hlc';
import { defaultPersistence, type TodoPersistence } from './persistence';
import {
  isLive,
  mergeRecord,
  sanitizeRecord,
  toTodo,
  type LWWRegister,
  type Todo,
  type TodoRecord
} from './todo-record';
import { loadJSON } from './storage';
import { uuid } from '../utils/uuid';

export type { Todo, TodoRecord } from './todo-record';

interface LegacyTodo {
  id: number;
  text: string;
  complete: boolean;
}

/**
 * The Model: owns the todo collection as a set of mergeable, HLC-stamped
 * records (local-first: annotate now, synchronize later — see todo-record.ts
 * for the merge semantics).
 *
 * Mutations are SYNCHRONOUS against an in-memory cache and emit `change`
 * immediately; persistence (IndexedDB, with localStorage fallback) happens
 * write-behind. `ready` resolves once persisted state is hydrated, which
 * also emits `change`.
 *
 * `applyRemote()` is the future sync entry point: hand it another replica's
 * records and the merge is deterministic regardless of arrival order.
 */
export class TodoStore extends EventTarget {
  readonly ready: Promise<void>;

  private records = new Map<string, TodoRecord>();
  private readonly persistence: TodoPersistence;
  private readonly hlc: HLC;

  constructor(
    persistence: TodoPersistence = defaultPersistence(),
    hlc: HLC = createDefaultHLC(),
    private readonly legacyKey: string = 'todos'
  ) {
    super();
    this.persistence = persistence;
    this.hlc = hlc;
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    // Ask the browser not to evict our origin's storage under pressure
    // (best-effort; browsers may ignore or prompt).
    try {
      void navigator.storage?.persist?.().catch(() => {});
    } catch {
      // navigator absent outside browsers.
    }
    try {
      const raw = await this.persistence.loadAll();
      for (const entry of raw) {
        const record = sanitizeRecord(entry);
        if (record) {
          this.records.set(record.id, record);
          this.observeRecord(record);
        }
      }
      await this.migrateLegacy();
    } catch {
      // Persistence unavailable: continue as an in-memory store.
    }
    this.emitChange();
  }

  /** One-time lift of the pre-CRDT localStorage blob into stamped records. */
  private async migrateLegacy(): Promise<void> {
    if (this.records.size > 0) return;
    const legacy = loadJSON<unknown>(this.legacyKey, []);
    if (!Array.isArray(legacy) || legacy.length === 0) return;

    const migrated: TodoRecord[] = [];
    for (const entry of legacy as LegacyTodo[]) {
      if (typeof entry?.text !== 'string') continue;
      const id = entry.id !== undefined ? String(entry.id) : uuid();
      const record = this.createRecord(id, entry.text, Boolean(entry.complete));
      this.records.set(record.id, record);
      migrated.push(record);
    }
    if (migrated.length === 0) return;

    await this.persistence.saveMany(migrated);
    try {
      localStorage.removeItem(this.legacyKey);
    } catch {
      // Removal is best-effort; records.size > 0 prevents re-migration.
    }
  }

  /** Live (non-tombstoned) todos, oldest first. */
  getAll(): readonly Todo[] {
    return [...this.records.values()]
      .filter(isLive)
      .sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0))
      .map(toTodo);
  }

  /** Full record set including tombstones — the payload a sync layer ships. */
  getRecords(): readonly TodoRecord[] {
    return [...this.records.values()];
  }

  add(text: string): void {
    const record = this.createRecord(uuid(), text, false);
    this.commit(record);
  }

  edit(id: string, text: string): void {
    this.mutate(id, (r) => ({ ...r, text: this.register(text) }));
  }

  toggle(id: string): void {
    this.mutate(id, (r) => ({ ...r, complete: this.register(!r.complete.value) }));
  }

  /** Tombstone, not removal — deletions must out-merge stale edits. */
  remove(id: string): void {
    this.mutate(id, (r) => ({ ...r, deleted: this.register(true) }));
  }

  /**
   * Merge another replica's records (deterministic, commutative,
   * idempotent). Advances the local clock past everything observed.
   */
  applyRemote(remote: readonly unknown[]): void {
    const changed: TodoRecord[] = [];
    for (const entry of remote) {
      const incoming = sanitizeRecord(entry);
      if (!incoming) continue;
      this.observeRecord(incoming);

      const existing = this.records.get(incoming.id);
      const merged = existing ? mergeRecord(existing, incoming) : incoming;
      if (!existing || JSON.stringify(merged) !== JSON.stringify(existing)) {
        this.records.set(merged.id, merged);
        changed.push(merged);
      }
    }
    if (changed.length === 0) return;
    this.persistence.saveMany(changed).catch(() => {});
    this.emitChange();
  }

  private register<T>(value: T): LWWRegister<T> {
    return { value, ts: this.hlc.now() };
  }

  private createRecord(id: string, text: string, complete: boolean): TodoRecord {
    return {
      id,
      created: this.hlc.now(),
      text: this.register(text),
      complete: this.register(complete),
      deleted: this.register(false)
    };
  }

  private mutate(id: string, change: (r: TodoRecord) => TodoRecord): void {
    const existing = this.records.get(id);
    if (!existing) return;
    this.commit(change(existing));
  }

  private commit(record: TodoRecord): void {
    this.records.set(record.id, record);
    this.persistence.save(record).catch(() => {});
    this.emitChange();
  }

  /** Keep the local clock causally ahead of all observed timestamps. */
  private observeRecord(record: TodoRecord): void {
    this.hlc.receive(record.created);
    this.hlc.receive(record.text.ts);
    this.hlc.receive(record.complete.ts);
    this.hlc.receive(record.deleted.ts);
  }

  private emitChange(): void {
    this.dispatchEvent(
      new CustomEvent<{ todos: readonly Todo[] }>('change', {
        detail: { todos: this.getAll() }
      })
    );
  }
}
