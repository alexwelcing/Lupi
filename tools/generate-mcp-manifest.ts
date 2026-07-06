
import { MCP_TOOL_DEFINITIONS } from '../packages/ui/src/mcp/toolManifest.ts';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const manifest = {
  schemaVersion: '0.3.0',
  generatedAt: new Date().toISOString(),
  tools: MCP_TOOL_DEFINITIONS,
};
writeFileSync(resolve('apps/web/public/mcp-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote', MCP_TOOL_DEFINITIONS.length, 'tools to apps/web/public/mcp-manifest.json');
