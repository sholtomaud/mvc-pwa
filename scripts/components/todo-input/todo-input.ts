import sheet from './todo-input.css' with { type: 'css' };
import htmlText from './todo-input.html?raw';

class TodoInput extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.adoptedStyleSheets = [sheet];
  }

  connectedCallback(): void {
    this.render();
    this.setupListeners();
  }

  private render(): void {
    this.shadow.innerHTML = htmlText;
  }

  private setupListeners(): void {
    const dialog = this.shadow.querySelector('.todo-dialog') as HTMLDialogElement;
    const fabBtn = this.shadow.querySelector('.fab-btn') as HTMLButtonElement;
    const form = this.shadow.querySelector('.todo-form') as HTMLFormElement;
    const input = this.shadow.querySelector('.todo-text-input') as HTMLInputElement;

    let cleanupKeyboard: (() => void) | null = null;

    // Sync FAB active state and start keyboard tracking
    fabBtn.addEventListener('click', () => {
      fabBtn.classList.add('open');
      cleanupKeyboard = this.trackKeyboard(dialog);
    });

    // Clean up active state and form inputs when closed (via Esc, backdrop click, or close button)
    dialog.addEventListener('close', () => {
      fabBtn.classList.remove('open');
      form.reset();
      cleanupKeyboard?.();
      cleanupKeyboard = null;
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
  private trackKeyboard(dialog: HTMLDialogElement): () => void {
    const vv = window.visualViewport;
    if (!vv) return () => {};

    const isMobileSheet = window.matchMedia('(max-width: 480px)').matches;

    const reposition = () => {
      // How much the keyboard has eaten from the bottom of the window
      const keyboardHeight = window.innerHeight - vv.height;
      if (isMobileSheet) {
        // Translate the sheet up by the keyboard height — leaves bottom:0 layout
        // untouched so max-height/overflow still work correctly
        dialog.style.transform = `translateY(${-Math.max(0, keyboardHeight)}px)`;
      } else {
        // Keep centred modal in the middle of the visible area
        const top = Math.round(vv.offsetTop + vv.height / 2);
        dialog.style.top = `${top}px`;
        dialog.style.transform = 'translate(-50%, -50%) scale(1)';
      }
    };

    vv.addEventListener('resize', reposition);
    vv.addEventListener('scroll', reposition);

    return () => {
      vv.removeEventListener('resize', reposition);
      vv.removeEventListener('scroll', reposition);
      dialog.style.transform = '';
      dialog.style.top = '';
    };
  }
}

customElements.define('todo-input', TodoInput);
export default TodoInput;
