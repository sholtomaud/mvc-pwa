import sheet from './todo-item.css' assert { type: 'css' };

class TodoItem extends HTMLElement {
  private shadow: ShadowRoot;
  private _id: number | null = null;
  private _text: string = '';
  private _complete: boolean = false;

  static get observedAttributes(): string[] {
    return ['id', 'text', 'complete'];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.adoptedStyleSheets = [sheet];
  }

  get todoId(): number | null {
    return this._id;
  }

  set todoId(val: number | null) {
    this._id = val;
    if (val !== null) {
      this.setAttribute('id', val.toString());
    } else {
      this.removeAttribute('id');
    }
  }

  get text(): string {
    return this._text;
  }

  set text(val: string) {
    this._text = val;
    this.setAttribute('text', val);
  }

  get complete(): boolean {
    return this._complete;
  }

  set complete(val: boolean) {
    this._complete = val;
    if (val) {
      this.setAttribute('complete', '');
    } else {
      this.removeAttribute('complete');
    }
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    
    if (name === 'id') {
      this._id = newValue ? parseInt(newValue, 10) : null;
    } else if (name === 'text') {
      this._text = newValue || '';
    } else if (name === 'complete') {
      this._complete = newValue !== null;
    }
    
    this.render();
  }

  async connectedCallback(): Promise<void> {
    await this.render();
    this.setupListeners();
  }

  private setupListeners(): void {
    this.shadow.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      
      // Checkbox toggle
      const checkbox = target.closest('.todo-checkbox') as HTMLButtonElement | null;
      if (checkbox) {
        this.dispatchEvent(new CustomEvent('todo-toggle', {
          bubbles: true,
          composed: true,
          detail: { id: this._id }
        }));
      }

      // Delete button
      const deleteBtn = target.closest('.delete-btn') as HTMLButtonElement | null;
      if (deleteBtn) {
        this.dispatchEvent(new CustomEvent('todo-delete', {
          bubbles: true,
          composed: true,
          detail: { id: this._id }
        }));
      }
    });

    // Edit action on focusout
    this.shadow.addEventListener('focusout', (e: Event) => {
      const target = e.target as HTMLElement;
      const textSpan = target.closest('.todo-text-span') as HTMLSpanElement | null;
      if (textSpan) {
        const updatedText = textSpan.innerText.trim();
        if (updatedText && updatedText !== this._text) {
          this.dispatchEvent(new CustomEvent('todo-edit', {
            bubbles: true,
            composed: true,
            detail: { id: this._id, text: updatedText }
          }));
        } else {
          // Reset text if left empty
          textSpan.innerText = this._text;
        }
      }
    });

    // Enter key to blur and commit
    this.shadow.addEventListener('keydown', (e: Event) => {
      const keyboardEvent = e as KeyboardEvent;
      const target = e.target as HTMLElement;
      const textSpan = target.closest('.todo-text-span') as HTMLSpanElement | null;
      if (textSpan && keyboardEvent.key === 'Enter') {
        e.preventDefault();
        textSpan.blur();
      }
    });
  }

  private async render(): Promise<void> {
    if (this._id !== null) {
      this.style.setProperty('--item-transition-name', `todo-item-${this._id}`);
    }

    const response = await fetch(import.meta.resolve('./todo-item.html'));
    const htmlText = await response.text();
    this.shadow.innerHTML = htmlText;

    // Apply values to HTML elements
    const card = this.shadow.querySelector('.todo-item-card') as HTMLDivElement | null;
    const checkbox = this.shadow.querySelector('.todo-checkbox') as HTMLButtonElement | null;
    const textSpan = this.shadow.querySelector('.todo-text-span') as HTMLSpanElement | null;

    if (card) {
      card.classList.toggle('completed', this._complete);
    }
    if (checkbox) {
      checkbox.classList.toggle('checked', this._complete);
      checkbox.setAttribute('aria-checked', this._complete ? 'true' : 'false');
    }
    if (textSpan) {
      textSpan.innerText = this._text;
    }
  }
}

customElements.define('todo-item', TodoItem);
export default TodoItem;
