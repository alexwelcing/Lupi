/**
 * intake.ts — a shared replay arriving by link (`?replay=…`).
 *
 * Read once as the viewer boots: the tape goes to the replay store as
 * `pending`, and the parameter leaves the address bar (replaceState), so a
 * reload, Back, or a link the visitor shares later does not replay the
 * sender's moment again. The molecule itself still opens from `sim`, `load`,
 * `molecule` or a saved view's route, exactly as it would without a replay.
 */
import { replayStore } from './replayStore';
import { decodeTape, isToyEvent } from './tape';

export const REPLAY_PARAM = 'replay';

let intakeFailed = false;

/** True once if the link carried a replay this build could not read. */
export function consumeIntakeFailure(): boolean {
  const failed = intakeFailed;
  intakeFailed = false;
  return failed;
}

/** Take `?replay=` from the address bar into the replay store (idempotent). */
export function intakeReplayParam(): boolean {
  if (typeof window === 'undefined') return false;
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return false;
  }
  const token = url.searchParams.get(REPLAY_PARAM);
  if (token === null) return false;
  url.searchParams.delete(REPLAY_PARAM);
  try {
    window.history.replaceState(window.history.state, '', url);
  } catch {
    /* sandboxed: the parameter stays, harmlessly */
  }
  const tape = decodeTape(token);
  if (!tape) {
    intakeFailed = true;
    return false;
  }
  replayStore.getState().setIncoming({ tape, phase: 'pending', toys: tape.events.some(isToyEvent) });
  return true;
}
