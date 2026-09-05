import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { firebaseConfigured } from '../auth/firebase';
import { useFirebaseAuth } from '../auth/useFirebaseAuth';
import { listUserSavedViews, makeSavedViewUrl } from '../savedViews';

/** Account only. Save owns publishing; MCP owns agent execution. No token or source-state polling. */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { user, loading, error, signIn, signOut } = useFirebaseAuth();
  const [open, setOpen] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const recent = useQuery({
    queryKey: ['recentSavedViews', user?.uid],
    queryFn: () => listUserSavedViews(user!.uid),
    enabled: Boolean(user && open),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div ref={container} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        data-testid="lupi-agent-dock-button"
        ref={trigger}
        type="button"
        aria-label="Account"
        aria-expanded={open}
        aria-controls="lupi-account-panel"
        onClick={() => setOpen(value => !value)}
        style={{ ...button, padding: compact ? '8px 10px' : '9px 14px' }}
      >
        Account
      </button>
      {open && (
        <section
          data-testid="lupi-agent-dock-panel"
          id="lupi-account-panel"
          aria-label="Account"
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            right: 0,
            zIndex: 300,
            width: 'min(320px, calc(100vw - 32px))',
            padding: 22,
            borderRadius: 12,
            border: '1px solid #405248',
            background: '#18231f',
            color: '#f0f2e9',
            boxShadow: '0 16px 48px #0008',
            font: '400 14px/1.6 system-ui,sans-serif',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18 }}>Your space</h2>
            <button
              style={button}
              aria-label="Close account"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              ×
            </button>
          </div>
          {user ? (
            <>
              <p style={{ overflowWrap: 'anywhere' }}>{user.displayName || user.email || 'Signed in'}</p>
              <h3 style={{ fontSize: 14 }}>Saved views</h3>
              {recent.isLoading && <p role="status">Loading saved views…</p>}
              {recent.isError && (
                <div role="alert">
                  <p>Saved views couldn’t be loaded.</p>
                  <button style={button} onClick={() => void recent.refetch()}>
                    Try again
                  </button>
                </div>
              )}
              {recent.data?.length === 0 && (
                <p>No saved views yet. Open a molecule and choose Save to keep a view.</p>
              )}
              {recent.data?.slice(0, 6).map(view => (
                <a
                  key={view.slug}
                  href={makeSavedViewUrl(view.slug)}
                  style={{
                    display: 'block',
                    color: '#d5ef9c',
                    paddingBlock: 8,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {view.title}
                </a>
              ))}
              <button style={{ ...button, marginTop: 16 }} disabled={loading} onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <p>Explore freely. Sign in only when you want to save and reopen your views.</p>
              {firebaseConfigured ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {(['google', 'github'] as const).map(provider => (
                    <button
                      key={provider}
                      style={button}
                      disabled={loading}
                      onClick={() => void signIn(provider)}
                    >
                      Continue with {provider === 'google' ? 'Google' : 'GitHub'}
                    </button>
                  ))}
                </div>
              ) : (
                <p role="status">
                  Sign-in isn’t available in this build. You can still explore and export pictures.
                </p>
              )}
            </>
          )}
          {error && (
            <p role="alert" style={{ color: '#ffb8ad' }}>
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
const button = {
  minHeight: 40,
  padding: '8px 12px',
  color: '#edf3e6',
  background: '#23352b',
  border: '1px solid #556b59',
  borderRadius: 7,
  cursor: 'pointer',
  font: '500 13px/1.4 system-ui,sans-serif',
} as const;
