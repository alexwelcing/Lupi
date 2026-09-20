import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { firebaseConfigured } from '../auth/firebase';
import { useFirebaseAuth } from '../auth/useFirebaseAuth';
import { MOBILE_MEDIA_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { listUserSavedViews, savedViewMillis } from '../savedViews';
import { useStore } from '../store';
import { formatRelativeTime } from './formatRelativeTime';
import {
  LupiButton,
  LupiIndexRow,
  LupiNotice,
  LupiPanel,
  LupiPanelHeader,
  LupiProviderButton,
  LupiSheet,
  LupiStatusPill,
  labelStyle,
  lupiUserColors,
  panelBodyStyle,
} from './LupiUserPrimitives';
import { openSavedViewInViewer, savedViewsQueryKey } from './SavedViewsLibrary';

const RECENT_LIMIT = 3;

/** Account only. Save owns publishing; MCP owns agent execution. No token or source-state polling. */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { user, loading, error, signIn, signOut } = useFirebaseAuth();
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);
  const openLibrary = useStore(s => s.setSavedViewsLibraryOpen);
  const [open, setOpen] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const recent = useQuery({
    queryKey: savedViewsQueryKey(user?.uid),
    queryFn: () => listUserSavedViews(user!.uid),
    enabled: Boolean(user && open),
    staleTime: 30_000,
  });

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (container.current?.contains(target) || sheet.current?.contains(target)) return;
      close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open, close]);

  const views = recent.data ?? [];
  const name = user?.displayName || user?.email?.split('@')[0] || 'Signed in';
  const provider = providerLabel(user?.providerData?.[0]?.providerId);

  const header = (
    <LupiPanelHeader
      kicker="Account"
      title={user ? name : 'Your space'}
      titleId={titleId}
      onClose={isMobile ? () => close(true) : undefined}
    />
  );

  const body = (
    <div style={panelBodyStyle}>
      {user ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, alignItems: 'center' }}>
            <Avatar name={name} photoUrl={user.photoURL} size={44} />
            <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
              {user.email && (
                <span style={{ color: lupiUserColors.paper, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.email}
                </span>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {provider && <LupiStatusPill label={provider} tone="green" />}
                {recent.data && <LupiStatusPill label={`${views.length} saved view${views.length === 1 ? '' : 's'}`} tone="cyan" />}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 7 }}>
            <span style={labelStyle}>Recent views</span>
            {recent.isPending && <p role="status" style={mutedCopy}>Loading saved views…</p>}
            {recent.isError && (
              <LupiNotice tone="pink">
                Saved views couldn’t be loaded.{' '}
                <button type="button" onClick={() => void recent.refetch()} style={inlineLink}>Try again</button>
              </LupiNotice>
            )}
            {recent.data && views.length === 0 && (
              <p style={mutedCopy}>No saved views yet. Open a molecule and choose Save to keep a view.</p>
            )}
            {views.slice(0, RECENT_LIMIT).map(view => (
              <LupiIndexRow
                key={view.slug}
                label={view.title}
                before={<Thumb src={view.thumbnail?.dataUrl} />}
                after={
                  <span style={{ color: lupiUserColors.muted, fontFamily: 'var(--font-mono), ui-monospace, monospace', fontSize: 10, whiteSpace: 'nowrap' }}>
                    {formatRelativeTime(savedViewMillis(view.updatedAt ?? view.createdAt))}
                  </span>
                }
                onClick={() => { openSavedViewInViewer(view.slug); close(); }}
              />
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <LupiButton
              tone="primary"
              size={isMobile ? 'touch' : 'default'}
              onClick={() => { close(); openLibrary(true); }}
            >
              All your views
            </LupiButton>
            <LupiButton size={isMobile ? 'touch' : 'default'} disabled={loading} onClick={() => void signOut()}>
              Sign out
            </LupiButton>
          </div>
        </>
      ) : (
        <>
          <LupiNotice>
            {firebaseConfigured
              ? 'Explore freely. Sign in only when you want to save and reopen your views.'
              : 'Sign-in isn’t available in this build. You can still explore and export pictures.'}
          </LupiNotice>
          <div style={{ display: 'grid', gap: 8 }}>
            <LupiProviderButton provider="google" label="Continue with Google" disabled={!firebaseConfigured || loading} onClick={() => void signIn('google')} />
            <LupiProviderButton provider="github" label="Continue with GitHub" disabled={!firebaseConfigured || loading} onClick={() => void signIn('github')} />
          </div>
        </>
      )}
      {error && <LupiNotice tone="pink">{error}</LupiNotice>}
    </div>
  );

  return (
    <div ref={container} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        data-testid="lupi-agent-dock-button"
        ref={trigger}
        type="button"
        aria-label="Account"
        aria-expanded={open}
        aria-controls="lupi-account-panel"
        aria-haspopup="dialog"
        onClick={() => setOpen(value => !value)}
        style={{ ...button, padding: compact ? '8px 10px' : '9px 14px' }}
      >
        {user && <span aria-hidden="true" style={signedInDot} />}
        Account
      </button>

      {open && isMobile && (
        <LupiSheet
          testId="lupi-agent-dock-panel"
          labelledBy={titleId}
          header={header}
          onDismiss={() => close(true)}
          sheetRef={node => {
            sheet.current = node;
            if (node) node.id = 'lupi-account-panel';
          }}
        >
          {body}
        </LupiSheet>
      )}

      {open && !isMobile && (
        <section id="lupi-account-panel" aria-labelledby={titleId}>
          <LupiPanel testId="lupi-agent-dock-panel" width={360} zIndex={300}>
            {header}
            {body}
          </LupiPanel>
        </section>
      )}
    </div>
  );
}

function providerLabel(id: string | undefined) {
  if (!id) return null;
  if (id.includes('google')) return 'Google';
  if (id.includes('github')) return 'GitHub';
  if (id.includes('override')) return 'dev';
  return id.replace(/\.com$/, '');
}

function Avatar({ name, photoUrl, size = 36 }: { name: string; photoUrl?: string | null; size?: number }) {
  const initials = name.split(/\s+/).map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  return photoUrl ? (
    <img
      src={photoUrl}
      alt=""
      referrerPolicy="no-referrer"
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: 8, objectFit: 'cover', border: `1px solid ${lupiUserColors.line}` }}
    />
  ) : (
    <span
      aria-hidden="true"
      style={{
        display: 'grid',
        placeItems: 'center',
        width: size,
        height: size,
        borderRadius: 8,
        background: `linear-gradient(135deg, ${lupiUserColors.amber}, #ff7a2c)`,
        color: '#120c05',
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
        fontSize: Math.round(size * 0.36),
        fontWeight: 900,
      }}
    >
      {initials}
    </span>
  );
}

function Thumb({ src }: { src?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: 44,
        height: 28,
        flexShrink: 0,
        borderRadius: 4,
        overflow: 'hidden',
        border: `1px solid ${lupiUserColors.line}`,
        background: 'rgba(5,5,5,0.6)',
      }}
    >
      {src && <img src={src} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />}
    </span>
  );
}

const button = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  minHeight: 40,
  padding: '8px 12px',
  color: '#edf3e6',
  background: '#23352b',
  border: '1px solid #556b59',
  borderRadius: 7,
  cursor: 'pointer',
  font: '500 13px/1.4 system-ui,sans-serif',
} as const;

const signedInDot = {
  width: 7,
  height: 7,
  borderRadius: 999,
  background: lupiUserColors.green,
  boxShadow: `0 0 10px ${lupiUserColors.green}`,
} as const;

const mutedCopy = { margin: 0, color: lupiUserColors.muted, fontSize: 12.5, lineHeight: 1.5 } as const;

const inlineLink = {
  background: 'none',
  border: 0,
  padding: 0,
  color: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
  font: 'inherit',
} as const;
