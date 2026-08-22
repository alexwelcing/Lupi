/**
 * ElementsPanel — the Elements explorer. Search-filtered periodic table in
 * single-select mode, a detail card for the selection, and a hand-off button
 * that seeds the run configurator (store state only; the modal that consumes
 * `runConfiguratorSeed` lands in a later phase).
 */
import { useState, type CSSProperties } from 'react';
import { ELEMENT_DATA } from '@atlas/core';
import { useStore } from '../store';
import { PeriodicTableGrid } from '../periodic-table/PeriodicTableGrid';
import { ElementDetailCard } from '../periodic-table/ElementDetailCard';

const ACCENT = '#1edce0';

export function ElementsPanel() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number[]>([]);

  const selectedZ = selected[0];
  const element = selectedZ !== undefined ? ELEMENT_DATA[selectedZ] : undefined;

  // Single-select: clicking the selected cell deselects; the grid disables the
  // other cells while one is selected (maxSelection=1), so switching goes
  // through deselect first.
  const toggle = (z: number) => setSelected((prev) => (prev.includes(z) ? [] : [z]));

  const configureRun = () => {
    if (!element) return;
    useStore.getState().openRunConfigurator({ elements: [element.symbol] });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
      <input
        type="search"
        aria-label="Filter elements"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by symbol or name…"
        style={searchInputStyle}
      />

      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <PeriodicTableGrid
          selected={selected}
          onToggle={toggle}
          maxSelection={1}
          filterText={query}
        />
      </div>

      {selectedZ !== undefined && element ? (
        <ElementDetailCard z={selectedZ} />
      ) : (
        <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', padding: '8px 2px' }}>
          Select an element to see its periodic facts.
        </div>
      )}

      <button
        type="button"
        disabled={!element}
        onClick={configureRun}
        style={primaryBtnStyle(Boolean(element))}
      >
        {element ? `Configure a run with ${element.symbol} →` : 'Configure a run →'}
      </button>
    </div>
  );
}

const searchInputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#121824',
  color: '#f8fafc',
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 13,
  outline: 'none',
};

const primaryBtnStyle = (enabled: boolean): CSSProperties => ({
  alignSelf: 'flex-start',
  padding: '9px 18px',
  borderRadius: 6,
  border: 'none',
  background: enabled ? ACCENT : '#1e2533',
  color: enabled ? '#04141a' : '#475569',
  cursor: enabled ? 'pointer' : 'not-allowed',
  fontSize: 13,
  fontWeight: 700,
});
