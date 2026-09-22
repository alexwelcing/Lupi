import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../store';
import { MOBILE_MEDIA_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { trackLibrarySearch } from '../library/trackLibrarySearch';
import { ElementPicker } from './ElementPicker';
import { applyJudgment, buildJudgePool, judgeSwitch, type SwitchJudgment } from './judgeSwitch';
import { recentSwitches, rememberSwitch, subscribeRecent } from './recent';
import { findSwitchCandidates, galleryCandidates, galleryPool, type SwitchCandidate } from './switchIndex';
import './switcher.css';

/**
 * Molecule switcher: the fastest way to change what is on screen.
 *
 * Type a name, formula, or element, or tap elements, and a result list
 * appears immediately from the local index. Enter or a click swaps the
 * molecule in place; the panel stays open so the next switch is one
 * keystroke away, and the last few switches sit at the top as chips. When
 * the edge has Jev configured, its judgment lands a moment later and
 * re-orders the list with a labeled best guess, which may be a molecule the
 * typed text never matched. Without it the deterministic list is the whole
 * feature.
 */
const LOCAL_DEBOUNCE_MS = 120;
const JUDGE_DEBOUNCE_MS = 250;
const RESULT_LIMIT = 24;

const SOURCE_LABEL: Record<SwitchCandidate['source'], string | null> = {
  gallery: null,
  omol: 'OMol25',
  pubchem: 'PubChem',
};

export function MoleculeSwitcher() {
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);
  const file = useStore((state) => state.file);
  const recent = useSyncExternalStore(subscribeRecent, recentSwitches, recentSwitches);
  const [query, setQuery] = useState('');
  const [elements, setElements] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<SwitchCandidate[]>(() => galleryCandidates({ query: '', elements: [] }));
  const [judgment, setJudgment] = useState<SwitchJudgment | null>(null);
  const [judging, setJudging] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchGeneration = useRef(0);
  const judgeAbort = useRef<AbortController | null>(null);

  const elementsKey = elements.join(',');
  const idle = !query.trim() && elements.length === 0;

  // Local candidates: immediate, deterministic.
  useEffect(() => {
    const generation = ++searchGeneration.current;
    const timer = setTimeout(() => {
      setLoading(true);
      findSwitchCandidates({ query, elements, limit: RESULT_LIMIT })
        .then((results) => {
          if (generation !== searchGeneration.current) return;
          setCandidates(results);
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

  // Jev judgment: never blocks, only re-orders once it lands. It starts from
  // the synchronous gallery matches and the gallery pool the moment typing
  // pauses, so a slow OMol25 or PubChem lookup never delays the best guess,
  // and a query with zero local matches still gets one.
  useEffect(() => {
    judgeAbort.current?.abort();
    setJudgment(null);
    if (idle) {
      setJudging(false);
      return;
    }
    const controller = new AbortController();
    judgeAbort.current = controller;
    setJudging(true);
    const timer = setTimeout(() => {
      const shown = galleryCandidates({ query, elements, limit: RESULT_LIMIT });
      judgeSwitch(
        { query: query.trim(), elements, candidates: buildJudgePool(shown, galleryPool(elements)), loaded: file ? { title: file.name } : null },
        controller.signal,
      )
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result?.configured) setJudgment(result);
        })
        .finally(() => {
          if (!controller.signal.aborted) setJudging(false);
        });
    }, JUDGE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, elementsKey]);

  const { ordered, bestKey, hint } = useMemo(() => applyJudgment(candidates, judgment, galleryPool(elements)), [candidates, judgment, elementsKey]);
  const notAMolecule = judgment?.intent?.choice === 'not_a_molecule' && judgment.intent.confidence >= 0.8;

  const open = useCallback(
    async (candidate: SwitchCandidate) => {
      if (opening) return;
      setOpening(candidate.key);
      setError(null);
      try {
        // A switch is the one way a molecule arrives with particles.
        useStore.getState().armArrival();
        await candidate.open();
        rememberSwitch(candidate);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : `Could not open ${candidate.title}.`);
      } finally {
        setOpening(null);
      }
    },
    [opening],
  );

  const toggleElement = (symbol: string) => {
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
    } else if (event.key === 'Escape' && !idle) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
      setElements([]);
    }
  };

  const status = loading
    ? 'Searching…'
    : idle
      ? 'Familiar molecules. Type, or tap an element.'
      : `${ordered.length}${ordered.length >= RESULT_LIMIT ? '+' : ''} ${ordered.length === 1 ? 'match' : 'matches'}${elements.length ? ` containing ${elements.join(' + ')}` : ''}${
          judgment?.configured ? ' · best guess by Jev (inferred)' : judging ? ' · asking for a best guess…' : ''
        }`;

  return (
    <div className="switcher">
      <div className="switcher-now">
        <span>Now</span>
        <strong>{file?.name ?? 'nothing yet'}</strong>
        {recent.filter((item) => item.title !== file?.name).length > 0 && (
          <span className="switcher-recent" role="group" aria-label="Recent molecules">
            {recent
              .filter((item) => item.title !== file?.name)
              .slice(0, 4)
              .map((item) => (
                <button key={item.key} type="button" onClick={() => void open(item)} disabled={opening !== null} aria-label={`Back to ${item.title}`}>
                  ↩ {item.title}
                </button>
              ))}
          </span>
        )}
      </div>
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
        placeholder={isMobile ? "caffeine, C6H6, “something sweet”…" : "caffeine, C6H6, “something sweet”… Enter switches"}
        style={{ textOverflow: 'ellipsis' }}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <ElementPicker selected={elements} onToggle={toggleElement} />
      {elements.length > 0 && (
        <div className="switcher-chips" aria-live="polite">
          <span>
            Containing <b>{elements.join(' + ')}</b>
          </span>
          <button type="button" className="switcher-clear" onClick={() => setElements([])}>
            Clear elements
          </button>
        </div>
      )}
      <p className="switcher-status" role="status">
        {status}
      </p>
      {error && (
        <p className="switcher-error" role="alert">
          {error}
        </p>
      )}
      {hint && (
        <p className="switcher-hint">
          <span>Maybe</span>
          <button type="button" onClick={() => void open(hint)} disabled={opening !== null} aria-label={`Switch to ${hint.title}`}>
            {hint.title}
            {hint.formula ? ` · ${hint.formula}` : ''}
          </button>
          <span>low confidence, inferred</span>
        </p>
      )}
      {ordered.length === 0 && !loading ? (
        <p className="switcher-empty">
          {judging
            ? 'No direct match. Asking for a best guess…'
            : notAMolecule
              ? 'That does not read as a molecule request. Try a name, a formula, or an element.'
              : 'No match in the gallery, OMol25, or PubChem names. Try fewer elements or a name.'}
        </p>
      ) : (
        <ul className="switcher-results" id={listId} role="listbox" aria-label="Molecules to switch to">
          {ordered.map((candidate, index) => {
            const badge = candidate.key === bestKey ? 'Best guess' : SOURCE_LABEL[candidate.source];
            return (
              <li key={candidate.key} id={`${listId}-${index}`} role="option" aria-selected={index === active} className={index === active ? 'is-active' : undefined}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => void open(candidate)}
                  disabled={opening !== null}
                  aria-busy={opening === candidate.key}
                  aria-label={`Switch to ${candidate.title}`}
                >
                  {candidate.image ? (
                    <img src={candidate.image} alt="" width="40" height="40" loading="lazy" decoding="async" />
                  ) : (
                    <span className="switcher-glyph" aria-hidden="true">
                      {candidate.source === 'omol' ? '◇' : candidate.source === 'pubchem' ? '⌕' : '◉'}
                    </span>
                  )}
                  <span className="switcher-text">
                    <strong>{candidate.title}</strong>
                    <small>{candidate.detail}</small>
                  </span>
                  {badge && <span className={`switcher-badge${candidate.key === bestKey ? ' is-best' : ''}`}>{badge}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
