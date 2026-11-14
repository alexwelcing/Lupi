import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { hasUsableSourceIds, resolveTypeLabel } from '@atlas/core';
import type { Frame } from '@atlas/core/types';
import { useStore } from './store';
import { playStore } from './play/playStore';
import { captureMeasurement, measurementValueLabel, resolveMeasurementAtomIndices, resolveMolecularMeasurement, requiredMeasurementAtoms, type MeasurementKind } from './measurements';

/** Measurement controls live in Data; the unoccluded molecule remains touchable. */
export function MeasurementWorkbench({ frame, frameIndex }: { frame: Frame | undefined; frameIndex: number }) {
  const measurement = useStore(s => s.measurement);
  const tool = useStore(s => s.measurementTool);
  const target = useStore(s => s.measurementTarget);
  const playing = useStore(s => s.playing);
  const file = useStore(s => s.file);
  const hiddenAtomTypes = useStore(s => s.hiddenAtomTypes);
  const [finding, setFinding] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => { setFinding(null); }, [measurement]);
  // Leaving Data disarms picking, but preserves the ruler and its source references.
  useEffect(() => () => {
    if (useStore.getState().measurementTool !== null) {
      useStore.setState({ measurementTool: null, measurementTarget: null, selectedAtoms: [] });
    }
  }, []);
  const resolved = useMemo(() => frame && !playing ? resolveMolecularMeasurement(frame, frameIndex, measurement) : null, [frame, frameIndex, measurement, playing]);
  const baseline = useMemo(() => {
    const source = measurement && file?.trajectory.frames[measurement.capturedFrame];
    if (!source || !measurement || measurement.atoms.some(atom => atom.identity === 'frame-row')) return null;
    return resolveMolecularMeasurement(source, measurement.capturedFrame, measurement);
  }, [file, measurement]);
  const delta = resolved?.status === 'ready' && baseline?.status === 'ready'
    && resolved.kind === 'distance' && resolved.unit === 'angstrom' && baseline.unit === 'angstrom'
    && measurement?.capturedFrame !== frameIndex
    ? resolved.value! - baseline.value! : null;
  const start = (kind: MeasurementKind) => {
    if (!frame) return;
    playStore.getState().setVerb('orbit');
    playStore.getState().setTrayOpen(false);
    useStore.setState({ playing: false, selectedAtoms: [], measurement: captureMeasurement(frame, frameIndex, kind, []), measurementTool: kind, measurementTarget: 0 });
    useStore.getState().fitCameraView();
    setFinding(null);
  };
  const clear = () => {
    useStore.setState({ measurement: null, measurementTool: null, measurementTarget: null, selectedAtoms: [] });
    setFinding(null);
  };
  const arm = (slot: number) => {
    if (!measurement) return;
    playStore.getState().setVerb('orbit');
    playStore.getState().setTrayOpen(false);
    useStore.setState({ playing: false, measurementTool: measurement.kind, measurementTarget: slot, selectedAtoms: [] });
    setFinding(finding === slot ? null : slot);
    setQuery('');
  };
  const choose = (index: number) => {
    if (!frame || !measurement || finding === null) return;
    const indices = resolveMeasurementAtomIndices(frame, frameIndex, measurement);
    if (indices.some((value, slot) => value === index && slot !== finding)) return;
    indices[Math.min(finding, indices.length)] = index;
    const next = captureMeasurement(frame, frameIndex, measurement.kind, indices);
    const done = next.atoms.length === requiredMeasurementAtoms(measurement.kind);
    const visibleTypes = new Set(useStore.getState().hiddenAtomTypes);
    visibleTypes.delete(frame.types[index]);
    useStore.setState({ hiddenAtomTypes: visibleTypes, playing: false, measurement: next, measurementTool: done ? null : next.kind, measurementTarget: done ? null : next.atoms.length, selectedAtoms: [] });
    setFinding(null);
  };
  const candidates = useMemo(() => {
    if (!frame || finding === null) return [];
    const q = query.trim().toLowerCase();
    const result: { index: number; label: string }[] = [];
    for (let index = 0; index < frame.natoms && result.length < 30; index++) {
      const label = `${resolveTypeLabel(frame, frame.types[index])} · ${hasUsableSourceIds(frame) ? `ID ${frame.ids[index]} · ` : ""}row ${index + 1}`;
      if (!q || label.toLowerCase().includes(q)) result.push({ index, label });
    }
    return result;
  }, [frame, finding, query]);
  const count = file?.trajectory.totalFrames ?? 1;
  const seek = (index: number) => {
    useStore.setState({ playing: false, measurementTool: null, measurementTarget: null, selectedAtoms: [] });
    useStore.getState().setFrame(index);
    setFinding(null);
  };
  if (!measurement) return <section aria-label="Coordinate measurement" style={panel}>
    <strong>Measure atoms</strong><p style={hint}>Tap two atoms for a distance. Rotate to see more, or choose an exact atom.</p>
    <div style={row}><button style={button} onClick={() => start('distance')} disabled={!frame}>Distance A–B</button><button style={button} onClick={() => start('angle')} disabled={!frame}>Angle A–B–C</button></div>
  </section>;
  const nextSlot = target ?? resolved?.atoms.length ?? 0;
  return <section aria-label="Measure atoms" style={panel}>
    <div style={{ ...row, justifyContent: 'space-between' }}>
      <div><span style={hint}>{measurement.kind === 'distance' ? 'DISTANCE A–B' : 'ANGLE A–B–C'}</span><output aria-live="polite" style={value}>{playing ? 'Pause to measure' : resolved ? measurementValueLabel(resolved) : '—'}</output></div>
      <button style={button} onClick={clear} aria-label="Clear measurement">Clear</button>
    </div>
    <div style={{ ...hint, margin: '3px 0 0' }}>Direct Cartesian · no periodic correction</div>
    <div style={{ ...row, marginTop: 8 }}>
      {Array.from({ length: requiredMeasurementAtoms(measurement.kind) }, (_, slot) => <button key={slot} style={{ ...button, flex: 1, opacity: slot > (resolved?.atoms.length ?? 0) ? 0.45 : 1, borderColor: tool && nextSlot === slot ? '#fbbf24' : '#586967' }} disabled={slot > (resolved?.atoms.length ?? 0)} onClick={() => arm(slot)} aria-label={`Choose atom ${String.fromCharCode(65 + slot)}`} aria-pressed={Boolean(tool && nextSlot === slot)}>
        <b style={{ color: '#fbbf24' }}>{String.fromCharCode(65 + slot)}</b> {resolved?.atoms[slot]?.label ?? 'Choose atom'}
      </button>)}
    </div>
    <p role="status" style={hint}>{playing ? 'Readouts use paused source frames, not interpolated playback.' : tool ? `Tap atom ${String.fromCharCode(65 + Math.min(nextSlot, requiredMeasurementAtoms(measurement.kind) - 1))} in the scene. Drag to rotate. Tap a slot for exact selection.` : !frame ? 'This source frame is not loaded yet.' : resolved?.status === 'unavailable' ? resolved.message : (resolved?.atoms.length ?? 0) < requiredMeasurementAtoms(measurement.kind) ? 'Choose an empty endpoint to continue measuring.' : 'Tap an endpoint to replace it. Gold line is a ruler, not a bond.'}</p>
    {finding !== null && <div style={{ marginTop: 8 }}>
      <label style={hint}>Exact atom for {String.fromCharCode(65 + finding)}<input aria-label="Find atom" value={query} onChange={e => setQuery(e.target.value)} placeholder="Element, ID or row" style={{ ...button, display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, fontSize: 16 }} /></label>
      <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
        {candidates.map(atom => <button key={atom.index} style={{ ...button, textAlign: 'left' }} disabled={resolved?.atoms.some((a, slot) => a.index === atom.index && slot !== finding)} onClick={() => choose(atom.index)}>{atom.label}{hiddenAtomTypes.has(frame!.types[atom.index]) ? ' · hidden: reveal' : ''}</button>)}
        {!candidates.length && <p style={hint}>No matching atoms.</p>}
      </div><p style={hint}>Showing up to 30 matches. Refine to find a hidden or crowded atom.</p>
    </div>}
    {frame && resolved?.atoms.some(atom => hiddenAtomTypes.has(frame.types[atom.index])) && <p role="status" style={hint}>
      A measured atom is hidden by the element filter. <button style={button} onClick={() => {
        const visibleTypes = new Set(hiddenAtomTypes);
        for (const atom of resolved.atoms) visibleTypes.delete(frame.types[atom.index]);
        useStore.setState({ hiddenAtomTypes: visibleTypes });
      }}>Show measured atoms</button>
    </p>}
    <div style={{ ...row, flexWrap: 'wrap' }}>
      <button style={button} onClick={() => useStore.getState().fitCameraView()}>Fit molecule</button>
      <button style={button} onClick={() => start(measurement.kind === 'distance' ? 'angle' : 'distance')}>{measurement.kind === 'distance' ? 'Angle…' : 'Distance…'}</button>
      {playing && <button style={button} onClick={() => useStore.setState({ playing: false })}>Pause</button>}
      {count > 1 && <button style={button} onClick={() => seek(Math.floor((count - 1) / 2))}>Middle frame</button>}
      {resolved?.status === 'unavailable' && <button style={button} onClick={() => seek(measurement.capturedFrame)}>Capture frame</button>}
    </div>
    {count > 1 && <label style={{ ...hint, display: 'block', marginTop: 8 }}>Frame {frameIndex + 1} / {count}<input aria-label="Measurement frame" type="range" min={0} max={count - 1} value={frameIndex} onChange={e => seek(Number(e.target.value))} style={{ width: '100%', minHeight: 44 }} /></label>}
    {delta !== null && <p style={hint}>Δ {delta >= 0 ? '+' : ''}{delta.toFixed(3)} Å vs capture frame {measurement.capturedFrame + 1} · direct Cartesian, no periodic correction</p>}
    <details style={{ marginTop: 8, fontSize: 12, color: '#b4c6c4' }}><summary style={{ cursor: 'pointer', minHeight: 28 }}>Source & measurement limits</summary>
      <p>{resolved?.coordinateProvenance}</p><p>{resolved?.identityLabel}</p>
      <p>Direct Cartesian separation. Periodic minimum-image and unwrapping are not applied. Not a bond assignment.</p>
      <p>Frame {frameIndex + 1}; source timestep {frame?.timestep ?? 'unknown'}. No physical time conversion.</p>
    </details>
  </section>;
}

const panel: CSSProperties = { padding: 14, background: '#10201f', color: '#f2f8f6', borderRadius: 16, fontFamily: 'var(--font-sans, sans-serif)' };
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const hint: CSSProperties = { color: '#bdceca', fontSize: 12, lineHeight: 1.45, margin: '7px 0' };
const button: CSSProperties = { minHeight: 44, padding: '8px 12px', borderRadius: 10, border: '1px solid #586967', background: '#203330', color: '#f2f8f6', fontSize: 13, cursor: 'pointer' };
const value: CSSProperties = { display: 'block', fontSize: 27, fontWeight: 750, color: '#ffe49a', fontVariantNumeric: 'tabular-nums' };
