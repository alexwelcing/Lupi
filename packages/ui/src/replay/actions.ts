/**
 * actions.ts — the ways into Instant Replay's sheet: the pill's "Replay ↗",
 * the R key and the palette.
 *
 * R (or the palette) opens the offered moment, else the last one (if it is
 * still in the recorder's 20 s), else this view as a still pose link.
 */
import { lastRecordedPose, recorderNow, RECORDER_SECONDS } from './recorder';
import { replayStore, type ReplayMoment } from './replayStore';
import { momentNoun } from './moments';

let viewSeq = 1_000_000;

/** A "this view" moment: the pose on screen now, sent as a still link. */
function viewMoment(): ReplayMoment | null {
  const last = lastRecordedPose();
  if (!last) return null;
  const t = recorderNow();
  viewSeq += 1;
  return {
    id: viewSeq,
    moment: 'view',
    gesture: null,
    t0: t - 0.05,
    t1: t,
    noun: momentNoun('view', null),
    at: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  };
}

/** Open the sheet for the best moment there is; returns what it opened, or null. */
export function openReplaySheet(): ReplayMoment | null {
  const store = replayStore.getState();
  if (store.sheet || store.clipping || store.incoming?.phase === 'playing') return null;
  const t = recorderNow();
  const recent = (moment: ReplayMoment | null) => moment && t - moment.t0 < RECORDER_SECONDS - 1;
  const moment = (recent(store.offer) ? store.offer : null) ?? (recent(store.lastMoment) ? store.lastMoment : null) ?? viewMoment();
  if (!moment) return null;
  store.openSheet(moment);
  return moment;
}
