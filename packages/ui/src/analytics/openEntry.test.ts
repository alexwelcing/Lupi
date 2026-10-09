import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPEN_ENTRY_STORAGE_KEY, OPEN_ENTRY_TTL_MS, markOpenEntry, takeOpenEntry } from './openEntry';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('openEntry', () => {
  it('hands the mark to the next load once', () => {
    markOpenEntry('home-shelf', 1_000);
    expect(JSON.parse(sessionStorage.getItem(OPEN_ENTRY_STORAGE_KEY)!)).toEqual({ entry: 'home-shelf', at: 1_000 });
    expect(takeOpenEntry(1_500)).toBe('home-shelf');
    expect(takeOpenEntry(1_600)).toBeNull();
  });

  it('expires after 30 s', () => {
    expect(OPEN_ENTRY_TTL_MS).toBe(30_000);
    markOpenEntry('finder', 0);
    expect(takeOpenEntry(30_000)).toBe('finder');
    markOpenEntry('finder', 0);
    expect(takeOpenEntry(30_001)).toBeNull();
    expect(sessionStorage.getItem(OPEN_ENTRY_STORAGE_KEY)).toBeNull();
  });

  it('ignores junk and survives blocked storage', () => {
    sessionStorage.setItem(OPEN_ENTRY_STORAGE_KEY, JSON.stringify({ entry: 'banner', at: 0 }));
    expect(takeOpenEntry(1)).toBeNull();
    sessionStorage.setItem(OPEN_ENTRY_STORAGE_KEY, '{not json');
    expect(takeOpenEntry(1)).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => markOpenEntry('palette')).not.toThrow();
    expect(takeOpenEntry()).toBeNull();
  });
});
