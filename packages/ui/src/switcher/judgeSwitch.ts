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
}

export const SWITCH_JUDGE_PATH = '/v1/switch/judge';
/** Below this the best pick is shown as a hint only, never moved to the top. */
export const BEST_PICK_THRESHOLD = 0.6;
const JUDGE_TIMEOUT_MS = 2_000;

let unavailable = false;

export function resetJudgeAvailability(): void {
  unavailable = false;
}

export async function judgeSwitch(
  request: { query: string; elements: string[]; candidates: SwitchCandidate[]; loaded?: { title: string; formula?: string } | null },
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
        candidates: request.candidates.slice(0, 40).map((candidate) => ({
          key: candidate.key,
          title: candidate.title,
          formula: candidate.formula,
          elements: candidate.elements,
          atoms: candidate.atoms || undefined,
          source: candidate.source,
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

/** Apply a judgment: a confident best pick leads, the rest sort by fit. Pure. */
export function applyJudgment(candidates: SwitchCandidate[], judgment: SwitchJudgment | null): { ordered: SwitchCandidate[]; bestKey: string | null } {
  if (!judgment?.configured) return { ordered: candidates, bestKey: null };
  const fit = judgment.fit ?? {};
  const bestKey = judgment.best && judgment.best.confidence >= BEST_PICK_THRESHOLD ? judgment.best.key : null;
  const ordered = [...candidates].sort((a, b) => {
    if (bestKey) {
      if (a.key === bestKey) return -1;
      if (b.key === bestKey) return 1;
    }
    return (fit[b.key] ?? -1) - (fit[a.key] ?? -1);
  });
  return { ordered, bestKey: bestKey && ordered.some((c) => c.key === bestKey) ? bestKey : null };
}
