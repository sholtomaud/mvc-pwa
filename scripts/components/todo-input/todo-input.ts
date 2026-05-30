import sheet from './todo-input.css' assert { type: 'css' };

class TodoInput extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.adoptedStyleSheets = [sheet];
  }

  async connectedCallback(): Promise<void> {
    await this.render();
    this.setupListeners();
  }

  private async render(): Promise<void> {
    const response = await fetch(import.meta.resolve('./todo-input.html'));
    const htmlText = await response.text();
    this.shadow.innerHTML = htmlText;
  }

  private setupListeners(): void {
    const dialog = this.shadow.querySelector('.todo-dialog') as HTMLDialogElement;
    const fabBtn = this.shadow.querySelector('.fab-btn') as HTMLButtonElement;
    const form = this.shadow.querySelector('.todo-form') as HTMLFormElement;
    const input = this.shadow.querySelector('.todo-text-input') as HTMLInputElement;

    // Sync FAB active state when opened via invoker commands
    fabBtn.addEventListener('click', () => {
      fabBtn.classList.add('open');
    });

    // Clean up active state and form inputs when closed (via Esc, backdrop click, or close button)
    dialog.addEventListener('close', () => {
      fabBtn.classList.remove('open');
      form.reset();
    });

    // Light dismiss (click backdrop to close)
    dialog.addEventListener('click', (e: MouseEvent) => {
      const rect = dialog.getBoundingClientRect();
      const isInDialog = (
        rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width
      );
      if (!isInDialog) {
        dialog.close();
      }
    });

    // Submit form
    form.addEventListener('submit', (e: Event) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) {
        this.dispatchEvent(new CustomEvent('todo-add', {
          bubbles: true,
          composed: true,
          detail: { text }
        }));
        dialog.close();
      }
    });
  }
}

customElements.define('todo-input', TodoInput);
export default TodoInput;
