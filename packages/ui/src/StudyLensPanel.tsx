import { useMemo, type CSSProperties } from 'react';
import { MOLECULAR_RECIPE_ID } from '@atlas/core/bonds';
import { useStore } from './store';
import { getPerceivedBonds, resolveFrameRecipe } from './bonds/perceivedBonds';
import { BondMethodSection } from './bonds/BondMethodSection';
import { Omol25SourceCard } from './omol25/Omol25SourceCard';
import { buildMoleculeStudyFacts } from './studyFacts';
import { studentPromptForFile } from './gallery/studentCollection';
import { usePhoneSheet } from './panels/usePhoneSheet';

const PANEL_FILL = '#15211ff5';
const PANEL_EDGE = '1px solid #526253';

/**
 * A short, structure-first reading surface. Extended course material belongs in the guide.
 *
 * On a phone it is a sheet like the command panels (panels/usePhoneSheet): a
 * bottom sheet with Peek, Half and Full detents held upright, a column on the
 * right held sideways, and the molecule moves into the room it leaves.
 */
export function StudyLensPanel({
  compact = false,
  stowed = false,
  onClose,
}: {
  compact?: boolean;
  /** The viewer chrome is stowed: the sheet is off screen. */
  stowed?: boolean;
  onClose: () => void;
}) {
  const file = useStore(state => state.file);
  const frame = useStore(state => state.frame);
  const selectedAtoms = useStore(state => state.selectedAtoms);
  const lastBondCount = useStore(state => state.lastBondCount);
  const lastBondDetail = useStore(state => state.lastBondDetail);
  const showBonds = useStore(state => state.showBonds);
  const bondProfile = useStore(state => state.bondProfile);
  const bondTolerance = useStore(state => state.bondTolerance);
  const measurement = useStore(state => state.measurement);
  const facts = useMemo(
    () =>
      buildMoleculeStudyFacts({
        file,
        frameIndex: frame,
        selectedAtoms,
        lastBondCount,
        lastBondDetail,
        showBonds,
        measurement,
      }),
    [file, frame, selectedAtoms, lastBondCount, lastBondDetail, showBonds, measurement],
  );
  const sourceFrame = file ? file.trajectory.frames[frame] ?? file.trajectory.frames[0] : undefined;
  // The same cached graph the view draws, before any display filter.
  const perceived = useMemo(() => {
    if (!sourceFrame || !showBonds) return null;
    const frameCount = file?.trajectory.totalFrames ?? 1;
    if (resolveFrameRecipe(sourceFrame, { profile: bondProfile, frameCount }) !== MOLECULAR_RECIPE_ID) return null;
    return getPerceivedBonds(sourceFrame, { recipe: MOLECULAR_RECIPE_ID, tolerance: bondTolerance });
  }, [sourceFrame, showBonds, bondProfile, bondTolerance, file]);
  const sheet = usePhoneSheet({
    id: 'learn',
    memoryKey: 'learn',
    open: compact && Boolean(facts && file) && !stowed,
    onDismiss: onClose,
  });
  if (!facts || !file) return null;
  const prompt = studentPromptForFile(file.name, file.sourceUrl);
  // A phone sheet: global.css places it; the header grips, the body scrolls.
  const phone = compact && sheet.mode !== null;
  const dragHandle = phone && sheet.mode === 'sheet';
  const outer: CSSProperties = phone
    ? {
        position: 'absolute',
        zIndex: 110,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: PANEL_FILL,
        border: PANEL_EDGE,
        color: '#eff3e9',
        font: '400 14px/1.65 system-ui,sans-serif',
      }
    : {
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
        background: PANEL_FILL,
        border: PANEL_EDGE,
        color: '#eff3e9',
        font: '400 14px/1.65 system-ui,sans-serif',
      };
  return (
    <aside
      id="viewer-study-panel"
      ref={sheet.sheetRef}
      className={phone ? 'lupi-study-panel' : undefined}
      data-testid="study-lens-panel"
      aria-label="Study Guide"
      style={outer}
      {...(phone ? sheet.sheetProps : {})}
    >
      {dragHandle && <button {...sheet.handleProps} aria-controls="viewer-study-panel" />}
      <header
        {...(dragHandle ? sheet.gripProps : {})}
        style={{
          display: 'flex',
          alignItems: 'start',
          justifyContent: 'space-between',
          gap: 14,
          flexShrink: 0,
          padding: phone ? `${dragHandle ? 18 : 14}px 16px 0 18px` : 0,
          touchAction: dragHandle ? 'none' : undefined,
        }}
      >
        <div>
          <span style={{ color: '#d5ef9c', fontSize: 12 }}>Learn</span>
          <h2
            style={{
              margin: phone ? '2px 0 10px' : '4px 0 16px',
              fontSize: phone ? 20 : 22,
              lineHeight: phone ? 1.25 : undefined,
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
            minWidth: phone ? 44 : 40,
            minHeight: phone ? 44 : 40,
            borderRadius: 6,
            color: 'inherit',
            border: PANEL_EDGE,
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </header>
      <div
        className={phone ? 'lupi-study-panel__body' : undefined}
        style={
          phone
            ? { flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '0 18px 18px' }
            : undefined
        }
      >
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
        {perceived && sourceFrame && (
          <BondMethodSection perceived={perceived} frame={sourceFrame} muted={muted} heading={heading} />
        )}
        {sourceFrame && <Omol25SourceCard frame={sourceFrame} muted={muted} heading={heading} />}
        <a
          href="/study/organic-functional-groups"
          style={{ display: 'block', marginTop: 20, color: '#d5ef9c' }}
        >
          Functional groups guide ↗
        </a>
        <p style={{ ...muted, marginBottom: 0, fontSize: 11 }}>
          Learning prompts curated by Lupi from the supplied coordinate models.
        </p>
      </div>
    </aside>
  );
}
const muted = { color: '#afc0b4', fontSize: 12 } as const;
const heading = { fontSize: 14, margin: '20px 0 8px' } as const;
