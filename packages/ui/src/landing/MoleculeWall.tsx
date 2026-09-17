import { useState } from 'react';
import { LOCAL_MOLECULES, type LocalMolecule } from './moleculeIndex';
import { openLocalMolecule } from './MoleculeFinder';

const FIRST_PAGE = 48;

function atomsLabel(atoms: number): string {
  if (atoms >= 1_000_000) return `${(atoms / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (atoms >= 1000) return `${Math.round(atoms / 1000)}k`;
  return atoms ? String(atoms) : '';
}

/**
 * Dense wall of every molecule that opens with one click. Tiles are plain
 * links (`/?sim=<id>`) so they work before hydration and in crawlers, but a
 * click loads in place so the viewer takes over without a full navigation.
 */
export function MoleculeWall() {
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const shown = expanded ? LOCAL_MOLECULES : LOCAL_MOLECULES.slice(0, FIRST_PAGE);

  const open = (event: React.MouseEvent<HTMLAnchorElement>, molecule: LocalMolecule) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (opening) return;
    setOpening(molecule.id);
    openLocalMolecule(molecule.id).catch(() => undefined).finally(() => setOpening(null));
  };

  return (
    <section id="molecules" className="wall student-width" aria-labelledby="wall-title">
      <div className="wall-head">
        <h2 id="wall-title">Or just click one.</h2>
        <p role="status">
          {LOCAL_MOLECULES.length} molecules and materials · sized from a few atoms to a million
        </p>
      </div>
      <ul className="wall-grid">
        {shown.map((molecule) => (
          <li key={molecule.id}>
            <a
              href={`/?sim=${encodeURIComponent(molecule.id)}`}
              aria-label={`Open ${molecule.title}`}
              aria-busy={opening === molecule.id}
              onClick={(event) => open(event, molecule)}
              title={molecule.subtitle}
            >
              {molecule.image ? (
                <img src={molecule.image} alt="" width="48" height="48" loading="lazy" decoding="async" />
              ) : (
                <span
                  className="wall-mark"
                  aria-hidden="true"
                  style={{ background: `linear-gradient(135deg, ${molecule.colors[0]}, ${molecule.colors[1]})` }}
                >
                  {molecule.title.slice(0, 1)}
                </span>
              )}
              <span className="wall-text">
                <strong>{molecule.title}</strong>
                <small>
                  {molecule.formula ?? molecule.domain}
                  {molecule.atoms ? ` · ${atomsLabel(molecule.atoms)}` : ''}
                </small>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {!expanded && LOCAL_MOLECULES.length > FIRST_PAGE && (
        <button type="button" className="student-secondary wall-more" onClick={() => setExpanded(true)}>
          Show all {LOCAL_MOLECULES.length}
        </button>
      )}
    </section>
  );
}
