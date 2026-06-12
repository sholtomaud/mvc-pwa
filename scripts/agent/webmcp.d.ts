/**
 * Ambient types for the WebMCP API (W3C Web Machine Learning CG draft).
 * https://webmachinelearning.github.io/webmcp/
 *
 * The API surface is still in flux: the June 2026 draft exposes
 * `document.modelContext`, while the original Chrome 146 Canary preview
 * shipped `navigator.modelContext`. We declare both and feature-detect at
 * runtime (see webmcp-tools.ts). Delete this file once lib.dom.d.ts ships
 * official types.
 */

interface ModelContextToolResultContent {
  type: 'text';
  text: string;
}

interface ModelContextToolResult {
  content: ModelContextToolResultContent[];
}

type ToolExecuteCallback = (
  args: Record<string, unknown>
) => Promise<ModelContextToolResult | string> | ModelContextToolResult | string;

interface ModelContextTool {
  name: string;
  /** Optional human-readable title for browser UI surfaces. */
  title?: string;
  description: string;
  /** JSON Schema object describing the tool's arguments. */
  inputSchema?: Record<string, unknown>;
  execute: ToolExecuteCallback;
  /** Hint that the tool does not mutate state (agents may skip confirmation). */
  readOnlyHint?: boolean;
  /** Hint that the tool's output may contain untrusted (user-authored) content. */
  untrustedContentHint?: boolean;
}

interface ModelContext extends EventTarget {
  registerTool(
    tool: ModelContextTool,
    options?: Record<string, unknown>
  ): Promise<void>;
  /** Earlier drafts: replaces the full tool set. May not exist everywhere. */
  provideContext?(context: { tools: ModelContextTool[] }): void;
  ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null;
}

interface Document {
  /** Current spec draft location. */
  readonly modelContext?: ModelContext;
}

interface Navigator {
  /** Original Chrome Canary preview location. */
  readonly modelContext?: ModelContext;
}
