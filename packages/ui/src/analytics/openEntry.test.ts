import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_ENTRY_TTL_MS, markOpenEntry, takeOpenEntry, type OpenEntry } from './openEntry';

function preference(name: string, value: unknown) { Object.defineProperty(navigator, name, { configurable: true, value }); }
beforeEach(() => {
  preference('globalPrivacyControl', false);
  preference('doNotTrack', '0');
  takeOpenEntry();
});

afterEach(() => {
  takeOpenEntry();
  vi.restoreAllMocks();
});

describe('openEntry', () => {
  it('hands the mark to the next load once', () => {
    markOpenEntry('home-shelf', 1_000);
    expect(takeOpenEntry(1_500)).toBe('home-shelf');
    expect(takeOpenEntry(1_600)).toBeNull();
  });

  it('expires after 30 s', () => {
    expect(OPEN_ENTRY_TTL_MS).toBe(30_000);
    markOpenEntry('finder', 0);
    expect(takeOpenEntry(30_000)).toBe('finder');
    markOpenEntry('finder', 0);
    expect(takeOpenEntry(30_001)).toBeNull();
    expect(takeOpenEntry(30_002)).toBeNull();
  });

  it('rejects invalid markers, invalid times, and clock reversal', () => {
    markOpenEntry('banner' as OpenEntry, 0);
    expect(takeOpenEntry(1)).toBeNull();
    markOpenEntry('palette', Number.NaN);
    expect(takeOpenEntry(1)).toBeNull();
    markOpenEntry('palette', 1_000);
    expect(takeOpenEntry(999)).toBeNull();
    expect(takeOpenEntry(1_001)).toBeNull();
  });

  it('does not read or write browser storage even when storage throws', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    expect(() => markOpenEntry('palette', 1_000)).not.toThrow();
    expect(takeOpenEntry(1_001)).toBe('palette');
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('honors GPC and DNT and discards a pending hint when privacy is enabled', () => {
    markOpenEntry('finder', 1_000);
    preference('globalPrivacyControl', true);
    expect(takeOpenEntry(1_001)).toBeNull();
    preference('globalPrivacyControl', false);
    expect(takeOpenEntry(1_002)).toBeNull();
    preference('doNotTrack', '1');
    markOpenEntry('palette', 1_003);
    expect(takeOpenEntry(1_004)).toBeNull();
  });

  it('retains only the latest page-local hint', () => {
    markOpenEntry('home-shelf', 1_000);
    markOpenEntry('library', 1_001);
    expect(takeOpenEntry(1_002)).toBe('library');
    expect(takeOpenEntry(1_003)).toBeNull();
  });
});
