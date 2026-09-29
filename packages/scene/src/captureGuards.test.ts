import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginCaptureRender,
  beginRecording,
  registerCaptureGuard,
  registerRecordingGuard,
  runPrepareCapture,
} from './captureGuards';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.restoreAllMocks();
});

describe('capture guards', () => {
  it('prepares in order, begins in order and restores LIFO even when one guard throws', () => {
    const log: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const name of ['a', 'b', 'c']) {
      cleanups.push(
        registerCaptureGuard({
          prepare: () => log.push(`prepare ${name}`),
          begin: () => {
            if (name === 'b') throw new Error('b');
            log.push(`begin ${name}`);
            return () => log.push(`restore ${name}`);
          },
        }),
      );
    }
    runPrepareCapture();
    // The render throws: the renderSceneToPixels pattern still restores in its finally.
    let restore = () => {};
    expect(() => {
      try {
        restore = beginCaptureRender();
        throw new Error('render failed');
      } finally {
        restore();
      }
    }).toThrow('render failed');
    restore(); // idempotent
    expect(log).toEqual(['prepare a', 'prepare b', 'prepare c', 'begin a', 'begin c', 'restore c', 'restore a']);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('brackets a recording LIFO and unregisters', () => {
    const log: string[] = [];
    const offA = registerRecordingGuard(() => (log.push('start a'), () => log.push('stop a')));
    cleanups.push(registerRecordingGuard(() => (log.push('start b'), () => log.push('stop b'))));
    beginRecording()();
    offA();
    beginRecording()();
    expect(log).toEqual(['start a', 'start b', 'stop b', 'stop a', 'start b', 'stop b']);
  });
});
