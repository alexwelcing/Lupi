import { useCallback, useContext, useMemo, useState } from 'react';
import { OMOL25_ATTRIBUTION_URL, OMOL25_PAPER_URL, omol25Collection, omolChargeSpin } from '@atlas/core/omol25';
import type { OpenEntry } from '../analytics/openEntry';
import { LandingIntentContext } from './landingIntent';
import { lightInkTile } from './MoleculeFinder';
import {
  OMOL_PICK_FAILURE,
  OMOL_SURPRISE_FAILURE,
  omolPickDetail,
  omolPickGeometry,
  omolPickHref,
  omolPickMark,
  omolPickTitle,
  openOmolPick,
  omolShelfTruth,
  openOmolSurprise,
  todaysOmolPicks,
  type OmolPick,
} from './omolPicks';
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

export interface OmolOpener {
  opening: string | null;
  failure: string | null;
  run(key: string, failed: string, open: () => Promise<{ ok: boolean; message?: string }>): void;
}

/** One open at a time; `failed` is the surface's own sentence, so a loader's raw message never shows. */
export function useOmolOpener(): OmolOpener {
  const [opening, setOpening] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const run = useCallback<OmolOpener['run']>(
    (key, failed, open) => {
      if (opening) return;
      setOpening(key);
      setFailure(null);
      open()
        .then((result) => {
          if (!result.ok && !/superseded/i.test(result.message ?? '')) setFailure(failed);
        })
        .catch(() => setFailure(failed))
        .finally(() => setOpening(null));
    },
    [opening],
  );
  return { opening, failure, run };
}

export function OmolOpenerStatus({ opener }: { opener: OmolOpener }) {
  return (
    <>
      <p className="omol-shelf__status" aria-live="polite">
        {opener.opening ? 'Opening…' : ''}
      </p>
      {opener.failure && (
        <p className="finder-error" role="alert">
          {opener.failure}
        </p>
      )}
    </>
  );
}

/**
 * Featured picks as ink tiles: plain links to the viewer with the
 * same-origin file, opened in place on a plain click, each with its geometry
 * state. Save-Data, or a drawing that fails to load, shows the pick's
 * heaviest element instead.
 */
export function OmolPickTiles({
  picks,
  entry,
  opener,
  prefetchViewer,
  label,
}: {
  picks: readonly OmolPick[];
  entry: OpenEntry;
  opener: OmolOpener;
  prefetchViewer?: () => void;
  label?: string;
}) {
  const [textOnly] = useState(saveData);
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <ul className="omol-shelf__tiles" aria-label={label}>
      {picks.map((pick) => {
        const chip = chargeChip(pick);
        const geometry = omolPickGeometry(pick);
        return (
          <li key={pick.id}>
            <a
              className="omol-tile"
              href={omolPickHref(pick)}
              aria-busy={opener.opening === pick.id || undefined}
              onClick={(event) => {
                if (!plainClick(event)) return;
                event.preventDefault();
                lightInkTile(event.currentTarget);
                opener.run(pick.id, OMOL_PICK_FAILURE, () => openOmolPick(pick, entry, prefetchViewer));
              }}
            >
              {!textOnly && !broken.has(pick.id) ? (
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
                {geometry && <small>{geometry}</small>}
                {chip && <span className="omol-tile__chip">{chip}</span>}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The home page's OMol25 shelf, directly after the hero: six featured picks
 * a day from bundled same-origin data, drawn as ink tiles. Rendered at once
 * (no fetch, so nothing shifts), still at idle, zero canvases.
 */
export function OmolShelf() {
  const intent = useContext(LandingIntentContext);
  const picks = useMemo(() => todaysOmolPicks(), []);
  const opener = useOmolOpener();

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
      <OmolPickTiles picks={picks} entry="home-shelf" opener={opener} prefetchViewer={intent.prefetchViewer} />
      <p className="omol-shelf__actions">
        <a className="student-secondary" href="/library/omol25">
          Browse OMol25 <span aria-hidden="true">→</span>
        </a>
        <a
          className="student-secondary"
          href="/library/random"
          aria-busy={opener.opening === 'surprise' || undefined}
          onClick={(event) => {
            if (!plainClick(event)) return;
            event.preventDefault();
            opener.run('surprise', OMOL_SURPRISE_FAILURE, () => openOmolSurprise('home-surprise', intent.prefetchViewer));
          }}
        >
          Surprise me <small>one of {NEUTRAL_TRAIN_ROWS.toLocaleString('en-US')}</small>
        </a>
        <a className="student-secondary" href="/library/omol25?view=facets">
          Filter by element <span aria-hidden="true">→</span>
        </a>
      </p>
      <OmolOpenerStatus opener={opener} />
      <p className="omol-shelf__caption">{omolShelfTruth()}</p>
    </section>
  );
}
