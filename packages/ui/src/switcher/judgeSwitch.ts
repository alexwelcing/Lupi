import type { PropertyRankJudgment } from '@atlas/core';
import type { SwitchCandidate } from './switchIndex';

/**
 * Ask the edge (and through it, Jev) which candidate best matches the
 * request. The switcher never waits on this: the deterministic list is
 * already on screen, and a judgment only re-orders it. A non-JSON or non-2xx
 * answer means "no judgment". After the edge reports `configured: false`
 * once, the session stops asking.
 */
export interface SwitchJudgment {
  configured: boolean;
  model?: string;
  intent?: { choice: string; confidence: number };
  best?: { key: string; confidence: number } | null;
  fit?: Record<string, number>;
  /** Property ranking ("floats in water", "heaviest metal"), when asked for. */
  rank?: PropertyRankJudgment | null;
}

export const SWITCH_JUDGE_PATH = '/v1/switch/judge';
/** Below this the best pick is shown as a hint only, never moved to the top. */
export const BEST_PICK_THRESHOLD = 0.6;
const JUDGE_TIMEOUT_MS = 3_500;
/** A best pick below the promotion threshold but at or above this is offered as a hint. */
export const HINT_THRESHOLD = 0.3;
/** Candidates whose fit falls below this move to the end; the rest keep the deterministic order. */
export const FIT_DEMOTE_THRESHOLD = 0.35;

let unavailable = false;

export function resetJudgeAvailability(): void {
  unavailable = false;
}

export const MAX_POOL = 160;

/** Local matches first (they get fit probabilities), then the rest of the
 *  gallery pool so Jev can name a molecule the typed text never matched. */
export function buildJudgePool(shown: SwitchCandidate[], pool: SwitchCandidate[]): Array<SwitchCandidate & { fit: boolean }> {
  const seen = new Set<string>();
  const merged: Array<SwitchCandidate & { fit: boolean }> = [];
  for (const candidate of shown) {
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    merged.push({ ...candidate, fit: true });
  }
  for (const candidate of pool) {
    if (merged.length >= MAX_POOL) break;
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    merged.push({ ...candidate, fit: false });
  }
  return merged;
}

export async function judgeSwitch(
  request: {
    query: string;
    elements: string[];
    candidates: Array<SwitchCandidate & { fit?: boolean }>;
    loaded?: { title: string; formula?: string } | null;
    /** Also ask the property-ranking questions for every candidate. */
    rank?: boolean;
  },
  signal?: AbortSignal,
): Promise<SwitchJudgment | null> {
  if (unavailable || typeof fetch !== 'function') return null;
  if (!request.query && request.elements.length === 0) return null;
  if (request.candidates.length === 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(SWITCH_JUDGE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        query: request.query,
        elements: request.elements,
        loaded: request.loaded ?? null,
        rank: request.rank === true && request.query.length > 0 ? true : undefined,
        candidates: request.candidates.slice(0, MAX_POOL).map((candidate) => ({
          key: candidate.key,
          title: candidate.title,
          formula: candidate.formula,
          elements: candidate.elements,
          atoms: candidate.atoms || undefined,
          source: candidate.source,
          fit: candidate.fit || undefined,
          category: candidate.category,
          evidence: request.rank ? candidate.evidence : undefined,
        })),
      }),
    });
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
      unavailable = true;
      return null;
    }
    const payload = (await response.json()) as SwitchJudgment & { error?: string };
    if (payload.configured === false) {
      unavailable = true;
      return { configured: false };
    }
    if (!response.ok) return null;
    return payload;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export interface AppliedJudgment {
  ordered: SwitchCandidate[];
  bestKey: string | null;
  /** A pick Jev leaned toward without enough confidence to promote it. */
  hint: SwitchCandidate | null;
}

/**
 * Apply a judgment, conservatively. A confident best pick leads, even when
 * the typed text never matched it (it is pulled in from the pool). The rest
 * keep their deterministic order; only candidates Jev is fairly sure do not
 * fit move to the end. A best pick below the promotion threshold becomes a
 * hint rather than silently vanishing. Property rankings, facet filters,
 * and sorts are `organize` in `searchPlan.ts`, which runs first. Pure.
 */
export function applyJudgment(candidates: SwitchCandidate[], judgment: SwitchJudgment | null, pool: SwitchCandidate[] = []): AppliedJudgment {
  if (!judgment?.configured) return { ordered: candidates, bestKey: null, hint: null };
  const fit = judgment.fit ?? {};
  const resolve = (key: string) => candidates.find((c) => c.key === key) ?? pool.find((c) => c.key === key) ?? null;
  const confidence = judgment.best?.confidence ?? 0;
  const best = judgment.best && confidence >= BEST_PICK_THRESHOLD ? resolve(judgment.best.key) : null;
  const hint = !best && judgment.best && confidence >= HINT_THRESHOLD ? resolve(judgment.best.key) : null;
  const rest = candidates.filter((c) => c.key !== best?.key);
  const kept = rest.filter((c) => (fit[c.key] ?? 1) >= FIT_DEMOTE_THRESHOLD);
  const demoted = rest.filter((c) => (fit[c.key] ?? 1) < FIT_DEMOTE_THRESHOLD);
  return { ordered: best ? [best, ...kept, ...demoted] : [...kept, ...demoted], bestKey: best ? best.key : null, hint };
}
