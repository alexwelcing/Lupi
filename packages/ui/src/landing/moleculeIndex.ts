/**
 * Instant local molecule index for the landing page.
 *
 * Every gallery entry that opens directly (has a coordinate file, no
 * dedicated route) becomes a searchable, clickable tile. Matching is a pure
 * function over titles, formulas, domains and metadata so results appear on
 * the first keystroke with no network, and the same list feeds the
 * "jump in" wall under the search box.
 */

import { ALL_EXAMPLES, type GalleryExample } from './shared';
import { galleryNomenclatureTags, nomenclatureForGalleryId } from '../galleryNomenclature';
import previews from '../gallery/previews.json';

export interface LocalMolecule {
  id: string;
  title: string;
  subtitle: string;
  formula?: string;
  atoms: number;
  domain: string;
  /** Preview image path when one exists (`/learn/<id>.svg`). */
  image?: string;
  /** Catalog palette, used as the tile mark when there is no preview art. */
  colors: [string, string, string];
  /** Lowercased haystack used for matching. */
  haystack: string;
}

/** Ids with preview art in apps/web/public/learn (tools/build-gallery-previews.mjs). */
const PREVIEW_IDS = new Set<string>(previews.ids);

/** Molecules most visitors recognize; they lead the wall. */
export const QUICK_PICK_IDS = [
  'caffeine', 'water', 'aspirin', 'glucose', 'ethanol', 'benzene', 'dopamine', 'serotonin',
  'adrenaline', 'melatonin', 'cholesterol', 'sucrose', 'vanillin', 'menthol', 'capsaicin',
  'limonene', 'resveratrol', 'theobromine', 'c60_buckyball', 'graphene_ribbon', 'diamond_crystal',
  'cnt_6_6', 'phenol', 'acetone',
];

function parseAtoms(label: string | undefined): number {
  const digits = (label ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

function toLocal(example: GalleryExample): LocalMolecule {
  const nomenclature = nomenclatureForGalleryId(example.id);
  const formula = nomenclature?.molecularFormula;
  const metadata = Object.values(example.metadata ?? {}).join(' ');
  return {
    id: example.id,
    title: example.title,
    subtitle: example.subtitle,
    formula,
    atoms: parseAtoms(example.atoms),
    domain: example.domain,
    image: PREVIEW_IDS.has(example.id) ? `/learn/${example.id}.svg` : undefined,
    colors: example.colors,
    haystack: `${example.title} ${formula ?? ''} ${example.domain} ${metadata} ${galleryNomenclatureTags(example.id).join(' ')}`
      .toLowerCase(),
  };
}

/** Every directly openable gallery molecule, quick picks first. */
export const LOCAL_MOLECULES: LocalMolecule[] = (() => {
  const openable = ALL_EXAMPLES.filter((ex) => ex.available !== false && Boolean(ex.file) && !ex.route);
  const byId = new Map(openable.map((ex) => [ex.id, ex]));
  const ordered: GalleryExample[] = [];
  for (const id of QUICK_PICK_IDS) {
    const ex = byId.get(id);
    if (ex) {
      ordered.push(ex);
      byId.delete(id);
    }
  }
  const rest = Array.from(byId.values()).sort((a, b) => parseAtoms(a.atoms) - parseAtoms(b.atoms));
  return [...ordered, ...rest].map(toLocal);
})();

/** Score a local molecule against a query: 0 = no match, higher = better. */
export function scoreLocalMolecule(molecule: LocalMolecule, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const title = molecule.title.toLowerCase();
  if (title === q) return 100;
  if (title.startsWith(q)) return 90;
  const words = title.split(/[\s,()-]+/);
  if (words.some((word) => word.startsWith(q))) return 80;
  if (molecule.formula && molecule.formula.toLowerCase() === q) return 75;
  if (title.includes(q)) return 60;
  if (molecule.haystack.includes(q)) return 30;
  return 0;
}

/** Instant matches for a query, best first. */
export function searchLocalMolecules(query: string, limit = 8): LocalMolecule[] {
  const q = query.trim();
  if (!q) return [];
  return LOCAL_MOLECULES
    .map((molecule) => ({ molecule, score: scoreLocalMolecule(molecule, q) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.molecule.atoms - b.molecule.atoms)
    .slice(0, limit)
    .map((entry) => entry.molecule);
}
