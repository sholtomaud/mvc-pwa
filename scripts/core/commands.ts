import type { Todo, TodoStore } from '../store/todo-store';

/**
 * Headless command layer: the single mutation surface for the Model.
 *
 * Both controllers — the human one (TodoApp, driven by view CustomEvents)
 * and the agent one (scripts/agent/webmcp-tools.ts, driven by WebMCP tool
 * calls) — funnel through these functions, so validation lives in exactly
 * one place. Views may *additionally* validate for UX (HTML5 constraints),
 * but nothing that only lives in a view is load-bearing: agents never see
 * the view layer.
 *
 * Design notes:
 * - Args are typed `unknown` and narrowed here. Agent input is untrusted by
 *   definition (schemas are advisory across implementations/polyfills), and
 *   treating our own views the same way costs nothing.
 * - Every command awaits `store.ready` first, so callers cannot race
 *   hydration (e.g. an agent tool call landing before IndexedDB loads, which
 *   would also suppress the legacy-localStorage migration).
 * - Commands return an explicit Result instead of `void`: agents cannot see
 *   the screen, so "did it work, and what is the state now" must travel in
 *   the return value.
 * - The JSON Schemas below are the same objects handed to WebMCP as each
 *   tool's `inputSchema` — contract and enforcement co-evolve in this file.
 */

export const MAX_TEXT_LENGTH = 500;

export type CommandResult =
  | { ok: true; todos: readonly Todo[] }
  | { ok: false; error: string };

/** JSON Schema per command — exported so the agent layer reuses them verbatim. */
export const commandSchemas = {
  list: {
    type: 'object',
    properties: {},
    additionalProperties: false
  },
  add: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_TEXT_LENGTH,
        description: 'The todo label'
      }
    },
    required: ['text'],
    additionalProperties: false
  },
  toggle: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        minLength: 1,
        description: 'Todo id (from todos_list)'
      }
    },
    required: ['id'],
    additionalProperties: false
  },
  edit: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, description: 'Todo id (from todos_list)' },
      text: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_TEXT_LENGTH,
        description: 'Replacement todo label'
      }
    },
    required: ['id', 'text'],
    additionalProperties: false
  },
  remove: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, description: 'Todo id (from todos_list)' }
    },
    required: ['id'],
    additionalProperties: false
  }
} as const satisfies Record<string, Record<string, unknown>>;

function ok(store: TodoStore): CommandResult {
  return { ok: true, todos: store.getAll() };
}

function fail(error: string): CommandResult {
  return { ok: false, error };
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TEXT_LENGTH ? trimmed : null;
}

/** Resolve an id against LIVE todos only — tombstoned records are not addressable. */
function findLive(store: TodoStore, value: unknown): Todo | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return store.getAll().find((t) => t.id === value) ?? null;
}

export async function listTodos(store: TodoStore): Promise<CommandResult> {
  await store.ready;
  return ok(store);
}

export async function addTodo(store: TodoStore, text: unknown): Promise<CommandResult> {
  await store.ready;
  const value = asText(text);
  if (value === null) {
    return fail(`\`text\` must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters.`);
  }
  store.add(value);
  return ok(store);
}

export async function toggleTodo(store: TodoStore, id: unknown): Promise<CommandResult> {
  await store.ready;
  const todo = findLive(store, id);
  if (!todo) return fail(`No todo with id ${JSON.stringify(id)}.`);
  store.toggle(todo.id);
  return ok(store);
}

export async function editTodo(
  store: TodoStore,
  id: unknown,
  text: unknown
): Promise<CommandResult> {
  await store.ready;
  const todo = findLive(store, id);
  if (!todo) return fail(`No todo with id ${JSON.stringify(id)}.`);
  const value = asText(text);
  if (value === null) {
    return fail(`\`text\` must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters.`);
  }
  store.edit(todo.id, value);
  return ok(store);
}

export async function removeTodo(store: TodoStore, id: unknown): Promise<CommandResult> {
  await store.ready;
  const todo = findLive(store, id);
  if (!todo) return fail(`No todo with id ${JSON.stringify(id)}.`);
  store.remove(todo.id);
  return ok(store);
}
