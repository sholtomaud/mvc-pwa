import sheet from './todo-list.css' with { type: 'css' };
import htmlText from './todo-list.html?raw';

import type { Todo } from '../../store/todo-store';
import { withViewTransition } from '../../utils/view-transition';
// Bare import for the side effect (customElements.define) — load-bearing,
// since the TodoItem binding below is only used in type positions and is
// elided by the TS transform.
import '../todo-item/todo-item';
import type TodoItem from '../todo-item/todo-item';

/**
 * Pure view: renders the todo collection it is given.
 *
 * Updates are keyed by todo id and patched in place instead of rebuilding
 * the whole <ul> via innerHTML on every mutation. This keeps DOM churn at
 * O(changes), preserves focus inside contenteditable spans during unrelated
 * updates, and lets per-item view-transition names actually match between
 * frames. Existing nodes are never re-appended (re-appending reconnects the
 * element and re-runs connectedCallback), only inserted or removed.
 */
class TodoList extends HTMLElement {
  private shadow: ShadowRoot;
  private items = new Map<string, TodoItem>();

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.adoptedStyleSheets = [sheet];
  }

  connectedCallback(): void {
    this.shadow.innerHTML = htmlText;
    // Re-stamping the template orphans any previously tracked item nodes.
    this.items.clear();
  }

  update(todos: readonly Todo[]): void {
    withViewTransition(() => this.reconcile(todos));
  }

  private reconcile(todos: readonly Todo[]): void {
    const container = this.shadow.querySelector<HTMLDivElement>('.list-container');
    if (!container) return;

    if (todos.length === 0) {
      this.items.clear();
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z" />
          </svg>
          <p>All clean! Nothing to do right now.</p>
        </div>
      `;
      return;
    }

    let ul = container.querySelector<HTMLUListElement>('ul.todo-list');
    if (!ul) {
      // Coming from the empty state (or first render): start a fresh list.
      this.items.clear();
      container.innerHTML = '<ul class="todo-list"></ul>';
      ul = container.querySelector<HTMLUListElement>('ul.todo-list')!;
    }

    const nextIds = new Set(todos.map((t) => t.id));

    // Remove items that no longer exist.
    for (const [id, el] of this.items) {
      if (!nextIds.has(id)) {
        el.remove();
        this.items.delete(id);
      }
    }

    // Patch existing items, insert new ones at their correct position.
    let cursor: ChildNode | null = ul.firstChild;
    for (const todo of todos) {
      const existing = this.items.get(todo.id);

      if (existing) {
        // Property setters no-op via the attributeChangedCallback
        // oldValue === newValue guard when nothing changed.
        if (existing.text !== todo.text) existing.text = todo.text;
        if (existing.complete !== todo.complete) existing.complete = todo.complete;
        if (cursor === existing) cursor = existing.nextSibling;
        continue;
      }

      const item = document.createElement('todo-item') as TodoItem;
      item.todoId = todo.id;
      item.text = todo.text;
      item.complete = todo.complete;
      ul.insertBefore(item, cursor);
      this.items.set(todo.id, item);
    }
  }
}

customElements.define('todo-list', TodoList);
export default TodoList;
