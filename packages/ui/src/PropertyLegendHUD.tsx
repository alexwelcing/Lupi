/**
 * PropertyLegendHUD — the missing piece that turns property coloring and
 * vector glyphs from "pretty colors" into a readable measurement: a
 * colormap bar with numeric bounds and the quantity's name.
 *
 * Shows up in two situations:
 *   - colorScheme 'property': bounds are the min/max of the selected
 *     per-atom scalar on the current frame
 *   - a vector field is active: bounds are 0 → p95 reference magnitude
 *     (the same normalization the arrows use), labeled with the field
 *
 * DOM overlay (not R3F) — mounted next to the other HUDs.
 */
import { useMemo } from 'react';
import { COLORMAPS } from '@atlas/scene';
import type { ColormapName, Frame } from '@atlas/core/types';
import type { VectorFieldSpec } from '@atlas/core';
import type { VectorGlyphStats } from '@atlas/scene';

interface PropertyLegendHUDProps {
  frame: Frame | undefined;
  colorMode: string;
  colorProperty: string | null;
  colormap: ColormapName;
  activeVectorField: VectorFieldSpec | null;
  vectorStats: VectorGlyphStats | null;
  /** Reserve space above the mobile HUD when set. */
  bottomOffset?: number;
}

// Min/max per (frame, property), cached on the frame object — playback
// re-renders per frame change, and an O(natoms) rescan each time would
// duplicate work at exactly the moment the main thread is busiest. Frames
// are immutable once parsed, so a WeakMap cache is safe and self-evicting.
const rangeCache = new WeakMap<Frame, Map<string, [number, number] | null>>();

function propertyRange(frame: Frame, property: string, data: Float32Array): [number, number] | null {
  let perFrame = rangeCache.get(frame);
  if (!perFrame) {
    perFrame = new Map();
    rangeCache.set(frame, perFrame);
  }
  const cached = perFrame.get(property);
  if (cached !== undefined) return cached;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const range: [number, number] | null = mn === Infinity ? null : [mn, mx];
  perFrame.set(property, range);
  return range;
}

function formatBound(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 10000 || a < 0.01) return v.toExponential(1);
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(3);
}

function colormapGradient(colormap: ColormapName): string {
  const mapFn = COLORMAPS[colormap] ?? COLORMAPS.viridis;
  const stops: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const [r, g, b] = mapFn(t);
    stops.push(`rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${Math.round(t * 100)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function PropertyLegendHUD({
  frame,
  colorMode,
  colorProperty,
  colormap,
  activeVectorField,
  vectorStats,
  bottomOffset = 0,
}: PropertyLegendHUDProps) {
  const scalarEntry = useMemo(() => {
    if (colorMode !== 'property' || !colorProperty || !frame) return null;
    const data = frame.properties?.get(colorProperty);
    if (!data || data.length === 0) return null;
    const range = propertyRange(frame, colorProperty, data);
    if (!range) return null;
    return { label: colorProperty, min: range[0], max: range[1] };
  }, [colorMode, colorProperty, frame]);

  const vectorEntry = useMemo(() => {
    if (!activeVectorField || !vectorStats) return null;
    return {
      label: `${activeVectorField.label} magnitude`,
      min: 0,
      max: vectorStats.refMagnitude,
      overflow: vectorStats.magMax > vectorStats.refMagnitude,
    };
  }, [activeVectorField, vectorStats]);

  if (!scalarEntry && !vectorEntry) return null;

  const gradient = colormapGradient(colormap);
  const rows = [
    scalarEntry && { key: 'scalar', ...scalarEntry, overflow: false },
    vectorEntry && { key: 'vector', ...vectorEntry },
  ].filter(Boolean) as Array<{ key: string; label: string; min: number; max: number; overflow: boolean }>;

  return (
    <div
      data-testid="property-legend"
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12 + bottomOffset,
        zIndex: 8,
        display: 'grid',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 10,
        background: 'rgba(8, 11, 18, 0.78)',
        border: '1px solid rgba(148, 163, 184, 0.18)',
        backdropFilter: 'blur(8px)',
        pointerEvents: 'none',
        maxWidth: 240,
      }}
    >
      {rows.map((row) => (
        <div key={row.key} style={{ display: 'grid', gap: 3 }}>
          <span style={{ color: '#cbd5e1', fontSize: 10, fontWeight: 700, letterSpacing: 0.4, lineHeight: 1 }}>
            {row.label}
          </span>
          <div style={{ height: 8, borderRadius: 4, background: gradient, minWidth: 160 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 9.5, lineHeight: 1 }}>
            <span>{formatBound(row.min)}</span>
            <span>
              {formatBound(row.max)}
              {row.overflow ? '+' : ''}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default PropertyLegendHUD;
