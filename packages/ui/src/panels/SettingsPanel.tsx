/**
 * SettingsPanel — persistence-backed viewer settings: per-atom-type visibility
 * and radius for the loaded file, playback speed/loop mode, and the
 * device-persistence preferences (remember toggle + reset to defaults).
 *
 * No props: everything reads/writes the global store. Inline dark-theme styles
 * follow ElementsPanel / MoleculeConfigurator (#0a0d14 surfaces, #1f2937
 * borders, #1edce0 accent).
 */
import { useMemo, type CSSProperties, type JSX } from 'react';
import { ELEMENT_DATA, resolveAtomicNumber, resolveTypeColor, resolveTypeLabel } from '@atlas/core';
import { useStore } from '../store';
import { CompactSelect, CompactSlider, ControlGroup } from '../studio/primitives';

const ACCENT = '#1edce0';
const DANGER = '#f87171';

const LOOP_OPTIONS = [
  { value: 'loop', label: 'Loop — wrap to the first frame' },
  { value: 'bounce', label: 'Bounce — play back and forth' },
  { value: 'once', label: 'Once — stop at the last frame' },
];

/** Log-scale speed slider: the exponent range −4…+4 maps to 0.0625×…16×. */
const SPEED_MIN_EXP = -4;
const SPEED_MAX_EXP = 4;

export function SettingsPanel(): JSX.Element {
  const file = useStore((s) => s.file);
  const frame = useStore((s) => s.frame);
  const hiddenAtomTypes = useStore((s) => s.hiddenAtomTypes);
  const atomTypeScales = useStore((s) => s.atomTypeScales);
  const elementColorOverrides = useStore((s) => s.elementColorOverrides);
  const toggleAtomType = useStore((s) => s.toggleAtomType);
  const showAllAtomTypes = useStore((s) => s.showAllAtomTypes);
  const setAtomTypeScale = useStore((s) => s.setAtomTypeScale);

  const playbackSpeed = useStore((s) => s.playbackSpeed);
  const setPlaybackSpeed = useStore((s) => s.setPlaybackSpeed);
  const loopMode = useStore((s) => s.loopMode);
  const setLoopMode = useStore((s) => s.setLoopMode);

  const persistSettings = useStore((s) => s.persistSettings);
  const setPersistSettings = useStore((s) => s.setPersistSettings);
  const resetSettings = useStore((s) => s.resetSettings);

  // Same enumeration pattern as MoleculeControls: read the resident frame
  // (falling back to frame 0 for streamed trajectories) and collect the raw
  // type ids actually present.
  const residentFrame = useMemo(
    () => file?.trajectory.frames[frame] ?? file?.trajectory.frames[0],
    [file, frame],
  );
  const presentTypes = useMemo(() => {
    const types = residentFrame?.types;
    if (!types || !residentFrame) return [];
    const rawTypes = new Set<number>();
    for (let i = 0; i < residentFrame.natoms; i++) rawTypes.add(types[i]);
    return Array.from(rawTypes)
      .sort((a, b) => a - b)
      .map((rawType) => {
        const z = resolveAtomicNumber(residentFrame, rawType);
        return {
          rawType,
          label: resolveTypeLabel(residentFrame, rawType),
          name: z !== undefined ? ELEMENT_DATA[z]?.name ?? null : null,
          color: elementColorOverrides[rawType] ?? resolveTypeColor(residentFrame, rawType),
        };
      });
  }, [residentFrame, elementColorOverrides]);

  const confirmReset = () => {
    if (typeof window !== 'undefined' && !window.confirm('Reset all viewer settings to their defaults? This cannot be undone.')) return;
    resetSettings();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' }}>
      <ControlGroup title="Atom types" wide>
        {!file ? (
          <div style={emptyHintStyle}>Load a molecule or run to manage its atom types.</div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={showAllAtomTypes}
                disabled={hiddenAtomTypes.size === 0}
                style={ghostBtnStyle(hiddenAtomTypes.size > 0)}
              >
                Show all
              </button>
            </div>
            {presentTypes.map((type) => {
              const visible = !hiddenAtomTypes.has(type.rawType);
              const scale = atomTypeScales[type.rawType] ?? 1;
              return (
                <div key={type.rawType} style={typeRowStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                        background: type.color, boxShadow: `0 0 6px ${type.color}66`,
                        opacity: visible ? 1 : 0.3,
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0, color: visible ? '#e2e8f0' : '#64748b', fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {type.label}
                      {type.name ? <span style={{ color: '#64748b', fontWeight: 500 }}> · {type.name}</span> : null}
                    </span>
                    <ToggleSwitch
                      label={`${type.label} visible`}
                      checked={visible}
                      onChange={() => toggleAtomType(type.rawType)}
                    />
                  </div>
                  <CompactSlider
                    label={`${type.label} radius`}
                    value={scale}
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    onChange={(v) => setAtomTypeScale(type.rawType, v)}
                    format={(v) => `${v.toFixed(2)}×`}
                  />
                </div>
              );
            })}
          </>
        )}
      </ControlGroup>

      <ControlGroup title="Playback" wide>
        <CompactSlider
          label="Speed"
          value={Math.log2(playbackSpeed)}
          min={SPEED_MIN_EXP}
          max={SPEED_MAX_EXP}
          step={0.5}
          onChange={(exp) => setPlaybackSpeed(Math.round(2 ** exp * 10000) / 10000)}
          format={() => `${+playbackSpeed.toFixed(4)}×`}
        />
        <CompactSelect
          label="Loop mode"
          value={loopMode}
          options={LOOP_OPTIONS}
          onChange={(v) => setLoopMode(v as 'loop' | 'bounce' | 'once')}
        />
      </ControlGroup>

      <ControlGroup title="Preferences" wide>
        <div style={prefRowStyle}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', color: '#e2e8f0', fontSize: 12, fontWeight: 700 }}>
              Remember settings on this device
            </span>
            <span style={{ display: 'block', color: '#64748b', fontSize: 10, marginTop: 2 }}>
              Persists the settings covered by shareable URLs to localStorage.
            </span>
          </span>
          <ToggleSwitch
            label="Remember settings on this device"
            checked={persistSettings}
            onChange={() => setPersistSettings(!persistSettings)}
          />
        </div>
        <button type="button" onClick={confirmReset} style={dangerBtnStyle}>
          Reset all settings to defaults
        </button>
      </ControlGroup>
    </div>
  );
}

/** Small accent switch used for the visibility and persistence toggles. */
function ToggleSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      style={{
        position: 'relative', flexShrink: 0,
        width: 30, height: 17, borderRadius: 999, padding: 0, cursor: 'pointer',
        border: `1px solid ${checked ? ACCENT : '#334155'}`,
        background: checked ? 'rgba(30,220,224,0.22)' : '#121826',
        transition: 'background 120ms, border-color 120ms',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute', top: 2, left: checked ? 15 : 2,
          width: 11, height: 11, borderRadius: '50%',
          background: checked ? ACCENT : '#64748b',
          transition: 'left 120ms',
        }}
      />
    </button>
  );
}

const emptyHintStyle: CSSProperties = {
  fontSize: 12, color: '#64748b', fontStyle: 'italic', padding: '4px 2px',
};

const ghostBtnStyle = (enabled: boolean): CSSProperties => ({
  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
  background: 'transparent', cursor: enabled ? 'pointer' : 'default',
  border: `1px solid ${enabled ? '#334155' : '#1f2937'}`,
  color: enabled ? '#94a3b8' : '#475569',
});

const typeRowStyle: CSSProperties = {
  display: 'grid', gap: 6, padding: 8, borderRadius: 8,
  border: '1px solid #1f2937', background: '#0a0d14',
};

const prefRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
  borderRadius: 8, border: '1px solid #1f2937', background: '#0a0d14',
};

const dangerBtnStyle: CSSProperties = {
  alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
  background: 'transparent', border: `1px solid ${DANGER}55`, color: DANGER,
  fontSize: 12, fontWeight: 700,
};
