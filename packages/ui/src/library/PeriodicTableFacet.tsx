import { PERIODIC_TABLE, type PeriodicCell } from '../molecules/periodicTable';

/**
 * 18-column periodic table where each present element shows how many
 * structures in the slice contain it. Clicking AND-filters chemical space.
 */
export function PeriodicTableFacet({
  countByElement,
  maxCount,
  selected,
  onToggle,
}: {
  countByElement: Map<string, number>;
  maxCount: number;
  selected: string[];
  onToggle: (symbol: string) => void;
}) {
  return (
    <div className="periodic" role="group" aria-label="Periodic table element filter">
      {PERIODIC_TABLE.map((cell) => (
        <PeriodicButton
          key={cell.symbol}
          cell={cell}
          count={countByElement.get(cell.symbol) ?? 0}
          maxCount={maxCount}
          active={selected.includes(cell.symbol)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function PeriodicButton({
  cell,
  count,
  maxCount,
  active,
  onToggle,
}: {
  cell: PeriodicCell;
  count: number;
  maxCount: number;
  active: boolean;
  onToggle: (symbol: string) => void;
}) {
  const present = count > 0;
  // Log scale so H, C, and O do not wash out the long tail.
  const heat = present ? 0.15 + 0.6 * (Math.log10(count + 1) / Math.log10(maxCount + 1)) : 0;
  return (
    <button
      type="button"
      className={`periodic-cell${present ? ' is-present' : ''}`}
      style={{ gridColumn: cell.col, gridRow: cell.row, ['--heat' as string]: heat }}
      disabled={!present}
      aria-pressed={active}
      onClick={() => present && onToggle(cell.symbol)}
      title={present ? `${cell.name}: ${count.toLocaleString()} structures` : `${cell.name}: not in this slice`}
    >
      <span>{cell.symbol}</span>
      {present && <small>{count >= 1000 ? `${Math.round(count / 1000)}k` : count}</small>}
    </button>
  );
}
