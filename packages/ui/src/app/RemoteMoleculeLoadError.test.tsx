import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RemoteMoleculeLoadError } from './RemoteMoleculeLoadError';

describe('RemoteMoleculeLoadError', () => {
  it('shows safe actionable copy without echoing an attacker-controlled URL', async () => {
    const retry = vi.fn();
    render(<RemoteMoleculeLoadError onRetry={retry} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('could not be opened');
    expect(alert.textContent).toContain('reviewed gallery and catalog sources');
    expect(screen.getByRole('link', { name: /explore trusted examples/i }).getAttribute('href')).toBe('/#gallery');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
