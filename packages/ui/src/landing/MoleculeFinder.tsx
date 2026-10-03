import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { OMOL25_NEUTRAL_TRAIN_ROWS, OMOL25_NEUTRAL_VALIDATION_ROWS } from '@atlas/core/omol25';
import { useStore } from '../store';
import { openPubChemMolecule, pubchemAutocomplete, PUBCHEM_COMPOUND_COUNT_LABEL } from '../molecules/pubchemLoad';
import { LOCAL_MOLECULES, searchLocalMolecules, type LocalMolecule } from './moleculeIndex';
import { LandingIntentContext } from './landingIntent';
import { beginRelay, endRelay, peekBaton, setBaton, type RelayBaton } from '../relay/baton';
import { hasFirstFrame } from '../relay/firstFrame';
import { hasMoleculePage, moleculePagePath } from '../moleculePage/pages';
import { inkTileFor, inkTileSrc, inkTileViewDir, prefetchInkModel, preloadInkTiles } from './inkTiles';
import {
  findOmolPicks,
  isFormulaShapedForOmol,
  omolFormulaHandoffHref,
  omolPickDetail,
  omolPickHref,
  omolPickTitle,
  openOmolPick,
  type OmolPick,
  type OmolPickMatches,
} from './omolPicks';
// The relay stage registers itself here, in the landing chunk (no three).
import '../relay/stage';

/**
 * The landing page's first fast path: one search box, results on the first
 * keystroke, one click into the molecule.
 *
 *  - Local gallery molecules match instantly (no network).
 *  - Featured OMol25 picks (bundled, no network) follow, matched by formula
 *    or element; picks that merely contain the formula come last, so Enter
 *    never opens an unrelated structure. A formula-shaped query also gets an
 *    explicit link into OMol25's validation index. OMol25 itself is never
 *    queried from here.
 *  - PubChem's compound dictionary fills in names for anything else after a
 *    short debounce, so a couple of letters reach 100M+ compounds.
 *  - Enter opens the top result; a name with no local match goes straight to
 *    PubChem, so typing any compound name and pressing Enter always works.
 *
 * Loading goes through the store; LandingShell hands off to the viewer the
 * moment `store.file` is set, so the viewer bundle only loads on a pick.
 */

export type FinderResult =
  | { kind: 'local'; key: string; title: string; detail: string; molecule: LocalMolecule }
  | { kind: 'omol'; key: string; title: string; detail: string; pick: OmolPick }
  | { kind: 'pubchem'; key: string; title: string; detail: string; name: string };

const PUBCHEM_DEBOUNCE_MS = 150;
const LOCAL_LIMIT = 6;
const PUBCHEM_LIMIT = 8;
const OMOL_ROWS_LABEL = `${(OMOL25_NEUTRAL_TRAIN_ROWS / 1_000_000).toFixed(1)}M`;
const OMOL_INDEX_ROWS = OMOL25_NEUTRAL_VALIDATION_ROWS.toLocaleString('en-US');

let relaySerial = 0;

/**
 * Open a gallery molecule from the landing (or the library) in place. The
 * sage relay covers the page from this call until the viewer's first frame:
 * it grows `fromRect` (the tapped drawing or tile image) into the stage. The
 * home page's drawing leaves a baton with its pose first; any other opener
 * gets a fresh one. An ink tile (`ink`) hands over its drawing's pose, and
 * the viewer opens in ink before the light comes on (Ink-to-Light).
 */
export function openLocalMolecule(
  id: string,
  opts?: { source?: RelayBaton['source']; fromRect?: DOMRect | null; ink?: boolean },
): Promise<void> {
  const source = opts?.source ?? 'finder';
  const held = peekBaton();
  let baton: RelayBaton;
  if (held && held.galleryId === id && held.source === source) {
    baton = held;
  } else {
    const ink = opts?.ink === true && inkTileSrc(id) !== null;
    const tile = ink ? inkTileFor(id) : null;
    baton = {
      galleryId: id,
      source,
      viewDir: tile ? inkTileViewDir(tile) : null,
      bodyOmegaY: 0,
      t: performance.now(),
      ...(ink ? { ink: true } : {}),
    };
    setBaton(baton); // replaces a stale pose for another opener
  }
  const serial = (relaySerial += 1);
  const endMine = () => {
    if (serial === relaySerial) endRelay();
  };
  beginRelay({ baton, fromRect: opts?.fromRect ?? null });
  // Code-split: the gallery loader drags in the streaming/MLIP machinery,
  // which the landing bundle must not pay for until a pick happens.
  return import('../viewer/openMolecule')
    .then(async ({ openMolecule }) => {
      const result = await openMolecule({ kind: 'gallery', id, history: 'push' });
      if (!result.ok) throw new Error(result.message);
      // Already on screen (nothing will draw a first frame for it): hand back now.
      const shown = useStore.getState().file?.trajectory;
      if (!shown || hasFirstFrame(shown)) endMine();
    })
    .catch((error: unknown) => {
      endMine();
      throw error;
    });
}

/** The preview image inside a clicked row or tile: where the relay grows from. */
export function previewRectIn(element: Element | null | undefined): DOMRect | null {
  const art = element?.querySelector('img, .wall-mark, .finder-glyph');
  return art ? art.getBoundingClientRect() : null;
}

/** Light the tapped ink drawing (a lime glow while the relay takes it); harmless on other art. */
export function lightInkTile(element: Element | null | undefined): void {
  const art = element?.querySelector<HTMLElement>('.ink-tile');
  if (!art) return;
  art.dataset.lit = '';
  window.setTimeout(() => delete art.dataset.lit, 1600);
}

function formatAtoms(atoms: number): string {
  if (atoms >= 1_000_000) return `${(atoms / 1_000_000).toFixed(atoms % 1_000_000 === 0 ? 0 : 1)}M atoms`;
  if (atoms >= 10_000) return `${Math.round(atoms / 1000)}k atoms`;
  return `${atoms.toLocaleString()} atoms`;
}

/**
 * Merge instant local matches, the featured OMol25 picks a query names and
 * PubChem names: gallery first, then OMol25, then PubChem, no duplicates.
 * Picks that only contain the formula follow PubChem's rows.
 */
export function mergeFinderResults(
  query: string,
  local: LocalMolecule[],
  remote: string[],
  picks: OmolPickMatches = findOmolPicks(query),
): FinderResult[] {
  const omolRow = (pick: OmolPick): FinderResult => ({
    kind: 'omol',
    key: `omol:${pick.id}`,
    title: omolPickTitle(pick),
    detail: `OMol25 · ${omolPickDetail(pick)}`,
    pick,
  });
  const results: FinderResult[] = local.map((molecule) => ({
    kind: 'local',
    key: `local:${molecule.id}`,
    title: molecule.title,
    detail: [molecule.formula, molecule.atoms ? formatAtoms(molecule.atoms) : null].filter(Boolean).join(' · '),
    molecule,
  }));
  for (const pick of picks.named) results.push(omolRow(pick));
  const seen = new Set(local.map((m) => m.title.toLowerCase()));
  for (const name of remote) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    results.push({ kind: 'pubchem', key: `pubchem:${lower}`, title: name, detail: 'PubChem', name });
  }
  const q = query.trim().toLowerCase();
  if (q.length >= 2 && !seen.has(q)) {
    results.push({ kind: 'pubchem', key: `pubchem:${q}`, title: query.trim(), detail: 'Look up on PubChem', name: query.trim() });
  }
  for (const pick of picks.containing) results.push(omolRow(pick));
  return results;
}

function finderRowContent(result: FinderResult) {
  const ink = result.kind === 'local' ? inkTileSrc(result.molecule.id) : result.kind === 'omol' ? result.pick.ink : null;
  return (
    <>
      {ink ? (
        <img className="ink-tile" src={ink} alt="" width="40" height="40" loading="lazy" decoding="async" />
      ) : result.kind === 'local' && result.molecule.image ? (
        <img src={result.molecule.image} alt="" width="40" height="40" loading="lazy" decoding="async" />
      ) : (
        <span className="finder-glyph" aria-hidden="true">
          {result.kind === 'local' ? '◉' : '⌕'}
        </span>
      )}
      <span className="finder-text">
        <strong>{result.title}</strong>
        <small>{result.detail}</small>
      </span>
      <span aria-hidden="true">↗</span>
    </>
  );
}

export function MoleculeFinder({ onOpen }: { onOpen?: (result: FinderResult) => void } = {}) {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const loading = useStore((state) => state.loading);
  const error = useStore((state) => state.error);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const intent = useContext(LandingIntentContext);

  const local = useMemo(() => searchLocalMolecules(query, LOCAL_LIMIT), [query]);
  // The ink tiles' poses arrive at idle, before a pick; the drawings of the
  // matches on show arrive as they appear (a couple of kB each), so the relay
  // can turn the one picked.
  useEffect(() => preloadInkTiles(), []);
  useEffect(() => {
    for (const molecule of local) if (inkTileSrc(molecule.id)) prefetchInkModel(molecule.id);
  }, [local]);
  const results = useMemo(() => mergeFinderResults(query, local, remote), [query, local, remote]);

  useEffect(() => {
    const prefix = query.trim();
    if (prefix.length < 2) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void pubchemAutocomplete(prefix, PUBCHEM_LIMIT).then((names) => {
        if (!cancelled) setRemote(names);
      });
    }, PUBCHEM_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const open = useCallback(
    async (result: FinderResult, fromRect: DOMRect | null = null) => {
      if (opening) return;
      setOpening(result.key);
      onOpen?.(result);
      // A pick is intent: fetch the viewer while the molecule loads.
      intent.prefetchViewer();
      try {
        if (result.kind === 'local') {
          await openLocalMolecule(result.molecule.id, { source: 'finder', fromRect, ink: inkTileSrc(result.molecule.id) !== null });
        }
        else if (result.kind === 'omol') await openOmolPick(result.pick, 'finder');
        else await openPubChemMolecule({ name: result.name });
      } catch {
        // The store carries the readable error; keep the finder usable.
      } finally {
        setOpening(null);
      }
    },
    [intent, onOpen, opening],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const index = results[active] ? active : 0;
      const pick = results[index];
      const row = document.getElementById(`${listId}-${index}`);
      if (pick) {
        lightInkTile(row);
        void open(pick, previewRectIn(row));
      }
    } else if (event.key === 'Escape') {
      setQuery('');
    }
  };

  const showList = query.trim().length > 0;
  const busy = loading || opening !== null;

  return (
    <div className="finder" role="search">
      <label className="finder-label" htmlFor={`${listId}-input`}>
        Type a molecule
      </label>
      <div className="finder-box">
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="search"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={query}
          placeholder="caffeine, aspirin, C6H6, dopamine…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showList}
          aria-controls={`${listId}-list`}
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
        />
        {busy && (
          <span className="finder-busy" role="status">
            Opening…
          </span>
        )}
      </div>
      <p className="finder-scope">
        {LOCAL_MOLECULES.length} ready to open · <a href="/library/omol25">{OMOL_ROWS_LABEL} in OMol25</a> ·{' '}
        {PUBCHEM_COMPOUND_COUNT_LABEL} more on PubChem · press Enter to open · <a href="/library">browse the library</a>
      </p>
      {showList && (
        <ul className="finder-results" id={`${listId}-list`} role="listbox" aria-label="Molecule matches">
          {results.map((result, index) => (
            <li
              key={result.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'is-active' : undefined}
            >
              {(result.kind === 'local' && hasMoleculePage(result.molecule.id)) || result.kind === 'omol' ? (
                // A gallery molecule with a page, or an OMol25 pick: a real link
                // (new tab, copy link and crawlers reach /m/<id> or the viewer);
                // a plain click opens it in place.
                <a
                  className="finder-row"
                  href={result.kind === 'omol' ? omolPickHref(result.pick) : moleculePagePath(result.molecule.id)}
                  aria-disabled={busy || undefined}
                  onMouseEnter={() => setActive(index)}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                    event.preventDefault();
                    if (busy) return;
                    lightInkTile(event.currentTarget);
                    void open(result, previewRectIn(event.currentTarget));
                  }}
                >
                  {finderRowContent(result)}
                </a>
              ) : (
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={(event) => void open(result, previewRectIn(event.currentTarget))}
                  disabled={busy}
                >
                  {finderRowContent(result)}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {showList && (
        <p className="finder-more">
          <a href={`/library?q=${encodeURIComponent(query.trim())}`}>Search the full library for “{query.trim()}” ↗</a>
        </p>
      )}
      {showList && isFormulaShapedForOmol(query) && (
        <p className="finder-more">
          <a href={omolFormulaHandoffHref(query)}>
            Find {query.trim()} in OMol25’s {OMOL_INDEX_ROWS}-structure index ↗
          </a>
        </p>
      )}
      {error && !loading && (
        <p className="finder-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
