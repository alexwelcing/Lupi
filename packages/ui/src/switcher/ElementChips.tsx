import { useState } from 'react';
import { getElementSpecBySymbol } from '@atlas/core';
import './elementChips.css';

/**
 * Element filter as chips, ordered by how many structures contain each
 * element. The common ones are always visible; the long tail sits behind
 * one "more" toggle. This replaced a periodic-table grid that never fit the
 * places it was inserted: a grid needs 18 columns of touch targets, a chip
 * row needs none.
 */
export interface ElementChipCount {
  symbol: string;
  count: number;
  /** Secondary count shown in the tooltip, e.g. OMol25 rows. */
  secondary?: number;
}

const QUICK_COUNT = 12;

function compact(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
}

export function elementLabel(symbol: string): string {
  return `${getElementSpecBySymbol(symbol)?.name ?? symbol} (${symbol})`;
}

export function ElementChips({
  counts,
  selected,
  onToggle,
  quick = QUICK_COUNT,
  secondaryLabel,
  ariaLabel = 'Elements',
}: {
  counts: ElementChipCount[];
  selected: string[];
  onToggle: (symbol: string) => void;
  quick?: number;
  secondaryLabel?: string;
  ariaLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  // Hydrogen is in nearly everything and rarely what anyone filters by.
  const ordered = [...counts.filter((entry) => entry.symbol !== 'H'), ...counts.filter((entry) => entry.symbol === 'H')];
  const visible = expanded ? ordered : ordered.slice(0, quick);
  const hidden = ordered.length - visible.length;
  return (
    <div className="element-chips" role="group" aria-label={ariaLabel}>
      {visible.map((entry) => (
        <button
          key={entry.symbol}
          type="button"
          className="element-chip"
          aria-pressed={selected.includes(entry.symbol)}
          aria-label={elementLabel(entry.symbol)}
          title={[`${entry.count} ${entry.count === 1 ? 'structure' : 'structures'}`, entry.secondary && secondaryLabel ? `${compact(entry.secondary)} ${secondaryLabel}` : null].filter(Boolean).join(' · ')}
          onClick={() => onToggle(entry.symbol)}
        >
          <b>{entry.symbol}</b>
          <small>{compact(entry.count)}</small>
        </button>
      ))}
      {(hidden > 0 || expanded) && ordered.length > quick && (
        <button type="button" className="element-chip element-chip--more" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Fewer elements' : `${hidden} more`}
        </button>
      )}
    </div>
  );
}
