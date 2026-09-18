import { useEffect, useMemo, useRef, useState } from 'react';
import { MOLECULE_PROVIDERS, searchMolecules } from '../molecules';
import type { MoleculeHit, MoleculeSourceId } from '../molecules/types';
import { LibraryCard, SOURCE_LABEL } from './LibraryCard';
import { openLibraryHit, useLibraryHandoff } from './openHit';
import { useLibraryQuery } from './useLibraryQuery';

/**
 * One grid over every connected source. An empty query browses; the source
 * and element chips narrow. Every hit opens through the same load path the
 * homepage finder and the agent tool use.
 */
const PER_SOURCE_LIMIT = 24;
const DEBOUNCE_MS = 220;

const SOURCE_CHIPS: Array<{ id: MoleculeSourceId | null; label: string }> = [
  { id: null, label: 'All sources' },
  { id: 'gallery', label: 'Lupi gallery' },
  { id: 'omol', label: 'OMol25' },
  { id: 'research', label: 'Zenodo research' },
  { id: 'nist', label: 'NIST potentials' },
  { id: 'pubchem', label: 'PubChem' },
  { id: 'saved', label: 'Saved views' },
];

const ELEMENT_CHIPS = ['H', 'C', 'N', 'O', 'F', 'S', 'P', 'Si', 'Cl', 'Fe', 'Cu', 'Ni', 'Li', 'Mg', 'Al', 'Ca'];

function isSourceId(value: string | null): value is MoleculeSourceId {
  return value !== null && value in SOURCE_LABEL;
}

export function LibraryBrowser({ lockedSource = null }: { lockedSource?: MoleculeSourceId | null }) {
  const [query, update] = useLibraryQuery();
  const handoff = useLibraryHandoff();
  const source = lockedSource ?? (isSourceId(query.source) ? query.source : null);
  const [text, setText] = useState(query.q);
  const [debounced, setDebounced] = useState(query.q);
  const [hits, setHits] = useState<MoleculeHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    setText(query.q);
  }, [query.q]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = text.trim();
      setDebounced(next);
      if (next !== query.q) update({ q: next, offset: 0 });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `query.q` is intentionally excluded: the URL follows the input, not the reverse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const elementsKey = query.elements.join(',');
  const availableSources = useMemo(
    () =>
      MOLECULE_PROVIDERS.filter((provider) => provider.isAvailable() && (!source || provider.id === source)).map(
        (provider) => provider.id,
      ),
    [source],
  );

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    searchMolecules(
      {
        text: debounced,
        elements: query.elements.length ? query.elements : undefined,
        sources: source ? [source] : undefined,
        limit: PER_SOURCE_LIMIT,
      },
      MOLECULE_PROVIDERS,
    )
      .then((results) => {
        if (id === requestId.current) setHits(results);
      })
      .catch(() => {
        if (id === requestId.current) setHits([]);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, source, elementsKey]);

  const toggleElement = (symbol: string) => {
    const next = query.elements.includes(symbol)
      ? query.elements.filter((item) => item !== symbol)
      : [...query.elements, symbol];
    update({ elements: next, offset: 0 });
  };

  const open = async (hit: MoleculeHit) => {
    if (opening) return;
    const key = `${hit.source}:${hit.id}`;
    setOpening(key);
    setOpenError(null);
    try {
      await openLibraryHit(hit, handoff);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : `Could not open ${hit.title}.`);
    } finally {
      setOpening(null);
    }
  };

  const status = loading
    ? `Searching ${availableSources.length} ${availableSources.length === 1 ? 'source' : 'sources'}…`
    : `${hits.length}${hits.length >= PER_SOURCE_LIMIT ? '+' : ''} ${hits.length === 1 ? 'result' : 'results'} from ${availableSources.length} ${availableSources.length === 1 ? 'source' : 'sources'}`;

  return (
    <div className="library-browser">
      <div className="library-toolbar">
        <label className="student-search library-search">
          <span>Search every collection</span>
          <input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Name, formula, element, DOI…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {!lockedSource && (
          <div className="student-filters library-chips" role="group" aria-label="Source">
            {SOURCE_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                aria-pressed={source === chip.id}
                onClick={() => update({ source: chip.id, offset: 0 })}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
        <div className="student-filters library-chips library-chips--elements" role="group" aria-label="Contains element">
          {ELEMENT_CHIPS.map((symbol) => (
            <button key={symbol} type="button" aria-pressed={query.elements.includes(symbol)} onClick={() => toggleElement(symbol)}>
              {symbol}
            </button>
          ))}
          {query.elements.length > 0 && (
            <button type="button" className="library-clear" onClick={() => update({ elements: [], offset: 0 })}>
              Clear elements
            </button>
          )}
        </div>
      </div>
      <p className="student-result-count" role="status">
        {status}
      </p>
      {openError && (
        <p className="finder-error" role="alert">
          {openError}
        </p>
      )}
      {!loading && hits.length === 0 ? (
        <div className="student-empty">
          <h3>No matching structures</h3>
          <p>Try a formula such as C6H6, an element chip, or a different source.</p>
          <button
            type="button"
            className="student-secondary"
            onClick={() => {
              setText('');
              update({ q: '', elements: [], source: lockedSource ? query.source : null, offset: 0 });
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="library-grid">
          {hits.map((hit) => {
            const key = `${hit.source}:${hit.id}`;
            return <LibraryCard key={key} hit={hit} busy={opening === key} onOpen={open} activeElements={query.elements} />;
          })}
        </div>
      )}
    </div>
  );
}
