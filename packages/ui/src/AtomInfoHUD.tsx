/**
 * <AtomInfoHUD /> - data card for the clicked atom.
 *
 * Desktop: a compact card anchored just above the atom, rendered at a constant
 * screen size so it stays legible at any zoom.
 * Phone: the same content docks as a sheet under the header (full width, larger
 * type, 44px close target) instead of floating over the molecule, where a
 * world-anchored card scales unpredictably and drifts off-screen.
 */

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Html } from '@react-three/drei';
import type { Frame } from '@atlas/core/types';
import {
  ELEMENT_DATA,
  hasAngstromDistances,
  resolveAtomicNumber,
  resolveTypeColor,
  resolveTypeDisplayRadius,
  resolveTypeLabel,
} from '@atlas/core';
import { useStore, type KnowledgeLabel } from './store';
import { humanizeCategory } from './periodic-table/ElementDetailCard';
import { MOBILE_MEDIA_QUERY, useMediaQuery } from './hooks/useMediaQuery';

const MAX_PROPERTY_ROWS = 4;
const MAX_KNOWLEDGE_ROWS = 4;

/** Header (64px + safe area on phones) plus breathing room. */
const MOBILE_DOCK_TOP = 'calc(76px + env(safe-area-inset-top))';

const FONT_SANS = "'IBM Plex Sans', Inter, ui-sans-serif, system-ui, sans-serif";
const FONT_MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const COLOR_TEXT = 'rgba(234, 244, 255, 0.96)';
const COLOR_MUTED = 'rgba(148, 176, 205, 0.78)';
const COLOR_ACCENT = '#7dd3fc';
const COLOR_RULE = 'rgba(122, 211, 255, 0.16)';
const COLOR_TILE = 'rgba(255, 255, 255, 0.035)';
const COLOR_TILE_BORDER = 'rgba(174, 214, 255, 0.10)';

interface AtomInfoHUDProps {
  frame: Frame;
  selectedAtoms: number[];
  activeProperty?: string;
  onDismissCard?: (atomIndex: number) => void;
}

export function AtomInfoHUD({
  frame,
  selectedAtoms,
  activeProperty,
  onDismissCard,
}: AtomInfoHUDProps) {
  const atomIndex = selectedAtoms[0];
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);
  const knowledgeLabels = useStore(s => s.knowledgeLabels);
  const showNeighbors = useStore(s => s.showNeighbors);
  const setShowNeighbors = useStore(s => s.setShowNeighbors);
  const setHighlightedNeighbors = useStore(s => s.setHighlightedNeighbors);
  const validAtomIndex = atomIndex != null && atomIndex >= 0 && atomIndex < frame.natoms;
  const nodeLabel = validAtomIndex
    ? knowledgeLabels.find((l) => l.kind === 'node' && l.atomIndex === atomIndex)
    : undefined;

  // Auto-populate neighbors when a node is selected and showNeighbors is on.
  // The guard keeps every hook unconditional without changing the empty-card path.
  useEffect(() => {
    if (validAtomIndex && showNeighbors && nodeLabel?.neighbors) {
      setHighlightedNeighbors(new Set(nodeLabel.neighbors));
    } else {
      setHighlightedNeighbors(new Set());
    }
  }, [validAtomIndex, showNeighbors, nodeLabel, setHighlightedNeighbors]);

  if (!validAtomIndex) return null;

  const x = frame.positions[atomIndex * 3];
  const y = frame.positions[atomIndex * 3 + 1];
  const z = frame.positions[atomIndex * 3 + 2];
  const type = frame.types[atomIndex];
  const id = frame.ids[atomIndex] ?? atomIndex;
  const atomicNumber = resolveAtomicNumber(frame, type);
  const element = atomicNumber === undefined ? undefined : ELEMENT_DATA[atomicNumber];
  const typeLabel = resolveTypeLabel(frame, type);
  const typeColor = resolveTypeColor(frame, type);
  const displayRadius = resolveTypeDisplayRadius(frame, type);
  const coordinateUnit = hasAngstromDistances(frame) ? 'Å' : 'source units';
  const properties = getPropertyRows(frame, atomIndex, activeProperty);
  const knowledge = getKnowledgeRows(knowledgeLabels, frame, atomIndex);
  const nodePath = nodeLabel?.nodeId ? formatNodePath(nodeLabel.nodeId) : undefined;

  const scale = isMobile ? 1.15 : 1;
  const label = { fontSize: 9.5 * scale };
  const value = { fontSize: 12.5 * scale };

  const card = (
    <div
      data-testid="atom-info-card"
      data-atom-index={atomIndex}
      data-layout={isMobile ? 'sheet' : 'anchored'}
      style={{
        width: isMobile ? 'calc(100vw - 20px)' : 248,
        maxWidth: isMobile ? 420 : undefined,
        boxSizing: 'border-box',
        color: COLOR_TEXT,
        background: 'linear-gradient(180deg, rgba(11, 18, 30, 0.94), rgba(4, 9, 17, 0.9))',
        border: '1px solid rgba(122, 211, 255, 0.32)',
        borderRadius: isMobile ? 16 : 12,
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.46), 0 0 0 1px rgba(255,255,255,0.05) inset',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        padding: isMobile ? '12px 14px 14px' : '10px 12px 12px',
        fontFamily: FONT_SANS,
        lineHeight: 1.3,
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 10 }}>
        <div
          aria-hidden="true"
          style={{
            position: 'relative',
            display: 'grid',
            placeItems: 'center',
            width: isMobile ? 44 : 38,
            height: isMobile ? 44 : 38,
            flex: '0 0 auto',
            borderRadius: 10,
            color: '#06111c',
            background: typeColor,
            fontWeight: 800,
            fontSize: isMobile ? 19 : 16,
            letterSpacing: '-0.01em',
            boxShadow: `0 0 20px ${typeColor}66, inset 0 1px 0 rgba(255,255,255,0.35)`,
          }}
        >
          {atomicNumber !== undefined && (
            <span style={{ position: 'absolute', top: 3, left: 5, fontSize: 9, fontWeight: 700, opacity: 0.72 }}>
              {atomicNumber}
            </span>
          )}
          {element?.symbol ?? `T${type}`}
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: isMobile ? 16 : 14,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {element?.name ?? typeLabel}
          </div>
          <div
            title={nodeLabel?.nodeId}
            style={{
              marginTop: 3,
              color: COLOR_MUTED,
              fontFamily: nodePath ? FONT_MONO : FONT_SANS,
              fontSize: (nodePath ? 10 : 11) * scale,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {nodePath ? (
              nodePath
            ) : element ? (
              <>
                <span>{humanizeCategory(element.category)}</span>
                <span aria-hidden="true"> · </span>
                <span title="Chemical role in this structure">{element.role}</span>
              </>
            ) : (
              'Unmapped atom type'
            )}
          </div>
        </div>

        {onDismissCard && (
          <button
            type="button"
            aria-label="Dismiss atom details"
            onClick={() => onDismissCard(atomIndex)}
            style={{
              alignSelf: 'flex-start',
              display: 'grid',
              placeItems: 'center',
              width: isMobile ? 32 : 24,
              height: isMobile ? 32 : 24,
              flex: '0 0 auto',
              margin: isMobile ? '-2px -2px 0 0' : '-1px -2px 0 0',
              border: '1px solid rgba(174, 214, 255, 0.18)',
              borderRadius: 8,
              color: 'rgba(217, 234, 255, 0.78)',
              background: 'rgba(255, 255, 255, 0.05)',
              cursor: 'pointer',
              padding: 0,
              fontSize: isMobile ? 16 : 13,
              lineHeight: 1,
              touchAction: 'manipulation',
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: isMobile ? 10 : 8 }}>
        <Chip scale={scale}>atom {atomIndex}</Chip>
        <Chip scale={scale}>id {id}</Chip>
        <Chip scale={scale}>type {type}</Chip>
        {atomicNumber !== undefined && <Chip scale={scale}>Z {atomicNumber}</Chip>}
      </div>

      {/* Element facts */}
      {element && (
        <Section first>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 5 }}>
            <Stat label="Mass" value={`${element.mass} u`} labelStyle={label} valueStyle={value} />
            <Stat label="Cov. radius" title="Single-bond covalent radius" value={`${element.radius} Å`} labelStyle={label} valueStyle={value} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 5, marginTop: 5 }}>
            <Stat label="Group" value={element.group !== null ? String(element.group) : '—'} labelStyle={label} valueStyle={value} />
            <Stat label="Period" value={element.period !== null ? String(element.period) : '—'} labelStyle={label} valueStyle={value} />
            <Stat
              label={isMobile ? 'χ Pauling' : 'χ'}
              rawLabel
              title="Pauling electronegativity (χ)"
              value={element.electronegativity !== null ? String(element.electronegativity) : '—'}
              labelStyle={label}
              valueStyle={value}
            />
          </div>
        </Section>
      )}

      {/* Position */}
      <Section title={`Position · ${coordinateUnit}`} titleStyle={label} first={!element}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 5 }}>
          <Stat label="x" value={formatCoordinate(x)} labelStyle={label} valueStyle={value} />
          <Stat label="y" value={formatCoordinate(y)} labelStyle={label} valueStyle={value} />
          <Stat label="z" value={formatCoordinate(z)} labelStyle={label} valueStyle={value} />
        </div>
      </Section>

      {/* Per-atom properties */}
      {properties.length > 0 && (
        <Section title="Properties" titleStyle={label}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 5 }}>
            {properties.map(({ name, value: propertyValue }) => (
              <Stat
                key={name}
                label={name}
                rawLabel
                title={name}
                value={formatPropertyValue(propertyValue)}
                labelStyle={label}
                valueStyle={value}
                accent={name === activeProperty}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Knowledge graph */}
      {(knowledge.length > 0 || nodeLabel?.neighbors) && (
        <Section title="Knowledge graph" titleStyle={label}>
          <div style={{ display: 'grid', gap: 4 }}>
            {knowledge.map((row) => (
              <KeyValueRow key={row.label} label={row.label} value={row.value} labelStyle={label} valueStyle={value} />
            ))}
            {nodeLabel?.neighbors && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
                <span style={{ ...label, color: COLOR_MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                  Highlight neighbors
                </span>
                <button
                  type="button"
                  aria-pressed={showNeighbors}
                  onClick={() => setShowNeighbors(!showNeighbors)}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 10.5 * scale,
                    fontWeight: 700,
                    minHeight: isMobile ? 32 : 24,
                    padding: '0 10px',
                    borderRadius: 7,
                    border: `1px solid ${showNeighbors ? 'rgba(160, 255, 200, 0.5)' : 'rgba(122, 211, 255, 0.25)'}`,
                    background: showNeighbors ? 'rgba(160, 255, 200, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                    color: showNeighbors ? '#a0ffc8' : 'rgba(205, 225, 244, 0.9)',
                    cursor: 'pointer',
                    touchAction: 'manipulation',
                  }}
                >
                  {showNeighbors ? 'On' : 'Off'}
                </button>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );

  if (isMobile) {
    // Dock under the header: the wrapper is pinned to the top-center of the
    // canvas and the sheet centers itself beneath it. No distance scaling.
    return (
      <Html
        position={[x, y, z]}
        center={false}
        calculatePosition={(_object, _camera, size) => [size.width / 2, 0]}
        style={{ pointerEvents: 'auto', left: 0, top: MOBILE_DOCK_TOP, transform: 'translateX(-50%)' }}
      >
        {card}
      </Html>
    );
  }

  return (
    <Html
      position={[x, y + displayRadius * 1.75 + 0.45, z]}
      center
      style={{ pointerEvents: 'auto' }}
    >
      {card}
    </Html>
  );
}

function Section({
  title,
  titleStyle,
  first = false,
  children,
}: {
  title?: string;
  titleStyle?: CSSProperties;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        marginTop: first ? 10 : 8,
        paddingTop: first ? 9 : 7,
        borderTop: `1px solid ${COLOR_RULE}`,
      }}
    >
      {title && (
        <div
          style={{
            ...titleStyle,
            marginBottom: 5,
            color: COLOR_MUTED,
            fontWeight: 600,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

/** Label-over-value tile. Numbers use tabular figures so columns line up. */
function Stat({
  label,
  value,
  title,
  labelStyle,
  valueStyle,
  accent = false,
  text = false,
  rawLabel = false,
}: {
  label: string;
  value: string;
  title?: string;
  labelStyle: CSSProperties;
  valueStyle: CSSProperties;
  accent?: boolean;
  text?: boolean;
  /** Keep the label's own casing (property names, symbols like χ). */
  rawLabel?: boolean;
}) {
  return (
    <div
      title={title}
      style={{
        minWidth: 0,
        padding: '4px 6px 5px',
        borderRadius: 7,
        background: accent ? 'rgba(125, 211, 252, 0.10)' : COLOR_TILE,
        border: `1px solid ${accent ? 'rgba(125, 211, 252, 0.35)' : COLOR_TILE_BORDER}`,
      }}
    >
      <div
        style={{
          ...labelStyle,
          color: accent ? COLOR_ACCENT : COLOR_MUTED,
          fontWeight: 600,
          letterSpacing: rawLabel ? '0.02em' : '0.05em',
          textTransform: rawLabel ? 'none' : 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
      <div
        style={{
          ...valueStyle,
          marginTop: 1,
          color: accent ? '#eef9ff' : COLOR_TEXT,
          fontFamily: text ? FONT_SANS : FONT_MONO,
          fontWeight: text ? 600 : 500,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function KeyValueRow({
  label,
  value,
  labelStyle,
  valueStyle,
}: {
  label: string;
  value: string;
  labelStyle: CSSProperties;
  valueStyle: CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
      <span
        style={{
          ...labelStyle,
          flex: '0 0 auto',
          color: COLOR_ACCENT,
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        title={value}
        style={{
          ...valueStyle,
          minWidth: 0,
          color: '#eef9ff',
          fontWeight: 600,
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Chip({ children, scale }: { children: ReactNode; scale: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 999,
        border: `1px solid ${COLOR_TILE_BORDER}`,
        background: COLOR_TILE,
        color: COLOR_MUTED,
        fontFamily: FONT_MONO,
        fontSize: 9.5 * scale,
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function getPropertyRows(frame: Frame, atomIndex: number, activeProperty?: string) {
  const rows: Array<{ name: string; value: number }> = [];
  const add = (name: string) => {
    const values = frame.properties.get(name);
    if (!values || values.length <= atomIndex) return;
    if (rows.some(row => row.name === name)) return;
    rows.push({ name, value: values[atomIndex] });
  };

  if (activeProperty) add(activeProperty);
  frame.properties.forEach((_values, name) => add(name));
  return rows.slice(0, MAX_PROPERTY_ROWS);
}

function getKnowledgeRows(labels: KnowledgeLabel[], frame: Frame, atomIndex: number): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const sphereId = frame.properties.get('sphere_id')?.[atomIndex];
  const kind = frame.properties.get('kind')?.[atomIndex];
  const radius = frame.properties.get('radius')?.[atomIndex];

  const nodeLabel = labels.find((l) => l.kind === 'node' && l.atomIndex === atomIndex);
  if (nodeLabel) {
    // Named key node: show its type, name, and connection count first.
    rows.push({ label: nodeLabel.nodeKind ?? 'node', value: nodeLabel.text });
    if (typeof nodeLabel.degree === 'number') {
      rows.push({ label: 'connections', value: String(nodeLabel.degree) });
    }
  } else if (typeof kind === 'number' || typeof kind === 'string') {
    rows.push({ label: 'kind', value: String(kind) });
  }

  if (typeof sphereId === 'number' || typeof sphereId === 'string') {
    const sphereLabel = labels.find(
      (l) =>
        l.kind === 'sphere' &&
        (l.sphereIndex === Number(sphereId) || l.sphereId === String(sphereId)),
    );
    if (sphereLabel) {
      rows.push({ label: 'sphere', value: sphereLabel.text });
    }
  }

  if (typeof radius === 'number') {
    rows.push({ label: 'radius', value: radius.toFixed(3) });
  }

  return rows.slice(0, MAX_KNOWLEDGE_ROWS);
}

/** Format a node id/path for display: keep the last meaningful segment and
 *  truncate very long paths so the HUD stays compact. */
function formatNodePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const cleaned = path.replace(/^[a-z]+:\/\//i, '').replace(/^\//, '');
  if (cleaned.length <= 42) return cleaned;
  const parts = cleaned.split('/');
  const file = parts.pop() ?? '';
  const dir = parts.join('/');
  if (file.length > 38) return `…/${file.slice(0, 36)}…`;
  const prefix = dir.slice(0, 40 - file.length - 4);
  return `${prefix}…/${file}`;
}

/** Two decimals with a typographic minus, and no "-0.00". */
function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  const fixed = value.toFixed(2);
  if (fixed === '-0.00') return '0.00';
  return fixed.replace('-', '−');
}

function formatPropertyValue(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs < 0.001 || abs >= 100000) return value.toExponential(2);
  if (abs < 1) return value.toFixed(4);
  return value.toFixed(3);
}
