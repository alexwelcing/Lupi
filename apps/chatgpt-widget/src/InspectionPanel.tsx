import { getElementSpec } from '@atlas/core/elements';
import type { MoleculeCard } from './toolResult';
import { inspectionDetails, PAIR_LABEL, type InspectionTarget } from './inspection';

export function InspectionPanel({ card, target, pinned, onPin }: {
  card: MoleculeCard; target: InspectionTarget | null; pinned: boolean;
  onPin: (target: InspectionTarget | null) => void;
}) {
  const details = inspectionDetails(card, target);
  return <section className="inspection-panel" aria-label="Atom and bond inspection" data-inspected-kind={details?.kind ?? ''} data-inspected-id={details?.kind === 'atom' ? details.atomId : ''} data-pinned={pinned}>
    <div className="inspection-toolbar">
      <label>Inspect atom <select aria-label="Inspect atom" value={pinned && target?.kind === 'atom' ? target.index : ''} onChange={(e) => onPin(e.target.value === '' ? null : { kind: 'atom', index: Number(e.target.value) })}>
        <option value="">Choose an atom</option>
        {card.molecule.atoms.ids.map((id, index) => <option key={id} value={index}>{getElementSpec(card.molecule.atoms.elements[index]).symbol} · {id}</option>)}
      </select></label>
      {pinned && <button type="button" onClick={() => onPin(null)}>Close details</button>}
    </div>
    <div className="inspection-body" aria-live={pinned ? 'polite' : 'off'}>
      {!details ? <p>Hover over an atom or bond for details. Tap to pin, or choose an atom above.</p> : <>
        <strong>{details.title}</strong><span className="inspection-label">{details.label}{pinned ? ' · pinned' : ' · tap the object to pin'}</span>
        {details.kind === 'atom' ? <>
          <p>Atomic number {details.atomicNumber} · {details.atomIdKind === 'synthetic-row' ? 'ID generated from row order' : 'PubChem source atom ID'}</p>
          <p className="inspection-coordinates">x {details.coordinates[0].toFixed(3)} · y {details.coordinates[1].toFixed(3)} · z {details.coordinates[2].toFixed(3)} {details.coordinateUnits === 'angstrom' ? 'Å' : '(2D depiction units, not distances)'}</p>
          <div className="inspection-neighbors">{details.neighbors.length ? details.neighbors.map((n) => <button key={n.pairIndex} type="button" disabled={!pinned} onClick={() => onPin({ kind: 'bond', index: n.pairIndex })} title={`${PAIR_LABEL[n.kind]} to ${n.symbol} ${n.atomId}`}>
            {n.symbol} {n.atomId} · {n.kind === 'ionicContact' ? 'ionic contact' : n.kind === 'coordination' ? 'coordination' : n.kind === 'source' ? `source order ${n.sourceOrder}` : 'covalent'}{n.distance === null ? '' : ` · ${n.distance.toFixed(3)} Å`}
          </button>) : <span>No connections in this view’s graph.</span>}</div>
        </> : <>
          <p>{details.distance === null ? '2D depiction: no physical bond length.' : `Length ${details.distance.toFixed(3)} Å`}{details.sourceOrder === null ? ' · bond order not estimated' : ` · source bond order code ${details.sourceOrder}`}</p>
          {details.bondKind === 'ionicContact' && <p>An ionic contact is not a covalent bond.</p>}
        </>}
        <p className="inspection-provenance">{details.provenance}</p>
      </>}
    </div>
  </section>;
}
