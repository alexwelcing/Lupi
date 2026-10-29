/**
 * Studio control primitives — the reusable, store-agnostic building blocks of
 * the control deck (groups, segmented buttons, sliders, color pickers).
 * Extracted out of StudioControlDeck so the deck reads as composition and
 * these pieces can be reused.
 *
 * CSS coupling: a few of these reference global classes that the StudioControlDeck
 * <style> block injects — `lupi-rive-snap` / `lupi-rive-flash` (SegmentButton
 * pulse), `lupi-native-color` (the color inputs). Those classes are global once
 * the deck mounts, and these primitives only ever render inside the deck, so
 * the styling resolves without duplicating the CSS here.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { usePressSpring } from '../hooks/usePressSpring';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Progressive disclosure — the easy path stays visible; finicky controls live
// behind one tap. Spans the full deck width so its contents stack cleanly.
export function AdvancedSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section style={{ gridColumn: '1 / -1', display: 'grid', gap: open ? 8 : 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 38,
          padding: '0 12px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(2,6,23,0.3)',
          color: '#94a3b8',
          fontSize: 10,
          fontWeight: 820,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          cursor: 'pointer',
          touchAction: 'manipulation',
        }}
      >
        <span>{title}</span>
        <span aria-hidden="true" style={{ transition: 'transform 140ms ease-out', transform: open ? 'rotate(90deg)' : 'none', fontSize: 12, lineHeight: 1 }}>▸</span>
      </button>
      {open && <div style={{ display: 'grid', gap: 8 }}>{children}</div>}
    </section>
  );
}

export function ControlGroup({ title, note, children, wide = false }: { title: string; note?: string; children: ReactNode; wide?: boolean }) {
  return (
    <section
      title={note}
      style={{
        gridColumn: wide ? '1 / -1' : undefined,
        display: 'grid',
        gap: 8,
        alignContent: 'start',
        minWidth: 0,
        padding: '11px 7px 12px',
        border: 0,
        borderTop: '1px solid #1d2934',
        borderRadius: 0,
        background: 'transparent',
        boxShadow: 'none',
      }}
    >
      <div style={{ display: 'grid', gap: 2 }}>
        <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 820, textTransform: 'uppercase', letterSpacing: 0, lineHeight: 1 }}>
          {title}
        </div>
      </div>
      {children}
    </section>
  );
}

export function SegmentButton({
  active,
  label,
  meta,
  onClick,
  accent = '#1edce0',
}: {
  active?: boolean;
  label: string;
  meta?: string;
  onClick: () => void;
  accent?: string;
}) {
  const [pulse, setPulse] = useState(false);
  const timerRef = useRef<number | null>(null);
  const press = usePressSpring({ pressedScale: 0.96, sound: false });

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const handleClick = () => {
    setPulse(false);
    window.requestAnimationFrame(() => setPulse(true));
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setPulse(false), 260);
    onClick();
  };

  return (
    <button
      {...press}
      type="button"
      onClick={handleClick}
      title={label}
      aria-label={meta ? `${label} ${meta}` : label}
      aria-pressed={active}
      className={pulse ? 'lupi-rive-snap' : undefined}
      style={{
        position: 'relative',
        minWidth: 0,
        width: '100%',
        minHeight: 34,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 7,
        padding: '7px 8px',
        overflow: 'hidden',
        borderRadius: 7,
        border: active ? `1px solid ${accent}` : '1px solid rgba(148,163,184,0.18)',
        background: active
          ? `linear-gradient(135deg, ${accent}33, rgba(9,14,22,0.9))`
          : 'linear-gradient(135deg, rgba(15,23,42,0.74), rgba(3,7,18,0.62))',
        color: active ? '#f8fafc' : '#cbd5e1',
        boxShadow: active
          ? `0 0 16px ${accent}24, inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 14px ${accent}12`
          : 'inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 0 rgba(0,0,0,0.18)',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 780,
        lineHeight: 1.12,
        whiteSpace: 'normal',
        letterSpacing: 0,
        touchAction: 'manipulation',
      }}
    >
      {pulse && <span className="lupi-rive-flash" style={{ position: 'absolute', inset: 0, background: accent, mixBlendMode: 'screen', pointerEvents: 'none' }} />}
      <span style={{ minWidth: 0, overflow: 'visible', textOverflow: 'clip', whiteSpace: 'normal', position: 'relative' }}>
        {label}
      </span>
      {meta && (
        <span style={{
          position: 'relative',
          flexShrink: 0,
          color: active ? accent : '#64748b',
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 820,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {meta}
        </span>
      )}
    </button>
  );
}

/** The house lime (#d5ef9c): the slider's filled track and its thumb. */
const SLIDER_ACCENT = '#d5ef9c';

export function CompactSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = value => value.toFixed(2),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const percent = clamp((value - min) / (max - min), 0, 1);
  return (
    <label style={{
      display: 'grid',
      gap: 5,
      minWidth: 0,
      padding: '7px 8px',
      borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.10)',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.024) 100%)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.2)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
        <span style={{ minWidth: 0, color: '#94a3b8', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ flexShrink: 0, color: '#e2e8f0', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{
          width: '100%',
          height: 4,
          accentColor: SLIDER_ACCENT,
          background: `linear-gradient(90deg, ${SLIDER_ACCENT} 0%, ${SLIDER_ACCENT} ${percent * 100}%, rgba(71,85,105,0.7) ${percent * 100}%, rgba(71,85,105,0.7) 100%)`,
          // The global range thumb reads these (pseudo-elements inherit them).
          ['--accent' as string]: SLIDER_ACCENT,
          ['--accent-soft' as string]: 'rgba(213, 239, 156, 0.24)',
        }}
      />
    </label>
  );
}

export function CompactSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label style={compactFieldStyle}>
      <span style={compactFieldLabelStyle}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        style={compactSelectStyle}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function ColorPicker({
  active,
  label,
  value,
  onChange,
}: {
  active?: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{
      display: 'grid',
      gridTemplateColumns: '44px minmax(0, 1fr)',
      gap: 8,
      alignItems: 'center',
      minWidth: 0,
      padding: 6,
      borderRadius: 8,
      border: active ? '1px solid #1edce0' : '1px solid rgba(148,163,184,0.2)',
      background: active
        ? 'linear-gradient(135deg, rgba(30,220,224,0.16), rgba(9,14,22,0.72))'
        : 'linear-gradient(180deg, rgba(15,23,42,0.56), rgba(9,14,22,0.48))',
      boxShadow: active ? '0 0 16px rgba(30,220,224,0.18)' : 'inset 0 1px 0 rgba(255,255,255,0.04)',
    }}>
      <input
        className="lupi-native-color"
        type="color"
        value={value}
        title={label}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.value)}
        style={{
          width: 40,
          height: 28,
          padding: 0,
          border: '1px solid rgba(255,255,255,0.22)',
          borderRadius: 6,
          background: 'transparent',
          cursor: 'pointer',
        }}
      />
      <span style={{ minWidth: 0, display: 'grid', gap: 2 }}>
        <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', lineHeight: 1 }}>{label}</span>
        <span style={{ color: active ? '#f8fafc' : '#cbd5e1', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 800, lineHeight: 1 }}>{value.toUpperCase()}</span>
      </span>
    </label>
  );
}

export function ElementColorPicker({
  active,
  rawType,
  value,
  options,
  overridden,
  onSelect,
  onChange,
  onReset,
}: {
  active?: boolean;
  rawType: number;
  value: string;
  options: Array<{ value: number; label: string }>;
  overridden?: boolean;
  onSelect: (rawType: number) => void;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '36px minmax(0, 1fr) 42px',
      gap: 7,
      alignItems: 'center',
      minWidth: 0,
      padding: 6,
      borderRadius: 8,
      border: active ? '1px solid #facc15' : '1px solid rgba(148,163,184,0.2)',
      background: active
        ? 'linear-gradient(135deg, rgba(250,204,21,0.16), rgba(9,14,22,0.72))'
        : 'linear-gradient(180deg, rgba(15,23,42,0.56), rgba(9,14,22,0.48))',
      boxShadow: active ? '0 0 16px rgba(250,204,21,0.16)' : 'inset 0 1px 0 rgba(255,255,255,0.04)',
    }}>
      <input
        className="lupi-native-color"
        type="color"
        value={value}
        title={`Source atom type ${rawType}`}
        aria-label={`Source atom type ${rawType} color`}
        onChange={(event) => onChange(event.currentTarget.value)}
        style={{
          width: 30,
          height: 28,
          padding: 0,
          border: '1px solid rgba(255,255,255,0.22)',
          borderRadius: 6,
          background: 'transparent',
          cursor: 'pointer',
        }}
      />
      <label style={{ display: 'grid', gap: 2, minWidth: 0 }}>
        <span style={compactFieldLabelStyle}>Atom type</span>
        <select
          value={rawType}
          onChange={(event) => onSelect(Number(event.currentTarget.value))}
          style={{ ...compactSelectStyle, height: 20, padding: '0 4px' }}
        >
          {options.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        title="Reset element color"
        onClick={onReset}
        disabled={!overridden}
        style={{
          height: 28,
          minWidth: 0,
          borderRadius: 5,
          border: overridden ? '1px solid rgba(250,204,21,0.56)' : '1px solid rgba(148,163,184,0.16)',
          background: overridden ? 'rgba(250,204,21,0.14)' : 'rgba(15,23,42,0.6)',
          color: overridden ? '#f8fafc' : '#64748b',
          cursor: overridden ? 'pointer' : 'default',
          fontSize: 10,
          fontWeight: 780,
          letterSpacing: 0,
        }}
      >
        Base
      </button>
    </div>
  );
}

/**
 * Appearance-scene card — the visual identity a MaterialScene authors
 * (cardGradient background, short code, accent glow when active). Sized for a
 * rail of 8-10 scenes without scrolling the deck.
 */
export function SceneCard({
  active,
  label,
  code,
  description,
  gradient,
  accent,
  testId,
  onClick,
}: {
  active?: boolean;
  label: string;
  code: string;
  description: string;
  gradient: string;
  accent: string;
  testId?: string;
  onClick: () => void;
}) {
  const press = usePressSpring({ pressedScale: 0.95, sound: false });
  return (
    <button
      {...press}
      type="button"
      aria-label={`${label} appearance`}
      aria-pressed={active}
      title={description}
      data-testid={testId}
      onClick={onClick}
      style={{
        display: 'grid',
        gap: 3,
        alignContent: 'end',
        justifyItems: 'start',
        minWidth: 0,
        height: 52,
        padding: '6px 8px',
        borderRadius: 8,
        border: active ? `1px solid ${accent}` : '1px solid rgba(148,163,184,0.22)',
        background: gradient,
        boxShadow: active
          ? `0 0 12px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.14)`
          : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.28)',
        cursor: 'pointer',
        touchAction: 'manipulation',
      }}
    >
      <span aria-hidden="true" style={{ color: active ? accent : 'rgba(226,232,240,0.55)', fontSize: 8, fontWeight: 900, fontFamily: 'var(--font-mono)', letterSpacing: 0.6, lineHeight: 1 }}>
        {code}
      </span>
      <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#f1f5f9', fontSize: 11, fontWeight: 780, lineHeight: 1.1 }}>
        {label}
      </span>
    </button>
  );
}

export function SwatchButton({
  active,
  label,
  background,
  onClick,
}: {
  active?: boolean;
  label: string;
  background: string;
  onClick: () => void;
}) {
  const press = usePressSpring({ pressedScale: 0.92, sound: false });
  return (
    <button
      {...press}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        height: 25,
        flex: '1 1 24px',
        minWidth: 24,
        borderRadius: 6,
        border: active ? '1px solid #f8fafc' : '1px solid rgba(148,163,184,0.22)',
        background,
        boxShadow: active
          ? '0 0 14px rgba(248,250,252,0.32), inset 0 1px 0 rgba(255,255,255,0.16)'
          : 'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 0 rgba(0,0,0,0.22)',
        cursor: 'pointer',
      }}
    />
  );
}

const compactFieldStyle: CSSProperties = {
  display: 'grid',
  gap: 5,
  minWidth: 0,
  padding: '7px 8px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.024) 100%)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.2)',
};

const compactFieldLabelStyle: CSSProperties = {
  color: '#94a3b8',
  fontSize: 10,
  fontWeight: 800,
  textTransform: 'uppercase',
  lineHeight: 1,
};

const compactSelectStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  height: 30,
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
  color: '#f8fafc',
  fontSize: 11,
  fontWeight: 650,
  padding: '0 8px',
  outline: 'none',
  cursor: 'pointer',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 0 rgba(0,0,0,0.2)',
};

export const paletteRailStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  minWidth: 0,
};

export const schemeHintStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(203,213,225,0.62)',
  fontSize: 10,
  lineHeight: 1.35,
  fontWeight: 600,
};
