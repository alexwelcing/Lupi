/**
 * build.mts — every artifact of the molecule pages, for the build
 * (scripts/generate-molecule-pages.mts writes them into apps/web/dist) and
 * the dev server (apps/web/vite.config.ts serves them on request).
 *
 *   /m/<id>                the page (dist/m/<id>.html: Workers static assets
 *                          and tools/serve-web.mjs serve it at /m/<id>)
 *   /m/                    the index of every page
 *   /m/manifest.json       id → name, formula, coordinate file (the Worker maps
 *                          a saved view's molecule to its card with it), and
 *                          the drawing's pose and fit (the ink tiles' hand-off)
 *   /og/m/<id>.png         the 1200×630 share card
 *   /og/m/<id>-ink.svg     the drawing alone (index tiles, Quick Look's image)
 *   /og/m/<id>-ink.json    the drawing's model (ink.ts InkModel): the landing's
 *                          ink tiles turn it in the relay while 3D loads
 *   /ar/<id>.usdz, .glb    "Place on your desk"
 */
import fs from 'node:fs';
import path from 'node:path';
import { inkSvgMarkup } from '../../packages/ui/src/moleculePage/ink.ts';
import { getElementSpecBySymbol } from '../../packages/core/src/elements.ts';
import { buildMoleculeCatalog, relatedMolecules, type MoleculeRecord } from './catalog.mts';
import { cardSvg, rasterizeCard } from './card.mts';
import { buildDeskModels } from './desk.mts';
import { renderIndexPage, renderMoleculePage, type PageContext } from './html.mts';

export interface MoleculeSite {
  records: MoleculeRecord[];
  byId: Map<string, MoleculeRecord>;
  origin: string;
  defaultImage: string;
}

export function loadMoleculeSite(repoRoot: string): MoleculeSite {
  const seo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/ui/src/seo-routes.json'), 'utf8')) as {
    siteOrigin: string;
    defaultSocialImage: string;
  };
  const records = buildMoleculeCatalog({ repoRoot });
  return {
    records,
    byId: new Map(records.map((record) => [record.id, record])),
    origin: seo.siteOrigin.replace(/\/+$/, ''),
    defaultImage: seo.defaultSocialImage,
  };
}

export function pageContext(site: MoleculeSite, opts: { appEntry?: string; warm?: string[]; cards: boolean }): PageContext {
  return { origin: site.origin, appEntry: opts.appEntry, warm: opts.warm, cards: opts.cards, defaultImage: site.defaultImage };
}

/** The viewer chunks a visitor about to open 3D will need (Vite's chunk names, hashed). */
const VIEWER_CHUNK = /^(App|openMolecule|vendor-three|vendor-three-webgpu|vendor-react-three|vendor-react|vendor-state)-[\w-]+\.(js|css)$/;

export function viewerChunks(distRoot: string): string[] {
  const dir = path.join(distRoot, 'assets');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => VIEWER_CHUNK.test(name))
    .sort()
    .map((name) => `/assets/${name}`);
}

export function moleculePageHtml(site: MoleculeSite, template: string, id: string, ctx: PageContext): string | null {
  const record = site.byId.get(id);
  if (!record) return null;
  return renderMoleculePage(template, record, relatedMolecules(record, site.records), ctx);
}

export function moleculeIndexHtml(site: MoleculeSite, template: string, ctx: PageContext): string {
  return renderIndexPage(template, site.records, ctx);
}

export function moleculeInkSvg(record: MoleculeRecord): string {
  return `${inkSvgMarkup(record.model, record.model.opening, {
    idPrefix: 'ink',
    title: `${record.name}, ink drawing`,
    attrs: { width: '400', height: '400' },
  })}\n`;
}

/** The drawing's model as JSON (the relay turns it while the viewer loads). */
export function moleculeInkJson(record: MoleculeRecord): string {
  return JSON.stringify(record.model);
}

export async function moleculeCardPng(site: MoleculeSite, record: MoleculeRecord): Promise<Buffer | null> {
  return rasterizeCard(cardSvg(record, site.origin));
}

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

/**
 * How the viewer frames this molecule, for the ink tiles' hand-off: the
 * bounds half-diagonal plus the largest ball-and-stick display radius
 * present (cameraFit.ts's content radius, before padding, at atom scale 1).
 */
export function moleculeFitRadius(record: MoleculeRecord): number {
  const p = record.model.p;
  let hx = 0;
  let hy = 0;
  let hz = 0;
  for (let i = 0; i < p.length; i += 3) {
    hx = Math.max(hx, Math.abs(p[i]));
    hy = Math.max(hy, Math.abs(p[i + 1]));
    hz = Math.max(hz, Math.abs(p[i + 2]));
  }
  const atom = Math.max(0, ...record.model.kinds.map((kind) => getElementSpecBySymbol(kind.s)?.displayRadius ?? 0));
  return round5(Math.hypot(hx, hy, hz) + atom);
}

export function moleculeManifest(site: MoleculeSite, cards: boolean) {
  return {
    schema: 'lupi.molecule-pages.v1',
    origin: site.origin,
    cards,
    pages: site.records.map((record) => ({
      id: record.id,
      name: record.name,
      formula: record.formula ?? record.modelFormula,
      atoms: record.atoms,
      file: record.file,
      // The ink drawing's opening pose (radians: azimuth about world +Y,
      // elevation) and drawn radius (Å), and the viewer's fit radius: an ink
      // tile hands its drawing over to the 3D view at the same pose and size.
      pose: [round5(record.model.opening.azimuth), round5(record.model.opening.elevation)],
      inkRadius: record.model.radius,
      fit: moleculeFitRadius(record),
    })),
  };
}

/** The viewer's entry module from the built index.html (warmed by "Open in 3D"). */
export function appEntryFrom(indexHtml: string): string | undefined {
  return indexHtml.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];
}

export interface WriteReport {
  pages: number;
  cards: number;
  desk: number;
  failures: string[];
}

/** Write every artifact into `distRoot` (the built app). */
export async function writeMoleculeSite(repoRoot: string, distRoot: string): Promise<WriteReport> {
  const site = loadMoleculeSite(repoRoot);
  const templatePath = path.join(distRoot, 'molecule.html');
  const template = fs.readFileSync(templatePath, 'utf8');
  const indexPath = path.join(distRoot, 'index.html');
  const appEntry = fs.existsSync(indexPath) ? appEntryFrom(fs.readFileSync(indexPath, 'utf8')) : undefined;
  const report: WriteReport = { pages: 0, cards: 0, desk: 0, failures: [] };

  const pagesDir = path.join(distRoot, 'm');
  const cardsDir = path.join(distRoot, 'og', 'm');
  const deskDir = path.join(distRoot, 'ar');
  for (const dir of [pagesDir, cardsDir, deskDir]) fs.mkdirSync(dir, { recursive: true });

  // Cards first: a page only names its own card when the card exists.
  for (const record of site.records) {
    fs.writeFileSync(path.join(cardsDir, `${record.id}-ink.svg`), moleculeInkSvg(record));
    fs.writeFileSync(path.join(cardsDir, `${record.id}-ink.json`), moleculeInkJson(record));
    const png = await moleculeCardPng(site, record);
    if (png) {
      fs.writeFileSync(path.join(cardsDir, `${record.id}.png`), png);
      report.cards += 1;
    }
  }
  const cards = report.cards === site.records.length;
  if (!cards && report.cards > 0) report.failures.push('some cards failed to rasterise; pages use the site card');
  const ctx = pageContext(site, { appEntry, warm: viewerChunks(distRoot), cards });

  for (const record of site.records) {
    fs.writeFileSync(path.join(pagesDir, `${record.id}.html`), moleculePageHtml(site, template, record.id, ctx)!);
    report.pages += 1;
    try {
      const desk = await buildDeskModels(record);
      fs.writeFileSync(path.join(deskDir, `${record.id}.usdz`), desk.usdz);
      fs.writeFileSync(path.join(deskDir, `${record.id}.glb`), desk.glb);
      report.desk += 1;
    } catch (error) {
      report.failures.push(`${record.id} desk model: ${(error as Error).message}`);
    }
  }
  fs.writeFileSync(path.join(pagesDir, 'index.html'), moleculeIndexHtml(site, template, ctx));
  fs.writeFileSync(path.join(pagesDir, 'manifest.json'), `${JSON.stringify(moleculeManifest(site, cards), null, 2)}\n`);

  // The sitemap gains the index and every page.
  const sitemapPath = path.join(distRoot, 'sitemap.xml');
  if (fs.existsSync(sitemapPath)) {
    const sitemap = fs.readFileSync(sitemapPath, 'utf8');
    const urls = [`${site.origin}/m/`, ...site.records.map((record) => `${site.origin}/m/${record.id}`)]
      .filter((url) => !sitemap.includes(`<loc>${url}</loc>`))
      .map((url) => `  <url><loc>${url}</loc></url>`)
      .join('\n');
    if (urls) fs.writeFileSync(sitemapPath, sitemap.replace('</urlset>', `${urls}\n</urlset>`));
  }

  // The template is not a page of its own.
  fs.rmSync(templatePath, { force: true });
  return report;
}
