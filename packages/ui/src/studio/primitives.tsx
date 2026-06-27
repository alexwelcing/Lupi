/**
 * Studio control primitives — the reusable, store-agnostic building blocks of
 * the control deck (groups, segmented buttons, sliders, the rotary knob, color
 * pickers). Extracted out of StudioControlDeck so the deck reads as composition
 * and these pieces can be reused.
 *
 * CSS coupling: a few of these reference global classes that the StudioControlDeck
 * <style> block injects — `lupi-rive-snap` / `lupi-rive-flash` (SegmentButton
 * pulse), `lupi-rive-dial` (RiveKnob focus ring), `lupi-native-color` (the color
 * inputs). Those classes are global once the deck mounts, and these primitives
 * only ever render inside the deck, so the styling resolves without duplicating
 * the CSS here.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { usePressSpring } from '../hooks/usePressSpring';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
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
        gap: 7,
        alignContent: 'start',
        minWidth: 0,
        padding: 8,
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        background: 'linear-gradient(180deg, rgba(15,23,42,0.48), rgba(2,6,23,0.22))',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 22px rgba(0,0,0,0.16)',
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
          accentColor: '#1edce0',
          background: `linear-gradient(90deg, #1edce0 0%, #1edce0 ${percent * 100}%, rgba(71,85,105,0.7) ${percent * 100}%, rgba(71,85,105,0.7) 100%)`,
        }}
      />
    </label>
  );
}

export function RiveKnob({
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
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ y: 0, value });
  const percent = clamp((value - min) / (max - min), 0, 1);
  const angle = -135 + percent * 270;
  const accent = dragging ? '#f59e0b' : '#1edce0';

  const setValue = (nextValue: number) => {
    onChange(clamp(snap(nextValue, step), min, max));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = { y: event.clientY, value };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dy = dragRef.current.y - event.clientY;
    setValue(dragRef.current.value + (dy / 118) * (max - min));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setValue(value + step);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setValue(value - step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setValue(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      setValue(max);
    }
  };

  return (
    <div style={{
      minHeight: 66,
      display: 'grid',
      gridTemplateColumns: '50px minmax(0, 1fr)',
      alignItems: 'center',
      gap: 8,
      minWidth: 0,
      padding: '7px 8px',
      borderRadius: 8,
      border: dragging ? '1px solid rgba(245,158,11,0.62)' : '1px solid rgba(148,163,184,0.2)',
      background: dragging
        ? 'linear-gradient(180deg, rgba(245,158,11,0.12), rgba(9,14,22,0.72))'
        : 'linear-gradient(180deg, rgba(15,23,42,0.58), rgba(9,14,22,0.48))',
      boxShadow: dragging
        ? '0 0 20px rgba(245,158,11,0.18), inset 0 1px 0 rgba(255,255,255,0.06)'
        : 'inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 0 rgba(0,0,0,0.2)',
    }}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        className="lupi-rive-dial"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        style={{
          width: 46,
          height: 46,
          borderRadius: '50%',
          position: 'relative',
          cursor: 'ns-resize',
          outline: 'none',
          touchAction: 'none',
          background: `conic-gradient(from 225deg, ${accent} 0deg, ${accent} ${percent * 270}deg, #1f2937 ${percent * 270}deg, #1f2937 270deg, transparent 270deg)`,
          boxShadow: dragging ? `0 0 18px ${accent}52` : '0 6px 18px rgba(0,0,0,0.34)',
        }}
      >
        <div style={{
          position: 'absolute',
          inset: 4,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #334155, #0f172a 72%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 1px 4px rgba(255,255,255,0.08)',
        }} />
        <div style={{
          position: 'absolute',
          inset: 4,
          borderRadius: '50%',
          transform: `rotate(${angle}deg)`,
          transition: dragging ? 'none' : 'transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}>
          <div style={{
            position: 'absolute',
            top: 2,
            left: '50%',
            width: 3,
            height: 9,
            transform: 'translateX(-50%)',
            borderRadius: 3,
            background: accent,
            boxShadow: `0 0 10px ${accent}78`,
          }} />
        </div>
      </div>
      <div style={{ minWidth: 0, display: 'grid', gap: 5 }}>
        <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 820, textTransform: 'uppercase', lineHeight: 1 }}>{label}</span>
        <span style={{ color: '#e2e8f0', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 820, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {format(value)}
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={`${label} fine control`}
          onChange={(event) => setValue(Number(event.currentTarget.value))}
          style={{
            width: '100%',
            height: 4,
            accentColor: accent,
          }}
        />
      </div>
    </div>
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
  atomicNumber,
  value,
  options,
  overridden,
  onSelect,
  onChange,
  onReset,
}: {
  active?: boolean;
  atomicNumber: number;
  value: string;
  options: Array<{ value: number; label: string }>;
  overridden?: boolean;
  onSelect: (atomicNumber: number) => void;
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
        title={`Atomic number ${atomicNumber}`}
        aria-label={`Atomic number ${atomicNumber} color`}
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
        <span style={compactFieldLabelStyle}>Element</span>
        <select
          value={atomicNumber}
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
