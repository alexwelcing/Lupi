/**
 * Bridge existing explicit product actions to Lupi's own cookieless tracker.
 * Only allowlisted event names leave this module. Event properties, identities,
 * query strings, lifecycle notifications and legacy analytics payloads do not.
 */
import { ANALYTICS_EVENTS, type AnalyticsEvent, type AnalyticsProps } from './events';
import { analyticsPrivacyBlocked, type AnalyticsContext } from './session';

export { ANALYTICS_EVENTS };
export type { AnalyticsEvent, AnalyticsProps };

/** Legacy source compatibility only; this payload is no longer constructed or sent. */
export interface AnalyticsPayload {
  readonly event: AnalyticsEvent;
  readonly sid: string;
  readonly ts: number;
  readonly isReturning: boolean;
  readonly utm: AnalyticsContext['utm'];
  readonly props: AnalyticsProps;
  readonly path: string;
}

/** Each entry is an explicit user action or its successful outcome. */
export const AUDIENCE_FEATURES = [
  ANALYTICS_EVENTS.MOLECULE_INTERACTED,
  ANALYTICS_EVENTS.SIGNUP_START,
  ANALYTICS_EVENTS.SIGNUP_COMPLETE,
  ANALYTICS_EVENTS.VIEW_SAVED,
  ANALYTICS_EVENTS.VIEW_SHARED,
  ANALYTICS_EVENTS.VIEW_FORKED,
  ANALYTICS_EVENTS.LIBRARY_SEARCHED,
  ANALYTICS_EVENTS.SCAN_STARTED,
  ANALYTICS_EVENTS.SCAN_MOLECULE_OPENED,
] as const;
export type AudienceFeature = (typeof AUDIENCE_FEATURES)[number];
const FEATURES = new Set<string>(AUDIENCE_FEATURES);
const MAX_PENDING = 32;
const MAX_AGE_MS = 30_000;
const READY_EVENT = 'lupi:audience-ready';
type AudienceTracker = { version: number; storage: string; track(name: AudienceFeature): void };
type Pending = { name: AudienceFeature; at: number };
let pending: Pending[] = [];
let listening = false;

function tracker(): AudienceTracker | undefined {
  const candidate = (window as Window & { audience?: AudienceTracker }).audience;
  return candidate?.version === 2 && candidate.storage === 'memory' && typeof candidate.track === 'function' ? candidate : undefined;
}

function flushPending(): void {
  listening = false;
  const queued = pending;
  pending = [];
  if (analyticsPrivacyBlocked()) return;
  const audience = tracker();
  if (!audience) return;
  const now = Date.now();
  for (const event of queued) {
    if (now - event.at < MAX_AGE_MS) {
      try { audience.track(event.name); } catch { /* Analytics never interrupts the UI. */ }
    }
  }
}

/** `app_landed` is intentionally omitted: the tracker owns page-view deduplication. */
export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  try {
    if (analyticsPrivacyBlocked()) { pending = []; return; }
    if (!FEATURES.has(event)) return;
    if (event === ANALYTICS_EVENTS.LIBRARY_SEARCHED) {
      // Result sets also load automatically. Count an actual query/filter only
      // after user activation, never initial catalogue hydration or pagination.
      const activation = navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } };
      if (activation.userActivation?.hasBeenActive !== true || (props.hasQuery !== true && !(typeof props.elementCount === 'number' && props.elementCount > 0))) return;
    }
    const name = event as AudienceFeature;
    const audience = tracker();
    if (audience) { audience.track(name); return; }
    // The own-host deferred script can finish after an app module. Preserve a
    // small, short-lived queue of names only; do not stub window.audience.
    const now = Date.now();
    pending = pending.filter((item) => now - item.at < MAX_AGE_MS).slice(-(MAX_PENDING - 1));
    pending.push({ name, at: now });
    if (!listening) {
      listening = true;
      window.addEventListener(READY_EVENT, () => { try { flushPending(); } catch { pending = []; listening = false; } }, { once: true });
    }
  } catch { /* Tracking must never break a product action. */ }
}
