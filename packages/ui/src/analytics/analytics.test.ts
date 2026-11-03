// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_EVENTS } from './events';

let moduleRun = 0;
type MemoryAudience = { version: number; storage: string; track: ReturnType<typeof vi.fn> };
const audienceWindow = window as Window & { audience?: MemoryAudience };
function preference(name: string, value: unknown) { Object.defineProperty(navigator, name, { configurable: true, value }); }
async function freshModules() {
  // Vitest resets modules; Bun's compatible test runner uses query-keyed imports.
  if (typeof vi.resetModules === 'function') {
    vi.resetModules();
    return { ...await import('./session'), ...await import('./track') };
  }
  const suffix = ++moduleRun;
  return { ...await import(`./session?memory-test=${suffix}`), ...await import(`./track?memory-test=${suffix}`) };
}
function installAudience(): MemoryAudience {
  const audience = { version: 2, storage: 'memory', track: vi.fn() };
  audienceWindow.audience = audience;
  return audience;
}
beforeEach(() => {
  audienceWindow.audience = undefined;
  preference('globalPrivacyControl', false);
  preference('doNotTrack', '0');
  preference('userActivation', { hasBeenActive: false });
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  // Clear any module's pending listener without replaying a previous test's event.
  preference('globalPrivacyControl', true);
  window.dispatchEvent(new Event('lupi:audience-ready'));
  audienceWindow.audience = undefined;
  vi.restoreAllMocks();
});

describe('cookieless compatibility context', () => {
  it('keeps IDs only in memory and never consults browser storage or query values', async () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('No analytics storage reads'); });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('No analytics storage writes'); });
    window.history.replaceState({}, '', '/?utm_source=private@example.com&utm_campaign=secret');
    const { ensureAnalyticsSession, getAnalyticsContext } = await freshModules();
    ensureAnalyticsSession();
    const first = getAnalyticsContext(), second = getAnalyticsContext();
    expect(first.sid).toBe(second.sid);
    expect(first.sid).not.toBe('unknown');
    expect(first.utm).toEqual({});
    expect(first.isReturning).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('starts a new context after reload and rotates after30 minutes inactivity', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const first = await freshModules();
    const initial = first.getAnalyticsContext().sid;
    clock.mockReturnValue(1_000_000 + 29 * 60_000);
    expect(first.getAnalyticsContext().sid).toBe(initial);
    clock.mockReturnValue(1_000_000 + 59 * 60_000);
    expect(first.getAnalyticsContext().sid).not.toBe(initial);
    const reloaded = await freshModules();
    expect(reloaded.getAnalyticsContext().sid).not.toBe(first.getAnalyticsContext().sid);
    expect(reloaded.getAnalyticsContext().isReturning).toBe(false);
  });

  it('does not initialize a context when browser privacy preferences disallow analytics', async () => {
    preference('globalPrivacyControl', true);
    const { getAnalyticsContext } = await freshModules();
    expect(getAnalyticsContext().sid).toBe('unknown');
    expect(getAnalyticsContext().utm).toEqual({});
  });
});

describe('explicit product action bridge', () => {
  it('forwards only the action name and never sends legacy payloads or arbitrary properties', async () => {
    const audience = installAudience();
    const beacon = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
    const legacyFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No direct analytics fetch'));
    const { track } = await freshModules();
    track(ANALYTICS_EVENTS.VIEW_SAVED, { email: 'private@example.com', token: 'secret', atoms: 42, query: 'private search' });
    expect(audience.track).toHaveBeenCalledTimes(1);
    expect(audience.track).toHaveBeenCalledWith('view_saved');
    expect(beacon).not.toHaveBeenCalled();
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it('does not turn landing, autoload, retention or diagnostics into engaged feature actions', async () => {
    const audience = installAudience();
    const { track } = await freshModules();
    for (const event of [ANALYTICS_EVENTS.APP_LANDED, ANALYTICS_EVENTS.MOLECULE_LOADED, ANALYTICS_EVENTS.RETURN_ACTIVE, ANALYTICS_EVENTS.RENDER_FAILED, ANALYTICS_EVENTS.SCAN_IDENTIFIED]) track(event);
    expect(audience.track).not.toHaveBeenCalled();
    track(ANALYTICS_EVENTS.MOLECULE_INTERACTED);
    track(ANALYTICS_EVENTS.SCAN_STARTED);
    expect(audience.track.mock.calls.map((call) => call[0])).toEqual(['molecule_interacted', 'scan_started']);
  });

  it('filters automatic library result hydration and never forwards search content', async () => {
    const audience = installAudience();
    const { track } = await freshModules();
    track(ANALYTICS_EVENTS.LIBRARY_SEARCHED, { hasQuery: false, elementCount: 0 });
    track(ANALYTICS_EVENTS.LIBRARY_SEARCHED, { hasQuery: true, query: 'private query' });
    expect(audience.track).not.toHaveBeenCalled();
    preference('userActivation', { hasBeenActive: true });
    track(ANALYTICS_EVENTS.LIBRARY_SEARCHED, { hasQuery: true, query: 'private query' });
    expect(audience.track).toHaveBeenCalledTimes(1);
    expect(audience.track).toHaveBeenCalledWith('library_searched');
  });

  it('buffers bounded names until the tracker is ready without creating a conflicting window global', async () => {
    const { track } = await freshModules();
    for (let i = 0; i < 40; i++) track(ANALYTICS_EVENTS.VIEW_SAVED, { email: 'never queued' });
    expect(audienceWindow.audience).toBeUndefined();
    const audience = installAudience();
    window.dispatchEvent(new Event('lupi:audience-ready'));
    expect(audience.track).toHaveBeenCalledTimes(32);
    expect(audience.track.mock.calls.every((call) => call.length === 1 && call[0] === 'view_saved')).toBe(true);
    window.dispatchEvent(new Event('lupi:audience-ready'));
    expect(audience.track).toHaveBeenCalledTimes(32);
  });

  it('discards queued actions after30 seconds instead of attributing them to a later visit', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { track } = await freshModules();
    track(ANALYTICS_EVENTS.VIEW_SAVED);
    clock.mockReturnValue(1_030_001);
    const audience = installAudience();
    window.dispatchEvent(new Event('lupi:audience-ready'));
    expect(audience.track).not.toHaveBeenCalled();
  });

  it('honors GPC and DNT even when the tracker is available, and drops pending actions on privacy changes', async () => {
    const { track } = await freshModules();
    track(ANALYTICS_EVENTS.VIEW_SAVED);
    preference('doNotTrack', '1');
    const audience = installAudience();
    window.dispatchEvent(new Event('lupi:audience-ready'));
    track(ANALYTICS_EVENTS.VIEW_SHARED);
    expect(audience.track).not.toHaveBeenCalled();
    preference('doNotTrack', '0');
    preference('globalPrivacyControl', true);
    track(ANALYTICS_EVENTS.SIGNUP_START);
    expect(audience.track).not.toHaveBeenCalled();
  });

  it('does not use older persistent trackers and swallows analytics implementation failures', async () => {
    const persistent = { version: 1, storage: 'persistent', track: vi.fn() };
    audienceWindow.audience = persistent;
    const { track } = await freshModules();
    track(ANALYTICS_EVENTS.VIEW_SAVED);
    expect(persistent.track).not.toHaveBeenCalled();
    const audience = installAudience();
    audience.track.mockImplementation(() => { throw new Error('Tracker failed'); });
    expect(() => track(ANALYTICS_EVENTS.VIEW_SAVED)).not.toThrow();
  });
});
