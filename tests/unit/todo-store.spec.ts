import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TodoStore, type Todo } from '../../scripts/store/todo-store';
import { installLocalStorage } from './helpers/local-storage-mock';

describe('TodoStore', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installLocalStorage();
  });

  it('starts empty when nothing is persisted', () => {
    expect(new TodoStore().getAll()).toEqual([]);
  });

  it('adds, toggles, edits and removes todos', () => {
    const store = new TodoStore();
    store.add('write tests');
    store.add('ship it');

    expect(store.getAll().map((t) => t.text)).toEqual(['write tests', 'ship it']);

    const [first, second] = store.getAll();
    store.toggle(first.id);
    expect(store.getAll()[0].complete).toBe(true);
    expect(store.getAll()[1].complete).toBe(false);

    store.edit(second.id, 'ship it today');
    expect(store.getAll()[1].text).toBe('ship it today');

    store.remove(first.id);
    expect(store.getAll().map((t) => t.text)).toEqual(['ship it today']);
  });

  it('never reuses ids after deleting the last todo', () => {
    const store = new TodoStore();
    store.add('a');
    store.add('b');
    const idOfB = store.getAll()[1].id;
    store.remove(idOfB);
    store.add('c');
    expect(store.getAll()[1].id).toBeGreaterThan(idOfB - 1);
    expect(store.getAll()[1].id).not.toBe(store.getAll()[0].id);
  });

  it('emits a change event with the new collection on every mutation', () => {
    const store = new TodoStore();
    const seen: (readonly Todo[])[] = [];
    store.addEventListener('change', (e) => {
      seen.push((e as CustomEvent<{ todos: readonly Todo[] }>).detail.todos);
    });

    store.add('a');
    store.toggle(store.getAll()[0].id);
    store.remove(store.getAll()[0].id);

    expect(seen).toHaveLength(3);
    expect(seen[2]).toEqual([]);
  });

  it('persists mutations and reloads them in a fresh store', () => {
    installLocalStorage();
    const store = new TodoStore();
    store.add('survive a reload');

    const reloaded = new TodoStore();
    expect(reloaded.getAll()).toEqual(store.getAll());
  });

  it('survives corrupted persisted JSON', () => {
    installLocalStorage({ todos: '{not json!!' });
    expect(new TodoStore().getAll()).toEqual([]);
  });

  it('filters malformed records out of persisted data', () => {
    installLocalStorage({
      todos: JSON.stringify([
        { id: 1, text: 'valid', complete: false },
        { id: 'nope', text: 42 },
        null,
        'garbage'
      ])
    });
    const store = new TodoStore();
    expect(store.getAll()).toEqual([{ id: 1, text: 'valid', complete: false }]);
  });

  it('does not crash when localStorage itself is unavailable', () => {
    vi.unstubAllGlobals(); // Node has no localStorage at all
    const store = new TodoStore();
    expect(() => store.add('still works in memory')).not.toThrow();
    expect(store.getAll()).toHaveLength(1);
  });
});
