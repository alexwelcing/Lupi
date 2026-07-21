import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { loadMoleculeHit } from './load';
import {
  FALLBACK_OMOL_COLLECTIONS,
  RemoteOmolWarmingError,
  remoteOmolHit,
  remoteOmolManifest,
  remoteOmolPage,
  type RemoteOmolCollection as Collection,
  type RemoteOmolCollectionId,
  type RemoteOmolPage,
} from './remoteOmol';
import type { MoleculeHit } from './types';

const ACCENT = '#34d399';
const PAGE_SIZE = 24;
const VISIBLE: RemoteOmolCollectionId[] = ['neutral-train', 'all-train-preview', 'train-4m-preview', 'validation-preview'];

export function RemoteOmolCollection({ onOpenFacets }: { onOpenFacets: () => void }) {
  const [collections, setCollections] = useState<Collection[]>([...FALLBACK_OMOL_COLLECTIONS]);
  const [collectionId, setCollectionId] = useState<RemoteOmolCollectionId>('neutral-train');
  const [offset, setOffset] = useState(0);
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState<RemoteOmolPage | null>(null);
  const [hits, setHits] = useState<MoleculeHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let alive = true;
    remoteOmolManifest().then((manifest) => { if (alive && manifest.collections.length) setCollections(manifest.collections); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebounced(text.trim()), 260);
    return () => globalThis.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    remoteOmolPage({ collection: collectionId, offset, limit: PAGE_SIZE, ...(debounced ? { formula: debounced } : {}) })
      .then((result) => {
        if (id !== requestId.current) return;
        setPage(result);
        setHits(result.rows.map(remoteOmolHit));
      })
      .catch((reason: unknown) => {
        if (id !== requestId.current) return;
        setPage(null);
        setHits([]);
        setError(reason instanceof RemoteOmolWarmingError
          ? 'Exact-formula search is warming upstream. Browse still works; retry this formula shortly.'
          : reason instanceof Error ? reason.message : 'OMol25 could not be reached.');
      })
      .finally(() => { if (id === requestId.current) setLoading(false); });
  }, [collectionId, debounced, offset]);

  const collection = useMemo(
    () => collections.find((item) => item.id === collectionId)
      ?? FALLBACK_OMOL_COLLECTIONS.find((item) => item.id === collectionId)!,
    [collectionId, collections],
  );
  const visible = useMemo(
    () => VISIBLE.map((id) => collections.find((item) => item.id === id)).filter((item): item is Collection => Boolean(item)),
    [collections],
  );
  const resultTotal = page?.matchedRows ?? collection.indexedRows;
  const pageEnd = Math.min(offset + hits.length, resultTotal);
  const canPrevious = offset > 0;
  const canNext = offset + PAGE_SIZE < resultTotal;

  const chooseCollection = (id: RemoteOmolCollectionId) => {
    setCollectionId(id);
    setOffset(0);
    setText('');
    setDebounced('');
  };
  const chooseRandomPage = () => {
    const lastStart = Math.max(0, resultTotal - PAGE_SIZE);
    const pageCount = Math.floor(lastStart / PAGE_SIZE) + 1;
    setOffset(Math.min(lastStart, Math.floor(Math.random() * pageCount) * PAGE_SIZE));
  };
  const launch = async (hit: MoleculeHit) => {
    const key = `${hit.source}:${hit.id}`;
    setLoadingId(key);
    try { await loadMoleculeHit(hit); } catch { setLoadingId(null); }
  };

  return (
    <div style={wrap}>
      <header style={masthead}>
        <div style={titleRow}>
          <span style={kicker}>Meta FAIR Chemistry</span>
          <h2 style={title}>Open Molecules 2025</h2>
          <span style={statusPill(collection.coverage === 'complete')}>{collection.coverage === 'complete' ? 'Complete split' : 'Indexed preview'}</span>
        </div>
        <p style={lead}>
          Stream source DFT coordinates from ColabFit. Lupi fetches one compact page and only the structure you open; no dataset shards are copied into the app.{' '}
          <a href="https://arxiv.org/abs/2505.08762" target="_blank" rel="noreferrer" style={link}>Paper</a>
          {' · '}
          <a href="https://huggingface.co/collections/colabfit/omol25-open-molecules-2025-colabfit" target="_blank" rel="noreferrer" style={link}>Source</a>
        </p>
        <div style={scopeRail} role="group" aria-label="OMol25 collection">
          {visible.map((option) => (
            <button key={option.id} type="button" onClick={() => chooseCollection(option.id)} aria-pressed={collectionId === option.id} style={scopeButton(collectionId === option.id)}>
              <span>{option.label}</span><span style={scopeCount}>{compactCount(option.indexedRows)}</span>
            </button>
          ))}
          <button type="button" onClick={onOpenFacets} style={scopeButton(false)}><span>Faceted validation</span><span style={scopeCount}>27.7K</span></button>
        </div>
        <div style={statRow}>
          <Stat label="Queryable now" value={collection.indexedRows.toLocaleString()} />
          <Stat label="Repository scope" value={collection.coverage === 'complete' ? '100%' : compactCount(collection.estimatedRows)} />
          <Stat label="Transfer model" value="On demand" />
          <Stat label="Source truth" value="Coordinates · no bonds" subtle />
        </div>
      </header>

      {collection.coverage === 'indexed-preview' && (
        <div style={notice}>Repository estimate: {collection.estimatedRows.toLocaleString()} rows. Hugging Face currently exposes {collection.indexedRows.toLocaleString()} through its row API; Lupi keeps that boundary visible.</div>
      )}

      <section>
        <div style={commandRow}>
          <div style={search}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input value={text} onChange={(event) => { setText(event.target.value); setOffset(0); }} placeholder="Exact formula, e.g. C6H6" aria-label="Search this OMol25 collection by exact formula" style={searchInput} />
          </div>
          <button type="button" onClick={chooseRandomPage} disabled={loading || resultTotal <= PAGE_SIZE} style={actionButton}>Random page</button>
        </div>
        <div style={resultsBar}>
          <span>{loading ? 'Loading source rows…' : hits.length ? `${(offset + 1).toLocaleString()}–${pageEnd.toLocaleString()} of ${resultTotal.toLocaleString()}` : 'No rows'}</span>
          <span>ωB97M-V/def2-TZVPD · source coordinates · no source bonds</span>
        </div>
        {error && <div style={errorStyle}>{error}</div>}
        {!loading && !error && hits.length === 0 && <div style={empty}>No exact formula match in this indexed collection.</div>}
        <div style={grid}>
          {hits.map((hit) => {
            const key = `${hit.source}:${hit.id}`;
            const busy = loadingId === key;
            return (
              <button key={key} type="button" onClick={() => launch(hit)} disabled={busy} style={card(busy)}>
                <span style={cardTitle}>{hit.title}</span>
                <span style={cardSubtitle}>{hit.subtitle}</span>
                <span style={elementRow}>{hit.elements?.map((element) => <span key={element} style={elementPill}>{element}</span>)}</span>
                <span style={truth}>SOURCE XYZ · NO SOURCE BONDS</span>
                {busy && <span style={busyStyle}>Loading structure…</span>}
              </button>
            );
          })}
        </div>
        <div style={pager}>
          <button type="button" disabled={!canPrevious || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} style={pagerButton(canPrevious && !loading)}>Previous</button>
          <span style={pagerReadout}>offset {offset.toLocaleString()}</span>
          <button type="button" disabled={!canNext || loading} onClick={() => setOffset(offset + PAGE_SIZE)} style={pagerButton(canNext && !loading)}>Next</button>
        </div>
      </section>
    </div>
  );
}

function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return value.toLocaleString();
}
function Stat({ label, value, subtle }: { label: string; value: string; subtle?: boolean }) {
  return <div style={stat}><div style={statValue(subtle)}>{value}</div><div style={statLabel}>{label}</div></div>;
}

const wrap: CSSProperties = { maxWidth: 1120, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 18 };
const masthead: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 22px', border: '1px solid rgba(52,211,153,0.28)', borderRadius: 12, background: 'linear-gradient(135deg, rgba(52,211,153,0.11), rgba(13,17,23,0.52))' };
const titleRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' };
const kicker: CSSProperties = { fontSize: 10, fontWeight: 750, color: ACCENT, letterSpacing: '0.11em', textTransform: 'uppercase' };
const title: CSSProperties = { margin: 0, color: '#f8fafc', fontFamily: 'Space Grotesk, sans-serif', fontSize: 27, lineHeight: 1.08 };
const statusPill = (complete: boolean): CSSProperties => ({ padding: '3px 8px', borderRadius: 100, color: complete ? ACCENT : '#fbbf24', background: complete ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.1)', border: `1px solid ${complete ? 'rgba(52,211,153,0.4)' : 'rgba(251,191,36,0.35)'}`, fontSize: 9, fontWeight: 800, textTransform: 'uppercase' });
const lead: CSSProperties = { margin: 0, maxWidth: '84ch', color: '#9fb0c5', fontSize: 12, lineHeight: 1.55 };
const link: CSSProperties = { color: ACCENT, textDecoration: 'none', fontWeight: 700 };
const scopeRail: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };
const scopeButton = (active: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderRadius: 7, cursor: 'pointer', color: active ? '#04140d' : '#cbd5e1', background: active ? ACCENT : 'rgba(255,255,255,0.045)', border: `1px solid ${active ? ACCENT : 'rgba(148,163,184,0.16)'}`, fontSize: 11, fontWeight: 730 });
const scopeCount: CSSProperties = { fontFamily: 'var(--font-mono, ui-monospace), monospace', fontSize: 9, opacity: 0.68 };
const statRow: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 };
const stat: CSSProperties = { padding: '9px 10px', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 7, background: 'rgba(2,6,23,0.25)' };
const statValue = (subtle = false): CSSProperties => ({ color: subtle ? '#94a3b8' : '#f1f5f9', fontSize: subtle ? 12 : 18, fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' });
const statLabel: CSSProperties = { marginTop: 3, color: '#64748b', fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase' };
const notice: CSSProperties = { padding: '9px 12px', color: '#d6b870', fontSize: 11, lineHeight: 1.45, border: '1px solid rgba(251,191,36,0.22)', borderRadius: 8, background: 'rgba(251,191,36,0.055)' };
const commandRow: CSSProperties = { display: 'flex', alignItems: 'stretch', gap: 8 };
const search: CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', border: '1px solid rgba(148,163,184,0.16)', borderRadius: 8, background: 'rgba(255,255,255,0.05)' };
const searchInput: CSSProperties = { flex: 1, minWidth: 0, color: '#f8fafc', background: 'transparent', border: 0, outline: 0, fontSize: 13 };
const actionButton: CSSProperties = { padding: '0 14px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.1)', color: ACCENT, cursor: 'pointer', fontSize: 11, fontWeight: 700 };
const resultsBar: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, margin: '8px 2px 11px', color: '#64748b', fontSize: 10, flexWrap: 'wrap' };
const errorStyle: CSSProperties = { marginBottom: 10, padding: '10px 12px', color: '#fca5a5', fontSize: 11, border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, background: 'rgba(248,113,113,0.08)' };
const empty: CSSProperties = { padding: '36px 16px', color: '#64748b', textAlign: 'center', fontSize: 12 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 9 };
const card = (busy: boolean): CSSProperties => ({ position: 'relative', minHeight: 126, display: 'flex', flexDirection: 'column', gap: 5, padding: '11px 12px', textAlign: 'left', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.65 : 1, border: '1px solid rgba(148,163,184,0.14)', borderRadius: 8, background: 'linear-gradient(180deg, rgba(15,23,42,0.78), rgba(13,17,23,0.94))' });
const cardTitle: CSSProperties = { color: '#f1f5f9', fontFamily: 'var(--font-mono, ui-monospace), monospace', fontWeight: 760, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const cardSubtitle: CSSProperties = { color: '#718096', fontSize: 10, lineHeight: 1.35 };
const elementRow: CSSProperties = { display: 'flex', gap: 3, flexWrap: 'wrap' };
const elementPill: CSSProperties = { padding: '1px 5px', color: '#a7f3d0', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.22)', borderRadius: 4, fontSize: 9, fontWeight: 700 };
const truth: CSSProperties = { marginTop: 'auto', color: '#4f7a69', fontSize: 8, fontWeight: 800, letterSpacing: '0.045em' };
const busyStyle: CSSProperties = { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', borderRadius: 8, color: ACCENT, background: 'rgba(6,8,13,0.72)', fontSize: 10, fontWeight: 700 };
const pager: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 14 };
const pagerButton = (enabled: boolean): CSSProperties => ({ padding: '6px 12px', color: enabled ? '#d1fae5' : '#475569', background: enabled ? 'rgba(52,211,153,0.09)' : 'rgba(255,255,255,0.025)', border: `1px solid ${enabled ? 'rgba(52,211,153,0.28)' : 'rgba(148,163,184,0.1)'}`, borderRadius: 6, cursor: enabled ? 'pointer' : 'default', fontSize: 10, fontWeight: 700 });
const pagerReadout: CSSProperties = { color: '#64748b', fontFamily: 'var(--font-mono, ui-monospace), monospace', fontSize: 9 };
