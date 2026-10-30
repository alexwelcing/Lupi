/**
 * Compatibility context for existing UI call sites. IDs live only in module
 * memory: no cookies, browser storage, campaign query values or fingerprints.
 * A reload starts anew; cross-visit returning status cannot be measured.
 */
export type UtmParamName = 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_term' | 'utm_content';
export type UtmParams = Partial<Record<UtmParamName, string>>;
export interface AnalyticsContext {
  readonly sid: string;
  /** Retained for source compatibility; campaigns are not collected. */
  readonly utm: UtmParams;
  /** Compatibility sentinel only. Returning status is unavailable. */
  readonly isReturning: boolean;
  readonly ts: number;
}

let memorySid: string | null = null;
let lastActivity = 0;
const SESSION_MS = 30 * 60 * 1000;

export function analyticsPrivacyBlocked(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return true;
  const preferences = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const legacyWindow = window as Window & { doNotTrack?: string };
  const dnt = String(preferences.doNotTrack || preferences.msDoNotTrack || legacyWindow.doNotTrack || '').toLowerCase();
  return preferences.globalPrivacyControl === true || dnt === '1' || dnt === 'yes';
}

function mintUuid(): string {
  try { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch { /* Fall back to a random, page-local ID. */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const n = Math.floor(Math.random() * 16);
    return (char === 'x' ? n : (n & 3) | 8).toString(16);
  });
}

export function ensureAnalyticsSession(): void {
  if (analyticsPrivacyBlocked()) return;
  const now = Date.now();
  if (!memorySid || now - lastActivity >= SESSION_MS || lastActivity > now + 60_000) memorySid = mintUuid();
  lastActivity = now;
}

export function getAnalyticsContext(): AnalyticsContext {
  ensureAnalyticsSession();
  return { sid: analyticsPrivacyBlocked() ? 'unknown' : memorySid ?? 'unknown', utm: {}, isReturning: false, ts: Date.now() };
}
