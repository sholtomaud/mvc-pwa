import { loadJSON, saveJSON } from './storage';

export interface Todo {
  id: number;
  text: string;
  complete: boolean;
}

/**
 * The Model of the app: owns the todo collection and its persistence.
 *
 * Extends EventTarget so views/controllers can subscribe with plain
 * addEventListener — no framework, no custom pub/sub. Emits a `change`
 * CustomEvent<{ todos: readonly Todo[] }> after every mutation.
 *
 * Persistence is currently localStorage; because it is isolated here, the
 * planned IndexedDB/HLC migration (see TODO.md) only has to touch this file.
 */
export class TodoStore extends EventTarget {
  private todos: Todo[];

  constructor(private readonly storageKey: string = 'todos') {
    super();
    this.todos = TodoStore.sanitize(loadJSON<unknown>(this.storageKey, []));
  }

  /** Never trust persisted data: keep only well-formed Todo records. */
  private static sanitize(raw: unknown): Todo[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (t): t is Todo =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as Todo).id === 'number' &&
        typeof (t as Todo).text === 'string' &&
        typeof (t as Todo).complete === 'boolean'
    );
  }

  getAll(): readonly Todo[] {
    return this.todos;
  }

  add(text: string): void {
    // max+1 (not last+1) so ids are never reused after deleting the tail —
    // reused ids would break keyed DOM reconciliation and future sync.
    const nextId = this.todos.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    this.commit([...this.todos, { id: nextId, text, complete: false }]);
  }

  toggle(id: number): void {
    this.commit(
      this.todos.map((t) => (t.id === id ? { ...t, complete: !t.complete } : t))
    );
  }

  edit(id: number, text: string): void {
    this.commit(this.todos.map((t) => (t.id === id ? { ...t, text } : t)));
  }

  remove(id: number): void {
    this.commit(this.todos.filter((t) => t.id !== id));
  }

  private commit(next: Todo[]): void {
    this.todos = next;
    saveJSON(this.storageKey, next);
    this.dispatchEvent(
      new CustomEvent<{ todos: readonly Todo[] }>('change', {
        detail: { todos: next }
      })
    );
  }
}
