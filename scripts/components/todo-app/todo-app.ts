import sheet from './todo-app.css' with { type: 'css' };
import htmlText from './todo-app.html?raw';

import { TodoStore } from '../../store/todo-store';
import { addTodo, editTodo, removeTodo, toggleTodo } from '../../core/commands';
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
 * The (human) Controller: translates view events (todo-add, todo-toggle, ...)
 * into core commands, and pushes store state into the TodoList view whenever
 * the model emits `change`. It holds no todo state of its own.
 *
 * The store is INJECTABLE (see scripts/main.ts): the composition root hands
 * the same TodoStore to this component and to the WebMCP agent surface, so
 * human and agent mutations flow through one model and one render path. If
 * nothing injects a store (standalone usage, unit tests), a private default
 * is created lazily on first access.
 */
class TodoApp extends HTMLElement {
  private shadow: ShadowRoot;
  private abort: AbortController | null = null;

  #store: TodoStore | null = null;
  #storeAbort: AbortController | null = null;

  get store(): TodoStore {
    this.#store ??= new TodoStore();
    return this.#store;
  }

  set store(next: TodoStore) {
    if (this.#store === next) return;
    this.#store = next;
    // If already connected, move the change subscription to the new store
    // and re-render from its state. (Pre-connect, connectedCallback binds.)
    if (this.abort) this.bindStore();
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.adoptedStyleSheets = [sheet];
  }

  connectedCallback(): void {
    // Capture a `store` own property set before this element was upgraded
    // (the composition root sets it pre-definition) so it routes through the
    // class setter instead of permanently shadowing it.
    if (Object.prototype.hasOwnProperty.call(this, 'store')) {
      const injected = (this as { store: TodoStore }).store;
      delete (this as Partial<Record<'store', TodoStore>>).store;
      this.store = injected;
    }

    this.abort = new AbortController();
    this.render();
    this.setupListeners();
    this.bindStore();
  }

  disconnectedCallback(): void {
    this.abort?.abort();
    this.abort = null;
    this.#storeAbort?.abort();
    this.#storeAbort = null;
  }

  /** Model -> View: subscribe to the current store and render its state. */
  private bindStore(): void {
    this.#storeAbort?.abort();
    this.#storeAbort = new AbortController();
    this.store.addEventListener('change', () => this.updateList(), {
      signal: this.#storeAbort.signal
    });
    // Child custom elements are already defined (imported above), so they
    // upgrade synchronously while the shadow HTML parses — the list is ready
    // to receive data immediately. No handshake event required.
    this.updateList();
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

    // View -> Model: custom events bubbling up from Shadow DOM children,
    // translated into core commands (the same surface the WebMCP agent
    // controller uses) so validation lives in exactly one place. Results are
    // intentionally not awaited: the store emits `change` on every commit,
    // and bindStore() turns that into a render.
    this.addEventListener(
      'todo-add',
      (e: Event) => {
        const { text } = (e as CustomEvent<{ text: string }>).detail;
        void addTodo(this.store, text);
      },
      { signal }
    );

    this.addEventListener(
      'todo-toggle',
      (e: Event) => {
        const { id } = (e as CustomEvent<{ id: string }>).detail;
        void toggleTodo(this.store, id);
      },
      { signal }
    );

    this.addEventListener(
      'todo-delete',
      (e: Event) => {
        const { id } = (e as CustomEvent<{ id: string }>).detail;
        void removeTodo(this.store, id);
      },
      { signal }
    );

    this.addEventListener(
      'todo-edit',
      (e: Event) => {
        const { id, text } = (e as CustomEvent<{ id: string; text: string }>).detail;
        void editTodo(this.store, id, text);
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
