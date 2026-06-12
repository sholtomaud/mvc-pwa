import type { TodoStore } from '../store/todo-store';
import {
  addTodo,
  commandSchemas,
  editTodo,
  listTodos,
  removeTodo,
  toggleTodo,
  type CommandResult
} from '../core/commands';

/**
 * WebMCP adapter: exposes the core command layer as agent-callable tools.
 *
 * Architectural position: this module is the *agent controller*, a peer to
 * TodoApp (the human controller). It contains no business logic — every tool
 * is a one-line delegation to scripts/core/commands.ts, and the inputSchema
 * objects are the very same ones the commands validate against.
 *
 * Because TodoStore emits `change` after every commit, agent mutations
 * re-render the UI through the existing Model -> View path: the user watches
 * the agent work inside their own interface, and persistence/offline come
 * for free through the store's write-behind.
 *
 * Graceful degradation is the contract of this module:
 * - No `document.modelContext` / `navigator.modelContext` -> resolves
 *   'unsupported' and the app runs exactly as before. Zero behavior change.
 * - Spec drift (the API moved namespaces between drafts) -> we detect both
 *   locations and fall back from `registerTool()` to the older
 *   `provideContext()` shape.
 * - Registration failure -> logged, never thrown. A broken agent surface
 *   must never brick the app (same philosophy as storage.ts).
 */

export type WebMCPStatus = 'unsupported' | 'registered' | 'partial' | 'failed';

/** Feature-detect across spec revisions; current draft hangs off Document. */
function getModelContext(): ModelContext | null {
  const fromDocument = typeof document !== 'undefined' ? document.modelContext : undefined;
  const fromNavigator = typeof navigator !== 'undefined' ? navigator.modelContext : undefined;
  return fromDocument ?? fromNavigator ?? null;
}

/** Convenience for callers that just want to know (e.g. to badge the UI). */
export function isWebMCPSupported(): boolean {
  return getModelContext() !== null;
}

function toToolResult(result: CommandResult): ModelContextToolResult {
  return {
    content: [
      {
        type: 'text',
        text: result.ok
          ? JSON.stringify({ ok: true, todos: result.todos })
          : JSON.stringify({ ok: false, error: result.error })
      }
    ]
  };
}

/**
 * Pure factory, separated from registration so tests (and future callers)
 * can exercise tool behavior without any browser API present.
 */
export function createTodoTools(store: TodoStore): ModelContextTool[] {
  return [
    {
      name: 'todos_list',
      title: 'List todos',
      description:
        'Returns all live todo items as JSON: { ok, todos: [{ id, text, complete }] }. ' +
        'Ids are opaque strings — call this first to discover ids before ' +
        'toggling, editing, or removing.',
      inputSchema: commandSchemas.list,
      readOnlyHint: true,
      // Todo text is user-authored: instruct agent runtimes not to interpret
      // it as instructions (prompt-injection mitigation).
      untrustedContentHint: true,
      execute: async () => toToolResult(await listTodos(store))
    },
    {
      name: 'todos_add',
      title: 'Add a todo',
      description: 'Adds a new, incomplete todo with the given text. Returns the updated list.',
      inputSchema: commandSchemas.add,
      execute: async ({ text }) => toToolResult(await addTodo(store, text))
    },
    {
      name: 'todos_toggle',
      title: 'Toggle a todo',
      description:
        'Flips the complete flag of the todo with the given id. ' +
        'Returns the updated list, or { ok: false, error } if the id is unknown.',
      inputSchema: commandSchemas.toggle,
      execute: async ({ id }) => toToolResult(await toggleTodo(store, id))
    },
    {
      name: 'todos_edit',
      title: 'Edit a todo',
      description: 'Replaces the text of the todo with the given id. Returns the updated list.',
      inputSchema: commandSchemas.edit,
      execute: async ({ id, text }) => toToolResult(await editTodo(store, id, text))
    },
    {
      name: 'todos_remove',
      title: 'Remove a todo',
      description:
        'Deletes the todo with the given id (not undoable via tools). Returns the updated list.',
      inputSchema: commandSchemas.remove,
      execute: async ({ id }) => toToolResult(await removeTodo(store, id))
    }
  ];
}

/** Guard against double registration (HMR, repeated composition-root runs). */
let registered = false;

/**
 * Register the todo tool surface with the browser's model context.
 * Never throws; resolves with a status the caller may log or ignore.
 */
export async function registerTodoTools(store: TodoStore): Promise<WebMCPStatus> {
  const ctx = getModelContext();
  if (!ctx) {
    // Expected on Firefox/Safari and pre-146 Chrome: the app is fully
    // functional without an agent surface. Say so once, quietly.
    console.info('[webmcp] No model context API in this browser — agent tools not registered.');
    return 'unsupported';
  }
  if (registered) return 'registered';

  const tools = createTodoTools(store);

  try {
    if (typeof ctx.registerTool === 'function') {
      const results = await Promise.allSettled(tools.map((tool) => ctx.registerTool(tool)));
      const failures = results.filter((r) => r.status === 'rejected');
      registered = failures.length < tools.length;
      if (failures.length === 0) return 'registered';
      console.warn(`[webmcp] ${failures.length}/${tools.length} tools failed to register.`, failures);
      return registered ? 'partial' : 'failed';
    }
    if (typeof ctx.provideContext === 'function') {
      // Older draft shape: replaces the page's full tool set atomically.
      ctx.provideContext({ tools });
      registered = true;
      return 'registered';
    }
    console.warn('[webmcp] Model context present but exposes no known registration method.');
    return 'failed';
  } catch (error) {
    console.warn('[webmcp] Tool registration failed.', error);
    return 'failed';
  }
}
