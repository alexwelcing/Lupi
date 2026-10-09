/**
 * BondLegendHUD — what the bond lines mean, whenever the molecular recipe
 * draws them (strategy §2.11): solid bonds, dashed metal coordination,
 * dotted ionic contacts, and that the source supplied coordinates, charge and
 * spin but no bonds. DOM only, stacked above PropertyLegendHUD.
 *
 * It starts collapsed ("Inferred bonds ⓘ") on a phone and under Still; under
 * Standard it collapses by itself after 4 s; under Gentle it stays until
 * closed. ⓘ opens Learn on "How these bonds were drawn". On a phone it
 * declares the area it covers so the live view makes room (viewInset).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_BOND_TOLERANCE, MOLECULAR_RECIPE_ID } from '@atlas/core/bonds';
import { omolSignedCharge } from '@atlas/core/omol25';
import type { Frame } from '@atlas/core/types';
import { useStore } from '../store';
import { useComfort } from '../motion/comfort';
import { MOBILE_MEDIA_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { setViewOccluder } from '../camera/viewInset';
import { resolveFrameRecipe } from './perceivedBonds';
import { requestBondMethodFocus } from './BondMethodSection';

const OCCLUDER_ID = 'bond-legend';
export const BOND_LEGEND_COLLAPSE_MS = 4000;
const STACK_GAP_PX = 8;

const INK = '#eff3e9';
const MUTED = '#afc0b4';
const FILL = 'rgba(16, 24, 23, 0.88)';
const EDGE = '1px solid #526253';

export type BondLegendMode = 'molecular' | 'distance';

/** What the legend says for a frame, or null when it does not show. */
export function bondLegendCopy(opts: {
  frame: Pick<Frame, 'chemistry' | 'sourceRecord'>;
  mode: BondLegendMode;
  tolerance: number;
}): { title: string; collapsed: string; adjusted: string | null; supplies: string | null } {
  if (opts.mode === 'distance') {
    return { title: 'Distance-only guides', collapsed: 'Distance-only guides', adjusted: null, supplies: null };
  }
  const omol25 = opts.frame.sourceRecord?.dataset === 'omol25';
  const adjusted = Math.abs(opts.tolerance - DEFAULT_BOND_TOLERANCE) > 1e-9;
  const collapsed = adjusted
    ? `Inferred bonds · adjusted (+${opts.tolerance.toFixed(2)} Å)`
    : 'Inferred bonds';
  const chemistry = opts.frame.chemistry;
  const supplier = omol25 ? 'OMol25' : 'The file';
  let supplies = `${supplier} supplies coordinates — not bonds.`;
  if (chemistry && chemistry.source !== 'unavailable') {
    const q = chemistry.totalCharge === null ? 'not recorded' : omolSignedCharge(chemistry.totalCharge);
    const m = chemistry.spinMultiplicity === null ? 'not recorded' : String(chemistry.spinMultiplicity);
    supplies = `${supplier} supplies coordinates, charge ${q} and spin multiplicity ${m} — not bonds.`;
  }
  return {
    title: omol25 ? 'Bonds inferred from DFT geometry · Lupi v1' : 'Bonds inferred from geometry · Lupi v1',
    collapsed,
    adjusted: adjusted
      ? `Tolerance adjusted to +${opts.tolerance.toFixed(2)} Å (default +${DEFAULT_BOND_TOLERANCE.toFixed(2)} Å).`
      : null,
    supplies,
  };
}

function Swatch({ dash }: { dash: 'solid' | 'dashed' | 'dotted' }) {
  return (
    <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true" style={{ flexShrink: 0 }}>
      <line
        x1="1"
        y1="4"
        x2="25"
        y2="4"
        stroke={INK}
        strokeWidth={dash === 'solid' ? 3 : dash === 'dashed' ? 2 : 2.2}
        strokeLinecap={dash === 'dotted' ? 'round' : 'butt'}
        strokeDasharray={dash === 'dashed' ? '5 3' : dash === 'dotted' ? '0.1 4' : undefined}
      />
    </svg>
  );
}

/** Height of the property legend below us (0 when it is not shown), kept current. */
function usePropertyLegendHeight(anchor: HTMLElement | null): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const parent = anchor?.parentElement;
    if (!parent) return undefined;
    let resize: ResizeObserver | null = null;
    const watch = () => {
      resize?.disconnect();
      const legend = parent.querySelector<HTMLElement>('[data-testid="property-legend"]');
      setHeight(legend ? legend.getBoundingClientRect().height : 0);
      if (legend && typeof ResizeObserver === 'function') {
        resize = new ResizeObserver(() => setHeight(legend.getBoundingClientRect().height));
        resize.observe(legend);
      }
    };
    watch();
    const children = typeof MutationObserver === 'function' ? new MutationObserver(watch) : null;
    children?.observe(parent, { childList: true });
    return () => {
      children?.disconnect();
      resize?.disconnect();
    };
  }, [anchor]);
  return height;
}

export function BondLegendHUD({
  frame,
  bottomOffset = 0,
}: {
  frame: Frame | undefined;
  /** The same offset PropertyLegendHUD gets; the legend stacks above it. */
  bottomOffset?: number;
}) {
  const showBonds = useStore((s) => s.showBonds);
  const bondProfile = useStore((s) => s.bondProfile);
  const tolerance = useStore((s) => s.bondTolerance);
  const frameCount = useStore((s) => s.file?.trajectory.totalFrames ?? 1);
  const comfort = useComfort();
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);

  let mode: BondLegendMode | null = null;
  if (frame && showBonds) {
    const recipe = resolveFrameRecipe(frame, { profile: bondProfile, frameCount });
    if (recipe === MOLECULAR_RECIPE_ID) mode = 'molecular';
    else if (bondProfile === 'distance' && resolveFrameRecipe(frame, { profile: 'auto', frameCount }) === MOLECULAR_RECIPE_ID) {
      mode = 'distance';
    }
  }

  const startCollapsed = isMobile || comfort === 'still';
  const [expanded, setExpanded] = useState(!startCollapsed);
  const shownKey = mode ? `${mode}|${frame?.sourceRecord?.row ?? ''}|${frameCount}` : null;
  // A new structure (or the legend appearing) starts over.
  useEffect(() => {
    setExpanded(!startCollapsed);
  }, [shownKey, startCollapsed]);
  useEffect(() => {
    if (!expanded || !mode || comfort !== 'standard') return undefined;
    const timer = window.setTimeout(() => setExpanded(false), BOND_LEGEND_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [expanded, mode, comfort, shownKey]);

  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const stackHeight = usePropertyLegendHeight(node);
  const observer = useRef<ResizeObserver | null>(null);
  useLayoutEffect(() => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || !isMobile) {
      setViewOccluder(OCCLUDER_ID, null);
      return undefined;
    }
    const report = () => {
      const r = node.getBoundingClientRect();
      setViewOccluder(OCCLUDER_ID, { rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
    };
    report();
    if (typeof ResizeObserver === 'function') {
      observer.current = new ResizeObserver(report);
      observer.current.observe(node);
    }
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      setViewOccluder(OCCLUDER_ID, null);
    };
  }, [node, isMobile, expanded, stackHeight]);

  const openLearn = useCallback(() => {
    requestBondMethodFocus();
    useStore.getState().setStudyLensOpen(true);
  }, []);

  if (!frame || !mode) return null;
  const copy = bondLegendCopy({ frame, mode, tolerance });
  const bottom = 12 + bottomOffset + (stackHeight > 0 ? stackHeight + STACK_GAP_PX : 0);
  const button = {
    color: INK,
    background: 'transparent',
    border: 'none',
    padding: 0,
    font: 'inherit',
    cursor: 'pointer',
    minHeight: 28,
  } as const;

  return (
    <div
      ref={setNode}
      data-testid="bond-legend"
      role="note"
      aria-label="Bond legend"
      style={{
        position: 'absolute',
        left: 12,
        bottom,
        zIndex: 8,
        maxWidth: expanded ? 280 : 240,
        padding: expanded ? '8px 10px' : '2px 10px',
        borderRadius: 10,
        background: FILL,
        border: EDGE,
        color: INK,
        font: '400 11px/1.4 system-ui, sans-serif',
      }}
    >
      {expanded ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontWeight: 600 }}>{copy.title}</strong>
            <button type="button" aria-label="Collapse bond legend" onClick={() => setExpanded(false)} style={{ ...button, color: MUTED, minWidth: 28 }}>
              ×
            </button>
          </div>
          {mode === 'molecular' && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3 }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Swatch dash="solid" />bond</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Swatch dash="dashed" />coordination</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Swatch dash="dotted" />ionic contact</li>
            </ul>
          )}
          {copy.adjusted && <span>{copy.adjusted}</span>}
          {copy.supplies && <span style={{ color: MUTED }}>{copy.supplies}</span>}
          <button type="button" onClick={openLearn} style={{ ...button, textAlign: 'left', textDecoration: 'underline' }}>
            How these bonds were drawn
          </button>
        </div>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button type="button" aria-expanded={false} onClick={() => setExpanded(true)} style={button}>
            {copy.collapsed}
          </button>
          <button type="button" aria-label="How these bonds were drawn" onClick={openLearn} style={{ ...button, minWidth: 28 }}>
            ⓘ
          </button>
        </span>
      )}
    </div>
  );
}
