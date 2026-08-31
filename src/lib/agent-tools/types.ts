/**
 * Agent tool plumbing types.
 *
 * The wire format is MCP's CallToolResult so results pass through WebMCP's
 * document.modelContext.registerTool() unmodified, and the shell postMessage
 * bridge can stay a dumb pipe — one format across both transports. Handlers
 * return plain JSON data; the executor wraps it (and every failure) into
 * AgentToolResult. Untrusted text (message bodies) always travels INSIDE a
 * JSON string, so it can't fake tool-result structure.
 */

/** The subset of JSON Schema the hand-rolled validator understands. */
export interface PropSchema {
  type: 'string' | 'number' | 'boolean';
  description?: string;
  enum?: string[];
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, PropSchema>;
  required?: string[];
}

export interface AgentToolDef {
  name: string;
  /** Shown to the agent. State caveats here (e.g. untrusted content warnings). */
  description: string;
  inputSchema: ToolInputSchema;
  /** Write tools additionally require the agent-writes toggle. */
  write: boolean;
  /** Returns plain JSON-serializable data; throw an Error for a clean failure. */
  handler: (input: Record<string, unknown>) => Promise<unknown>;
  /** Toast text shown to the user after a successful write. */
  successToast?: (data: any) => string;
}

/** MCP CallToolResult — what both transports deliver to the agent. */
export interface AgentToolResult {
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
}

/** The tool list as advertised to agents (schema only, no handlers). */
export interface AgentToolDescriptor {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}
