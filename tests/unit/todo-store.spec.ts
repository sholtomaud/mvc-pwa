import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TodoStore, type Todo } from '../../scripts/store/todo-store';
import { MemoryPersistence } from '../../scripts/store/persistence';
import { HLC } from '../../scripts/store/hlc';
import { installLocalStorage } from './helpers/local-storage-mock';

let t = 1_000_000;
const clock = () => t++;

function makeStore(persistence = new MemoryPersistence(), nodeId = 'node-a') {
  return new TodoStore(persistence, new HLC(nodeId, clock));
}

describe('TodoStore', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installLocalStorage();
  });

  it('starts empty when nothing is persisted', async () => {
    const store = makeStore();
    await store.ready;
    expect(store.getAll()).toEqual([]);
  });

  it('adds, toggles, edits and removes todos (synchronously, post-ready)', async () => {
    const store = makeStore();
    await store.ready;

    store.add('write tests');
    store.add('ship it');
    expect(store.getAll().map((x) => x.text)).toEqual(['write tests', 'ship it']);

    const [first, second] = store.getAll();
    store.toggle(first.id);
    expect(store.getAll()[0].complete).toBe(true);

    store.edit(second.id, 'ship it today');
    expect(store.getAll()[1].text).toBe('ship it today');

    store.remove(first.id);
    expect(store.getAll().map((x) => x.text)).toEqual(['ship it today']);
  });

  it('uses globally unique string ids (sync-safe, never reused)', async () => {
    const store = makeStore();
    await store.ready;
    store.add('a'); store.add('b'); store.add('c');
    const ids = store.getAll().map((x) => x.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(typeof id).toBe('string');
  });

  it('removal is a tombstone: hidden from getAll, present in getRecords', async () => {
    const store = makeStore();
    await store.ready;
    store.add('doomed');
    const id = store.getAll()[0].id;
    store.remove(id);

    expect(store.getAll()).toEqual([]);
    const record = store.getRecords().find((r) => r.id === id);
    expect(record).toBeTruthy();
    expect(record!.deleted.value).toBe(true);
  });

  it('emits change on hydration and on every mutation', async () => {
    const store = makeStore();
    const seen: (readonly Todo[])[] = [];
    store.addEventListener('change', (e) => {
      seen.push((e as CustomEvent<{ todos: readonly Todo[] }>).detail.todos);
    });
    await store.ready;
    expect(seen.length).toBe(1); // hydration

    store.add('a');
    store.toggle(store.getAll()[0].id);
    store.remove(store.getAll()[0].id);
    expect(seen.length).toBe(4);
    expect(seen[3]).toEqual([]);
  });

  it('persists write-behind and reloads in a fresh store', async () => {
    const persistence = new MemoryPersistence();
    const store = makeStore(persistence);
    await store.ready;
    store.add('survive a reload');
    store.toggle(store.getAll()[0].id);
    await vi.waitFor(() => expect(persistence.records.size).toBe(1));

    const reloaded = makeStore(persistence, 'node-a');
    await reloaded.ready;
    expect(reloaded.getAll()).toEqual(store.getAll());
  });

  it('migrates the legacy localStorage blob into stamped records once', async () => {
    installLocalStorage({
      todos: JSON.stringify([
        { id: 1, text: 'old one', complete: false },
        { id: 2, text: 'old two', complete: true }
      ])
    });
    const persistence = new MemoryPersistence();
    const store = makeStore(persistence);
    await store.ready;

    expect(store.getAll().map((x) => x.text)).toEqual(['old one', 'old two']);
    expect(store.getAll()[1].complete).toBe(true);
    expect(store.getAll().map((x) => x.id)).toEqual(['1', '2']);
    expect(persistence.records.size).toBe(2);
    // Legacy key removed so migration cannot run twice.
    expect(localStorage.getItem('todos')).toBeNull();
  });

  it('filters corrupted or malformed persisted records', async () => {
    const persistence = new MemoryPersistence();
    const seed = makeStore(persistence);
    await seed.ready;
    seed.add('valid');
    await vi.waitFor(() => expect(persistence.records.size).toBe(1));
    // Corrupt the persisted set directly.
    (persistence.records as Map<string, unknown>).set('bad', { id: 'bad', text: 'not a record' });

    const store = makeStore(persistence, 'node-b');
    await store.ready;
    expect(store.getAll().map((x) => x.text)).toEqual(['valid']);
  });

  it('does not crash when persistence fails entirely', async () => {
    const broken = {
      loadAll: () => Promise.reject(new Error('boom')),
      save: () => Promise.reject(new Error('boom')),
      saveMany: () => Promise.reject(new Error('boom'))
    };
    const store = new TodoStore(broken, new HLC('node-a', clock));
    await store.ready;
    expect(() => store.add('still works in memory')).not.toThrow();
    expect(store.getAll()).toHaveLength(1);
  });

  describe('applyRemote (two-replica merge)', () => {
    it('a fresh replica converges to the source replica', async () => {
      const a = makeStore(new MemoryPersistence(), 'node-a');
      const b = makeStore(new MemoryPersistence(), 'node-b');
      await a.ready; await b.ready;

      a.add('from A');
      a.toggle(a.getAll()[0].id);
      b.applyRemote(a.getRecords());

      expect(b.getAll()).toEqual(a.getAll());
    });

    it('concurrent edits to different fields both survive, in either merge order', async () => {
      const a = makeStore(new MemoryPersistence(), 'node-a');
      const b = makeStore(new MemoryPersistence(), 'node-b');
      await a.ready; await b.ready;

      a.add('shared');
      b.applyRemote(a.getRecords());
      const id = a.getAll()[0].id;

      a.edit(id, 'renamed on A'); // concurrent…
      b.toggle(id);               // …divergence

      a.applyRemote(b.getRecords());
      b.applyRemote(a.getRecords());

      expect(a.getAll()).toEqual([{ id, text: 'renamed on A', complete: true }]);
      expect(b.getAll()).toEqual(a.getAll());
    });

    it('a delete out-merges a stale edit on both replicas', async () => {
      const a = makeStore(new MemoryPersistence(), 'node-a');
      const b = makeStore(new MemoryPersistence(), 'node-b');
      await a.ready; await b.ready;

      a.add('doomed');
      b.applyRemote(a.getRecords());
      const id = a.getAll()[0].id;

      a.edit(id, 'edited just before the delete lands');
      b.remove(id);

      a.applyRemote(b.getRecords());
      b.applyRemote(a.getRecords());
      expect(a.getAll()).toEqual([]);
      expect(b.getAll()).toEqual([]);
    });

    it('is idempotent: re-applying the same records changes nothing and emits nothing', async () => {
      const a = makeStore(new MemoryPersistence(), 'node-a');
      const b = makeStore(new MemoryPersistence(), 'node-b');
      await a.ready; await b.ready;
      a.add('once');
      b.applyRemote(a.getRecords());

      let changes = 0;
      b.addEventListener('change', () => changes++);
      b.applyRemote(a.getRecords());
      b.applyRemote(a.getRecords());
      expect(changes).toBe(0);
      expect(b.getAll().length).toBe(1);
    });

    it('writes after a merge are causally later than everything observed', async () => {
      // Replica B's wall clock is far behind A's.
      let ta = 9_000_000; let tb = 1_000;
      const a = new TodoStore(new MemoryPersistence(), new HLC('node-a', () => ta++));
      const b = new TodoStore(new MemoryPersistence(), new HLC('node-b', () => tb++));
      await a.ready; await b.ready;

      a.add('from the future');
      b.applyRemote(a.getRecords());
      const id = b.getAll()[0].id;
      b.edit(id, 'B edits afterwards');

      // A merges B's edit back: B's write must win despite B's slow clock.
      a.applyRemote(b.getRecords());
      expect(a.getAll()[0].text).toBe('B edits afterwards');
    });
  });
});
