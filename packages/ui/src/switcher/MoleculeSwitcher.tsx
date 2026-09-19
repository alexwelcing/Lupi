import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ELEMENT_DATA, getAtomicNumberBySymbol } from '@atlas/core';
import { PeriodicTableGrid } from '../periodic-table/PeriodicTableGrid';
import { ElementDetailCard } from '../periodic-table/ElementDetailCard';
import { useStore } from '../store';
import { trackLibrarySearch } from '../library/trackLibrarySearch';
import { applyJudgment, judgeSwitch, type SwitchJudgment } from './judgeSwitch';
import { findSwitchCandidates, galleryCandidates, type SwitchCandidate } from './switchIndex';
import './switcher.css';

/**
 * Molecule switcher: the fastest way to change what is on screen.
 *
 * Type a name, formula, or element, or click elements on the periodic table,
 * and a result list appears immediately from the local index. Enter or a
 * click swaps the molecule in place; the panel stays open so the next switch
 * is one keystroke away. When the edge has Jev configured, its judgment
 * arrives a moment later and re-orders the list with a labeled best guess.
 * Without it, the deterministic list is the whole feature.
 */
const LOCAL_DEBOUNCE_MS = 120;
const JUDGE_DEBOUNCE_MS = 250;
const RESULT_LIMIT = 24;

const SOURCE_LABEL: Record<SwitchCandidate['source'], string> = {
  gallery: 'Lupi gallery',
  omol: 'OMol25',
  pubchem: 'PubChem',
};

export function MoleculeSwitcher() {
  const file = useStore((state) => state.file);
  const [query, setQuery] = useState('');
  const [elements, setElements] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<SwitchCandidate[]>(() => galleryCandidates({ query: '', elements: [] }));
  const [judgment, setJudgment] = useState<SwitchJudgment | null>(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchGeneration = useRef(0);
  const judgeAbort = useRef<AbortController | null>(null);

  const selectedZ = useMemo(() => elements.map((symbol) => getAtomicNumberBySymbol(symbol)).filter((z): z is number => typeof z === 'number'), [elements]);
  const elementsKey = elements.join(',');

  // Local candidates: immediate, deterministic.
  useEffect(() => {
    const generation = ++searchGeneration.current;
    const timer = setTimeout(() => {
      setLoading(true);
      findSwitchCandidates({ query, elements, limit: RESULT_LIMIT })
        .then((results) => {
          if (generation !== searchGeneration.current) return;
          setCandidates(results);
          setJudgment(null);
          setActive(0);
          trackLibrarySearch({ collection: 'switcher', source: 'viewer', hasQuery: query.trim().length > 0, elementCount: elements.length, resultCount: results.length });
        })
        .finally(() => {
          if (generation === searchGeneration.current) setLoading(false);
        });
    }, LOCAL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, elementsKey]);

  // Jev judgment: never blocks, only re-orders once it lands.
  useEffect(() => {
    judgeAbort.current?.abort();
    if (loading || candidates.length === 0 || (!query.trim() && elements.length === 0)) return;
    const controller = new AbortController();
    judgeAbort.current = controller;
    const timer = setTimeout(() => {
      judgeSwitch(
        { query: query.trim(), elements, candidates, loaded: file ? { title: file.name } : null },
        controller.signal,
      ).then((result) => {
        if (!controller.signal.aborted && result?.configured) setJudgment(result);
      });
    }, JUDGE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, loading]);

  const { ordered, bestKey } = useMemo(() => applyJudgment(candidates, judgment), [candidates, judgment]);

  const open = useCallback(
    async (candidate: SwitchCandidate) => {
      if (opening) return;
      setOpening(candidate.key);
      setError(null);
      try {
        await candidate.open();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : `Could not open ${candidate.title}.`);
      } finally {
        setOpening(null);
      }
    },
    [opening],
  );

  const toggleElement = (z: number) => {
    const symbol = ELEMENT_DATA[z]?.symbol;
    if (!symbol) return;
    setElements((previous) => (previous.includes(symbol) ? previous.filter((item) => item !== symbol) : [...previous, symbol]));
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, ordered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const pick = ordered[active] ?? ordered[0];
      if (pick) void open(pick);
    } else if (event.key === 'Escape' && (query || elements.length)) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
      setElements([]);
    }
  };

  const status = loading
    ? 'Searching…'
    : `${ordered.length}${ordered.length >= RESULT_LIMIT ? '+' : ''} ${ordered.length === 1 ? 'match' : 'matches'}${elements.length ? ` containing ${elements.join(' + ')}` : ''}${judgment?.configured ? ' · best guess by Jev (inferred)' : ''}`;

  return (
    <div className="switcher">
      <p className="switcher-now">
        <span>Now showing</span>
        <strong>{file?.name ?? 'nothing yet'}</strong>
      </p>
      <input
        ref={inputRef}
        type="search"
        aria-label="Switch molecule"
        role="combobox"
        aria-expanded={ordered.length > 0}
        aria-controls={listId}
        aria-activedescendant={ordered[active] ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        value={query}
        placeholder="Name, formula, or element… Enter switches"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="switcher-chips" aria-live="polite">
        {elements.length === 0 ? (
          <span>Click elements below to filter (AND).</span>
        ) : (
          <>
            {elements.map((symbol) => (
              <button key={symbol} type="button" onClick={() => setElements((previous) => previous.filter((item) => item !== symbol))} aria-label={`Remove ${symbol} filter`}>
                {symbol} ×
              </button>
            ))}
            <button type="button" className="switcher-clear" onClick={() => setElements([])}>
              Clear elements
            </button>
          </>
        )}
      </div>
      <div className="switcher-table" tabIndex={0} role="region" aria-label="Scrollable periodic table">
        <PeriodicTableGrid selected={selectedZ} onToggle={toggleElement} cellSize={28} showLegend={false} />
      </div>
      <p className="switcher-status" role="status">
        {status}
      </p>
      {error && (
        <p className="switcher-error" role="alert">
          {error}
        </p>
      )}
      {ordered.length === 0 && !loading ? (
        <p className="switcher-empty">No match in the gallery, OMol25, or PubChem names. Try fewer elements or a name.</p>
      ) : (
        <ul className="switcher-results" id={listId} role="listbox" aria-label="Molecules to switch to">
          {ordered.map((candidate, index) => (
            <li key={candidate.key} id={`${listId}-${index}`} role="option" aria-selected={index === active} className={index === active ? 'is-active' : undefined}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => void open(candidate)}
                disabled={opening !== null}
                aria-busy={opening === candidate.key}
                aria-label={`Switch to ${candidate.title}`}
              >
                <strong>{candidate.title}</strong>
                <small>{candidate.detail}</small>
                <span className={`switcher-badge${candidate.key === bestKey ? ' is-best' : ''}`}>
                  {candidate.key === bestKey ? 'Best guess' : SOURCE_LABEL[candidate.source]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selectedZ.length === 1 && (
        <details className="switcher-facts">
          <summary>About {ELEMENT_DATA[selectedZ[0]]?.name}</summary>
          <ElementDetailCard z={selectedZ[0]} />
        </details>
      )}
    </div>
  );
}
