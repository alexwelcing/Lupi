import { describe, expect, it } from 'vitest';
import type { LupiIntent, PointerKind } from '@atlas/scene';
import { createGestureMachine, type GestureSink } from './gestureArbiter';
import { GESTURE } from './gestureTokens';

function makeMachine({ moving = false }: { moving?: boolean } = {}) {
  const intents: LupiIntent[] = [];
  const calls: string[] = [];
  const state = { moving };
  const sink: GestureSink = {
    emit: (intent) => intents.push(intent),
    verb: () => 'orbit',
    canManipulate: () => true,
    isMoving: () => state.moving,
    isIdle: () => !state.moving,
    catchMotion: () => {
      calls.push('catch');
      state.moving = false;
    },
    beginGesture: () => calls.push('begin'),
    endGesture: () => calls.push('end'),
    startDrag: () => calls.push('drag'),
    orbitBy: () => calls.push('orbit'),
    panBy: () => calls.push('pan'),
    zoomBy: () => calls.push('zoom'),
    dollyBy: () => calls.push('dolly'),
    endDrag: () => calls.push('release'),
  };
  return { machine: createGestureMachine(GESTURE, sink), intents, calls };
}

/** Press, move `px` to the right in one step, lift. */
function press(machine: ReturnType<typeof makeMachine>['machine'], pointerType: PointerKind, px: number, t = 0) {
  const at = (x: number, dt: number) => ({ id: 1, pointerType, x, y: 100, t: t + dt, button: 0, shiftKey: false });
  machine.down(at(100, 0));
  machine.move(at(100 + px, 16));
  return machine.up(at(100 + px, 32));
}

const taps = (intents: LupiIntent[]) => intents.filter((i) => i.type === 'canvas.tap').length;

describe('gesture machine', () => {
  it('tells taps from drags by the slop (touch 8 px, mouse 3 px)', () => {
    const cases: Array<[PointerKind, number, boolean]> = [
      ['touch', 7, true],
      ['touch', 9, false],
      ['mouse', 2, true],
      ['mouse', 4, false],
    ];
    for (const [kind, px, isTap] of cases) {
      const { machine, intents, calls } = makeMachine();
      const result = press(machine, kind, px);
      expect(taps(intents), `${kind} ${px}px`).toBe(isTap ? 1 : 0);
      expect(result).toBe(isTap ? 'tap' : 'swallow');
      expect(calls.includes('drag')).toBe(!isTap);
    }
  });

  it('catches motion on press and swallows that press’s tap', () => {
    const { machine, intents, calls } = makeMachine({ moving: true });
    const result = press(machine, 'touch', 0);
    expect(calls[0]).toBe('catch');
    expect(result).toBe('swallow');
    expect(taps(intents)).toBe(0);
    // The next press is an ordinary tap again.
    expect(press(machine, 'touch', 0, 1000)).toBe('tap');
    expect(taps(intents)).toBe(1);
  });
});
