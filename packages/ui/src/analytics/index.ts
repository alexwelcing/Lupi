/**
 * Lupi analytics — named actions through the own-host cookieless tracker.
 *
 * Public surface for the rest of the app. Call sites should import from
 * here and stay tiny:
 *
 *   import { track, ANALYTICS_EVENTS } from './analytics';
 *   track(ANALYTICS_EVENTS.VIEW_SAVED, { atoms: count });
 *
 * track.ts forwards only allowlisted semantic event names. Browser storage,
 * campaign values, free-form properties and legacy vendor sinks are not used.
 */

export { ANALYTICS_EVENTS } from './events';
export type { AnalyticsEvent, AnalyticsProps } from './events';
export { track } from './track';
export type { AnalyticsPayload } from './track';
export {
  ensureAnalyticsSession,
  getAnalyticsContext,
} from './session';
export type { AnalyticsContext, UtmParams } from './session';
