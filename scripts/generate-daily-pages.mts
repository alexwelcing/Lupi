/**
 * After `vite build`: write Lupi Daily (/daily/, /daily/<date>, /daily/text),
 * its puzzle files and share cards into apps/web/dist. See
 * scripts/daily/build.mts for the artifact list. LUPI_DAILY_TODAY=YYYY-MM-DD
 * pins the build date (the window of date pages and cards).
 *
 *   tsx scripts/generate-daily-pages.mts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDailySite } from './daily/build.mts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const distRoot = path.join(repoRoot, 'apps/web/dist');

const started = Date.now();
const report = await writeDailySite(repoRoot, distRoot);
for (const failure of report.failures) console.warn(`[daily] ${failure}`);
console.log(
  `Generated Lupi Daily: ${report.pages} pages, ${report.puzzles} puzzles, ${report.cards} cards in ${Date.now() - started} ms.`,
);
