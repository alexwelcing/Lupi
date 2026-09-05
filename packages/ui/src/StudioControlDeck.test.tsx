import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StudioControlDeck } from './StudioControlDeck';
import { useStore } from './store';
import { resetStore } from './test-utils';
describe('focused style controls', () => {
  beforeEach(resetStore);
  afterEach(cleanup);
  it('changes only the requested viewer setting', () => {
    render(<StudioControlDeck mode="molecule" />);
    const previous = useStore.getState().showBonds;
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bond guides' }));
    expect(useStore.getState().showBonds).toBe(!previous);
    fireEvent.click(screen.getByRole('button', { name: 'Paper' }));
    expect(useStore.getState().backgroundPreset).toBe('white');
    fireEvent.change(screen.getByRole('slider', { name: 'Atom size' }), {
      target: { value: '1.5' },
    });
    expect(useStore.getState().atomScale).toBe(1.5);
    expect(screen.queryByText(/Equilibrium|New run|Research/)).toBeNull();
  });
});
