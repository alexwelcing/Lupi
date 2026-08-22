/**
 * RunConfigurator — a guided builder for procedural lattice runs. Picks
 * elements on the periodic table, lattice type, size, spacing, and an optional
 * viewer patch, shows the exact `lupi.generate_molecule` MCP request it will
 * send (same honesty pattern as MoleculeConfigurator's review step), then runs
 * it against the real viewer MCP bridge.
 *
 * Store contract: consumes `runConfiguratorOpen` / `runConfiguratorSeed` /
 * `closeRunConfigurator`. Seeded by the Elements explorer or the command
 * palette ("New run"). Local state resets on every open; Esc closes.
 *
 * Flow: Structure → Size → Look → Review & run.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ELEMENT_DATA, getAtomicNumberBySymbol } from '@atlas/core';
import { useStore } from '../store';
import { PeriodicTableGrid } from '../periodic-table/PeriodicTableGrid';

const ACCENT = '#1edce0';

/** Mirror of the bridge's private cap (mcpViewerBridge.tsx) — kept local so
 *  this module stays free of bridge internals. */
export const MAX_PROCEDURAL_ATOMS = 1_000_000;
const MAX_ELEMENTS = 4;
const MAX_SPACING = 10;

type Step = 'structure' | 'size' | 'look' | 'review';
const STEP_ORDER: Step[] = ['structure', 'size', 'look', 'review'];
const STEP_LABEL: Record<Step, string> = {
  structure: 'Structure', size: 'Size', look: 'Look', review: 'Review',
};

type Lattice = 'sc' | 'bcc' | 'fcc';
const LATTICE_OPTIONS: { id: Lattice; label: string; hint: string }[] = [
  { id: 'sc', label: 'Simple cubic', hint: 'One atom per cell corner — open, easy to read' },
  { id: 'bcc', label: 'Body-centered', hint: 'Corners + one center atom (Fe, W)' },
  { id: 'fcc', label: 'Face-centered', hint: 'Corners + face atoms — close-packed (Cu, Al)' },
];

const COUNT_PRESETS = [1_000, 10_000, 100_000, 500_000];
const ATOM_SCALE_PRESETS = [0.5, 1.0, 1.5];

export interface RunSelections {
  elements: string[];
  lattice: 'sc' | 'bcc' | 'fcc';
  atomCount: number;
  /** Lattice constant in Å, or null for the bridge's per-element default. */
  spacing: number | null;
  showBonds: boolean;
  colorScheme: 'element' | 'uniform';
  atomScale: number;
}

/** Assemble the exact lupi.generate_molecule request the bridge executes. */
export function buildRunRequest(s: RunSelections): {
  id: string;
  tool: 'lupi.generate_molecule';
  arguments: Record<string, unknown>;
} {
  if (s.elements.length < 1 || s.elements.length > MAX_ELEMENTS) {
    throw new Error(`A run needs 1–${MAX_ELEMENTS} elements (got ${s.elements.length}).`);
  }
  return {
    id: 'run-configurator',
    tool: 'lupi.generate_molecule',
    arguments: {
      inputType: 'procedural',
      elements: s.elements,
      lattice: s.lattice,
      atomCount: Math.min(Math.max(Math.round(s.atomCount), 1), MAX_PROCEDURAL_ATOMS),
      ...(s.spacing != null ? { spacing: s.spacing } : {}),
      viewer: { showBonds: s.showBonds, colorScheme: s.colorScheme, atomScale: s.atomScale },
    },
  };
}

interface McpBridge {
  execute: (r: { id: string; tool: string; arguments: Record<string, unknown> }) => Promise<{ ok: boolean; error?: { message?: string } }>;
}

export function RunConfigurator() {
  const open = useStore((s) => s.runConfiguratorOpen);
  const seed = useStore((s) => s.runConfiguratorSeed);
  const close = useStore((s) => s.closeRunConfigurator);

  const [step, setStep] = useState<Step>('structure');
  const [elementsZ, setElementsZ] = useState<number[]>([]);
  const [lattice, setLattice] = useState<Lattice>('fcc');
  const [countPreset, setCountPreset] = useState<number | 'custom'>(10_000);
  const [customCountText, setCustomCountText] = useState('');
  const [spacingMode, setSpacingMode] = useState<'auto' | 'custom'>('auto');
  const [spacingText, setSpacingText] = useState('');
  const [showBonds, setShowBonds] = useState(false);
  const [colorScheme, setColorScheme] = useState<'element' | 'uniform'>('element');
  const [atomScale, setAtomScale] = useState(1.0);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Seed from the store and reset to a clean flow on each open.
  useEffect(() => {
    if (!open) return;
    setStep('structure');
    setElementsZ(
      (seed?.elements ?? [])
        .map((symbol) => getAtomicNumberBySymbol(symbol))
        .filter((z): z is number => z !== undefined)
        .slice(0, MAX_ELEMENTS),
    );
    setLattice('fcc');
    setCountPreset(10_000);
    setCustomCountText('');
    setSpacingMode('auto');
    setSpacingText('');
    setShowBonds(false);
    setColorScheme('element');
    setAtomScale(1.0);
    setRunError(null);
    setRunning(false);
  }, [open, seed]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const customCount = useMemo(() => Number(customCountText), [customCountText]);
  const customCountValid = customCountText.trim() !== '' && Number.isFinite(customCount) && customCount >= 1;
  const atomCount = countPreset === 'custom' ? Math.floor(customCount) : countPreset;

  const customSpacing = useMemo(() => Number(spacingText), [spacingText]);
  const customSpacingValid = spacingText.trim() !== '' && Number.isFinite(customSpacing) && customSpacing > 0 && customSpacing <= MAX_SPACING;
  const spacing = spacingMode === 'auto' ? null : customSpacing;

  const selections: RunSelections | null = useMemo(() => {
    const elements = elementsZ.map((z) => ELEMENT_DATA[z]?.symbol).filter((s): s is string => Boolean(s));
    if (elements.length === 0 || !Number.isFinite(atomCount) || atomCount < 1) return null;
    if (spacingMode === 'custom' && !customSpacingValid) return null;
    return { elements, lattice, atomCount, spacing, showBonds, colorScheme, atomScale };
  }, [elementsZ, lattice, atomCount, spacing, spacingMode, customSpacingValid, showBonds, colorScheme, atomScale]);

  if (!open) return null;

  const stepIndex = STEP_ORDER.indexOf(step);
  const canNext =
    step === 'structure' ? elementsZ.length >= 1
    : step === 'size' ? (countPreset !== 'custom' || customCountValid) && (spacingMode !== 'custom' || customSpacingValid)
    : true;
  const goNext = () => { const i = STEP_ORDER.indexOf(step); if (i < STEP_ORDER.length - 1) setStep(STEP_ORDER[i + 1]); };
  const goBack = () => { const i = STEP_ORDER.indexOf(step); if (i > 0) setStep(STEP_ORDER[i - 1]); };

  const toggleElement = (z: number) =>
    setElementsZ((prev) => (prev.includes(z) ? prev.filter((x) => x !== z) : [...prev, z].slice(0, MAX_ELEMENTS)));

  /** Wait briefly for the viewer MCP bridge, then execute the run request. */
  const run = async () => {
    if (!selections || running) return;
    setRunning(true);
    setRunError(null);
    let request;
    try {
      request = buildRunRequest(selections);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
      setRunning(false);
      return;
    }
    const mcp = () => (window as unknown as { __lupiViewerMcp?: McpBridge }).__lupiViewerMcp;
    for (let i = 0; i < 40 && !mcp(); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const bridge = mcp();
    if (!bridge) {
      setRunError('The viewer bridge is not ready yet — open the viewer route and try again.');
      setRunning(false);
      return;
    }
    try {
      const response = await bridge.execute(request);
      if (!response.ok) {
        setRunError(response.error?.message ?? 'The viewer rejected the run request.');
        setRunning(false);
        return;
      }
      close();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="New run" onClick={close} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={panelStyle}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 4, height: 16, background: ACCENT }} />
            <span style={titleStyle}>New run</span>
          </div>
          <button onClick={close} aria-label="Close" style={closeBtnStyle}>×</button>
        </div>

        <div style={stepperStyle}>
          {STEP_ORDER.map((s, i) => {
            const done = i < stepIndex;
            const active = i === stepIndex;
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={pipStyle(active, done)}>{done ? '✓' : i + 1}</span>
                <span style={{ fontSize: 11, color: active ? '#e2e8f0' : '#64748b', fontWeight: active ? 700 : 500 }}>
                  {STEP_LABEL[s]}
                </span>
                {i < STEP_ORDER.length - 1 && <span style={{ width: 16, height: 1, background: '#1f2937' }} />}
              </div>
            );
          })}
        </div>

        <div style={bodyStyle}>
          {step === 'structure' && (
            <div>
              <div style={captionStyle}>
                Pick 1–{MAX_ELEMENTS} elements{elementsZ.length > 0 ? ` — ${elementsZ.length} selected` : ''}
              </div>
              <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
                <PeriodicTableGrid
                  selected={elementsZ}
                  onToggle={toggleElement}
                  maxSelection={MAX_ELEMENTS}
                  cellSize={26}
                />
              </div>
              <div style={{ ...captionStyle, marginTop: 14 }}>Lattice</div>
              <ChoiceGroup
                options={LATTICE_OPTIONS}
                value={lattice}
                onChange={(v) => setLattice(v as Lattice)}
              />
            </div>
          )}

          {step === 'size' && (
            <div>
              <div style={captionStyle}>How many atoms?</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {COUNT_PRESETS.map((count) => {
                  const active = countPreset === count;
                  return (
                    <button key={count} type="button" onClick={() => setCountPreset(count)} style={choiceRowStyle(active, false)}>
                      <span style={radioStyle(active)}>{active && <span style={radioDotStyle} />}</span>
                      <span style={{ color: active ? '#fff' : '#e2e8f0', fontSize: 13, fontWeight: 700 }}>
                        {count.toLocaleString('en-US')} atoms
                      </span>
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setCountPreset('custom')}
                  style={choiceRowStyle(countPreset === 'custom', false)}
                >
                  <span style={radioStyle(countPreset === 'custom')}>{countPreset === 'custom' && <span style={radioDotStyle} />}</span>
                  <span style={{ color: countPreset === 'custom' ? '#fff' : '#e2e8f0', fontSize: 13, fontWeight: 700 }}>Custom</span>
                </button>
                <input
                  type="number"
                  min={1}
                  aria-label="Custom atom count"
                  placeholder="e.g. 250000"
                  value={customCountText}
                  onFocus={() => setCountPreset('custom')}
                  onChange={(e) => { setCountPreset('custom'); setCustomCountText(e.target.value); }}
                  style={numberInputStyle}
                />
              </div>
              {countPreset === 'custom' && customCountText.trim() !== '' && !customCountValid && (
                <div style={hintErrorStyle}>Enter a positive whole number.</div>
              )}
              {atomCount > MAX_PROCEDURAL_ATOMS && (
                <div style={hintStyle}>Clamped to {MAX_PROCEDURAL_ATOMS.toLocaleString('en-US')} atoms — the viewer's procedural cap.</div>
              )}

              <div style={{ ...captionStyle, marginTop: 16 }}>Lattice spacing</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button" onClick={() => setSpacingMode('auto')} style={choiceRowStyle(spacingMode === 'auto', false)}>
                  <span style={radioStyle(spacingMode === 'auto')}>{spacingMode === 'auto' && <span style={radioDotStyle} />}</span>
                  <span style={{ textAlign: 'left' }}>
                    <span style={{ display: 'block', color: spacingMode === 'auto' ? '#fff' : '#e2e8f0', fontSize: 13, fontWeight: 700 }}>Auto</span>
                    <span style={{ display: 'block', color: '#64748b', fontSize: 11, marginTop: 2 }}>Per-element default constant</span>
                  </span>
                </button>
                <button type="button" onClick={() => setSpacingMode('custom')} style={choiceRowStyle(spacingMode === 'custom', false)}>
                  <span style={radioStyle(spacingMode === 'custom')}>{spacingMode === 'custom' && <span style={radioDotStyle} />}</span>
                  <span style={{ color: spacingMode === 'custom' ? '#fff' : '#e2e8f0', fontSize: 13, fontWeight: 700 }}>Explicit</span>
                </button>
                <input
                  type="number"
                  min={0}
                  step={0.05}
                  aria-label="Lattice spacing in angstroms"
                  placeholder="Å"
                  disabled={spacingMode !== 'custom'}
                  value={spacingText}
                  onChange={(e) => setSpacingText(e.target.value)}
                  style={{ ...numberInputStyle, width: 90, opacity: spacingMode === 'custom' ? 1 : 0.4 }}
                />
              </div>
              {spacingMode === 'custom' && spacingText.trim() !== '' && !customSpacingValid && (
                <div style={hintErrorStyle}>Spacing must be a positive number ≤ {MAX_SPACING} Å.</div>
              )}
            </div>
          )}

          {step === 'look' && (
            <div>
              <ChoiceGroup
                caption="Show visual bond guides?"
                options={[
                  { id: 'off', label: 'No guides', hint: 'Atoms only — fastest for big lattices' },
                  { id: 'on', label: 'Show bonds', hint: 'Inferred covalent links between neighbors' },
                ]}
                value={showBonds ? 'on' : 'off'}
                onChange={(v) => setShowBonds(v === 'on')}
              />
              <div style={{ marginTop: 16 }}>
                <ChoiceGroup
                  caption="Color scheme"
                  options={[
                    { id: 'element', label: 'By element', hint: 'Standard CPK colors per species' },
                    { id: 'uniform', label: 'Uniform', hint: 'One color — shape & material speak' },
                  ]}
                  value={colorScheme}
                  onChange={(v) => setColorScheme(v as 'element' | 'uniform')}
                />
              </div>
              <div style={{ ...captionStyle, marginTop: 16 }}>Atom size</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {ATOM_SCALE_PRESETS.map((scale) => {
                  const active = atomScale === scale;
                  return (
                    <button key={scale} type="button" onClick={() => setAtomScale(scale)} style={{ ...choiceRowStyle(active, false), flex: 1 }}>
                      <span style={radioStyle(active)}>{active && <span style={radioDotStyle} />}</span>
                      <span style={{ color: active ? '#fff' : '#e2e8f0', fontSize: 13, fontWeight: 700 }}>{scale.toFixed(1)}×</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 'review' && (
            <div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>
                Running this MCP request against the viewer:
              </div>
              <pre style={mcpPreStyle}>
                {selections ? JSON.stringify(buildRunRequest(selections), null, 2) : 'Incomplete selections.'}
              </pre>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 8, fontStyle: 'italic' }}>
                This is the real request the viewer's MCP bridge executes — the same API agents use.
              </div>
              {runError && (
                <div role="alert" style={{ fontSize: 12, color: '#f87171', marginTop: 10, lineHeight: 1.5 }}>
                  {runError}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={footerStyle}>
          <button onClick={step === 'structure' ? close : goBack} style={ghostBtnStyle}>
            {step === 'structure' ? 'Cancel' : 'Back'}
          </button>
          {step === 'review' ? (
            <button onClick={() => void run()} disabled={!selections || running} style={primaryBtnStyle(Boolean(selections) && !running)}>
              {running ? 'Running…' : 'Run →'}
            </button>
          ) : (
            <button onClick={goNext} disabled={!canNext} style={primaryBtnStyle(canNext)}>
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Presentational pieces (same look as MoleculeConfigurator) ───
function ChoiceGroup({
  caption, options, value, onChange,
}: {
  caption?: string;
  options: { id: string; label: string; hint: string; disabled?: boolean }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      {caption && <div style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 600, marginBottom: 12 }}>{caption}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button key={o.id} type="button" onClick={() => !o.disabled && onChange(o.id)} disabled={o.disabled} style={choiceRowStyle(active, Boolean(o.disabled))}>
              <span style={radioStyle(active)}>{active && <span style={radioDotStyle} />}</span>
              <span style={{ textAlign: 'left' }}>
                <span style={{ display: 'block', color: o.disabled ? '#475569' : active ? '#fff' : '#e2e8f0', fontSize: 13, fontWeight: 700 }}>{o.label}</span>
                <span style={{ display: 'block', color: o.disabled ? '#3a4658' : '#64748b', fontSize: 11, marginTop: 2 }}>{o.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Styles (mirrors MoleculeConfigurator) ───
const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 600,
  background: 'rgba(2,4,8,0.72)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const panelStyle: CSSProperties = {
  width: 'min(560px, 100%)', maxHeight: 'min(86vh, 720px)',
  display: 'flex', flexDirection: 'column',
  background: '#0a0d14', border: '1px solid #1f2937', borderRadius: 12,
  boxShadow: '0 30px 90px rgba(0,0,0,0.6)', overflow: 'hidden',
};
const headerStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 16px', borderBottom: '1px solid #1f2937', background: '#0d1117',
};
const titleStyle: CSSProperties = {
  fontSize: 13, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
  textTransform: 'uppercase', letterSpacing: '0.12em', color: '#e2e8f0',
};
const closeBtnStyle: CSSProperties = {
  width: 26, height: 26, border: '1px solid #334155', borderRadius: 6,
  background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1,
};
const stepperStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
  padding: '12px 16px', borderBottom: '1px solid #1f2937', background: '#0b0e15',
};
const pipStyle = (active: boolean, done: boolean): CSSProperties => ({
  width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 10, fontWeight: 800,
  background: done ? ACCENT : active ? 'rgba(30,220,224,0.15)' : '#121826',
  color: done ? '#04141a' : active ? ACCENT : '#64748b',
  border: `1px solid ${done || active ? ACCENT : '#334155'}`,
});
const bodyStyle: CSSProperties = { padding: 16, overflowY: 'auto', flex: 1 };
const footerStyle: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 10,
  padding: '12px 16px', borderTop: '1px solid #1f2937', background: '#0d1117',
};
const captionStyle: CSSProperties = { fontSize: 13, color: '#cbd5e1', fontWeight: 600, marginBottom: 12 };
const choiceRowStyle = (active: boolean, disabled: boolean): CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 12px', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
  background: active ? 'rgba(30,220,224,0.08)' : '#121418',
  border: `1px solid ${active ? ACCENT : '#1f2937'}`, transition: 'border-color 120ms, background 120ms',
});
const radioStyle = (active: boolean): CSSProperties => ({
  width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
  border: `1.5px solid ${active ? ACCENT : '#475569'}`,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
});
const radioDotStyle: CSSProperties = { width: 8, height: 8, borderRadius: '50%', background: ACCENT };
const numberInputStyle: CSSProperties = {
  flex: 1, minWidth: 0, boxSizing: 'border-box', background: '#121824', color: '#f8fafc',
  border: '1px solid #334155', borderRadius: 6, padding: '9px 12px', fontSize: 13, outline: 'none',
};
const hintStyle: CSSProperties = { fontSize: 11, color: '#94a3b8', marginTop: 8, fontStyle: 'italic' };
const hintErrorStyle: CSSProperties = { fontSize: 11, color: '#f87171', marginTop: 8 };
const mcpPreStyle: CSSProperties = {
  margin: 0, padding: 12, background: '#06080d', border: '1px solid #1f2937', borderRadius: 8,
  color: '#9ff7ff', fontSize: 11, fontFamily: 'ui-monospace, monospace', lineHeight: 1.5,
  overflowX: 'auto', whiteSpace: 'pre',
};
const ghostBtnStyle: CSSProperties = {
  padding: '9px 16px', background: 'transparent', color: '#94a3b8',
  border: '1px solid #334155', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const primaryBtnStyle = (enabled: boolean): CSSProperties => ({
  padding: '9px 18px', borderRadius: 6, border: 'none',
  background: enabled ? 'linear-gradient(135deg, #0f62fe, #7c3aed)' : '#1e2533',
  color: enabled ? '#fff' : '#475569', cursor: enabled ? 'pointer' : 'not-allowed',
  fontSize: 13, fontWeight: 700,
});
