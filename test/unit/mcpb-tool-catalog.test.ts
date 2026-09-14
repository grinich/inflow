import { agentToolCatalog } from '@/lib/agent-tools/catalog';
import { STATIC_TOOL_CATALOG } from '../../mcpb/server/tool-catalog.mjs';

it('keeps the standalone MCP catalog in sync with the extension catalog', () => {
  expect(STATIC_TOOL_CATALOG).toEqual(
    agentToolCatalog.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }))
  );
});
