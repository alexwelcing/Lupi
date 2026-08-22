/**
 * PeriodicTableGrid — the standard 18-column periodic table rendered from the
 * canonical PERIODIC_LAYOUT in @atlas/core. Dependency-light by design: only
 * React + @atlas/core so panels, configurators, and tests can all mount it.
 *
 * Styling approach: category-tinted border/background per cell, selected state
 * in the app accent. Element text stays on the neutral foreground palette so
 * even the lightest category tints remain readable on the dark theme.
 */
import { ELEMENT_DATA, PERIODIC_LAYOUT, type ElementCategory } from '@atlas/core';
import { humanizeCategory } from './ElementDetailCard';

const ACCENT = '#1edce0';

/** One tint per category — used for cell borders, cell background wash, and
 *  legend dots. 6-digit hex so alpha suffixes (`${tint}55`) stay valid. */
export const CATEGORY_COLORS: Record<ElementCategory, string> = {
  'alkali-metal': '#c084fc',
  'alkaline-earth': '#a3e635',
  'transition-metal': '#fb923c',
  'post-transition-metal': '#94a3b8',
  'metalloid': '#2dd4bf',
  'nonmetal': '#38bdf8',
  'halogen': '#4ade80',
  'noble-gas': '#67e8f9',
  'lanthanide': '#f0abfc',
  'actinide': '#e879f9',
  'unknown': '#64748b',
};

/** Canonical legend order: follows the ElementCategory union order. */
const CATEGORY_ORDER = Object.keys(CATEGORY_COLORS) as ElementCategory[];

const PLACEHOLDER_LABELS: Record<'lanthanides' | 'actinides', string> = {
  lanthanides: '57–71',
  actinides: '89–103',
};

export interface PeriodicTableGridProps {
  /** Selected atomic numbers. */
  selected: number[];
  /** Toggle callback for an element cell. */
  onToggle: (z: number) => void;
  /** When this many cells are selected, unselected cells render disabled. */
  maxSelection?: number;
  /** Dims (and disables) cells whose symbol/name do not match, case-insensitive. */
  filterText?: string;
  /** Show the category legend row under the grid. Default true. */
  showLegend?: boolean;
  /** Cell edge in px. Default 34. */
  cellSize?: number;
}

export function PeriodicTableGrid({
  selected,
  onToggle,
  maxSelection,
  filterText,
  showLegend = true,
  cellSize = 34,
}: PeriodicTableGridProps) {
  const query = filterText?.trim().toLowerCase() ?? '';
  const atMax = maxSelection !== undefined && selected.length >= maxSelection;

  const presentCategories = CATEGORY_ORDER.filter((category) =>
    PERIODIC_LAYOUT.some((cell) => cell.z !== null && ELEMENT_DATA[cell.z]?.category === category),
  );

  return (
    <div>
      <div
        role="group"
        aria-label="Periodic table"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(18, 1fr)',
          // Implicit rows (8 is the visual gap before the f-block) keep full
          // cell height so the main table and f-block stay aligned.
          gridAutoRows: `${cellSize}px`,
          gap: 2,
          minWidth: 18 * (cellSize + 2),
        }}
      >
        {PERIODIC_LAYOUT.map((cell) => {
          if (cell.z === null) {
            return (
              <div
                key={`placeholder-${cell.placeholder}`}
                aria-hidden="true"
                style={{
                  gridColumn: cell.col,
                  gridRow: cell.row,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px dashed #1f2937',
                  borderRadius: 4,
                  color: '#64748b',
                  fontSize: Math.max(7, cellSize * 0.22),
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  userSelect: 'none',
                }}
              >
                {cell.placeholder ? PLACEHOLDER_LABELS[cell.placeholder] : ''}
              </div>
            );
          }

          const z = cell.z;
          const element = ELEMENT_DATA[z];
          if (!element) return null;

          const isSelected = selected.includes(z);
          const matches =
            !query ||
            element.symbol.toLowerCase().includes(query) ||
            element.name.toLowerCase().includes(query);
          const disabled = (atMax && !isSelected) || !matches;
          const tint = CATEGORY_COLORS[element.category];

          return (
            <button
              key={z}
              type="button"
              aria-label={`${element.name}, atomic number ${z}`}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onToggle(z)}
              style={{
                gridColumn: cell.col,
                gridRow: cell.row,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                borderRadius: 4,
                border: `1px solid ${isSelected ? ACCENT : `${tint}55`}`,
                background: isSelected ? 'rgba(30, 220, 224, 0.16)' : `${tint}14`,
                color: isSelected ? ACCENT : '#e2e8f0',
                opacity: matches ? 1 : 0.22,
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                transition: 'border-color 120ms, background 120ms, opacity 120ms',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 1,
                  left: 3,
                  fontSize: Math.max(7, cellSize * 0.22),
                  lineHeight: 1.2,
                  color: isSelected ? ACCENT : '#94a3b8',
                }}
              >
                {z}
              </span>
              <span style={{ fontSize: cellSize * 0.38, fontWeight: 700, lineHeight: 1 }}>
                {element.symbol}
              </span>
            </button>
          );
        })}
      </div>

      {showLegend && (
        <div
          aria-label="Category legend"
          style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: 10 }}
        >
          {presentCategories.map((category) => (
            <span
              key={category}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#94a3b8' }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: CATEGORY_COLORS[category],
                  flexShrink: 0,
                }}
              />
              {humanizeCategory(category)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
