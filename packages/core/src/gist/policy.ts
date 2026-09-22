import { GIST_KEEP_MOVE, GIST_PROPORTION_MOVES } from './moves';

/**
 * The decision rule between a Jev answer and the shape, shared by the
 * browser loop and the Node bench so both sculpt the same way.
 *
 * Measured on 2026-09-22 against the live model: Jev picks the right move
 * from the first call but a nine-way Choice spreads probability, so the
 * winner's confidence sits around 0.3 to 0.4 even when it wins every call.
 * Confidence alone is therefore the wrong gate. A move applies when it is
 * confident, or when it wins two consecutive judgments of the same shape.
 * `keep` satisfies the loop the same way: twice in a row, or once with a
 * likeness the model rates high. A large measured mismatch doubles the step
 * of a proportion move so a box does not take ten calls to become a bottle.
 */
export interface SculptAnswer {
  move: { id: string; confidence: number };
  likeness: number | null;
  mismatch: number | null;
}

export interface SculptMemory {
  /** The last non-keep move chosen for the current shape, if any. */
  lastMove: string | null;
  /** Consecutive keeps for the current shape. */
  keeps: number;
  /** Consecutive proportion votes damped because the silhouette already matches. */
  damped?: number;
  /** Votes per move for the current shape; a move applies at two, consecutive or not. */
  votes?: Record<string, number>;
}

/** Votes a move needs for the current shape before it applies without a confident answer. */
export const SCULPT_VOTES_TO_APPLY = 2;

/** This many damped votes in a row mean Jev has nothing structural left to say. */
export const SCULPT_DAMPED_SATISFIED = 3;

export interface SculptVerdict {
  /** Move id to apply now, or null. */
  apply: string | null;
  /** Step multiplier for proportion moves: 1 normally, 2 when far off the photo. */
  strength: number;
  /** True when the loop should stop: the shape reads as the subject. */
  satisfied: boolean;
  memory: SculptMemory;
}

export const SCULPT_CONFIDENCE_GATE = 0.45;
export const SCULPT_LIKENESS_SATISFIED = 0.85;
export const SCULPT_MISMATCH_STRONG = 0.3;
/** Below this measured mismatch a proportion move is noise: the step is coarser than the error
 *  left, and what remains is usually structural (a taper against straight sides), not a width. */
export const SCULPT_MISMATCH_SETTLED = 0.12;
/** At this likeness the shape already reads as the subject; proportion moves need a confident vote. */
export const SCULPT_LIKENESS_READS = 0.8;

export function decideSculpt(answer: SculptAnswer, memory: SculptMemory, gate = SCULPT_CONFIDENCE_GATE): SculptVerdict {
  const { id, confidence } = answer.move;
  const strength = answer.mismatch !== null && answer.mismatch > SCULPT_MISMATCH_STRONG ? 2 : 1;
  if (id === GIST_KEEP_MOVE) {
    const keeps = memory.keeps + 1;
    const satisfied = keeps >= 2 || (answer.likeness !== null && answer.likeness >= SCULPT_LIKENESS_SATISFIED);
    return { apply: null, strength, satisfied, memory: { lastMove: null, keeps } };
  }
  // Once the shape reads as the subject, or its silhouette matches the photo,
  // a proportion vote is more likely to wreck it than improve it.
  const reads = answer.likeness !== null && answer.likeness >= SCULPT_LIKENESS_READS;
  const settledProportion = GIST_PROPORTION_MOVES.includes(id) && (reads || (answer.mismatch !== null && answer.mismatch < SCULPT_MISMATCH_SETTLED));
  if (settledProportion) {
    // The silhouette already matches the photo; only a confident vote moves it now,
    // and a run of damped votes means the shape is as good as this vocabulary gets.
    if (confidence >= gate + 0.2) return { apply: id, strength: 1, satisfied: false, memory: { lastMove: null, keeps: 0 } };
    const damped = (memory.damped ?? 0) + 1;
    return { apply: null, strength, satisfied: damped >= SCULPT_DAMPED_SATISFIED, memory: { ...memory, lastMove: null, damped } };
  }
  // Votes accumulate per move for this shape, so "cap, slim, cap" still lands the cap.
  const votes = { ...(memory.votes ?? {}), [id]: (memory.votes?.[id] ?? 0) + 1 };
  if (confidence >= gate || votes[id] >= SCULPT_VOTES_TO_APPLY) {
    return { apply: id, strength, satisfied: false, memory: { lastMove: null, keeps: 0 } };
  }
  return { apply: null, strength, satisfied: false, memory: { lastMove: id, keeps: 0, damped: memory.damped, votes } };
}
