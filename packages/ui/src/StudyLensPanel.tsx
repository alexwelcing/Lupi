import { useMemo } from 'react';
import { useStore } from './store';
import { buildMoleculeStudyFacts } from './studyFacts';
import { studentPromptForFile } from './gallery/studentCollection';

/** A short, structure-first reading surface. Extended course material belongs in the guide. */
export function StudyLensPanel({ compact = false, onClose }: { compact?: boolean; onClose: () => void }) {
  const file = useStore(state => state.file);
  const frame = useStore(state => state.frame);
  const selectedAtoms = useStore(state => state.selectedAtoms);
  const lastBondCount = useStore(state => state.lastBondCount);
  const showBonds = useStore(state => state.showBonds);
  const measurement = useStore(state => state.measurement);
  const facts = useMemo(
    () =>
      buildMoleculeStudyFacts({
        file,
        frameIndex: frame,
        selectedAtoms,
        lastBondCount,
        showBonds,
        measurement,
      }),
    [file, frame, selectedAtoms, lastBondCount, showBonds, measurement],
  );
  if (!facts || !file) return null;
  const prompt = studentPromptForFile(file.name, file.sourceUrl);
  return (
    <aside
      id="viewer-study-panel"
      data-testid="study-lens-panel"
      aria-label="Study Guide"
      style={{
        position: 'absolute',
        zIndex: 110,
        top: compact ? 150 : 164,
        left: compact ? 12 : 18,
        right: compact ? 12 : 'auto',
        width: compact ? 'auto' : 380,
        maxHeight: 'calc(100dvh - 250px)',
        overflowY: 'auto',
        padding: 22,
        borderRadius: 12,
        background: '#15211ff5',
        border: '1px solid #526253',
        color: '#eff3e9',
        font: '400 14px/1.65 system-ui,sans-serif',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'start',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        <div>
          <span style={{ color: '#d5ef9c', fontSize: 12 }}>Learn</span>
          <h2
            style={{
              margin: '4px 0 16px',
              fontSize: 22,
              overflowWrap: 'anywhere',
            }}
          >
            {facts.title}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close Study Guide"
          onClick={onClose}
          style={{
            minWidth: 40,
            minHeight: 40,
            borderRadius: 6,
            color: 'inherit',
            border: '1px solid #526253',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </header>
      <p style={{ margin: '0 0 20px', fontSize: 16 }}>
        {prompt || 'Rotate the structure. What patterns can you find in its shape and composition?'}
      </p>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          margin: '0 0 20px',
        }}
      >
        <div>
          <dt style={muted}>Composition</dt>
          <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{facts.formula || 'Not identified'}</dd>
        </div>
        <div>
          <dt style={muted}>Atoms in this frame</dt>
          <dd style={{ margin: 0 }}>{facts.atomCount.toLocaleString()}</dd>
        </div>
      </dl>
      <h3 style={heading}>Try it</h3>
      <ol style={{ paddingLeft: 20 }}>
        <li>Rotate the model and compare two viewing angles.</li>
        <li>Open Style to show or hide bond guides.</li>
        <li>Select atoms to inspect their coordinates in Data.</li>
      </ol>
      {facts.measurement && (
        <section>
          <h3 style={heading}>Your measurement</h3>
          <p>
            {facts.measurement.value === null
              ? facts.measurement.message
              : `${facts.measurement.value.toFixed(3)} ${facts.measurement.unitLabel}`}
          </p>
          <p style={muted}>Displayed coordinates only; periodic minimum-image distances are not applied.</p>
        </section>
      )}
      <details style={{ borderTop: '1px solid #526253', paddingTop: 14 }}>
        <summary style={{ cursor: 'pointer', minHeight: 40 }}>What this model tells you</summary>
        <p>{facts.dataProvenance.coordinates}</p>
        <p>{facts.dataProvenance.bonds}</p>
        <p>{facts.dataProvenance.properties}</p>
        <p style={muted}>Source: {facts.sourceLabel}</p>
        {facts.sourceUrl && (
          <a
            href={facts.sourceUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#d5ef9c', overflowWrap: 'anywhere' }}
          >
            Open source data ↗
          </a>
        )}
      </details>
      <a
        href="/study/organic-functional-groups"
        style={{ display: 'block', marginTop: 20, color: '#d5ef9c' }}
      >
        Functional groups guide ↗
      </a>
      <p style={{ ...muted, marginBottom: 0, fontSize: 11 }}>
        Learning prompts curated by Lupi from the supplied coordinate models.
      </p>
    </aside>
  );
}
const muted = { color: '#afc0b4', fontSize: 12 } as const;
const heading = { fontSize: 14, margin: '20px 0 8px' } as const;
