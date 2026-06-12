import { TodoStore } from './store/todo-store';
import { registerTodoTools } from './agent/webmcp-tools';

/**
 * Composition root: the only module that knows how the app is wired.
 *
 * One TodoStore (the Model) is created here and handed to BOTH controllers:
 *   - the human controller: <todo-app>, via property injection
 *   - the agent controller: the WebMCP tool surface (no-op where unsupported)
 *
 * Ordering matters. <todo-app> already sits in index.html, so the element
 * upgrades — and connects — the moment its module executes. Static imports
 * hoist above this code, which would let the component lazily create its own
 * private store before we could inject ours. The dynamic import below keeps
 * definition until AFTER the store property is set on the (not yet upgraded)
 * element; TodoApp's connectedCallback then captures that pre-upgrade own
 * property through its setter (the standard "upgrade property" dance).
 */

const store = new TodoStore();

const app = document.querySelector<HTMLElement & { store?: TodoStore }>('todo-app');
if (app) {
  // Pre-upgrade own property; re-routed through the class setter on upgrade.
  app.store = store;
}

// Defining the element upgrades and connects <todo-app> synchronously.
void import('./components/todo-app/todo-app');

// Agent surface: resolves 'unsupported' harmlessly in browsers without
// WebMCP. Fire-and-forget — the UI never waits on agent plumbing.
void registerTodoTools(store);
