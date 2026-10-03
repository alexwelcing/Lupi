/**
 * Omol25SourceCard — Learn's card for an OMol25 record, read from the frame
 * the viewer already holds (`Frame.sourceRecord`, `Frame.chemistry`); no
 * second fetch. The claims are the shared truth strings (core/omol25).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import {
  OMOL25_CITATION,
  OMOL25_COLLECTIONS,
  OMOL25_COORDINATE_TRUTH,
  isOmol25CollectionId,
  omol25Collection,
  omolCardTruth,
  omolChargeSourcePhrase,
  omolChargeSpin,
  omolGeometryState,
  omolStructurePath,
} from '@atlas/core/omol25';
import type { Frame } from '@atlas/core/types';
import { openMolecule } from '../viewer/openMolecule';

const NEUTRAL_TRAIN_ROWS = OMOL25_COLLECTIONS.find((c) => c.id === 'neutral-train')!.sourceRows;

/** A uniform row of the 34.3M-row neutral training split (no index download). */
export function randomNeutralTrainRow(random: () => number = cryptoUnit): number {
  return Math.min(NEUTRAL_TRAIN_ROWS - 1, Math.floor(random() * NEUTRAL_TRAIN_ROWS));
}

function cryptoUnit(): number {
  const words = new Uint32Array(2);
  globalThis.crypto.getRandomValues(words);
  // 53 random bits: no modulo bias over 34,335,828 rows.
  return ((words[0] >>> 5) * 67_108_864 + (words[1] >>> 6)) / 9_007_199_254_740_992;
}

export interface Omol25SourceRows {
  record: string;
  chargeSpin: string | null;
  gap: string | null;
  force: string | null;
  energy: string | null;
}

/** The card's value lines for one frame, or null when it is not an OMol25 record. */
export function omol25SourceRows(frame: Pick<Frame, 'chemistry' | 'sourceRecord'>): Omol25SourceRows | null {
  const record = frame.sourceRecord;
  if (!record || record.dataset !== 'omol25') return null;
  const collection = record.collection && isOmol25CollectionId(record.collection)
    ? `${omol25Collection(record.collection).label} (${record.collection})`
    : record.collection ?? 'OMol25';
  const chemistry = frame.chemistry ?? null;
  return {
    record: record.row !== null ? `${collection} · row ${record.row.toLocaleString('en-US')}` : collection,
    chargeSpin: chemistry
      ? `${omolChargeSpin(chemistry)} (${omolChargeSourcePhrase(chemistry.source)})`
      : null,
    gap: record.homoLumoGapEv !== null ? `${record.homoLumoGapEv.toFixed(2)} eV` : null,
    force: omolGeometryState(record.maxForceEvPerA),
    energy: record.energyEv !== null
      ? `${record.energyEv.toLocaleString('en-US', { maximumFractionDigits: 3 })} eV (total energy; not comparable across formulas)`
      : null,
  };
}

export function Omol25SourceCard({
  frame,
  muted,
  heading,
}: {
  frame: Pick<Frame, 'chemistry' | 'sourceRecord'>;
  muted: CSSProperties;
  heading: CSSProperties;
}) {
  const rows = omol25SourceRows(frame);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copied === 'idle') return undefined;
    const timer = window.setTimeout(() => setCopied('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  if (!rows) return null;

  const copyCitation = async () => {
    try {
      await navigator.clipboard.writeText(OMOL25_CITATION);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  };
  const openRandom = () => {
    void openMolecule({ kind: 'url', url: omolStructurePath('neutral-train', randomNeutralTrainRow()) });
  };

  const entries: Array<[string, string | null]> = [
    ['Record', rows.record],
    ['Charge and spin', rows.chargeSpin],
    ['HOMO–LUMO gap', rows.gap],
    ['Largest force', rows.force],
    ['Energy', rows.energy],
  ];
  const action: CSSProperties = {
    minHeight: 40,
    padding: '0 12px',
    borderRadius: 6,
    color: 'inherit',
    border: '1px solid #526253',
    background: 'transparent',
    cursor: 'pointer',
    font: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    textDecoration: 'none',
  };

  return (
    <section data-testid="omol25-source-card" style={{ borderTop: '1px solid #526253', paddingTop: 14, marginTop: 14 }}>
      <h3 style={{ ...heading, marginTop: 0 }}>OMol25 source</h3>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', margin: '0 0 12px' }}>
        {entries.filter(([, value]) => value !== null).map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt style={muted}>{label}</dt>
            <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value}</dd>
          </div>
        ))}
      </dl>
      <p style={{ margin: '0 0 6px' }}>{OMOL25_COORDINATE_TRUTH}</p>
      <p style={{ margin: '0 0 12px' }}>{omolCardTruth()}</p>
      <p style={{ ...muted, margin: '0 0 8px' }}>{OMOL25_CITATION}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={copyCitation} style={action}>Copy citation</button>
        <a href="/library/omol25" style={action}>Open in Library</a>
        <button type="button" onClick={openRandom} style={action}>Random OMol25</button>
        <span role="status" style={muted}>
          {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : ''}
        </span>
      </div>
    </section>
  );
}
