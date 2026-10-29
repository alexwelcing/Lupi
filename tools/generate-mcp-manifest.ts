import { writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_TOOL_DEFINITIONS } from '../packages/ui/src/mcp/toolManifest.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, 'apps/web/public/browser-mcp-manifest.json');
// No timestamp: the manifest is committed and rewritten by every web build, so
// it must depend on the tool definitions alone to leave the tree clean.
const manifest = {
  schemaVersion: '0.3.0',
  tools: MCP_TOOL_DEFINITIONS,
};

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote', MCP_TOOL_DEFINITIONS.length, 'browser tools to', relative(repoRoot, manifestPath));
