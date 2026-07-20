import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SavedViewLoadState } from './SavedViewLoadState';

function query(overrides: Record<string, unknown> = {}) {
  return {
    error: null,
    isError: false,
    isFetching: false,
    isPending: false,
    refetch: vi.fn(),
    ...overrides,
  } as never;
}

describe('SavedViewLoadState', () => {
  it('renders a saved-view-specific accessible loading state', () => {
    render(<SavedViewLoadState slug="caffeine-view" query={query({ isPending: true })} />);
    expect(screen.getByRole('status', { name: /saved view loading/i }).textContent).toContain('Opening view');
    expect(screen.getByText(/caffeine-view/i)).toBeTruthy();
  });

  it('renders anchored not-found state, safe slug, Retry, and Explore', async () => {
    render(<SavedViewLoadState slug={'Missing <token>'} query={query({
      isError: true,
      error: new Error('No Lupi view found for "missing-token".'),
    })} />);
    const alert = screen.getByRole('alert');
    expect(screen.getByRole('heading', { name: 'View not found' })).toBeTruthy();
    expect(alert.textContent).toContain('missing-token');
    expect(alert.textContent).not.toContain('<token>');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to explore/i }).getAttribute('href')).toBe('/#gallery');
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('distinguishes explicit permission denial from not-found', () => {
    const denied = Object.assign(new Error('No Lupi view found for "secret".'), { code: 'permission-denied' });
    render(<SavedViewLoadState slug="secret" query={query({ isError: true, error: denied })} />);
    expect(screen.getByRole('heading', { name: /could not be opened/i })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/not permitted/i);
    expect(screen.queryByText('View not found')).toBeNull();
  });

  it('renders safe generic copy without leaking the raw error', () => {
    render(<SavedViewLoadState slug="broken" query={query({
      isError: true,
      error: new Error('Firebase project secret-project-123 token=abcdef'),
    })} />);
    expect(screen.getByRole('alert').textContent).toMatch(/check your connection/i);
    expect(screen.getByRole('alert').textContent).not.toMatch(/secret-project|abcdef/i);
  });

  it('awaits one Retry and announces a persistent terminal result', async () => {
    const refetch = vi.fn().mockResolvedValue({
      isError: true,
      error: new Error('No Lupi view found for "missing".'),
    });
    render(<SavedViewLoadState slug="missing" query={query({
      isError: true,
      error: new Error('No Lupi view found for "missing".'),
      refetch,
    })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Retry completed; view still not found.');
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('removes the failure view after a successful retry', async () => {
    function Harness() {
      const [failed, setFailed] = useState(true);
      const refetch = async () => {
        setFailed(false);
        return { isError: false, error: null };
      };
      return <SavedViewLoadState slug="recover" query={query({
        isError: failed,
        error: failed ? new Error('No Lupi view found for "recover".') : null,
        refetch,
      })} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
