import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ViewerGestureHint } from './ViewerGestureHint';

describe('ViewerGestureHint', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('dismisses only for canvas interaction and remembers the dismissal for the session', () => {
    const { unmount } = render(
      <div>
        <button type="button">Viewer action</button>
        <canvas aria-label="Molecule canvas" />
        <ViewerGestureHint isMobile={false} />
      </div>,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Viewer action' }));
    expect(screen.getByTestId('viewer-gesture-hint')).toBeTruthy();

    fireEvent.pointerDown(screen.getByLabelText('Molecule canvas'));
    expect(screen.queryByTestId('viewer-gesture-hint')).toBeNull();

    unmount();
    render(<ViewerGestureHint isMobile={false} />);
    expect(screen.queryByTestId('viewer-gesture-hint')).toBeNull();
  });

  it('uses the mobile interaction copy and safe vertical offset', () => {
    render(<ViewerGestureHint isMobile />);

    const hint = screen.getByTestId('viewer-gesture-hint');
    expect(hint.textContent).toContain('Pinch to zoom');
    expect(hint.style.top).toBe('132px');
  });

  it('does not promise per-atom selection when the scene is above the picking budget', () => {
    render(<ViewerGestureHint isMobile={false} canSelectAtoms={false} />);

    const hint = screen.getByTestId('viewer-gesture-hint');
    expect(hint.textContent).toContain('Scroll to zoom');
    expect(hint.textContent).not.toContain('Select an atom');
  });
});
