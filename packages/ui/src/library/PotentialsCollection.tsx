import { useEffect, useMemo, useState } from 'react';
import { filterCatalog, loadNistCatalog, summarize, type NistCatalogEntry } from '@atlas/nist';
import { nistCatalogUrl, nistDemoUrl } from '../molecules/dataEndpoints';
import type { MoleculeHit } from '../molecules/types';
import { useStore } from '../store';
import { LibraryCard } from './LibraryCard';
import { openLibraryHit, useLibraryHandoff } from './openHit';
import { trackLibrarySearch } from './trackLibrarySearch';
import { useLibraryQuery } from './useLibraryQuery';

const ELEMENT_CHIP_COUNT = 24;
const PAGE = 48;

/** The same mapping the federated NIST provider uses, so the collection and
 *  the search agree on what opening a potential means. */
export function nistHit(entry: NistCatalogEntry): MoleculeHit {
  return {
    id: entry.id,
    source: 'nist',
    title: entry.short_label || entry.potid,
    subtitle: `${entry.elements.join(', ')} · ${entry.pair_style} · ${entry.year}`,
    elements: entry.elements,
    formula: entry.elements.join(''),
    tags: [entry.pair_style, ...entry.elements],
    notice: entry.demo_path ? undefined : 'No demo trajectory for this potential yet.',
    provenance: entry.doi
      ? {
          sourceUrl: `https://doi.org/${entry.doi}`,
          doi: entry.doi,
          citation: entry.potid,
          license: 'NIST IPR',
          licenseUrl: 'https://www.ctcms.nist.gov/potentials/',
        }
      : undefined,
    load: entry.demo_path
      ? { kind: 'url', url: nistDemoUrl(entry.demo_path) }
      : {
          kind: 'generate',
          inputType: 'procedural',
          input: `${entry.elements[0] ?? 'Cu'} fcc crystal`,
          elements: entry.elements,
          lattice: 'fcc',
          atomCount: 500,
        },
  };
}

/**
 * NIST Interatomic Potentials Repository catalog in the student design.
 * Filters run in the browser over the bundled catalog; a potential with a
 * demo trajectory opens it, the rest open a procedural crystal and say so.
 */
export function PotentialsCollection() {
  const [query, update] = useLibraryQuery();
  const handoff = useLibraryHandoff();
  const catalog = useStore((state) => state.nistCatalog);
  const setCatalog = useStore((state) => state.setNistCatalog);
  const [text, setText] = useState(query.q);
  const [pairStyles, setPairStyles] = useState<string[]>([]);
  const [demoOnly, setDemoOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    if (catalog) return;
    let alive = true;
    loadNistCatalog(nistCatalogUrl())
      .then((entries) => {
        if (alive) setCatalog(entries);
      })
      .catch((reason: unknown) => {
        if (alive) setLoadError(reason instanceof Error ? reason.message : 'The NIST catalog could not be loaded.');
      });
    return () => {
      alive = false;
    };
  }, [catalog, setCatalog]);

  useEffect(() => {
    setText(query.q);
  }, [query.q]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = text.trim();
      if (next !== query.q) update({ q: next });
    }, 220);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const summary = useMemo(() => (catalog ? summarize(catalog) : null), [catalog]);
  const elementChips = useMemo(() => (summary ? summary.element_counts.slice(0, ELEMENT_CHIP_COUNT) : []), [summary]);
  const filtered = useMemo(() => {
    if (!catalog) return [];
    const base = filterCatalog(catalog, {
      query: query.q,
      elements: query.elements,
      pair_styles: pairStyles,
      year_min: null,
      year_max: null,
      single_element_only: false,
    });
    const scoped = demoOnly ? base.filter((entry) => Boolean(entry.demo_path)) : base;
    return [...scoped].sort((a, b) => Number(Boolean(b.demo_path)) - Number(Boolean(a.demo_path)) || b.year - a.year);
  }, [catalog, query.q, query.elements, pairStyles, demoOnly]);

  const elementsKey = query.elements.join(',');
  const pairKey = pairStyles.join(',');
  useEffect(() => {
    if (!catalog) return;
    setShown(PAGE);
    trackLibrarySearch({
      collection: 'potentials',
      source: pairStyles.length ? pairStyles.join('+') : 'all',
      hasQuery: query.q.length > 0,
      elementCount: query.elements.length,
      resultCount: filtered.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, query.q, elementsKey, pairKey, demoOnly]);

  const toggleElement = (symbol: string) =>
    update({ elements: query.elements.includes(symbol) ? query.elements.filter((item) => item !== symbol) : [...query.elements, symbol] });
  const togglePairStyle = (style: string) =>
    setPairStyles((previous) => (previous.includes(style) ? previous.filter((item) => item !== style) : [...previous, style]));

  const open = async (hit: MoleculeHit) => {
    if (opening) return;
    setOpening(hit.id);
    setOpenError(null);
    try {
      await openLibraryHit(hit, handoff);
    } catch (reason) {
      setOpenError(reason instanceof Error ? reason.message : `Could not open ${hit.title}.`);
    } finally {
      setOpening(null);
    }
  };

  const demoCount = catalog ? catalog.filter((entry) => Boolean(entry.demo_path)).length : 0;

  return (
    <div className="library-browser">
      <div className="library-intro">
        <p>
          Interatomic potentials from the NIST Interatomic Potentials Repository, filtered in the browser by element, pair
          style, and year. A demo is Lupi's own small simulation run with that potential, not a NIST-published result;
          potentials without one open a procedural crystal so the elements can still be inspected.
        </p>
      </div>
      {summary && (
        <div className="library-stats">
          <div>
            <strong>{summary.total_potentials.toLocaleString()}</strong>
            <span>potentials</span>
          </div>
          <div>
            <strong>{summary.unique_elements}</strong>
            <span>elements</span>
          </div>
          <div>
            <strong>{summary.unique_pair_styles}</strong>
            <span>pair styles</span>
          </div>
          <div>
            <strong>{demoCount}</strong>
            <span>with a demo trajectory</span>
          </div>
        </div>
      )}
      <div className="library-toolbar">
        <label className="student-search library-search">
          <span>Search potentials</span>
          <input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Mishin, eam/alloy, Ni Al…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="student-filters library-chips library-chips--elements" role="group" aria-label="Contains element">
          {elementChips.map(({ element, count }) => (
            <button key={element} type="button" aria-pressed={query.elements.includes(element)} onClick={() => toggleElement(element)} title={`${count} potentials`}>
              {element}
            </button>
          ))}
          {query.elements.length > 0 && (
            <button type="button" className="library-clear" onClick={() => update({ elements: [] })}>
              Clear elements
            </button>
          )}
        </div>
        <div className="student-filters library-chips" role="group" aria-label="Pair style">
          {(summary?.pair_style_counts ?? []).map(({ pair_style, count }) => (
            <button key={pair_style} type="button" aria-pressed={pairStyles.includes(pair_style)} onClick={() => togglePairStyle(pair_style)}>
              {pair_style} <small>{count}</small>
            </button>
          ))}
          <button type="button" aria-pressed={demoOnly} onClick={() => setDemoOnly((value) => !value)}>
            Demo trajectory only
          </button>
        </div>
      </div>
      <p className="student-result-count" role="status">
        {loadError ? loadError : catalog ? `${filtered.length.toLocaleString()} ${filtered.length === 1 ? 'potential' : 'potentials'}` : 'Loading the NIST catalog…'}
      </p>
      {openError && (
        <p className="finder-error" role="alert">
          {openError}
        </p>
      )}
      {catalog && filtered.length === 0 ? (
        <div className="student-empty">
          <h3>No matching potentials</h3>
          <p>Try fewer elements or another pair style.</p>
          <button
            type="button"
            className="student-secondary"
            onClick={() => {
              setText('');
              setPairStyles([]);
              setDemoOnly(false);
              update({ q: '', elements: [] });
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="library-grid">
          {filtered.slice(0, shown).map((entry) => {
            const hit = nistHit(entry);
            return <LibraryCard key={entry.id} hit={hit} busy={opening === entry.id} onOpen={open} activeElements={query.elements} />;
          })}
        </div>
      )}
      {filtered.length > shown && (
        <div className="library-pager">
          <button type="button" className="student-secondary" onClick={() => setShown((value) => value + PAGE)}>
            Show {Math.min(PAGE, filtered.length - shown)} more of {filtered.length.toLocaleString()}
          </button>
        </div>
      )}
    </div>
  );
}
