import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodoStore } from '../../scripts/store/todo-store';
import { MemoryPersistence } from '../../scripts/store/persistence';
import { HLC } from '../../scripts/store/hlc';
import {
  createTodoTools,
  isWebMCPSupported,
  registerTodoTools
} from '../../scripts/agent/webmcp-tools';
import { installLocalStorage } from './helpers/local-storage-mock';

let t = 2_000_000;
const clock = () => t++;

function makeStore() {
  return new TodoStore(new MemoryPersistence(), new HLC('node-a', clock));
}

/** Minimal fake of the browser's ModelContext for the current draft shape. */
function fakeModelContext(overrides: Partial<ModelContext> = {}): ModelContext & {
  tools: ModelContextTool[];
} {
  const tools: ModelContextTool[] = [];
  return Object.assign(new EventTarget(), {
    tools,
    registerTool: vi.fn(async (tool: ModelContextTool) => {
      tools.push(tool);
    }),
    ontoolchange: null,
    ...overrides
  }) as ModelContext & { tools: ModelContextTool[] };
}

async function callTool(tool: ModelContextTool, args: Record<string, unknown> = {}) {
  const result = (await tool.execute(args)) as ModelContextToolResult;
  return JSON.parse(result.content[0].text) as {
    ok: boolean;
    todos?: { id: string; text: string; complete: boolean }[];
    error?: string;
  };
}

function toolByName(tools: ModelContextTool[], name: string): ModelContextTool {
  const tool = tools.find((x) => x.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

describe('webmcp tool behavior (createTodoTools — no browser API needed)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installLocalStorage();
  });

  it('exposes the five todo tools with schemas and safety hints', () => {
    const tools = createTodoTools(makeStore());
    expect(tools.map((x) => x.name).sort()).toEqual([
      'todos_add',
      'todos_edit',
      'todos_list',
      'todos_remove',
      'todos_toggle'
    ]);
    const list = toolByName(tools, 'todos_list');
    expect(list.readOnlyHint).toBe(true);
    expect(list.untrustedContentHint).toBe(true); // todo text is user-authored
    for (const tool of tools) expect(tool.inputSchema).toBeDefined();
  });

  it('supports the full agent round-trip: add -> list -> toggle -> edit -> remove', async () => {
    const store = makeStore();
    const tools = createTodoTools(store);

    expect((await callTool(toolByName(tools, 'todos_add'), { text: 'buy milk' })).ok).toBe(true);

    const listed = await callTool(toolByName(tools, 'todos_list'));
    expect(listed.ok).toBe(true);
    const id = listed.todos![0].id;
    expect(typeof id).toBe('string');

    const toggled = await callTool(toolByName(tools, 'todos_toggle'), { id });
    expect(toggled.todos![0].complete).toBe(true);

    const edited = await callTool(toolByName(tools, 'todos_edit'), { id, text: 'buy oat milk' });
    expect(edited.todos![0].text).toBe('buy oat milk');

    const removed = await callTool(toolByName(tools, 'todos_remove'), { id });
    expect(removed).toEqual({ ok: true, todos: [] });
  });

  it('returns structured errors instead of throwing on bad agent input', async () => {
    const tools = createTodoTools(makeStore());
    const bad = await callTool(toolByName(tools, 'todos_toggle'), { id: 'no-such-id' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('no-such-id');
    const empty = await callTool(toolByName(tools, 'todos_add'), { text: '   ' });
    expect(empty.ok).toBe(false);
  });

  it('agent mutations notify UI subscribers through the same change event', async () => {
    const store = makeStore();
    await store.ready;
    const onChange = vi.fn();
    store.addEventListener('change', onChange);
    await callTool(toolByName(createTodoTools(store), 'todos_add'), { text: 'from agent' });
    expect(onChange).toHaveBeenCalled();
    expect(store.getAll().map((x) => x.text)).toEqual(['from agent']);
  });
});

describe('webmcp registration (graceful degradation)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules(); // clear the module-level `registered` guard
    installLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function freshRegister() {
    // Re-import per test so the double-registration guard starts clean.
    const mod = await import('../../scripts/agent/webmcp-tools');
    return mod;
  }

  it("resolves 'unsupported' and stays silent-safe when no API exists", async () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', {});
    const { registerTodoTools: register, isWebMCPSupported: supported } = await freshRegister();
    expect(supported()).toBe(false);
    await expect(register(makeStore())).resolves.toBe('unsupported');
  });

  it('registers via document.modelContext.registerTool (current draft)', async () => {
    const ctx = fakeModelContext();
    vi.stubGlobal('document', { modelContext: ctx });
    vi.stubGlobal('navigator', {});
    const { registerTodoTools: register } = await freshRegister();
    await expect(register(makeStore())).resolves.toBe('registered');
    expect(ctx.tools).toHaveLength(5);
  });

  it('falls back to navigator.modelContext (earlier Chrome preview)', async () => {
    const ctx = fakeModelContext();
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', { modelContext: ctx });
    const { registerTodoTools: register } = await freshRegister();
    await expect(register(makeStore())).resolves.toBe('registered');
    expect(ctx.tools).toHaveLength(5);
  });

  it('falls back to provideContext when registerTool is absent (older draft)', async () => {
    const provided: { tools: ModelContextTool[] }[] = [];
    const ctx = fakeModelContext({
      registerTool: undefined as unknown as ModelContext['registerTool'],
      provideContext: (context: { tools: ModelContextTool[] }) => {
        provided.push(context);
      }
    });
    vi.stubGlobal('document', { modelContext: ctx });
    const { registerTodoTools: register } = await freshRegister();
    await expect(register(makeStore())).resolves.toBe('registered');
    expect(provided[0].tools).toHaveLength(5);
  });

  it("reports 'partial' when some registrations reject, without throwing", async () => {
    let calls = 0;
    const ctx = fakeModelContext({
      registerTool: vi.fn(async () => {
        if (calls++ === 0) throw new Error('duplicate tool name');
      })
    });
    vi.stubGlobal('document', { modelContext: ctx });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registerTodoTools: register } = await freshRegister();
    await expect(register(makeStore())).resolves.toBe('partial');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reports 'failed' when the context exposes no known registration method", async () => {
    const ctx = fakeModelContext({
      registerTool: undefined as unknown as ModelContext['registerTool']
    });
    vi.stubGlobal('document', { modelContext: ctx });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registerTodoTools: register } = await freshRegister();
    await expect(register(makeStore())).resolves.toBe('failed');
    warn.mockRestore();
  });

  it('only registers once per session (HMR / repeated composition-root runs)', async () => {
    const ctx = fakeModelContext();
    vi.stubGlobal('document', { modelContext: ctx });
    const { registerTodoTools: register } = await freshRegister();
    await register(makeStore());
    await register(makeStore());
    expect(ctx.tools).toHaveLength(5);
  });
});

// Keep static imports referenced so the top-level import isn't elided
// (mirrors the load-bearing-import caution in todo-app.ts).
void isWebMCPSupported;
void registerTodoTools;
