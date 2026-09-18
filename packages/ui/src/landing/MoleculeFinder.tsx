import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { openPubChemMolecule, pubchemAutocomplete, PUBCHEM_COMPOUND_COUNT_LABEL } from '../molecules/pubchemLoad';
import { LOCAL_MOLECULES, searchLocalMolecules, type LocalMolecule } from './moleculeIndex';

/**
 * The landing page's first fast path: one search box, results on the first
 * keystroke, one click into the molecule.
 *
 *  - Local gallery molecules match instantly (no network).
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
  | { kind: 'pubchem'; key: string; title: string; detail: string; name: string };

const PUBCHEM_DEBOUNCE_MS = 150;
const LOCAL_LIMIT = 6;
const PUBCHEM_LIMIT = 8;

export function openLocalMolecule(id: string): Promise<void> {
  // Code-split: the gallery loader drags in the streaming/MLIP machinery,
  // which the landing bundle must not pay for until a pick happens.
  return import('../viewer/openMolecule').then(async ({ openMolecule }) => {
    const result = await openMolecule({ kind: 'gallery', id, history: 'push' });
    if (!result.ok) throw new Error(result.message);
  });
}

function formatAtoms(atoms: number): string {
  if (atoms >= 1_000_000) return `${(atoms / 1_000_000).toFixed(atoms % 1_000_000 === 0 ? 0 : 1)}M atoms`;
  if (atoms >= 10_000) return `${Math.round(atoms / 1000)}k atoms`;
  return `${atoms.toLocaleString()} atoms`;
}

/** Merge instant local matches with PubChem names, local first, no duplicates. */
export function mergeFinderResults(query: string, local: LocalMolecule[], remote: string[]): FinderResult[] {
  const results: FinderResult[] = local.map((molecule) => ({
    kind: 'local',
    key: `local:${molecule.id}`,
    title: molecule.title,
    detail: [molecule.formula, molecule.atoms ? formatAtoms(molecule.atoms) : null].filter(Boolean).join(' · '),
    molecule,
  }));
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
  return results;
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

  const local = useMemo(() => searchLocalMolecules(query, LOCAL_LIMIT), [query]);
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
    async (result: FinderResult) => {
      if (opening) return;
      setOpening(result.key);
      onOpen?.(result);
      try {
        if (result.kind === 'local') await openLocalMolecule(result.molecule.id);
        else await openPubChemMolecule({ name: result.name });
      } catch {
        // The store carries the readable error; keep the finder usable.
      } finally {
        setOpening(null);
      }
    },
    [onOpen, opening],
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
      const pick = results[active] ?? results[0];
      if (pick) void open(pick);
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
        {LOCAL_MOLECULES.length} ready to open · {PUBCHEM_COMPOUND_COUNT_LABEL} more on PubChem · press Enter to open ·{' '}
        <a href="/library">browse the library</a>
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
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => void open(result)}
                disabled={busy}
              >
                {result.kind === 'local' && result.molecule.image ? (
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
              </button>
            </li>
          ))}
        </ul>
      )}
      {showList && (
        <p className="finder-more">
          <a href={`/library?q=${encodeURIComponent(query.trim())}`}>Search the full library for “{query.trim()}” ↗</a>
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
