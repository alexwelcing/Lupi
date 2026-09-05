import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LupiActionButton } from './LupiActionButton';
import { IconRemix } from './icons';

const gpu = vi.hoisted(() => ({ acquire: vi.fn(), paint: vi.fn(), dispose: vi.fn() }));
vi.mock('./action-light/runtime', () => ({ acquireActionLight: gpu.acquire }));

let reduced = false;
let forced = false;
let preferenceListeners: Array<() => void> = [];
beforeEach(() => {
  reduced = false;
  forced = false;
  preferenceListeners = [];
  vi.clearAllMocks();
  gpu.acquire.mockResolvedValue({ paint: gpu.paint, dispose: gpu.dispose });
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query.includes('reduced-motion') ? reduced : forced; },
    addEventListener: (_: string, fn: () => void) => preferenceListeners.push(fn),
    removeEventListener: (_: string, fn: () => void) => { preferenceListeners = preferenceListeners.filter(item => item !== fn); },
  }));
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { gpu: {} }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('optical actions', () => {
  it('keeps native button semantics, labels, refs and exactly one action per click', () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(<LupiActionButton ref={ref} onClick={onClick}><IconRemix /> Remix scene</LupiActionButton>);
    const button = screen.getByRole('button', { name: 'Remix scene' });
    expect(ref.current).toBe(button);
    expect(button.getAttribute('type')).toBe('button');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(gpu.acquire).not.toHaveBeenCalled();
  });
  it('does not initialize a GPU for reduced motion, forced colors or disabled actions', () => {
    const view = render(<LupiActionButton>Remix scene</LupiActionButton>);
    const button = screen.getByRole('button');
    reduced = true;
    fireEvent.focus(button);
    reduced = false;
    forced = true;
    fireEvent.pointerDown(button);
    forced = false;
    view.rerender(<LupiActionButton disabled>Remix scene</LupiActionButton>);
    fireEvent.pointerEnter(button);
    expect(gpu.acquire).not.toHaveBeenCalled();
    expect(button.querySelector('canvas')).toBeNull();
  });
  it('works as an ordinary button when WebGPU is absent', () => {
    vi.stubGlobal('navigator', {});
    const click = vi.fn();
    render(<LupiActionButton onClick={click}>Remix scene</LupiActionButton>);
    const button = screen.getByRole('button');
    fireEvent.focus(button);
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
    expect(gpu.acquire).not.toHaveBeenCalled();
    expect(button.querySelector('canvas')).toBeNull();
  });
  it('lazily acquires once, then releases when motion is reduced or the button unmounts', async () => {
    const view = render(<LupiActionButton>Remix scene</LupiActionButton>);
    const button = screen.getByRole('button');
    fireEvent.focus(button);
    await waitFor(() => expect(button.getAttribute('data-action-renderer')).toBe('vgpu'));
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(gpu.acquire).toHaveBeenCalledTimes(1);
    reduced = true;
    preferenceListeners.forEach(listener => listener());
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(button.querySelector('canvas')).toBeNull();
    expect(button.getAttribute('data-action-renderer')).toBe('css');
    view.unmount();
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(preferenceListeners).toHaveLength(0);
  });
  it('disposes a device that finishes loading after unmount', async () => {
    let finish!: (value: { paint: typeof gpu.paint; dispose: typeof gpu.dispose }) => void;
    gpu.acquire.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<LupiActionButton>Remix scene</LupiActionButton>);
    fireEvent.focus(screen.getByRole('button'));
    await waitFor(() => expect(gpu.acquire).toHaveBeenCalledTimes(1));
    view.unmount();
    finish({ paint: gpu.paint, dispose: gpu.dispose });
    await waitFor(() => expect(gpu.dispose).toHaveBeenCalledTimes(1));
  });
  it('keeps the action working if the GPU fails, without retrying on every hover', async () => {
    gpu.acquire.mockRejectedValue(new Error('No adapter'));
    const click = vi.fn();
    render(<LupiActionButton onClick={click}>Remix scene</LupiActionButton>);
    const button = screen.getByRole('button');
    fireEvent.focus(button);
    await waitFor(() => expect(button.querySelector('canvas')).toBeNull());
    fireEvent.blur(button);
    fireEvent.focus(button);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('data-action-renderer')).toBe('css');
    expect(gpu.acquire).toHaveBeenCalledTimes(1);
  });
});
