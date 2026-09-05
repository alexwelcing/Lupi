import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GpuStudioLaunch } from './GpuStudioLaunch';

const mocks = vi.hoisted(() => ({ createStudio: vi.fn(), state: {} as any }));
vi.mock('./runtime', () => ({ createStudio: mocks.createStudio }));
vi.mock('../store', () => ({
  useStore: Object.assign((selector: (state: any) => unknown) => selector(mocks.state), {
    getState: () => mocks.state,
    setState: (value: object) => Object.assign(mocks.state, value),
  }),
}));

beforeEach(() => {
  mocks.createStudio.mockReset();
  mocks.state = {
    playing: true,
    frame: 0,
    loadedAtomCount: 1,
    file: {
      name: 'Test',
      trajectory: {
        frames: [{ natoms: 1, positions: new Float32Array([0, 0, 0]), types: new Int32Array([6]) }],
      },
    },
  };
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'gpu');
});

describe('GPU Studio launch lifecycle', () => {
  it('does not initialize on mount and gives an actionable unsupported state', async () => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
    const onOpenChange = vi.fn();
    render(<GpuStudioLaunch onOpenChange={onOpenChange} />);
    expect(mocks.createStudio).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open GPU Studio' }));
    expect(mocks.state.playing).toBe(false);
    await screen.findByText(/WebGPU is unavailable/);
    expect(mocks.createStudio).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back to viewer' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
  it('aborts and disposes an initialization that resolves after closing', async () => {
    let finish: (value: any) => void = () => {};
    const dispose = vi.fn();
    mocks.createStudio.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    render(<GpuStudioLaunch onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open GPU Studio' }));
    await waitFor(() => expect(mocks.createStudio).toHaveBeenCalledTimes(1));
    const signal = mocks.createStudio.mock.calls[0][2] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: 'Back to viewer' }));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish({ dispose });
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('turns initialization rejection into a closable failure, not a broken viewer', async () => {
    mocks.createStudio.mockRejectedValue(
      new Error('This device could not render the studio effect.'),
    );
    render(<GpuStudioLaunch onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open GPU Studio' }));
    await screen.findByText(/This device could not render/);
    expect(screen.getByRole('button', { name: 'Rotate', exact: true })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: /Return to my molecule/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
