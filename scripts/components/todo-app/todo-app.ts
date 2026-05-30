import sheet from './todo-app.css' with { type: 'css' };

// Register child components by importing them
import '../todo-item/todo-item';
import '../todo-input/todo-input';
import '../todo-list/todo-list';
import '../app-navigation/app-navigation';
import '../user-profile/user-profile';

interface Todo {
  id: number;
  text: string;
  complete: boolean;
}



class TodoApp extends HTMLElement {
  private shadow: ShadowRoot;
  private todos: Todo[];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.adoptedStyleSheets = [sheet];
    this.todos = JSON.parse(localStorage.getItem('todos') || '[]');
  }

  async connectedCallback(): Promise<void> {
    await this.render();
    this.setupListeners();
    this.updateList();
  }

  private async render(): Promise<void> {
    const response = await fetch(import.meta.resolve('./todo-app.html'));
    const htmlText = await response.text();
    this.shadow.innerHTML = htmlText;
  }

  private setupListeners(): void {
    // Listen for custom events bubbling from Shadow DOM child components
    this.addEventListener('todo-add', (e: Event) => {
      const customEvent = e as CustomEvent<{ text: string }>;
      this.addTodo(customEvent.detail.text);
    });

    this.addEventListener('todo-toggle', (e: Event) => {
      const customEvent = e as CustomEvent<{ id: number }>;
      this.toggleTodo(customEvent.detail.id);
    });

    this.addEventListener('todo-delete', (e: Event) => {
      const customEvent = e as CustomEvent<{ id: number }>;
      this.deleteTodo(customEvent.detail.id);
    });

    this.addEventListener('todo-edit', (e: Event) => {
      const customEvent = e as CustomEvent<{ id: number; text: string }>;
      this.editTodo(customEvent.detail.id, customEvent.detail.text);
    });

    this.addEventListener('view-change', (e: Event) => {
      const customEvent = e as CustomEvent<{ route: string }>;
      this.switchView(customEvent.detail.route);
    });

    this.addEventListener('list-ready', () => {
      this.updateList();
    });
  }

  private _commit(todos: Todo[]): void {
    this.todos = todos;
    localStorage.setItem('todos', JSON.stringify(todos));
    this.updateList();
  }

  private addTodo(text: string): void {
    const newTodo: Todo = {
      id: this.todos.length > 0 ? this.todos[this.todos.length - 1].id + 1 : 1,
      text,
      complete: false
    };
    this._commit([...this.todos, newTodo]);
  }

  private toggleTodo(id: number): void {
    const updated = this.todos.map(todo =>
      todo.id === id ? { ...todo, complete: !todo.complete } : todo
    );
    this._commit(updated);
  }

  private deleteTodo(id: number): void {
    const updated = this.todos.filter(todo => todo.id !== id);
    this._commit(updated);
  }

  private editTodo(id: number, text: string): void {
    const updated = this.todos.map(todo =>
      todo.id === id ? { ...todo, text } : todo
    );
    this._commit(updated);
  }

  private switchView(route: string): void {
    const render = () => {
      const tasksView = this.shadow.querySelector('#view-tasks') as HTMLElement | null;
      const profileView = this.shadow.querySelector('#view-profile') as HTMLElement | null;
      if (!tasksView || !profileView) return;

      if (route === 'tasks') {
        tasksView.classList.add('active');
        profileView.classList.remove('active');
      } else if (route === 'profile') {
        profileView.classList.add('active');
        tasksView.classList.remove('active');
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docAny = document as any;
    if (docAny.startViewTransition) {
      try {
        const transition: ViewTransition = docAny.startViewTransition(render);
        // Chain .catch() inline — must happen synchronously before any microtask can
        // process the promise rejection, otherwise the AbortError becomes unhandled.
        transition.updateCallbackDone.catch(() => {});
        transition.ready.catch(() => {});
        transition.finished.catch(() => {});
      } catch {
        // startViewTransition can throw synchronously in edge cases
        render();
      }
    } else {
      render();
    }
  }

  private updateList(): void {
    const todoListElement = this.shadow.querySelector('todo-list') as any;
    if (todoListElement && typeof todoListElement.update === 'function') {
      todoListElement.update(this.todos);
    }
  }
}

customElements.define('todo-app', TodoApp);
export default TodoApp;
