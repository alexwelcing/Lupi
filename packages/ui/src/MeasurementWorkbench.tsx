import { useMemo, type CSSProperties } from 'react';
import type { Frame } from '@atlas/core/types';
import { useStore } from './store';
import {
  captureMeasurement,
  measurementValueLabel,
  resolveMolecularMeasurement,
  type MeasurementKind,
} from './measurements';

export function MeasurementWorkbench({
  frame,
  frameIndex,
}: {
  frame: Frame | undefined;
  frameIndex: number;
}) {
  const measurementTool = useStore((state) => state.measurementTool);
  const measurement = useStore((state) => state.measurement);
  const playing = useStore((state) => state.playing);
  const setMeasurementTool = useStore((state) => state.setMeasurementTool);
  const setMeasurement = useStore((state) => state.setMeasurement);
  const setSelectedAtoms = useStore((state) => state.setSelectedAtoms);
  const resolved = useMemo(
    () => frame && !playing ? resolveMolecularMeasurement(frame, frameIndex, measurement) : null,
    [frame, frameIndex, measurement, playing],
  );

  const start = (kind: MeasurementKind) => {
    if (!frame) return;
    if (measurementTool === kind) {
      setMeasurementTool(null);
      return;
    }
    // Measurement is defined on an integer source frame. Pause before the
    // first pick so the R3F interpolation pose, picker, and reported value do
    // not disagree about which geometry the user addressed.
    useStore.setState({ playing: false });
    setSelectedAtoms([]);
    setMeasurement(captureMeasurement(frame, frameIndex, kind, []));
    setMeasurementTool(kind);
  };

  const clear = () => {
    setMeasurementTool(null);
    setMeasurement(null);
    setSelectedAtoms([]);
  };

  return (
    <section aria-label="Coordinate measurement" style={sectionStyle}>
      <div style={headingRowStyle}>
        <div>
          <div style={eyebrowStyle}>COORDINATE MEASUREMENT</div>
          <div style={helperStyle}>Pick atoms directly in the 3D view.</div>
        </div>
        {measurement && (
          <button type="button" onClick={clear} style={clearButtonStyle}>CLEAR</button>
        )}
      </div>

      <div role="group" aria-label="Measurement type" style={toolGridStyle}>
        <ToolButton
          label="Distance"
          detail="A–B"
          active={measurementTool === 'distance'}
          disabled={!frame}
          onClick={() => start('distance')}
        />
        <ToolButton
          label="Angle"
          detail="A–B–C"
          active={measurementTool === 'angle'}
          disabled={!frame}
          onClick={() => start('angle')}
        />
      </div>

      {measurementTool && (
        <div role="status" style={pickCueStyle}>
          {measurementTool === 'distance' ? 'Select two distinct atoms.' : 'Select three distinct atoms; B is the angle vertex.'}
        </div>
      )}

      {measurement && playing && (
        <div role="status" style={pickCueStyle}>
          Measurement is hidden during interpolated playback. Pause to read the exact integer source frame.
        </div>
      )}

      {resolved && (
        <article style={resultStyle}>
          <div style={valueRowStyle}>
            <div>
              <div style={resultKindStyle}>{resolved.kind === 'distance' ? 'DISTANCE A–B' : 'ANGLE A–B–C'}</div>
              <output aria-live="polite" style={valueStyle}>{measurementValueLabel(resolved)}</output>
            </div>
            <div style={atomSequenceStyle}>
              {Array.from({ length: resolved.requiredAtoms }, (_, index) => (
                <span key={index} style={atomChipStyle(Boolean(resolved.atoms[index]))}>
                  {String.fromCharCode(65 + index)}
                </span>
              ))}
            </div>
          </div>

          {resolved.atoms.length > 0 && (
            <div style={atomListStyle}>
              {resolved.atoms.map((atom, index) => (
                <span key={`${atom.id}-${index}`}>
                  {String.fromCharCode(65 + index)}: {atom.label}
                </span>
              ))}
            </div>
          )}

          <p style={messageStyle}>{resolved.message}</p>
          <dl style={provenanceStyle}>
            <ProvenanceRow label="Frame" value={`Frame ${frameIndex + 1}; source timestep ${frame?.timestep ?? 'unknown'}. No physical time conversion is implied.`} />
            <ProvenanceRow label="Coordinates" value={resolved.coordinateProvenance} />
            <ProvenanceRow label="Identity" value={resolved.identityLabel} />
            <ProvenanceRow
              label="Periodic boundary"
              value="Not applied. This is the direct displayed Cartesian geometry, without minimum-image or trajectory unwrapping."
            />
          </dl>
        </article>
      )}
    </section>
  );
}

function ToolButton({
  label,
  detail,
  active,
  disabled,
  onClick,
}: {
  label: string;
  detail: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={toolButtonStyle(active, disabled)}
    >
      <strong>{label}</strong>
      <span>{detail}</span>
    </button>
  );
}

function ProvenanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={provenanceRowStyle}>
      <dt style={provenanceTermStyle}>{label}</dt>
      <dd style={provenanceValueStyle}>{value}</dd>
    </div>
  );
}

const sectionStyle: CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'color-mix(in srgb, var(--bg-elevated) 76%, transparent)',
};

const headingRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 9,
};

const eyebrowStyle: CSSProperties = {
  color: '#fbbf24',
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: '0.1em',
};

const helperStyle: CSSProperties = {
  marginTop: 3,
  color: 'var(--text-dim)',
  fontSize: 10,
};

const clearButtonStyle: CSSProperties = {
  padding: '4px 7px',
  color: 'var(--text-secondary)',
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  borderRadius: 4,
  cursor: 'pointer',
  font: '700 9px/1 var(--font-mono)',
};

const toolGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 6,
};

const toolButtonStyle = (active: boolean, disabled: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '7px 9px',
  color: active ? '#111827' : 'var(--text-primary)',
  background: active ? '#fbbf24' : 'var(--bg-surface)',
  border: `1px solid ${active ? '#fbbf24' : 'var(--border-subtle)'}`,
  borderRadius: 5,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.45 : 1,
  fontSize: 11,
});

const pickCueStyle: CSSProperties = {
  marginTop: 7,
  padding: '6px 8px',
  color: '#fde68a',
  background: 'rgba(251, 191, 36, 0.08)',
  border: '1px solid rgba(251, 191, 36, 0.24)',
  borderRadius: 4,
  fontSize: 10,
};

const resultStyle: CSSProperties = {
  marginTop: 9,
  padding: 10,
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderLeft: '3px solid #fbbf24',
  borderRadius: 5,
};

const valueRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};

const resultKindStyle: CSSProperties = {
  color: 'var(--text-dim)',
  fontSize: 8,
  fontWeight: 800,
  letterSpacing: '0.08em',
};

const valueStyle: CSSProperties = {
  display: 'block',
  marginTop: 3,
  color: '#fbbf24',
  font: '750 20px/1.15 var(--font-mono)',
};

const atomSequenceStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
};

const atomChipStyle = (filled: boolean): CSSProperties => ({
  display: 'grid',
  placeItems: 'center',
  width: 24,
  height: 24,
  borderRadius: '50%',
  color: filled ? '#111827' : 'var(--text-dim)',
  background: filled ? '#fbbf24' : 'transparent',
  border: `1px solid ${filled ? '#fbbf24' : 'var(--border-default)'}`,
  font: '800 10px/1 var(--font-mono)',
});

const atomListStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '3px 10px',
  marginTop: 7,
  color: 'var(--text-secondary)',
  font: '500 9px/1.3 var(--font-mono)',
};

const messageStyle: CSSProperties = {
  margin: '8px 0 0',
  color: 'var(--text-secondary)',
  fontSize: 10,
  lineHeight: 1.4,
};

const provenanceStyle: CSSProperties = {
  display: 'grid',
  gap: 5,
  margin: '8px 0 0',
  paddingTop: 8,
  borderTop: '1px solid var(--border-subtle)',
};

const provenanceRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '76px 1fr',
  gap: 7,
  fontSize: 9,
  lineHeight: 1.35,
};

const provenanceTermStyle: CSSProperties = {
  margin: 0,
  color: 'var(--text-dim)',
  fontWeight: 700,
};

const provenanceValueStyle: CSSProperties = {
  margin: 0,
  color: 'var(--text-secondary)',
};
