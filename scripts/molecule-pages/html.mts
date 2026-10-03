/**
 * html.mts — the static HTML of a molecule page (/m/<id>) and of the index
 * (/m/), filled into the Vite-built template (apps/web/molecule.html).
 *
 * Everything a crawler, a chat unfurler or a visitor without JavaScript needs
 * is in the HTML: title, description, canonical, Open Graph and Twitter meta
 * with the molecule's own card, JSON-LD (MolecularEntity + BreadcrumbList),
 * the ink drawing at its opening pose, the facts, and the verbs as plain
 * links. The page script (packages/ui/src/moleculePage/page.ts) only makes the
 * drawing spin and the verbs smarter.
 */
import { inkSvgMarkup } from '../../packages/ui/src/moleculePage/ink.ts';
import {
  moleculeCardPath,
  moleculeDeskPaths,
  moleculeInkPath,
  moleculePagePath,
} from '../../packages/ui/src/moleculePage/pages.ts';
import type { MoleculePageData } from '../../packages/ui/src/moleculePage/page.ts';
import { CARD_HEIGHT, CARD_WIDTH, cardAlt } from './card.mts';
import type { MoleculeRecord } from './catalog.mts';

export interface PageContext {
  /** https://lupi.live */
  origin: string;
  /** The viewer's entry module (warmed when a visitor shows intent). */
  appEntry?: string;
  /** The viewer's heavy chunks, prefetched on intent. */
  warm?: string[];
  /** False when the card PNGs could not be rasterised: og:image falls back to the site card. */
  cards: boolean;
  defaultImage: string;
}

const HEAD_MARK = '<!--lupi:molecule-head-->';
const BODY_MARK = '<!--lupi:molecule-body-->';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:·\s]+$/, '')}…`;
}

/** C8H10N4O2 → C<sub>8</sub>H<sub>10</sub>N<sub>4</sub>O<sub>2</sub> */
export function formulaHtml(formula: string): string {
  return escapeHtml(formula).replace(/(\d+)/g, '<sub>$1</sub>');
}

function jsonForScript(value: unknown): string {
  // JSON may hold U+2028/U+2029, which end a line inside a <script>.
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

const WATER: Record<string, string> = {
  miscible: 'Mixes completely',
  soluble: 'Dissolves',
  slightly: 'Slightly soluble',
  insoluble: 'Does not dissolve',
  reacts: 'Reacts with water',
};

const PHASE: Record<string, string> = { solid: 'Solid', liquid: 'Liquid', gas: 'Gas' };

function fmtNumber(value: number, digits = 2): string {
  return Number(value.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits });
}

function topBar(): string {
  return `<a class="mp-skip" href="#main">Skip to content</a>
<header class="mp-top">
  <a class="mp-brand" href="/">Lupi</a>
  <nav aria-label="Site">
    <a href="/m/">All molecules</a>
    <a href="/daily/">Daily</a>
    <a href="/library">Library</a>
  </nav>
</header>`;
}

function footer(): string {
  return `<footer class="mp-foot">
  <span>Lupi · explore molecules in 3D, free and without an account</span>
  <a href="/">Home</a>
  <a href="/m/">All molecules</a>
  <a href="/daily/">Lupi Daily</a>
  <a href="/llms.txt">For agents</a>
</footer>`;
}

function moleculeTile(record: MoleculeRecord): string {
  const formula = record.formula ?? record.modelFormula;
  return `<li><a href="${moleculePagePath(record.id)}"><img src="${moleculeInkPath(record.id)}" alt="" width="160" height="160" loading="lazy" decoding="async"><strong>${escapeHtml(record.name)}</strong><span>${formulaHtml(formula)}</span></a></li>`;
}

export function pageTitle(record: MoleculeRecord): string {
  const formula = record.formula ?? record.modelFormula;
  return `${record.name}: 3D structure, ${formula} | Lupi`;
}

export function pageDescription(record: MoleculeRecord): string {
  return clip(`${record.description} Spin the drawing, then open it in 3D.`, 200);
}

function headTags(record: MoleculeRecord, ctx: PageContext): string {
  const url = `${ctx.origin}${moleculePagePath(record.id)}`;
  const image = ctx.cards ? `${ctx.origin}${moleculeCardPath(record.id)}` : ctx.defaultImage;
  const alt = ctx.cards ? cardAlt(record) : `${record.name} in the Lupi molecular viewer.`;
  const title = pageTitle(record);
  const ogTitle = `${record.name} · ${record.formula ?? record.modelFormula}`;
  const description = pageDescription(record);
  const entity: Record<string, unknown> = {
    '@type': 'MolecularEntity',
    '@id': `${url}#molecule`,
    name: record.name,
    url,
    image,
    description: record.description,
    molecularFormula: record.formula ?? undefined,
    iupacName: record.systematicName ?? undefined,
    molecularWeight: record.molarMass
      ? { '@type': 'QuantitativeValue', value: record.molarMass, unitText: 'g/mol' }
      : undefined,
    identifier: record.pubchemCid ? `PubChem CID ${record.pubchemCid}` : undefined,
    sameAs: record.sourceUrl ?? undefined,
    alternateName: record.aliases.length ? record.aliases : undefined,
  };
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      entity,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Lupi', item: `${ctx.origin}/` },
          { '@type': 'ListItem', position: 2, name: 'Molecules', item: `${ctx.origin}/m/` },
          { '@type': 'ListItem', position: 3, name: record.name, item: url },
        ],
      },
    ],
  };
  const meta = (attr: string, key: string, content: string) =>
    `<meta ${attr}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`;
  return [
    `<title>${escapeHtml(title)}</title>`,
    meta('name', 'description', description),
    meta('name', 'robots', 'index,follow,max-image-preview:large'),
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    meta('property', 'og:site_name', 'Lupi'),
    meta('property', 'og:locale', 'en_US'),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:title', ogTitle),
    meta('property', 'og:description', description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    ...(ctx.cards
      ? [
          meta('property', 'og:image:type', 'image/png'),
          meta('property', 'og:image:width', String(CARD_WIDTH)),
          meta('property', 'og:image:height', String(CARD_HEIGHT)),
        ]
      : []),
    meta('property', 'og:image:alt', alt),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', ogTitle),
    meta('name', 'twitter:description', description),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', alt),
    `<script type="application/ld+json">${jsonForScript(jsonLd)}</script>`,
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}

function factsList(record: MoleculeRecord): string {
  const rows: Array<[string, string]> = [];
  if (record.formula) rows.push(['Formula', `${formulaHtml(record.formula)} <small>PubChem</small>`]);
  else rows.push(['Formula', `${formulaHtml(record.modelFormula)} <small>counted from the model</small>`]);
  if (record.molarMass) rows.push(['Molar mass', `${fmtNumber(record.molarMass)} g/mol <small>from the formula</small>`]);
  rows.push(['Atoms in this model', record.atoms.toLocaleString('en-US')]);
  if (record.systematicName) rows.push(['Systematic name', escapeHtml(record.systematicName)]);
  if (record.aliases.length) rows.push(['Also called', escapeHtml(record.aliases.join(', '))]);
  const sheet = record.sheet;
  if (sheet?.substance) rows.push(['Bulk substance', escapeHtml(sheet.substance)]);
  if (sheet?.phase) rows.push(['At 25 °C', PHASE[sheet.phase] ?? escapeHtml(sheet.phase)]);
  if (sheet?.density !== undefined) rows.push(['Density', `${fmtNumber(sheet.density, 3)} g/cm³`]);
  if (sheet?.meltingPoint !== undefined) rows.push(['Melts at', `${fmtNumber(sheet.meltingPoint, 1)} °C`]);
  if (sheet?.boilingPoint !== undefined) rows.push(['Boils at', `${fmtNumber(sheet.boilingPoint, 1)} °C`]);
  if (sheet?.water) rows.push(['In water', WATER[sheet.water] ?? escapeHtml(sheet.water)]);
  rows.push(['Shelf', escapeHtml(record.domain)]);
  return `<dl class="mp-facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function elementsList(record: MoleculeRecord): string {
  return `<ul class="mp-elements" aria-label="Elements">${record.elements
    .map(
      (e) =>
        `<li><i style="background:${e.color}" aria-hidden="true"></i><b>${e.symbol}</b>${escapeHtml(e.name)} × ${e.count}</li>`,
    )
    .join('')}</ul>`;
}

function deskIcon(): string {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>';
}

function shareIcon(): string {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
}

/**
 * One observation to make with the drawing: the student collection's prompt,
 * else one read off the drawing's own detents (what the turn will click onto).
 */
function tryThis(record: MoleculeRecord): string | null {
  if (record.prompt) return record.prompt;
  const labels = record.model.detents.map((d) => d.label);
  const ring = labels.find((label) => /face-on/.test(label) && !/^Face-on/.test(label));
  if (ring) {
    const polygon = ring.split(' ')[0];
    const named = polygon === 'Ring' ? 'a ring' : `a ${polygon.toLowerCase()}`;
    return `Turn the drawing until it clicks with ${named} facing you. Then open it in 3D and find the same ring.`;
  }
  if (labels.some((label) => label.startsWith('Face-on'))) {
    return 'Turn it edge-on, then face-on: every atom lies in one plane. Does the 3D view agree?';
  }
  if (labels.length >= 2) {
    return `Flick the drawing: it settles on the ${labels.length} views that line up with its principal axes. Which one shows the most atoms?`;
  }
  return null;
}

export function moleculePageData(record: MoleculeRecord, ctx: PageContext): MoleculePageData {
  const desk = moleculeDeskPaths(record.id);
  return {
    id: record.id,
    name: record.name,
    model: record.model,
    open: `/?sim=${encodeURIComponent(record.id)}`,
    url: `${ctx.origin}${moleculePagePath(record.id)}`,
    shareText: `${record.name} (${record.formula ?? record.modelFormula}) in 3D on Lupi`,
    usdz: desk.usdz,
    glb: desk.glb,
    ink: moleculeInkPath(record.id),
    appEntry: ctx.appEntry,
    warm: ctx.warm,
  };
}

function bodyMarkup(record: MoleculeRecord, related: MoleculeRecord[], ctx: PageContext): string {
  const formula = record.formula ?? record.modelFormula;
  const desk = moleculeDeskPaths(record.id);
  const drawing = inkSvgMarkup(record.model, record.model.opening, { idPrefix: 'mp-static' });
  const stats = [`${record.atoms.toLocaleString('en-US')} atoms`, record.molarMass ? `${fmtNumber(record.molarMass)} g/mol` : null]
    .filter(Boolean)
    .join(' · ');
  const label = `${record.name}, ${formula}, ${record.atoms} atoms. An ink drawing you can turn: drag or use the arrow keys; press Enter to open it in 3D.`;
  const data = moleculePageData(record, ctx);
  const sources = [
    record.pubchemCid && record.sourceUrl
      ? `<li>Identity: <a href="${escapeHtml(record.sourceUrl)}" rel="noopener">PubChem CID ${record.pubchemCid}</a></li>`
      : '',
    `<li>Coordinates: <a href="${escapeHtml(record.file)}">${escapeHtml(record.file.split('/').pop() ?? record.file)}</a> <small>SHA-256 ${record.sha256.slice(0, 12)}…</small></li>`,
    record.sheet ? '<li>Room-temperature values: typical handbook figures (CRC Handbook, PubChem), not measured by Lupi.</li>' : '',
    `<li>3D model: <a href="${desk.usdz}">USDZ</a> · <a href="${desk.glb}" download>GLB</a></li>`,
  ]
    .filter(Boolean)
    .join('');

  return `${topBar()}
<main id="main" class="mp-main">
  <figure class="mp-hero">
    <div id="ink-stage" class="mp-stage" role="img" tabindex="0" aria-label="${escapeHtml(label)}">${drawing}</div>
    <figcaption id="ink-caption" class="mp-caption"><span class="mp-caption__hint">Drag to turn · tap to open in 3D</span><span class="mp-caption__flash" aria-hidden="true"></span></figcaption>
    <span id="ink-live" class="mp-live" role="status" aria-live="polite"></span>
  </figure>
  <div class="mp-side">
  <section class="mp-head" aria-labelledby="mp-name">
    <p class="mp-kicker">${escapeHtml(record.domain)}${record.topic ? ` · ${escapeHtml(record.topic)}` : ''}</p>
    <h1 id="mp-name">${escapeHtml(record.name)}</h1>
    <p class="mp-formula">${formulaHtml(formula)} <span>· ${escapeHtml(stats)}</span></p>
    <p class="mp-lede">${escapeHtml(record.description)}</p>
    <div class="mp-verbs">
      <a id="open-3d" class="mp-verb mp-verb--primary" href="${escapeHtml(data.open)}">Open in 3D</a>
      <button id="desk" class="mp-verb" type="button" hidden>${deskIcon()}Place on your desk</button>
      <button id="share" class="mp-verb" type="button">${shareIcon()}Share</button>
    </div>
    <p id="share-status" class="mp-status" role="status" aria-live="polite"></p>
  </section>
  ${
    tryThis(record)
      ? `<section class="mp-section" aria-labelledby="mp-try"><h2 id="mp-try">Try this</h2><p class="mp-try">${escapeHtml(tryThis(record)!)}</p></section>`
      : ''
  }
  <section class="mp-section" aria-labelledby="mp-facts">
    <h2 id="mp-facts">Facts</h2>
    ${factsList(record)}
    ${elementsList(record)}
  </section>
  <section class="mp-section" aria-labelledby="mp-sources">
    <h2 id="mp-sources">Sources</h2>
    <ul class="mp-sources">${sources}</ul>
  </section>
  </div>
  ${
    related.length
      ? `<section class="mp-section mp-more" aria-labelledby="mp-more"><h2 id="mp-more">More molecules</h2><ul>${related.map(moleculeTile).join('')}</ul></section>`
      : ''
  }
  <p class="mp-note">The drawing and the desk model are illustrations of a coordinate model, not photographs. Bond lines are inferred from distances between atoms: visual guides, not source bond orders.</p>
</main>
${footer()}
<script type="application/json" id="lupi-molecule-data">${jsonForScript(data)}</script>`;
}

function fill(template: string, head: string, body: string): string {
  if (!template.includes(HEAD_MARK) || !template.includes(BODY_MARK)) {
    throw new Error('molecule.html is missing its lupi:molecule-head/body marks');
  }
  return template.replace(HEAD_MARK, head.trimStart()).replace(BODY_MARK, body);
}

export function renderMoleculePage(
  template: string,
  record: MoleculeRecord,
  related: MoleculeRecord[],
  ctx: PageContext,
): string {
  return fill(template, headTags(record, ctx), bodyMarkup(record, related, ctx));
}

/** /m/: every molecule page, by shelf, as links (the crawl hub and a browsable index). */
export function renderIndexPage(template: string, records: MoleculeRecord[], ctx: PageContext): string {
  const url = `${ctx.origin}/m/`;
  const title = 'Molecules in 3D: spin, read, open | Lupi';
  const description = `${records.length} molecules from caffeine to C60, each as an ink drawing you can spin, with its formula and facts, one tap from a live 3D view.`;
  const meta = (attr: string, key: string, content: string) =>
    `  <meta ${attr}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Molecules in 3D',
    url,
    description,
    hasPart: records.map((r) => ({ '@type': 'MolecularEntity', name: r.name, url: `${ctx.origin}${moleculePagePath(r.id)}` })),
  };
  const head = [
    `  <title>${escapeHtml(title)}</title>`,
    meta('name', 'description', description),
    meta('name', 'robots', 'index,follow,max-image-preview:large'),
    `  <link rel="canonical" href="${url}" />`,
    meta('property', 'og:site_name', 'Lupi'),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:title', 'Molecules in 3D'),
    meta('property', 'og:description', description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', ctx.defaultImage),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:image', ctx.defaultImage),
    `  <script type="application/ld+json">${jsonForScript(jsonLd)}</script>`,
  ].join('\n');

  const shelves = new Map<string, MoleculeRecord[]>();
  for (const record of records) {
    const list = shelves.get(record.domain) ?? [];
    list.push(record);
    shelves.set(record.domain, list);
  }
  const sections = [...shelves.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(
      ([shelf, list]) =>
        `<section class="mp-more"><h2>${escapeHtml(shelf)}</h2><ul>${list
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(moleculeTile)
          .join('')}</ul></section>`,
    )
    .join('\n');
  const body = `${topBar()}
<main id="main" class="mp-main mp-index">
  <h1>Molecules in 3D</h1>
  <p>Every molecule here is drawn from its own coordinate file. Spin the drawing, read the facts, then open the live 3D view, or place it on your desk from a phone.</p>
  <a class="mp-daily" href="/daily/"><span class="mp-daily__disc" aria-hidden="true">?</span><span><strong>Lupi Daily</strong><span>One mystery molecule a day, as an ink silhouette. Can you name it in six clues?</span></span></a>
  <input id="mp-filter" type="search" placeholder="Filter by name or formula" aria-label="Filter molecules" autocomplete="off" spellcheck="false" hidden />
  <p id="mp-filter-status" class="mp-status" role="status" aria-live="polite"></p>
  ${sections}
</main>
${footer()}`;
  return fill(template, head, body);
}
