import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { useStore } from './store';
import { resetStore } from './test-utils';
import { MOBILE_MEDIA_QUERY } from './hooks/useMediaQuery';

const auth = vi.hoisted(() => ({
  user: null as null | { uid: string },
  idToken: null as string | null,
  signIn: vi.fn(),
  refreshToken: vi.fn(),
}));

vi.mock('./auth/useFirebaseAuth', () => ({
  useFirebaseAuth: () => ({
    loading: false,
    signIn: auth.signIn,
    refreshToken: auth.refreshToken,
    user: auth.user,
    idToken: auth.idToken,
  }),
}));
vi.mock('./auth/firebase', () => ({ firebaseConfigured: true }));
vi.mock('./savedViews', async importOriginal => ({
  ...(await importOriginal<typeof import('./savedViews')>()),
  listUserSavedViews: vi.fn(async () => []),
  saveCurrentMolecularView: vi.fn(),
}));
vi.mock('./analytics', async importOriginal => ({
  ...(await importOriginal<typeof import('./analytics')>()),
  track: vi.fn(),
}));

import { SavedViewButton } from './SavedViewButton';

let mobile = false;

function renderSave(compact = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <div data-testid="header">
        <SavedViewButton compact={compact} />
      </div>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mobile = false;
  auth.user = null;
  auth.idToken = null;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === MOBILE_MEDIA_QUERY && mobile;
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  resetStore();
  useStore.setState({
    file: {
      name: 'Benzaldehyde',
      size: 1,
      trajectory: createMockTrajectory(1, 14),
      thermo: null,
    },
    loadedAtomCount: 14,
    frame: 0,
    showBonds: true,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SavedViewButton', () => {
  it('opens an anchored popover inside the header on desktop', () => {
    auth.user = { uid: 'u1' };
    auth.idToken = 'token';
    renderSave();
    fireEvent.click(screen.getByTestId('lupi-save-view-button'));
    const panel = screen.getByTestId('lupi-save-view-panel');
    expect(screen.getByTestId('header').contains(panel)).toBe(true);
    expect(screen.queryByTestId('lupi-save-view-panel-backdrop')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByText('Source')).toBeTruthy();
  });

  it('opens a full-width bottom sheet portaled to <body> on a phone', () => {
    mobile = true;
    auth.user = { uid: 'u1' };
    auth.idToken = 'token';
    renderSave(true);
    const trigger = screen.getByTestId('lupi-save-view-button');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);

    const sheet = screen.getByTestId('lupi-save-view-panel');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    // Portaled: the sheet escapes the header (and its layout containment).
    expect(screen.getByTestId('header').contains(sheet)).toBe(false);
    expect(document.body.contains(sheet)).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(sheet.id);
    expect(sheet.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(sheet.getAttribute('aria-labelledby')!)?.textContent).toBe('Create a view link');

    // Compact summary replaces the four desktop meta rows.
    expect(screen.getByTestId('lupi-save-view-summary').textContent).toContain('14 atoms');
    expect(screen.queryByText('Source')).toBeNull();

    // The share URL is the link-name field's helper line, not an ellipsised box.
    expect(screen.getByText(/\/view\/benzaldehyde-publish$/)).toBeTruthy();

    // Primary action lives in the pinned footer, is touch sized, and is enabled with a token.
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.getAttribute('disabled')).toBeNull();
    expect(save.style.height).toBe('48px');
    // Inputs use 16px text so iOS does not zoom on focus.
    expect((screen.getByLabelText('Name') as HTMLInputElement).style.fontSize).toBe('16px');
  });

  it('stays open for taps inside the portaled sheet and closes from the backdrop, the close button and Escape', () => {
    mobile = true;
    auth.user = { uid: 'u1' };
    auth.idToken = 'token';
    renderSave(true);
    const trigger = screen.getByTestId('lupi-save-view-button');

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByLabelText('Name'));
    expect(screen.queryByTestId('lupi-save-view-panel')).not.toBeNull();

    fireEvent.click(screen.getByTestId('lupi-save-view-panel-backdrop'));
    expect(screen.queryByTestId('lupi-save-view-panel')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('lupi-save-view-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('lupi-save-view-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('stacks full-width sign-in buttons for guests on a phone with no footer', () => {
    mobile = true;
    renderSave(true);
    fireEvent.click(screen.getByTestId('lupi-save-view-button'));
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue with GitHub/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
