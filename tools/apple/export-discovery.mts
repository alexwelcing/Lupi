/** Keep the native discovery catalogue byte-for-byte with the shared code. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISCOVERY_CATALOG, DISCOVERY_CATALOG_VERSION } from '../../packages/core/src/jev/moleculeDiscovery';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = path.join(root, 'apps/apple/LupiKit/Sources/LupiData/Resources/discovery.json');
const starters = JSON.parse(fs.readFileSync(path.join(root, 'apps/apple/LupiKit/Sources/LupiData/Resources/starters/starters.json'), 'utf8')).starters as { id: string; formula: string; atoms: number }[];
for (const candidate of DISCOVERY_CATALOG) {
  const starter = starters.find((s) => s.id === candidate.id);
  if (!starter || starter.formula !== candidate.formula || starter.atoms !== candidate.atoms) throw new Error(`Discovery starter mismatch: ${candidate.id}`);
}
const text = `${JSON.stringify({ catalogVersion: DISCOVERY_CATALOG_VERSION, candidates: DISCOVERY_CATALOG }, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) throw new Error('Native discovery catalogue is stale. Run pnpm exec tsx tools/apple/export-discovery.mts.');
} else fs.writeFileSync(file, text);
console.log('Native discovery catalogue matches all 12 bundled starters.');
