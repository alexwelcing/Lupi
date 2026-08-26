/**
 * Settings persistence tests. This jsdom environment does NOT provide
 * window.localStorage (see the pre-existing analytics.test.ts failure), so each
 * test installs a fresh in-memory stub and removes it afterwards.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SETTINGS_STORAGE_KEY,
  buildStateDelta,
  initSettingsPersistence,
  rehydrateSettingsFromStorage,
} from './store';
import { resetStore, getStoreState } from './test-utils';

function installLocalStorageStub() {
  const data = new Map<string, string>();
  const stub: Storage = {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
  };
  Object.defineProperty(window, 'localStorage', { value: stub, configurable: true, writable: true });
}

function readStoredRecord(): { persist: boolean; delta: Record<string, unknown> } | null {
  const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe('Store — settings persistence', () => {
  let stopPersistence: (() => void) | null = null;

  beforeEach(() => {
    resetStore();
    installLocalStorageStub();
  });

  afterEach(() => {
    stopPersistence?.();
    stopPersistence = null;
    vi.useRealTimers();
    // jsdom here has no localStorage of its own — remove the stub entirely.
    delete (window as { localStorage?: Storage }).localStorage;
  });

  it('rehydrates whitelisted fields from a seeded storage record', () => {
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ persist: true, delta: { spd: 2, bonds: 1, pp: 'cinematic' } }),
    );

    expect(rehydrateSettingsFromStorage()).toBe(true);
    expect(getStoreState().playbackSpeed).toBe(2);
    expect(getStoreState().showBonds).toBe(true);
    expect(getStoreState().postprocessPreset).toBe('cinematic');
  });

  it('writes the delta to storage when a whitelisted field changes (debounced)', () => {
    vi.useFakeTimers();
    stopPersistence = initSettingsPersistence();

    getStoreState().setPlaybackSpeed(4);
    vi.advanceTimersByTime(300);

    const stored = readStoredRecord();
    expect(stored).not.toBeNull();
    expect(stored!.persist).toBe(true);
    expect(stored!.delta.spd).toBe(4);
  });

  it('keeps persistSettings itself out of the delta keys', () => {
    getStoreState().setPlaybackSpeed(4);
    const delta = buildStateDelta(getStoreState());
    expect(delta).not.toHaveProperty('persistSettings');
    expect(delta).not.toHaveProperty('persist');
  });

  it('writes nothing when persistSettings is off, and removes the key', () => {
    vi.useFakeTimers();
    stopPersistence = initSettingsPersistence();
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ persist: true, delta: {} }));

    getStoreState().setPersistSettings(false);
    expect(getStoreState().persistSettings).toBe(false);
    expect(window.localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();

    getStoreState().setPlaybackSpeed(8);
    vi.advanceTimersByTime(300);
    expect(window.localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it('resetSettings restores DEFAULTS and clears the storage key', () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ persist: true, delta: { spd: 4 } }));
    getStoreState().setPlaybackSpeed(4);
    getStoreState().setPostprocessPreset('cinematic');
    getStoreState().toggleBonds();

    getStoreState().resetSettings();

    expect(getStoreState().playbackSpeed).toBe(1.0);
    expect(getStoreState().postprocessPreset).toBe('studio');
    expect(getStoreState().showBonds).toBe(false);
    expect(window.localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    // The persistence toggle itself is not part of the reset whitelist.
    expect(getStoreState().persistSettings).toBe(true);
  });

  it('ignores corrupt stored JSON', () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, 'not-json{{{');

    expect(rehydrateSettingsFromStorage()).toBe(false);
    expect(getStoreState().playbackSpeed).toBe(1.0);
    expect(getStoreState().postprocessPreset).toBe('studio');
  });

  it('respects an opted-out stored record', () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ persist: false, delta: { spd: 4 } }));
    expect(rehydrateSettingsFromStorage()).toBe(false);
    expect(getStoreState().playbackSpeed).toBe(1.0);
  });
});
