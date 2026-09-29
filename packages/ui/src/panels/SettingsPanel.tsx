/**
 * SettingsPanel — persistence-backed viewer settings. First the device's
 * Sound, Haptics and Motion (the Play tray's "Settings…" leads here for
 * these, so they sit at the top, visible without scrolling), then per-atom-type
 * visibility and radius for the loaded file, playback speed/loop mode, and the
 * remember toggle with the reset to defaults.
 *
 * No props. The atom-type, playback and remember settings read/write the
 * global store. Sound (lib/clickSound.ts), Haptics (lib/haptics.ts) and Motion
 * (motion/comfort.ts) are per-device module state: they never enter
 * buildStateDelta, URLs or saved views, and resetSettings leaves them alone.
 * Sound and Haptics are off until the visitor turns them on here.
 *
 * Inline dark-theme styles follow ElementsPanel / MoleculeConfigurator
 * (#0a0d14 surfaces, #1f2937 borders) with the lime accent.
 */
import { useMemo, useRef, useSyncExternalStore, type CSSProperties, type JSX, type KeyboardEvent } from 'react';
import { ELEMENT_DATA, resolveAtomicNumber, resolveTypeColor, resolveTypeLabel } from '@atlas/core';
import { useStore } from '../store';
import { CompactSelect, CompactSlider, ControlGroup } from '../studio/primitives';
import { isClickSoundEnabled, playClick, setClickSoundEnabled, subscribeClickSound } from '../lib/clickSound';
import { isHapticsEnabled, isHapticsSupported, setHapticsEnabled, subscribeHaptics, tick } from '../lib/haptics';
import { setComfort, useComfort, type Comfort } from '../motion/comfort';

const ACCENT = '#d5ef9c';
const ACCENT_SOFT = 'rgba(213,239,156,0.2)';
const DANGER = '#f87171';

const MOTION_OPTIONS: ReadonlyArray<{ value: Comfort; label: string; detail: string }> = [
  { value: 'standard', label: 'Standard', detail: 'Flicks coast and click onto faces; molecules condense as they arrive; taps ripple.' },
  { value: 'gentle', label: 'Gentle', detail: 'No coasting. Arrivals and ripples at half strength; view changes still glide.' },
  { value: 'still', label: 'Still', detail: 'Nothing moves on its own. View changes cut instead of gliding.' },
];

const neverSubscribe = () => () => {};
const readFalse = () => false;

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

  const soundOn = useSyncExternalStore(subscribeClickSound, isClickSoundEnabled, readFalse);
  const hapticsOn = useSyncExternalStore(subscribeHaptics, isHapticsEnabled, readFalse);
  const hapticsSupported = useSyncExternalStore(neverSubscribe, isHapticsSupported, readFalse);
  const comfort = useComfort();
  const motionDetail = MOTION_OPTIONS.find((option) => option.value === comfort)?.detail ?? '';

  // Turning a channel on answers at once, so the visitor knows what they chose.
  const toggleSound = () => {
    const next = !isClickSoundEnabled();
    setClickSoundEnabled(next);
    if (next) playClick();
  };
  const toggleHaptics = () => {
    const next = !isHapticsEnabled();
    setHapticsEnabled(next);
    if (next) tick(8);
  };

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
      <ControlGroup title="Sound and motion" wide>
        <div style={prefRowStyle}>
          <PrefText title="Sound" detail="Soft clicks when a view snaps onto a face, an atom ripples, or a button is pressed." />
          <ToggleSwitch label="Sound" checked={soundOn} onChange={toggleSound} />
        </div>
        <div style={prefRowStyle}>
          <PrefText
            title="Haptics"
            detail={hapticsSupported ? 'A light tap when a view snaps onto a face, is caught, or flips.' : 'Not supported on this device'}
          />
          <ToggleSwitch
            label="Haptics"
            checked={hapticsOn && hapticsSupported}
            disabled={!hapticsSupported}
            onChange={toggleHaptics}
          />
        </div>
        <div style={{ ...prefRowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <PrefText title="Motion" detail={motionDetail} />
          <MotionRadios value={comfort} onChange={setComfort} />
        </div>
      </ControlGroup>

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
          <PrefText
            title="Remember settings on this device"
            detail="Persists the settings covered by shareable URLs to localStorage."
          />
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

function PrefText({ title, detail }: { title: string; detail: string }) {
  return (
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: 'block', color: '#e2e8f0', fontSize: 12, fontWeight: 700 }}>{title}</span>
      {detail ? <span style={{ display: 'block', color: '#64748b', fontSize: 10, marginTop: 2 }}>{detail}</span> : null}
    </span>
  );
}

/**
 * Small accent switch used for the visibility, preference and persistence
 * toggles. The track is 30x17; the transparent button around it is a 44x32
 * hit area, so a thumb finds it on a phone.
 */
function ToggleSwitch({
  label, checked, disabled = false, onChange,
}: { label: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      style={{
        position: 'relative', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 44, height: 32, margin: '-7px -7px', padding: 0,
        border: 0, background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        touchAction: 'manipulation',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'relative', display: 'block',
          width: 30, height: 17, borderRadius: 999, boxSizing: 'border-box',
          border: `1px solid ${checked ? ACCENT : '#334155'}`,
          background: checked ? ACCENT_SOFT : '#121826',
          transition: 'background 120ms, border-color 120ms',
        }}
      >
        <span
          style={{
            position: 'absolute', top: 2, left: checked ? 15 : 2,
            width: 11, height: 11, borderRadius: '50%',
            background: checked ? ACCENT : '#64748b',
            transition: 'left 120ms',
          }}
        />
      </span>
    </button>
  );
}

/**
 * Motion: Standard / Gentle / Still as one radio group (APG pattern: one tab
 * stop, the arrow keys move and select). Writes comfort.ts only.
 */
function MotionRadios({ value, onChange }: { value: Comfort; onChange: (next: Comfort) => void }) {
  const groupRef = useRef<HTMLDivElement | null>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = MOTION_OPTIONS.findIndex((option) => option.value === value);
    const next = MOTION_OPTIONS[(index + step + MOTION_OPTIONS.length) % MOTION_OPTIONS.length];
    onChange(next.value);
    groupRef.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div ref={groupRef} role="radiogroup" aria-label="Motion" onKeyDown={onKeyDown} style={motionGroupStyle}>
      {MOTION_OPTIONS.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={option.value}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            style={motionOptionStyle(checked)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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

const motionGroupStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4,
  padding: 3, borderRadius: 8, border: '1px solid #1f2937', background: '#070a10',
};

const motionOptionStyle = (checked: boolean): CSSProperties => ({
  minHeight: 36, padding: '0 8px', borderRadius: 6, cursor: 'pointer',
  border: `1px solid ${checked ? ACCENT : 'transparent'}`,
  background: checked ? ACCENT_SOFT : 'transparent',
  color: checked ? '#f4f8ea' : '#94a3b8',
  fontSize: 12, fontWeight: 700, touchAction: 'manipulation',
  transition: 'background 120ms, border-color 120ms, color 120ms',
});

const dangerBtnStyle: CSSProperties = {
  alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
  background: 'transparent', border: `1px solid ${DANGER}55`, color: DANGER,
  fontSize: 12, fontWeight: 700,
};
