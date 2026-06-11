import sheet from './todo-item.css' with { type: 'css' };
import htmlText from './todo-item.html?raw';

class TodoItem extends HTMLElement {
  private shadow: ShadowRoot;
  private _id: string | null = null;
  private _text: string = '';
  private _complete: boolean = false;
  private listenersAttached = false;

  // `data-id` rather than `id`: the global HTML id attribute has document-wide
  // semantics (fragment targets, label[for], CSS #selectors) and stamping todo
  // ids like "1"/"2" onto it invites collisions.
  static get observedAttributes(): string[] {
    return ['data-id', 'text', 'complete'];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.adoptedStyleSheets = [sheet];
  }

  get todoId(): string | null {
    return this._id;
  }

  set todoId(val: string | null) {
    this._id = val;
    if (val !== null) {
      this.setAttribute('data-id', val);
    } else {
      this.removeAttribute('data-id');
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

    if (name === 'data-id') {
      this._id = newValue || null;
    } else if (name === 'text') {
      this._text = newValue || '';
    } else if (name === 'complete') {
      this._complete = newValue !== null;
    }

    this.render();
  }

  connectedCallback(): void {
    this.render();
    this.setupListeners();
  }

  private setupListeners(): void {
    // connectedCallback re-runs if the element is ever moved/re-appended;
    // the shadow root persists, so guard against stacking duplicate listeners.
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    this.shadow.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;

      // Checkbox toggle
      const checkbox = target.closest<HTMLButtonElement>('.todo-checkbox');
      if (checkbox) {
        this.dispatchEvent(new CustomEvent('todo-toggle', {
          bubbles: true,
          composed: true,
          detail: { id: this._id }
        }));
      }

      // Delete button
      const deleteBtn = target.closest<HTMLButtonElement>('.delete-btn');
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
      const textSpan = target.closest<HTMLSpanElement>('.todo-text-span');
      if (textSpan) {
        // textContent rather than innerText: no forced layout, identical for
        // a single-line span, and implemented in non-browser DOMs (jsdom).
        const updatedText = (textSpan.textContent ?? '').trim();
        if (updatedText && updatedText !== this._text) {
          this.dispatchEvent(new CustomEvent('todo-edit', {
            bubbles: true,
            composed: true,
            detail: { id: this._id, text: updatedText }
          }));
        } else {
          // Reset text if left empty
          textSpan.textContent = this._text;
        }
      }
    });

    // Enter key to blur and commit
    this.shadow.addEventListener('keydown', (e: Event) => {
      const keyboardEvent = e as KeyboardEvent;
      const target = e.target as HTMLElement;
      const textSpan = target.closest<HTMLSpanElement>('.todo-text-span');
      if (textSpan && keyboardEvent.key === 'Enter') {
        e.preventDefault();
        textSpan.blur();
      }
    });
  }

  private render(): void {
    if (this._id !== null) {
      this.style.setProperty('--item-transition-name', `todo-item-${this._id}`);
    }

    // Stamp the template once; subsequent renders only patch values so an
    // in-progress contenteditable edit in this item is never blown away.
    if (!this.shadow.querySelector('.todo-item-card')) {
      this.shadow.innerHTML = htmlText;
    }

    // Apply values to HTML elements
    const card = this.shadow.querySelector<HTMLDivElement>('.todo-item-card');
    const checkbox = this.shadow.querySelector<HTMLButtonElement>('.todo-checkbox');
    const textSpan = this.shadow.querySelector<HTMLSpanElement>('.todo-text-span');

    if (card) {
      card.classList.toggle('completed', this._complete);
    }
    if (checkbox) {
      checkbox.classList.toggle('checked', this._complete);
      checkbox.setAttribute('aria-checked', this._complete ? 'true' : 'false');
    }
    if (textSpan && textSpan.textContent !== this._text) {
      textSpan.textContent = this._text;
    }
  }
}

customElements.define('todo-item', TodoItem);
export default TodoItem;
