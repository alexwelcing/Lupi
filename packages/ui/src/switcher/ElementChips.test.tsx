import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElementChips, elementLabel } from './ElementChips';

afterEach(cleanup);

const counts = [
  { symbol: 'H', count: 61 },
  { symbol: 'C', count: 60 },
  { symbol: 'O', count: 51 },
  { symbol: 'N', count: 29 },
  { symbol: 'Cl', count: 4 },
  { symbol: 'S', count: 2 },
];

describe('ElementChips', () => {
  it('shows common elements first, hydrogen last, and the tail behind one toggle', () => {
    const onToggle = vi.fn();
    render(<ElementChips counts={counts} selected={['N']} onToggle={onToggle} quick={3} />);
    const group = screen.getByRole('group', { name: 'Elements' });
    const labels = Array.from(group.querySelectorAll('button')).map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(labels).toEqual(['Carbon (C)', 'Oxygen (O)', 'Nitrogen (N)', '3 more']);
    expect(screen.getByRole('button', { name: 'Nitrogen (N)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '3 more' }));
    expect(screen.getByRole('button', { name: 'Hydrogen (H)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fewer elements' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chlorine (Cl)' }));
    expect(onToggle).toHaveBeenCalledWith('Cl');
    expect(elementLabel('Xx')).toBe('Xx (Xx)');
  });
});
