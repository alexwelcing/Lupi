/**
 * ElementDetailCard — a compact fact sheet for one element, sourced entirely
 * from ELEMENT_DATA in @atlas/core. Inline styles (MoleculeConfigurator dark
 * palette) keep it independent of the stylesheet.
 */
import { ELEMENT_DATA, type ElementCategory } from '@atlas/core';

/** 'transition-metal' → 'Transition metal'. */
export function humanizeCategory(category: ElementCategory): string {
  const words = category.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface ElementDetailCardProps {
  /** Atomic number. */
  z: number;
}

export function ElementDetailCard({ z }: ElementDetailCardProps) {
  const element = ELEMENT_DATA[z];
  if (!element) return null;

  return (
    <div
      data-testid="element-detail-card"
      style={{
        background: '#121418',
        border: '1px solid #1f2937',
        borderRadius: 10,
        padding: 14,
        color: '#e2e8f0',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          aria-hidden="true"
          style={{
            position: 'relative',
            display: 'grid',
            placeItems: 'center',
            width: 52,
            height: 52,
            flex: '0 0 auto',
            borderRadius: 8,
            background: element.color,
            color: '#06111c',
            fontWeight: 800,
            fontSize: 22,
            boxShadow: `0 0 18px ${element.color}55`,
          }}
        >
          <span style={{ position: 'absolute', top: 3, left: 5, fontSize: 10, fontWeight: 700, opacity: 0.75 }}>
            {z}
          </span>
          {element.symbol}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{element.name}</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
            Group {element.group ?? '—'} · Period {element.period ?? '—'}
          </div>
        </div>
      </div>

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '4px 14px',
          margin: '12px 0 0',
          paddingTop: 10,
          borderTop: '1px solid #1f2937',
          fontSize: 12,
        }}
      >
        <Row label="Category" value={humanizeCategory(element.category)} />
        <Row label="Block" value={`${element.block}-block`} />
        <Row label="Group" value={element.group !== null ? String(element.group) : '—'} />
        <Row label="Period" value={element.period !== null ? String(element.period) : '—'} />
        <Row label="Atomic mass" value={`${element.mass} u`} />
        <Row label="Covalent radius" value={`${element.radius} Å`} />
        <Row label="Display radius" value={`${element.displayRadius} Å`} />
        <Row
          label="Electronegativity (Pauling)"
          value={element.electronegativity !== null ? String(element.electronegativity) : '—'}
        />
        <Row label="Role" value={element.role} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ color: '#64748b', margin: 0 }}>{label}</dt>
      <dd style={{ color: '#e2e8f0', margin: 0, textAlign: 'right' }}>{value}</dd>
    </>
  );
}
