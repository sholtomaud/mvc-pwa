// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { installLocalStorage } from './helpers/local-storage-mock';

/**
 * DOM integration tests: exercise the full Model -> Controller -> View chain
 * through real custom elements in jsdom. This layer exists because store unit
 * tests cannot catch wiring regressions — e.g. a component registration
 * silently dropped by type-only import elision, which broke the add flow in
 * a real browser while all store tests stayed green.
 */

// Chromium-faithful startViewTransition shim: the update callback runs
// ASYNCHRONOUSLY (next task) and the promises reject if it throws.
function installViewTransitionShim(): void {
  (document as unknown as { startViewTransition: unknown }).startViewTransition = (
    update: () => void
  ) => {
    let resolve!: () => void, reject!: (e: unknown) => void;
    const done = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    done.catch(() => {});
    setTimeout(() => {
      try { update(); resolve(); } catch (e) { reject(e); }
    }, 0);
    return { updateCallbackDone: done, ready: done, finished: done };
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function queryItem(app: HTMLElement, index = 0): HTMLElement | null {
  const list = app.shadowRoot?.querySelector('todo-list');
  const items = list?.shadowRoot?.querySelectorAll('todo-item');
  return (items?.[index] as HTMLElement) ?? null;
}

async function mountApp(): Promise<HTMLElement> {
  await import('../../scripts/components/todo-app/todo-app');
  const app = document.createElement('todo-app');
  document.body.appendChild(app);
  await tick();
  return app;
}

function addTodo(app: HTMLElement, text: string): void {
  // Dispatch the same composed event todo-input emits on submit.
  app.dispatchEvent(
    new CustomEvent('todo-add', { bubbles: true, composed: true, detail: { text } })
  );
}

describe('todo-app DOM integration', () => {
  beforeEach(() => {
    // Browser APIs the components rely on that jsdom does not implement.
    (globalThis as Record<string, unknown>).IntersectionObserver = class {
      observe() {} unobserve() {} disconnect() {}
    };
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    };
    if (!(globalThis as Record<string, unknown>).CSS) {
      (globalThis as Record<string, unknown>).CSS = { supports: () => false };
    }
    if (!window.matchMedia) {
      (window as unknown as Record<string, unknown>).matchMedia = () => ({
        matches: false, addEventListener() {}, removeEventListener() {}
      });
    }
    installViewTransitionShim();
    // Never trust the host's localStorage (jsdom's can be shadowed by Node's
    // broken experimental Web Storage global) — install a working mock.
    installLocalStorage();
    document.body.innerHTML = '';
  });

  it('registers every component (guards against type-only import elision)', async () => {
    await import('../../scripts/components/todo-app/todo-app');
    for (const tag of ['todo-app', 'todo-list', 'todo-item', 'todo-input', 'app-navigation', 'user-profile']) {
      expect(customElements.get(tag), `${tag} must be defined`).toBeTruthy();
    }
  });

  it('renders a todo-item with checkbox and text after todo-add', async () => {
    const app = await mountApp();
    addTodo(app, 'hello');
    await tick(); await tick();

    const item = queryItem(app);
    expect(item, 'todo-item should exist').toBeTruthy();
    expect(item!.shadowRoot!.querySelector('.todo-checkbox')).toBeTruthy();
    expect(item!.shadowRoot!.querySelector('.todo-text-span')!.textContent).toBe('hello');
    expect(item!.getAttribute('data-id')).toBe('1');
  });

  it('toggles completion through a checkbox click and persists it', async () => {
    const app = await mountApp();
    addTodo(app, 'toggle me');
    await tick(); await tick();

    const item = queryItem(app)!;
    (item.shadowRoot!.querySelector('.todo-checkbox') as HTMLElement).click();
    await tick(); await tick();

    const checkbox = item.shadowRoot!.querySelector('.todo-checkbox')!;
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('todos')).toContain('"complete":true');
  });

  it('removes the item from the DOM on delete', async () => {
    const app = await mountApp();
    addTodo(app, 'one');
    addTodo(app, 'two');
    await tick(); await tick();

    (queryItem(app, 0)!.shadowRoot!.querySelector('.delete-btn') as HTMLElement).click();
    await tick(); await tick();

    const list = app.shadowRoot!.querySelector('todo-list')!;
    const items = list.shadowRoot!.querySelectorAll('todo-item');
    expect(items.length).toBe(1);
    expect(items[0].shadowRoot!.querySelector('.todo-text-span')!.textContent).toBe('two');
  });

  it('patches in place: unrelated items keep their DOM node across updates', async () => {
    const app = await mountApp();
    addTodo(app, 'stable');
    addTodo(app, 'changing');
    await tick(); await tick();

    const stableNode = queryItem(app, 0)!;
    (queryItem(app, 1)!.shadowRoot!.querySelector('.todo-checkbox') as HTMLElement).click();
    await tick(); await tick();

    expect(queryItem(app, 0)).toBe(stableNode);
  });

  it('hydrates persisted todos on a fresh mount', async () => {
    localStorage.setItem('todos', JSON.stringify([{ id: 7, text: 'restored', complete: true }]));
    const app = await mountApp();
    await tick();

    const item = queryItem(app)!;
    expect(item.shadowRoot!.querySelector('.todo-text-span')!.textContent).toBe('restored');
    expect(item.shadowRoot!.querySelector('.todo-checkbox')!.getAttribute('aria-checked')).toBe('true');
  });
});
