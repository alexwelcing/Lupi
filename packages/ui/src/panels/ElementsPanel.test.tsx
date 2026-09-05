import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ElementsPanel } from './ElementsPanel';

afterEach(cleanup);
describe('student element lookup', () => {
  it('allows a new choice without deselecting the previous element', () => {
    render(<ElementsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Hydrogen, atomic number 1' }));
    const helium = screen.getByRole('button', { name: 'Helium, atomic number 2' });
    expect(helium).toHaveProperty('disabled', false);
    fireEvent.click(helium);
    expect(helium.getAttribute('aria-pressed')).toBe('true');
  });
  it('makes a filtered element reachable and explains no matches', () => {
    render(<ElementsPanel />);
    const search = screen.getByRole('searchbox', { name: 'Filter elements' });
    fireEvent.change(search, { target: { value: 'oxygen' } });
    const oxygen = screen.getByRole('button', { name: 'O · Oxygen' });
    fireEvent.click(oxygen);
    expect(oxygen.getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(search, { target: { value: 'zzzzz' } });
    expect(screen.getByRole('status').textContent).toContain('No matching elements');
  });
});
