import { describe, expect, it } from 'vitest';
import {
  assertViewerLoadCurrent,
  beginViewerLoad,
  cancelViewerLoad,
  ViewerLoadSupersededError,
} from './loadGuard';

describe('viewer load ownership', () => {
  it('invalidates an older load when a newer load starts', () => {
    const first = beginViewerLoad();
    const second = beginViewerLoad();

    expect(first()).toBe(false);
    expect(second()).toBe(true);
    expect(() => assertViewerLoadCurrent(first)).toThrow(ViewerLoadSupersededError);
  });

  it('invalidates the active load when navigation cancels viewer work', () => {
    const active = beginViewerLoad();
    cancelViewerLoad();
    expect(active()).toBe(false);
  });
});
