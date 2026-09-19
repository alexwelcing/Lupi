import { useEffect, useMemo, useState } from 'react';
import { getAtomicNumberBySymbol } from '@atlas/core';
import { PERIODIC_TABLE } from '../molecules/periodicTable';
import { switchElementCounts, type ElementCount } from './switchIndex';

/**
 * Two ways to pick elements, both driven by what is actually switchable:
 * big chips for the elements most structures contain (the ones people tap),
 * and a compact heat-lit periodic table that fits the panel width for
 * everything else. Elements no structure contains are shown but disabled.
 */
const QUICK_COUNT = 14;

function compact(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

export function ElementPicker({ selected, onToggle }: { selected: string[]; onToggle: (symbol: string) => void }) {
  const [counts, setCounts] = useState<ElementCount[]>([]);
  useEffect(() => {
    let alive = true;
    switchElementCounts().then((result) => {
      if (alive) setCounts(result);
    });
    return () => {
      alive = false;
    };
  }, []);

  const bySymbol = useMemo(() => new Map(counts.map((entry) => [entry.symbol, entry])), [counts]);
  const quick = useMemo(() => {
    const present = counts.filter((entry) => entry.gallery > 0);
    return [...present.filter((entry) => entry.symbol !== 'H'), ...present.filter((entry) => entry.symbol === 'H')].slice(0, QUICK_COUNT);
  }, [counts]);
  const maxTotal = counts.reduce((max, entry) => Math.max(max, entry.gallery + entry.omol), 1);

  return (
    <div className="switcher-elements">
      <div className="switcher-chip-row" role="group" aria-label="Common elements">
        {quick.map((entry) => {
          const cell = PERIODIC_TABLE.find((item) => item.symbol === entry.symbol);
          return (
            <button
              key={entry.symbol}
              type="button"
              className="switcher-element-chip"
              aria-pressed={selected.includes(entry.symbol)}
              aria-label={`${cell?.name ?? entry.symbol} (${entry.symbol})`}
              title={`${entry.gallery} gallery · ${compact(entry.omol)} OMol25`}
              onClick={() => onToggle(entry.symbol)}
            >
              <b>{entry.symbol}</b>
              <small>{entry.gallery}</small>
            </button>
          );
        })}
      </div>
      <div className="switcher-periodic" role="group" aria-label="Periodic table element filter">
        {PERIODIC_TABLE.map((cell) => {
          const entry = bySymbol.get(cell.symbol);
          const total = (entry?.gallery ?? 0) + (entry?.omol ?? 0);
          const present = total > 0;
          const heat = present ? 0.15 + 0.6 * (Math.log10(total + 1) / Math.log10(maxTotal + 1)) : 0;
          const z = getAtomicNumberBySymbol(cell.symbol);
          return (
            <button
              key={cell.symbol}
              type="button"
              className={`switcher-cell${present ? ' is-present' : ''}`}
              style={{ gridColumn: cell.col, gridRow: cell.row, ['--heat' as string]: heat }}
              disabled={!present}
              aria-pressed={selected.includes(cell.symbol)}
              aria-label={`${cell.name}, atomic number ${z ?? '?'}`}
              title={present ? `${cell.name}: ${entry?.gallery ?? 0} gallery, ${compact(entry?.omol ?? 0)} OMol25` : `${cell.name}: no switchable structure`}
              onClick={() => present && onToggle(cell.symbol)}
            >
              {cell.symbol}
            </button>
          );
        })}
      </div>
    </div>
  );
}
