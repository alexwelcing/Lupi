import { useStore } from './store';
export type StudioDeckMode = 'molecule' | 'scene';

/** The everyday controls. Renderer/agent capabilities are not a menu inventory. */
export function StudioControlDeck({ mode: _mode }: { mode: StudioDeckMode }) {
  const showBonds = useStore(s => s.showBonds);
  const showAxes = useStore(s => s.showAxes);
  const showCell = useStore(s => s.showCell);
  const atomScale = useStore(s => s.atomScale);
  const background = useStore(s => s.backgroundPreset);
  return (
    <div
      data-testid="studio-control-deck"
      style={{
        padding: 16,
        display: 'grid',
        gap: 24,
        font: '14px/1.6 system-ui',
        color: '#eff3e9',
      }}
    >
      <fieldset style={section}>
        <legend>Structure</legend>
        <label style={row}>
          <span>Bond guides</span>
          <input type="checkbox" checked={showBonds} onChange={() => useStore.getState().toggleBonds()} />
        </label>
        <p style={hint}>Connections may be inferred from distance. They are not a claim about bond order.</p>
        <label style={row}>
          <span>Coordinate axes</span>
          <input type="checkbox" checked={showAxes} onChange={() => useStore.getState().toggleAxes()} />
        </label>
        <label style={row}>
          <span>Cell / bounding box</span>
          <input type="checkbox" checked={showCell} onChange={() => useStore.getState().toggleCell()} />
        </label>
        <label style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          Atom size · {atomScale.toFixed(2)}×
          <input
            aria-label="Atom size"
            type="range"
            min=".3"
            max="2"
            step=".05"
            value={atomScale}
            onChange={event => useStore.getState().setAtomScale(Number(event.target.value))}
          />
        </label>
      </fieldset>
      <fieldset style={section}>
        <legend>Background</legend>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {[
            ['deep', 'Dark'],
            ['white', 'Paper'],
            ['blueprint', 'Blueprint'],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={background === id}
              onClick={() => useStore.getState().setBackgroundPreset(id)}
              style={{
                ...button,
                borderColor: background === id ? '#d5ef9c' : '#526253',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <button type="button" style={button} onClick={() => useStore.getState().setColorScheme('element')}>
        Use element colors
      </button>
      <p style={hint}>
        Use Data to inspect source properties, Camera to change the viewing angle, and Export to make a
        picture.
      </p>
    </div>
  );
}
const section = { border: 0, margin: 0, padding: 0, minWidth: 0 } as const;
const row = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: 44,
  gap: 16,
} as const;
const hint = { color: '#afc0b4', fontSize: 12, margin: '4px 0 8px' } as const;
const button = {
  minHeight: 44,
  padding: '10px 14px',
  color: '#eff3e9',
  border: '1px solid #526253',
  borderRadius: 7,
  background: '#1c2c26',
  cursor: 'pointer',
} as const;
