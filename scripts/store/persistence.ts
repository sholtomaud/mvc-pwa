import { loadJSON, saveJSON } from './storage';
import type { TodoRecord } from './todo-record';

/**
 * Async persistence boundary for todo records.
 *
 * The store mutates an in-memory cache synchronously and writes behind
 * through this interface, so the UI never blocks on storage and the
 * persistence technology can change without touching components.
 */
export interface TodoPersistence {
  loadAll(): Promise<unknown[]>;
  save(record: TodoRecord): Promise<void>;
  saveMany(records: TodoRecord[]): Promise<void>;
}

/** In-memory adapter for tests and last-resort fallback. */
export class MemoryPersistence implements TodoPersistence {
  readonly records = new Map<string, TodoRecord>();

  async loadAll(): Promise<unknown[]> {
    return [...this.records.values()];
  }

  async save(record: TodoRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async saveMany(records: TodoRecord[]): Promise<void> {
    for (const r of records) this.records.set(r.id, r);
  }
}

/** Fallback adapter for environments without IndexedDB. */
export class LocalStoragePersistence implements TodoPersistence {
  constructor(private readonly key: string = 'todo-records') {}

  async loadAll(): Promise<unknown[]> {
    const raw = loadJSON<unknown>(this.key, []);
    return Array.isArray(raw) ? raw : [];
  }

  async save(record: TodoRecord): Promise<void> {
    const all = (await this.loadAll()) as TodoRecord[];
    const next = all.filter((r) => r?.id !== record.id);
    next.push(record);
    saveJSON(this.key, next);
  }

  async saveMany(records: TodoRecord[]): Promise<void> {
    const ids = new Set(records.map((r) => r.id));
    const all = (await this.loadAll()) as TodoRecord[];
    const next = all.filter((r) => r?.id && !ids.has(r.id));
    next.push(...records);
    saveJSON(this.key, next);
  }
}

const DB_NAME = 'mvc-pwa-todos';
const DB_VERSION = 1;
const STORE_NAME = 'todos';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Primary adapter: one object store keyed by record id. */
export class IndexedDBPersistence implements TodoPersistence {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('IndexedDB open blocked'));
      });
    }
    return this.dbPromise;
  }

  async loadAll(): Promise<unknown[]> {
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, 'readonly');
    return requestToPromise(tx.objectStore(STORE_NAME).getAll());
  }

  async save(record: TodoRecord): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).put(record));
  }

  async saveMany(records: TodoRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const r of records) store.put(r);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

/** IndexedDB where available (browsers), localStorage otherwise (jsdom). */
export function defaultPersistence(): TodoPersistence {
  if (typeof indexedDB !== 'undefined') return new IndexedDBPersistence();
  return new LocalStoragePersistence();
}
