/**
 * After `vite build`: write the zero-canvas molecule pages (/m/<id>), their
 * share cards, ink drawings and desk models into apps/web/dist. See
 * scripts/molecule-pages/build.mts for the artifact list.
 *
 *   tsx scripts/generate-molecule-pages.mts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeMoleculeSite } from './molecule-pages/build.mts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const distRoot = path.join(repoRoot, 'apps/web/dist');

const started = Date.now();
const report = await writeMoleculeSite(repoRoot, distRoot);
for (const failure of report.failures) console.warn(`[molecule-pages] ${failure}`);
console.log(
  `Generated ${report.pages} molecule pages (${report.cards} cards, ${report.desk} desk models) in ${Date.now() - started} ms.`,
);
