import sheet from './todo-app.css' with { type: 'css' };
import htmlText from './todo-app.html?raw';

import { TodoStore } from '../../store/todo-store';
import { withViewTransition } from '../../utils/view-transition';

// Importing child components for their side effect (customElements.define).
// NOTE: these bare imports are load-bearing — an import binding used only in
// type positions (like TodoList below) is elided by the TS transform, which
// would silently drop the component registration.
import '../todo-list/todo-list';
import '../todo-item/todo-item';
import '../todo-input/todo-input';
import '../app-navigation/app-navigation';
import '../user-profile/user-profile';

// Type-only import so the cross-component `update()` call is type-checked.
import type TodoList from '../todo-list/todo-list';

/**
 * The Controller: translates view events (todo-add, todo-toggle, ...) into
 * store mutations, and pushes store state into the TodoList view whenever
 * the model emits `change`. It holds no todo state of its own.
 */
class TodoApp extends HTMLElement {
  private shadow: ShadowRoot;
  private store: TodoStore;
  private abort: AbortController | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.adoptedStyleSheets = [sheet];
    this.store = new TodoStore();
  }

  connectedCallback(): void {
    this.abort = new AbortController();
    this.render();
    this.setupListeners();
    // Child custom elements are already defined (imported above), so they
    // upgrade synchronously while the shadow HTML parses — the list is ready
    // to receive data immediately. No handshake event required.
    this.updateList();
  }

  disconnectedCallback(): void {
    this.abort?.abort();
    this.abort = null;
  }

  private render(): void {
    this.shadow.innerHTML = htmlText;
    // Parser-created custom elements inside innerHTML are upgraded via the
    // backup element queue (a microtask), NOT synchronously — even when
    // already defined. Force the upgrade now so children expose their class
    // API (e.g. TodoList.update) immediately.
    customElements.upgrade(this.shadow);
  }

  private setupListeners(): void {
    const signal = this.abort?.signal;

    // Model -> View: re-render the list on every store change.
    this.store.addEventListener('change', () => this.updateList(), { signal });

    // View -> Model: custom events bubbling up from Shadow DOM children.
    this.addEventListener(
      'todo-add',
      (e: Event) => {
        const { text } = (e as CustomEvent<{ text: string }>).detail;
        this.store.add(text);
      },
      { signal }
    );

    this.addEventListener(
      'todo-toggle',
      (e: Event) => {
        const { id } = (e as CustomEvent<{ id: number }>).detail;
        this.store.toggle(id);
      },
      { signal }
    );

    this.addEventListener(
      'todo-delete',
      (e: Event) => {
        const { id } = (e as CustomEvent<{ id: number }>).detail;
        this.store.remove(id);
      },
      { signal }
    );

    this.addEventListener(
      'todo-edit',
      (e: Event) => {
        const { id, text } = (e as CustomEvent<{ id: number; text: string }>).detail;
        this.store.edit(id, text);
      },
      { signal }
    );

    this.addEventListener(
      'view-change',
      (e: Event) => {
        const { route } = (e as CustomEvent<{ route: string }>).detail;
        this.switchView(route);
      },
      { signal }
    );
  }

  private switchView(route: string): void {
    if (route !== 'tasks' && route !== 'profile') return;

    withViewTransition(() => {
      const tasksView = this.shadow.querySelector<HTMLElement>('#view-tasks');
      const profileView = this.shadow.querySelector<HTMLElement>('#view-profile');
      if (!tasksView || !profileView) return;

      tasksView.classList.toggle('active', route === 'tasks');
      profileView.classList.toggle('active', route === 'profile');
    });
  }

  private updateList(): void {
    const todoList = this.shadow.querySelector<TodoList>('todo-list');
    todoList?.update(this.store.getAll());
  }
}

customElements.define('todo-app', TodoApp);
export default TodoApp;
