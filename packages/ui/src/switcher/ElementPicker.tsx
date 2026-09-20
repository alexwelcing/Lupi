import { useEffect, useMemo, useState } from 'react';
import { ElementChips } from './ElementChips';
import { switchElementCounts, type ElementCount } from './switchIndex';

/** Element chips for the switcher, counted over everything switchable. */
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
  const chips = useMemo(
    () => counts.filter((entry) => entry.gallery + entry.omol > 0).map((entry) => ({ symbol: entry.symbol, count: entry.gallery, secondary: entry.omol })),
    [counts],
  );
  return <ElementChips counts={chips} selected={selected} onToggle={onToggle} secondaryLabel="OMol25" ariaLabel="Elements" />;
}
