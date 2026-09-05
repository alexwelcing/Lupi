/**
 * ElementsPanel — the Elements explorer. Search-filtered periodic table in
 * single-select mode and a detail card. Search results remain reachable on
 * narrow screens without hunting across an off-screen periodic table.
 */
import { useState, type CSSProperties } from 'react';
import { ELEMENT_DATA } from '@atlas/core';
import { PeriodicTableGrid } from '../periodic-table/PeriodicTableGrid';
import { ElementDetailCard } from '../periodic-table/ElementDetailCard';

export function ElementsPanel() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number[]>([]);

  const selectedZ = selected[0];
  const element = selectedZ !== undefined ? ELEMENT_DATA[selectedZ] : undefined;

  const matchingElements = Object.entries(ELEMENT_DATA).filter(
    ([, data]) =>
      data.name.toLowerCase().includes(query.trim().toLowerCase()) ||
      data.symbol.toLowerCase().includes(query.trim().toLowerCase()),
  );
  // Single-select replaces the previous choice; other elements stay usable.
  const toggle = (z: number) => setSelected(prev => (prev.includes(z) ? [] : [z]));

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '4px 0',
      }}
    >
      <input
        type="search"
        aria-label="Filter elements"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Filter by symbol or name…"
        style={searchInputStyle}
      />

      {query.trim() ? (
        <div role="group" aria-label="Matching elements" style={{ display: 'grid', gap: 8 }}>
          {matchingElements.length === 0 && <p role="status">No matching elements. Try a name or symbol.</p>}
          {matchingElements.map(([z, data]) => (
            <button
              key={z}
              type="button"
              aria-pressed={selectedZ === Number(z)}
              onClick={() => toggle(Number(z))}
              style={{
                minHeight: 44,
                padding: '10px 12px',
                textAlign: 'left',
                background: '#192522',
                color: '#eff3e9',
                border: '1px solid #526253',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {data.symbol} · {data.name}
            </button>
          ))}
        </div>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-label="Scrollable periodic table"
          style={{ overflowX: 'auto', paddingBottom: 4 }}
        >
          <PeriodicTableGrid selected={selected} onToggle={toggle} cellSize={44} />
        </div>
      )}

      {selectedZ !== undefined && element ? (
        <ElementDetailCard z={selectedZ} />
      ) : (
        <div
          style={{
            fontSize: 12,
            color: '#64748b',
            fontStyle: 'italic',
            padding: '8px 2px',
          }}
        >
          Select an element to see its periodic facts.
        </div>
      )}
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
};
