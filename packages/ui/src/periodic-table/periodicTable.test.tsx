import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeriodicTableGrid } from './PeriodicTableGrid';
import { ElementDetailCard } from './ElementDetailCard';

afterEach(() => cleanup());

describe('PeriodicTableGrid', () => {
  it('renders exactly 118 element buttons plus the 2 f-block placeholders', () => {
    render(<PeriodicTableGrid selected={[]} onToggle={() => {}} />);

    expect(screen.getAllByRole('button')).toHaveLength(118);
    expect(screen.getByText('57–71')).toBeTruthy();
    expect(screen.getByText('89–103')).toBeTruthy();
  });

  it('calls onToggle with the atomic number and reflects selection via aria-pressed', () => {
    const onToggle = vi.fn();
    render(<PeriodicTableGrid selected={[26]} onToggle={onToggle} />);

    const iron = screen.getByRole('button', { name: 'Iron, atomic number 26' });
    const oxygen = screen.getByRole('button', { name: 'Oxygen, atomic number 8' });
    expect(iron.getAttribute('aria-pressed')).toBe('true');
    expect(oxygen.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(oxygen);
    expect(onToggle).toHaveBeenCalledWith(8);
  });

  it('disables unselected cells once maxSelection is reached', () => {
    const onToggle = vi.fn();
    render(<PeriodicTableGrid selected={[26]} onToggle={onToggle} maxSelection={1} />);

    const oxygen = screen.getByRole('button', { name: 'Oxygen, atomic number 8' });
    expect(oxygen).toHaveProperty('disabled', true);
    fireEvent.click(oxygen);
    expect(onToggle).not.toHaveBeenCalled();

    // The already-selected cell stays interactive so it can be deselected.
    const iron = screen.getByRole('button', { name: 'Iron, atomic number 26' });
    expect(iron).toHaveProperty('disabled', false);
  });

  it('dims non-matching cells under filterText while keeping matches interactive', () => {
    const onToggle = vi.fn();
    render(<PeriodicTableGrid selected={[]} onToggle={onToggle} filterText="oxy" />);

    const oxygen = screen.getByRole('button', { name: 'Oxygen, atomic number 8' });
    expect(oxygen).toHaveProperty('disabled', false);
    fireEvent.click(oxygen);
    expect(onToggle).toHaveBeenCalledWith(8);

    const iron = screen.getByRole('button', { name: 'Iron, atomic number 26' });
    expect(iron).toHaveProperty('disabled', true);
    expect(iron.style.opacity).toBe('0.22');
    fireEvent.click(iron);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('ElementDetailCard', () => {
  it('renders the periodic facts for iron', () => {
    render(<ElementDetailCard z={26} />);

    expect(screen.getByText('Iron')).toBeTruthy();
    expect(screen.getByText('Transition metal')).toBeTruthy();
    expect(screen.getByText('d-block')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy(); // group
    expect(screen.getByText('4')).toBeTruthy(); // period
    expect(screen.getByText('55.845 u')).toBeTruthy();
    expect(screen.getByText('1.32 Å')).toBeTruthy();
    expect(screen.getByText('1.83')).toBeTruthy();
    expect(screen.getByText('Magnetic Core')).toBeTruthy();
  });
});
