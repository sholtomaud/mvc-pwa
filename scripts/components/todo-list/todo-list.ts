import sheet from './todo-list.css' with { type: 'css' };
import htmlText from './todo-list.html?raw';

interface Todo {
  id: number;
  text: string;
  complete: boolean;
}

class TodoList extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.adoptedStyleSheets = [sheet];
  }

  connectedCallback(): void {
    this.render();
    this.dispatchEvent(new CustomEvent('list-ready', {
      bubbles: true,
      composed: true
    }));
  }

  private render(): void {
    this.shadow.innerHTML = htmlText;
  }

  update(todos: Todo[]): void {
    const renderDom = () => {
      const container = this.shadow.querySelector('.list-container') as HTMLDivElement | null;
      if (!container) return;

      if (!todos || todos.length === 0) {
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

      container.innerHTML = `<ul class="todo-list"></ul>`;
      const ul = container.querySelector('ul') as HTMLUListElement;

      todos.forEach(todo => {
        // Create custom todo-item element
        const item = document.createElement('todo-item') as any;
        item.todoId = todo.id;
        item.text = todo.text;
        item.complete = todo.complete;
        ul.appendChild(item);
      });
    };

    const doc = document as any;
    // Use View Transitions API if supported
    if (doc.startViewTransition) {
      doc.startViewTransition(() => {
        renderDom();
      });
    } else {
      renderDom();
    }
  }
}

customElements.define('todo-list', TodoList);
export default TodoList;
