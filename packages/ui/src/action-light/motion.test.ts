import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachActionMotion } from './motion';

let button: HTMLButtonElement;
let dispose: () => void;
let now = 0;
let nextId = 0;
let reduced = false;
let forced = false;
const frames = new Map<number, FrameRequestCallback>();
const preferences = new Set<() => void>();
const advance = (count = 1) => {
  for (let i = 0; i < count; i++) {
    now += 1000 / 60;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(now));
  }
};
const pointer = (name: string, props = {}) => {
  const event = new Event(name, { bubbles: true, cancelable: true });
  Object.assign(event, { button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: 195, clientY: 60 }, props);
  button.dispatchEvent(event);
  return event;
};
const value = (name: string) => Number(button.style.getPropertyValue(`--action-${name}`));

beforeEach(() => {
  now = nextId = 0;
  reduced = forced = false;
  frames.clear(); preferences.clear();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query.includes('reduced-motion') ? reduced : forced; },
    addEventListener: (_: string, callback: () => void) => preferences.add(callback),
    removeEventListener: (_: string, callback: () => void) => preferences.delete(callback),
  }));
  button = document.createElement('button');
  document.body.append(button);
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 200, 52));
  dispose = attachActionMotion(button);
});
afterEach(() => { dispose(); button.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('starts only on input, moves smoothly, settles while hovered and returns on leave', () => {
  expect(frames.size).toBe(0);
  pointer('pointerenter');
  advance();
  expect(value('x')).toBeGreaterThan(0);
  expect(value('x')).toBeLessThan(.85);
  advance(100);
  expect(value('x')).toBeCloseTo(.85);
  expect(frames.size).toBe(0);
  expect(button.hasAttribute('data-action-moving')).toBe(false);
  pointer('pointerleave');
  advance(100);
  expect(value('x')).toBe(0);
  expect(value('y')).toBe(0);
  expect(frames.size).toBe(0);
});

it('compresses a primary touch, rebounds on release and never captures or cancels input', () => {
  const click = vi.fn();
  button.addEventListener('click', click);
  pointer('pointerenter', { pointerType: 'touch' });
  expect(frames.size).toBe(0);
  const down = pointer('pointerdown', { pointerType: 'touch' });
  expect(down.defaultPrevented).toBe(false);
  advance(14);
  expect(value('press')).toBeGreaterThan(.9);
  pointer('pointerup', { pointerType: 'touch' });
  let minimum = 0;
  for (let i = 0; i < 100; i++) { advance(); minimum = Math.min(minimum, value('press')); }
  expect(minimum).toBeLessThan(-.02);
  expect(value('press')).toBe(0);
  button.click();
  expect(click).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);
});

it('settles on wall time even when the scene drops frames', () => {
  pointer('pointerdown'); advance(4);
  pointer('pointerup');
  now += 1400;
  advance();
  expect(value('press')).toBe(0);
  expect(value('x')).toBe(0);
  expect(frames.size).toBe(0);
  expect(button.hasAttribute('data-action-moving')).toBe(false);
});

it('supports native keyboard press/release and ignores key-repeat and secondary buttons', () => {
  pointer('pointerdown', { button: 2 });
  expect(frames.size).toBe(0);
  button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true }));
  expect(frames.size).toBe(0);
  button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
  advance(12);
  expect(value('press')).toBeGreaterThan(.9);
  button.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
  advance(100);
  expect(value('press')).toBe(0);
  expect(frames.size).toBe(0);
});

it('cancels a scroll gesture cleanly and does not re-engage on captured touch moves', () => {
  pointer('pointerdown', { pointerType: 'touch' });
  advance(4);
  pointer('pointercancel', { pointerType: 'touch' });
  pointer('pointermove', { pointerType: 'touch' });
  expect(frames.size).toBe(0);
  expect(button.style.getPropertyValue('--action-press')).toBe('');
  expect(button.hasAttribute('data-action-pressed')).toBe(false);
});

it('honors live accessibility changes, disabled state, visibility and disposal', () => {
  for (const setPreference of [() => { reduced = true; }, () => { forced = true; }]) {
    pointer('pointerdown'); advance(4);
    setPreference(); preferences.forEach(callback => callback());
    expect(frames.size).toBe(0);
    expect(button.style.getPropertyValue('--action-press')).toBe('');
    pointer('pointerenter');
    expect(frames.size).toBe(0);
    reduced = forced = false;
  }
  pointer('pointerdown'); advance();
  button.disabled = true;
  advance();
  expect(frames.size).toBe(0);
  button.disabled = false;
  pointer('pointerdown'); advance();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(frames.size).toBe(0);
  dispose();
  expect(preferences.size).toBe(0);
  expect(button.hasAttribute('data-action-moving')).toBe(false);
});
