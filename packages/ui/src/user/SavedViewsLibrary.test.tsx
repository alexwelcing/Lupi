import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { resetStore } from '../test-utils';

const seams = vi.hoisted(() => ({
  listUserSavedViews: vi.fn(),
  renameSavedView: vi.fn(async () => undefined),
  updateSavedViewVisibility: vi.fn(async () => undefined),
  deleteSavedView: vi.fn(async () => undefined),
}));
vi.mock('../auth/useFirebaseAuth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../savedViews', async importOriginal => ({
  ...(await importOriginal<typeof import('../savedViews')>()),
  ...seams,
}));

import { SavedViewsLibrary } from './SavedViewsLibrary';

const view = (slug: string, title: string, visibility: 'public' | 'unlisted' = 'public') => ({
  schemaVersion: 1 as const,
  slug,
  title,
  ownerId: 'u1',
  visibility,
  molecule: { kind: 'url' as const, name: `${slug}.xyz`, url: `/${slug}.xyz`, size: 1, atomCount: 24, totalFrames: 1 },
  view: { frame: 0 } as never,
  exportDefaults: { baseName: slug, canonicalSlug: slug },
});

beforeEach(() => {
  resetStore();
  useStore.setState({ savedViewsLibraryOpen: true, activeSavedView: { slug: 'caffeine', title: 'Caffeine', ownerId: 'u1', visibility: 'public' } });
  seams.listUserSavedViews.mockResolvedValue([view('caffeine', 'Caffeine'), view('water', 'Water', 'unlisted')]);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('SavedViewsLibrary', () => {
  it('lists the owner’s views and routes rename, visibility and confirmed delete to the data layer', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SavedViewsLibrary />
      </QueryClientProvider>,
    );
    const cards = await screen.findAllByTestId('lupi-saved-view-card');
    expect(cards).toHaveLength(2);
    expect(screen.getByText('On screen')).toBeTruthy();
    expect(screen.getByText('Unlisted')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]);
    const input = screen.getByLabelText('View name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Morning coffee' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(seams.renameSavedView).toHaveBeenCalledWith('caffeine', 'Morning coffee'));

    fireEvent.click(screen.getByRole('button', { name: 'Make unlisted' }));
    await waitFor(() => expect(seams.updateSavedViewVisibility).toHaveBeenCalledWith('caffeine', 'unlisted'));

    // Delete is two-step: the first tap only arms the confirmation.
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);
    expect(seams.deleteSavedView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(seams.deleteSavedView).toHaveBeenCalledWith('water'));
  });

  it('closes on Escape by clearing the store flag', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SavedViewsLibrary />
      </QueryClientProvider>,
    );
    await screen.findAllByTestId('lupi-saved-view-card');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useStore.getState().savedViewsLibraryOpen).toBe(false);
  });
});
