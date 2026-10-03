import { useContext, useEffect, useState } from 'react';
import { LOCAL_MOLECULES, type LocalMolecule } from './moleculeIndex';
import { lightInkTile, openLocalMolecule, previewRectIn } from './MoleculeFinder';
import { LandingIntentContext } from './landingIntent';
import { hasMoleculePage, moleculePagePath } from '../moleculePage/pages';
import { inkTileSrc, preloadInkTiles } from './inkTiles';

const FIRST_PAGE = 48;

function atomsLabel(atoms: number): string {
  if (atoms >= 1_000_000) return `${(atoms / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (atoms >= 1000) return `${Math.round(atoms / 1000)}k`;
  return atoms ? String(atoms) : '';
}

/**
 * Dense wall of every molecule that opens with one click. Tiles are plain
 * links so they work before hydration and in crawlers: to the molecule's own
 * page (`/m/<id>`) when it has one, else the viewer (`/?sim=<id>`). A click
 * loads in place so the viewer takes over without a full navigation, the
 * tile's preview growing into the sage relay stage on the way; a new tab or a
 * copied link gets the page.
 *
 * Ink tiles: a molecule with a page shows its own ink drawing (the /m
 * page's, at its opening pose) on the sage plate. A tap lights it, the relay
 * grows the drawing to the size the 3D view will draw it, and the viewer
 * opens in ink at the same pose before the light comes on (Ink-to-Light).
 */
export function MoleculeWall() {
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const intent = useContext(LandingIntentContext);
  const shown = expanded ? LOCAL_MOLECULES : LOCAL_MOLECULES.slice(0, FIRST_PAGE);
  // The ink tiles' poses arrive at idle, before a tap.
  useEffect(() => preloadInkTiles(), []);

  const open = (event: React.MouseEvent<HTMLAnchorElement>, molecule: LocalMolecule) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (opening) return;
    setOpening(molecule.id);
    // A tap is intent: fetch the viewer while the molecule loads.
    intent.prefetchViewer();
    const ink = inkTileSrc(molecule.id) !== null;
    if (ink) lightInkTile(event.currentTarget);
    // The relay grows the tile's preview (or ink drawing) into the sage stage.
    openLocalMolecule(molecule.id, { source: 'tile', fromRect: previewRectIn(event.currentTarget), ink })
      .catch(() => undefined)
      .finally(() => setOpening(null));
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
              href={hasMoleculePage(molecule.id) ? moleculePagePath(molecule.id) : `/?sim=${encodeURIComponent(molecule.id)}`}
              aria-label={`Open ${molecule.title}`}
              aria-busy={opening === molecule.id}
              onClick={(event) => open(event, molecule)}
              title={molecule.subtitle}
            >
              {inkTileSrc(molecule.id) ? (
                <img className="ink-tile" src={inkTileSrc(molecule.id)!} alt="" width="48" height="48" loading="lazy" decoding="async" />
              ) : molecule.image ? (
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
