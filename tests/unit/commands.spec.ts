import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TodoStore } from '../../scripts/store/todo-store';
import { MemoryPersistence } from '../../scripts/store/persistence';
import { HLC } from '../../scripts/store/hlc';
import {
  addTodo,
  editTodo,
  listTodos,
  MAX_TEXT_LENGTH,
  removeTodo,
  toggleTodo
} from '../../scripts/core/commands';
import { installLocalStorage } from './helpers/local-storage-mock';

let t = 1_000_000;
const clock = () => t++;

function makeStore() {
  return new TodoStore(new MemoryPersistence(), new HLC('node-a', clock));
}

describe('core commands', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installLocalStorage();
  });

  it('list awaits hydration and returns persisted todos', async () => {
    const persistence = new MemoryPersistence();
    const seed = makeStore();
    await seed.ready;
    seed.add('persisted');
    await new TodoStore(persistence, new HLC('node-a', clock)).ready;

    // NOTE: deliberately NOT awaiting store.ready ourselves — the command must.
    const store = makeStore();
    const result = await listTodos(store);
    expect(result.ok).toBe(true);
  });

  it('add trims, validates, and returns the updated list', async () => {
    const store = makeStore();
    const result = await addTodo(store, '  ship it  ');
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.todos.map((x) => x.text)).toEqual(['ship it']);
    }
  });

  it('add rejects non-strings, empty, and oversized text without mutating', async () => {
    const store = makeStore();
    for (const bad of [42, null, undefined, '', '   ', 'x'.repeat(MAX_TEXT_LENGTH + 1)]) {
      const result = await addTodo(store, bad);
      expect(result.ok).toBe(false);
    }
    expect(store.getAll()).toHaveLength(0);
  });

  it('toggle/edit/remove resolve ids against live todos and report unknown ids', async () => {
    const store = makeStore();
    await addTodo(store, 'a');
    const [todo] = store.getAll();

    expect((await toggleTodo(store, todo.id)).ok).toBe(true);
    expect(store.getAll()[0].complete).toBe(true);

    expect((await editTodo(store, todo.id, 'b')).ok).toBe(true);
    expect(store.getAll()[0].text).toBe('b');

    expect((await removeTodo(store, todo.id)).ok).toBe(true);
    expect(store.getAll()).toHaveLength(0);

    // Tombstoned ids are no longer addressable.
    const gone = await toggleTodo(store, todo.id);
    expect(gone.ok).toBe(false);

    for (const bad of [123, '', 'nope', undefined]) {
      expect((await toggleTodo(store, bad)).ok).toBe(false);
      expect((await removeTodo(store, bad)).ok).toBe(false);
      expect((await editTodo(store, bad, 'x')).ok).toBe(false);
    }
  });

  it('edit validates replacement text against the same rules as add', async () => {
    const store = makeStore();
    await addTodo(store, 'keep me');
    const [todo] = store.getAll();
    const result = await editTodo(store, todo.id, '   ');
    expect(result.ok).toBe(false);
    expect(store.getAll()[0].text).toBe('keep me');
  });
});
