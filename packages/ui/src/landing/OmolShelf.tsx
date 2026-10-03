import { useContext, useMemo, useState } from 'react';
import {
  OMOL25_ATTRIBUTION_URL,
  OMOL25_PAPER_URL,
  omol25Collection,
  omolBondTruth,
  omolChargeSpin,
} from '@atlas/core/omol25';
import { LandingIntentContext } from './landingIntent';
import { lightInkTile } from './MoleculeFinder';
import {
  OMOL_PICK_FAILURE,
  OMOL_SURPRISE_FAILURE,
  omolPickDetail,
  omolPickHref,
  omolPickMark,
  omolPickTitle,
  openOmolPick,
  openOmolSurprise,
  todaysOmolPicks,
  type OmolPick,
} from './omolShelf';
import './omol-shelf.css';

const NEUTRAL_TRAIN_ROWS = omol25Collection('neutral-train').sourceRows;
const MILLIONS = (NEUTRAL_TRAIN_ROWS / 1_000_000).toFixed(1);

function saveData(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData);
}

function plainClick(event: React.MouseEvent): boolean {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0);
}

function chargeChip(pick: OmolPick): string | null {
  if (pick.charge === 0 && pick.spinMultiplicity === 1) return null;
  return omolChargeSpin({ totalCharge: pick.charge, spinMultiplicity: pick.spinMultiplicity, source: 'record' });
}

/**
 * The home page's OMol25 shelf, directly after the hero: six featured picks
 * a day from bundled same-origin data, drawn as ink tiles. Rendered at once
 * (no fetch, so nothing shifts), still at idle, zero canvases. Tiles are
 * plain links to the viewer; a plain click opens the pick in place.
 */
export function OmolShelf() {
  const intent = useContext(LandingIntentContext);
  const picks = useMemo(() => todaysOmolPicks(), []);
  const [textOnly] = useState(saveData);
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const [opening, setOpening] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // `failed` is this shelf's own sentence; the loader's raw message stays out of the page.
  const run = (key: string, failed: string, open: () => Promise<{ ok: boolean; message?: string }>) => {
    if (opening) return;
    setOpening(key);
    setFailure(null);
    open()
      .then((result) => {
        if (!result.ok && !/superseded/i.test(result.message ?? '')) setFailure(failed);
      })
      .catch(() => setFailure(failed))
      .finally(() => setOpening(null));
  };

  return (
    <section className="omol-shelf student-width" aria-labelledby="omol-shelf-title">
      <p className="omol-shelf__eyebrow">
        OMol25 · Meta FAIR Chemistry · CC BY 4.0
        <span className="omol-shelf__credits">
          <a href={OMOL25_PAPER_URL} target="_blank" rel="noreferrer">
            Paper ↗
          </a>
          <a href={OMOL25_ATTRIBUTION_URL} target="_blank" rel="noreferrer">
            Source ↗
          </a>
        </span>
      </p>
      <h2 id="omol-shelf-title">From Open Molecules 2025</h2>
      <p className="omol-shelf__deck">{MILLIONS} million DFT structures to explore. Today’s six picks.</p>
      <ul className="omol-shelf__tiles">
        {picks.map((pick) => {
          const chip = chargeChip(pick);
          const showInk = !textOnly && !broken.has(pick.id);
          return (
            <li key={pick.id}>
              <a
                className="omol-tile"
                href={omolPickHref(pick)}
                aria-busy={opening === pick.id || undefined}
                onClick={(event) => {
                  if (!plainClick(event)) return;
                  event.preventDefault();
                  lightInkTile(event.currentTarget);
                  run(pick.id, OMOL_PICK_FAILURE, () => openOmolPick(pick, 'home-shelf', intent.prefetchViewer));
                }}
              >
                {showInk ? (
                  <img
                    className="ink-tile"
                    src={pick.ink}
                    alt=""
                    width="88"
                    height="88"
                    loading="lazy"
                    decoding="async"
                    onError={() => setBroken((previous) => new Set(previous).add(pick.id))}
                  />
                ) : (
                  <span className="omol-tile__mark" aria-hidden="true">
                    {omolPickMark(pick)}
                  </span>
                )}
                <span className="omol-tile__text">
                  <strong>{omolPickTitle(pick)}</strong>
                  <small>{omolPickDetail(pick)}</small>
                  {chip && <span className="omol-tile__chip">{chip}</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <p className="omol-shelf__actions">
        <a className="student-secondary" href="/library/omol25">
          Browse OMol25 <span aria-hidden="true">→</span>
        </a>
        <a
          className="student-secondary"
          href="/library/random"
          aria-busy={opening === 'surprise' || undefined}
          onClick={(event) => {
            if (!plainClick(event)) return;
            event.preventDefault();
            run('surprise', OMOL_SURPRISE_FAILURE, () => openOmolSurprise('home-surprise', intent.prefetchViewer));
          }}
        >
          Surprise me <small>one of {NEUTRAL_TRAIN_ROWS.toLocaleString('en-US')}</small>
        </a>
        <a className="student-secondary" href="/library/omol25?view=facets">
          Filter by element <span aria-hidden="true">→</span>
        </a>
      </p>
      {opening && (
        <p className="omol-shelf__status" role="status">
          Opening…
        </p>
      )}
      {failure && (
        <p className="finder-error" role="alert">
          {failure}
        </p>
      )}
      <p className="omol-shelf__caption">{omolBondTruth()}</p>
    </section>
  );
}
