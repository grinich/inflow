import { vi } from 'vitest';

/**
 * Mock of the WebMCP registration surface (document.modelContext) — records
 * registrations so tests can inspect the advertised tool set and invoke a
 * tool's execute the way a browser agent would.
 */

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: unknown;
  execute: (input: unknown) => Promise<unknown>;
}

let registered = new Map<string, RegisteredTool>();

export function installModelContextMock(target: object = document) {
  registered = new Map();
  const modelContext = {
    registerTool: vi.fn(
      (tool: RegisteredTool, opts?: { signal?: AbortSignal }) => {
        registered.set(tool.name, tool);
        opts?.signal?.addEventListener('abort', () => registered.delete(tool.name));
        return { unregister: () => registered.delete(tool.name) };
      }
    ),
  };
  Object.defineProperty(target, 'modelContext', { value: modelContext, configurable: true });
  return modelContext;
}

export function uninstallModelContextMock(target: object = document) {
  delete (target as { modelContext?: unknown }).modelContext;
}

export function getRegisteredTools(): string[] {
  return [...registered.keys()].sort();
}

export function invokeTool(name: string, input: unknown): Promise<unknown> {
  const tool = registered.get(name);
  if (!tool) throw new Error(`tool "${name}" is not registered`);
  return tool.execute(input);
}
