import type { MoleculeHit, MoleculeSourceId } from '../molecules/types';

export const SOURCE_LABEL: Record<MoleculeSourceId, string> = {
  gallery: 'Lupi gallery',
  research: 'Zenodo research',
  nist: 'NIST potential',
  saved: 'Saved view',
  pubchem: 'PubChem',
  omol: 'OMol25',
  library: 'Library',
  social: 'Social QR',
};

/**
 * One sentence about where the coordinates come from and what the viewer
 * adds. This is the contract's core rule made visible: the card never lets a
 * viewer inference read as dataset truth. Pure over the hit so it is testable.
 */
export function describeHitTruth(hit: MoleculeHit): string {
  switch (hit.source) {
    case 'omol':
      return 'Source DFT coordinates. OMol25 supplies no bonds; any bond lines are a viewer guide.';
    case 'research':
      return hit.load.kind === 'url' && hit.load.atomTypeMap
        ? 'Source file streamed from Zenodo with a catalog element map.'
        : 'Source file streamed from Zenodo. LAMMPS type IDs stay opaque unless a map exists.';
    case 'nist':
      return hit.load.kind === 'url'
        ? 'NIST demo trajectory computed with this potential.'
        : 'No demo trajectory. Opens a procedural crystal built in the viewer, not NIST data.';
    case 'pubchem':
      return 'PubChem record with its own connection table as source bonds.';
    case 'gallery':
      return 'Curated Lupi coordinate file. Bond lines are distance-inferred guides.';
    case 'saved':
      return 'Your saved view, reopened from its original source.';
    case 'library':
      return 'Library entry resolved through its recorded load path.';
    case 'social':
      return 'Social QR archive authored as atoms and bonds.';
    default:
      return '';
  }
}

export function provenanceLine(hit: MoleculeHit): string | null {
  if (!hit.provenance) return null;
  const host = (() => {
    try {
      return new URL(hit.provenance.sourceUrl).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  })();
  return [host, hit.provenance.doi, hit.provenance.license].filter(Boolean).join(' · ');
}

export function LibraryCard({
  hit,
  busy,
  onOpen,
  activeElements = [],
}: {
  hit: MoleculeHit;
  busy: boolean;
  onOpen: (hit: MoleculeHit) => void;
  activeElements?: string[];
}) {
  const provenance = provenanceLine(hit);
  return (
    <article className={`library-card library-card--${hit.source}`}>
      <button type="button" onClick={() => onOpen(hit)} disabled={busy} aria-busy={busy} aria-label={`Open ${hit.title}`}>
        <span className="library-card-head">
          <h3>{hit.title}</h3>
          <span className="library-badge">{SOURCE_LABEL[hit.source]}</span>
        </span>
        {hit.subtitle && <span className="library-card-subtitle">{hit.subtitle}</span>}
        {hit.elements && hit.elements.length > 0 && (
          <span className="library-elements" aria-label="Elements">
            {hit.elements.slice(0, 10).map((symbol) => (
              <span key={symbol} className={activeElements.includes(symbol) ? 'is-active' : undefined}>
                {symbol}
              </span>
            ))}
            {hit.elements.length > 10 && <span>+{hit.elements.length - 10}</span>}
          </span>
        )}
        {provenance && (
          <span className="library-provenance" title={hit.provenance?.citation}>
            {provenance}
          </span>
        )}
        {hit.notice && <span className="library-notice">{hit.notice}</span>}
        <span className="library-truth">{describeHitTruth(hit)}</span>
        {busy && <span className="library-card-busy">Opening…</span>}
      </button>
    </article>
  );
}
