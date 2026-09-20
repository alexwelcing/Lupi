import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFirebaseAuth, type LupiAuthProviderId } from './auth/useFirebaseAuth';
import { firebaseConfigured } from './auth/firebase';
import {
  defaultSavedViewTitle,
  listUserSavedViews,
  makeSavedViewUrl,
  saveCurrentMolecularView,
  slugifySavedViewTitle,
  type SavedMolecularView,
} from './savedViews';
import { useStore, type SavedViewVisibility } from './store';
import { track, ANALYTICS_EVENTS } from './analytics';
import { captureViewerThumbnail } from './viewer/captureViewerThumbnail';
import { MOBILE_MEDIA_QUERY, useMediaQuery } from './hooks/useMediaQuery';
import {
  LupiButton,
  LupiField,
  LupiIndexRow,
  LupiMetaRow,
  LupiNotice,
  LupiOpticalMark,
  LupiPanel,
  LupiPanelHeader,
  LupiProviderButton,
  LupiSheet,
  LupiStatusPill,
  LupiUserTrigger,
  labelStyle,
  lupiUserColors,
  panelBodyStyle,
} from './user/LupiUserPrimitives';

const PENDING_SAVE_KEY = 'lupi.pendingSaveViewDraft';

interface SaveDraft {
  title: string;
  slug: string;
}

function BookmarkGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function socialPostText(title: string) {
  return `Explore this molecular view in Lupi: ${title}`.slice(0, 190);
}

function linkedInShareUrl(url: string) {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}

function xShareUrl(url: string, title: string) {
  const params = new URLSearchParams({
    text: socialPostText(title),
    url,
  });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

function openSharePopup(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer,width=760,height=760');
}

export function SavedViewButton({ compact = false }: { compact?: boolean }) {
  const file = useStore(state => state.file);
  const loadedAtomCount = useStore(state => state.loadedAtomCount);
  const frame = useStore(state => state.frame);
  const showBonds = useStore(state => state.showBonds);
  const activeSavedView = useStore(state => state.activeSavedView);
  const openLibrary = useStore(state => state.setSavedViewsLibraryOpen);
  const { loading: authLoading, signIn, user, idToken, refreshToken } = useFirebaseAuth();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);
  const titleId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(() => defaultSavedViewTitle(file));
  const [slug, setSlug] = useState(() => slugifySavedViewTitle(defaultSavedViewTitle(file)));
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<SavedViewVisibility>('public');
  const [recentViews, setRecentViews] = useState<SavedMolecularView[]>([]);
  const lastActiveSlugRef = useRef<string | null>(null);

  // Editing your own saved view: prefill its name, slug and visibility so Save
  // updates it in place instead of quietly forking "<file> Publish".
  const ownsActiveView = Boolean(activeSavedView && user && activeSavedView.ownerId === user.uid);

  const defaultTitle = useMemo(() => defaultSavedViewTitle(file), [file?.name]);
  const cleanSlug = slugifySavedViewTitle(slug || title || defaultTitle);
  const urlPreview = makeSavedViewUrl(cleanSlug);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const queryClient = useQueryClient();

  useEffect(() => {
    if (slugTouched) return;
    setTitle(defaultTitle);
    setSlug(slugifySavedViewTitle(defaultTitle));
  }, [defaultTitle, slugTouched]);

  useEffect(() => {
    const slugNow = ownsActiveView && activeSavedView ? activeSavedView.slug : null;
    if (slugNow === lastActiveSlugRef.current) return;
    lastActiveSlugRef.current = slugNow;
    if (slugNow && activeSavedView) {
      setTitle(activeSavedView.title);
      setSlug(activeSavedView.slug);
      setSlugTouched(true);
      setVisibility(activeSavedView.visibility);
      setSavedUrl(makeSavedViewUrl(activeSavedView.slug));
      setStatus(null);
      setError(null);
    } else {
      // Left the saved view (new file or signed out): back to a fresh draft.
      setSlugTouched(false);
      setVisibility('public');
      setSavedUrl(null);
      setStatus(null);
    }
  }, [ownsActiveView, activeSavedView]);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) containerRef.current?.querySelector('button')?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The mobile sheet is portaled to <body>, so it is not inside containerRef.
      if (containerRef.current?.contains(target) || sheetRef.current?.contains(target)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (!user || !file) return;
    const pending = readPendingDraft();
    if (!pending) return;
    setTitle(pending.title);
    setSlug(pending.slug);
    setSlugTouched(true);
    setOpen(true);
    setStatus('Ready to save.');
    localStorage.removeItem(PENDING_SAVE_KEY);
  }, [user?.uid, file?.name]);

  // TanStack Query for recent saved views (caching, loading states, refetch on save)
  const recentViewsQuery = useQuery({
    queryKey: ['savedViews', user?.uid],
    queryFn: () => listUserSavedViews(user!.uid),
    enabled: !!user && open,
    staleTime: 1000 * 30,
  });

  useEffect(() => {
    if (recentViewsQuery.data) {
      setRecentViews(recentViewsQuery.data);
    } else if (recentViewsQuery.isError) {
      setRecentViews([]);
    }
  }, [recentViewsQuery.data, recentViewsQuery.isError]);

  // Activation auto-nudge REMOVED: the app no longer auto-opens the Save panel for
  // anonymous visitors after a delay. There is no unprompted sign-up push — the
  // panel opens only when the user explicitly clicks Save.

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (!slugTouched) setSlug(slugifySavedViewTitle(value));
  };

  const handleProviderSignIn = async (provider: LupiAuthProviderId) => {
    writePendingDraft({ title, slug: cleanSlug });
    await signIn(provider);
  };

  const handleSave = async (asNew = false) => {
    if (!user) return;
    if (!idToken) {
      setError('Your sign-in session is still initializing. Wait a moment, or click Refresh session below.');
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await saveCurrentMolecularView({
        title,
        slug: asNew ? slugifySavedViewTitle(title || defaultTitle) : cleanSlug,
        user,
        visibility,
        thumbnail: captureViewerThumbnail(),
        forceNewSlug: asNew,
      });
      setSavedUrl(result.url);
      setSlug(result.view.slug);
      setSlugTouched(true);
      setStatus(asNew ? 'Saved as a new view.' : ownsActiveView ? 'View updated.' : 'Saved.');
      // Invalidate recent views query so list updates immediately
      queryClient.invalidateQueries({
        queryKey: ['savedViews', user?.uid],
      });
      // North Star: a molecule view was persisted. No PII — counts + flags only.
      track(ANALYTICS_EVENTS.VIEW_SAVED, {
        atoms: loadedAtomCount || file?.trajectory.frames[0]?.natoms || 0,
        frame: frame + 1,
        bonds: showBonds,
      });
      // Referral: the shareable canonical link was produced and copied.
      track(ANALYTICS_EVENTS.VIEW_SHARED, { method: 'auto_copy' });
      await navigator.clipboard.writeText(result.url).catch(() => undefined);
      window.history.pushState({}, '', result.url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const handleNativeShare = async () => {
    if (!savedUrl || !canNativeShare) return;
    track(ANALYTICS_EVENTS.VIEW_SHARED, { method: 'native_share' });
    try {
      await navigator.share({
        title,
        text: socialPostText(title),
        url: savedUrl,
      });
      setStatus('Share sheet opened.');
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name !== 'AbortError') setError(err instanceof Error ? err.message : 'Share failed.');
    }
  };

  const handleExternalShare = (method: 'linkedin' | 'x') => {
    if (!savedUrl) return;
    track(ANALYTICS_EVENTS.VIEW_SHARED, { method });
    openSharePopup(method === 'linkedin' ? linkedInShareUrl(savedUrl) : xShareUrl(savedUrl, title));
    setStatus(method === 'linkedin' ? 'Opened LinkedIn share.' : 'Opened X share.');
  };

  if (!file) return null;

  const atomCount = loadedAtomCount || file.trajectory.frames[0]?.natoms || 0;
  const controlSize = isMobile ? 'touch' : 'default';

  const handleCopy = async () => {
    if (!savedUrl) return;
    try {
      await navigator.clipboard.writeText(savedUrl);
      track(ANALYTICS_EVENTS.VIEW_SHARED, { method: 'copy_button' });
      setStatus('Link copied.');
      setError(null);
    } catch {
      setError('Could not copy the link. Select and copy the saved URL above.');
    }
  };

  const handleRefreshSession = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await refreshToken();
      if (!next) throw new Error('Could not refresh session.');
      setStatus('Session refreshed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Session refresh failed.');
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <LupiPanelHeader
      kicker="Save and share"
      title={ownsActiveView ? 'Update your view' : savedUrl ? 'Your saved snapshot' : 'Create a view link'}
      titleId={titleId}
      accessory={isMobile ? undefined : <LupiOpticalMark active={Boolean(savedUrl)} />}
      onClose={isMobile ? () => close(true) : undefined}
    />
  );

  // What is being saved. Four rows on desktop; one scannable line on a phone.
  const summary = isMobile ? (
    <div
      data-testid="lupi-save-view-summary"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px 8px',
        color: lupiUserColors.muted,
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      <span style={{ color: lupiUserColors.paper, minWidth: 0, overflowWrap: 'anywhere' }}>{file.name}</span>
      <span aria-hidden="true">·</span>
      <span>{atomCount.toLocaleString()} atoms</span>
      <span aria-hidden="true">·</span>
      <span>frame {frame + 1}</span>
      <span aria-hidden="true">·</span>
      <span>bonds {showBonds ? 'on' : 'off'}</span>
    </div>
  ) : (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <LupiStatusPill label={user ? 'signed in' : 'guest'} tone={user ? 'green' : 'amber'} />
        <LupiStatusPill label={savedUrl ? 'saved' : 'draft'} tone={savedUrl ? 'green' : 'amber'} />
      </div>
      <div
        style={{
          display: 'grid',
          gap: 0,
          borderTop: `1px solid ${lupiUserColors.line}`,
          borderBottom: `1px solid ${lupiUserColors.line}`,
        }}
      >
        <LupiMetaRow label="Source" value={file.name} />
        <LupiMetaRow label="Atoms" value={atomCount} />
        <LupiMetaRow label="Frame" value={frame + 1} />
        <LupiMetaRow label="Bonds" value={showBonds ? 'on' : 'off'} />
      </div>
    </>
  );

  const signedOut = (
    <>
      <LupiNotice>
        {firebaseConfigured
          ? 'Sign in to save a shareable view link. You can export a picture without an account.'
          : 'Sign-in is not available in this build. You can still export a picture without an account.'}
      </LupiNotice>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
        <LupiProviderButton
          provider="google"
          label={isMobile ? 'Continue with Google' : 'Google'}
          onClick={() => handleProviderSignIn('google')}
          disabled={!firebaseConfigured || authLoading}
        />
        <LupiProviderButton
          provider="github"
          label={isMobile ? 'Continue with GitHub' : 'GitHub'}
          onClick={() => handleProviderSignIn('github')}
          disabled={!firebaseConfigured || authLoading}
        />
      </div>
    </>
  );

  const fields = (
    <div style={{ display: 'grid', gap: isMobile ? 12 : 10 }}>
      <LupiField
        label="Name"
        size={controlSize}
        value={title}
        onChange={handleTitleChange}
        placeholder="My molecule study"
      />
      <LupiField
        label="Link name"
        size={controlSize}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={slug}
        onChange={value => {
          setSlugTouched(true);
          setSlug(slugifySavedViewTitle(value));
        }}
        placeholder={slugifySavedViewTitle(title || defaultTitle)}
        hint={isMobile ? urlPreview : undefined}
      />
    </div>
  );

  const visibilityControl = (
    <div style={{ display: 'grid', gap: 6 }}>
      <span style={labelStyle}>Who can find it</span>
      <div role="radiogroup" aria-label="Visibility" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {(['public', 'unlisted'] as const).map(option => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={visibility === option}
            onClick={() => setVisibility(option)}
            style={{
              height: isMobile ? 44 : 36,
              borderRadius: 6,
              border: `1px solid ${visibility === option ? 'rgba(132,215,255,0.6)' : lupiUserColors.line}`,
              background: visibility === option ? 'rgba(132,215,255,0.14)' : 'rgba(244,239,229,0.04)',
              color: lupiUserColors.paper,
              fontFamily: 'var(--font-mono), ui-monospace, monospace',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {option === 'public' ? 'Public' : 'Unlisted'}
          </button>
        ))}
      </div>
      <span style={{ color: lupiUserColors.muted, fontSize: 11, lineHeight: 1.4 }}>
        {visibility === 'public'
          ? 'Listed on your profile and open to search engines.'
          : 'Only people with the link can open it.'}
      </span>
    </div>
  );

  const libraryLink = (
    <button
      type="button"
      onClick={() => { close(); openLibrary(true); }}
      style={{
        justifySelf: 'start',
        padding: 0,
        border: 0,
        background: 'none',
        color: lupiUserColors.cyan,
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
        fontSize: 11,
        fontWeight: 800,
        cursor: 'pointer',
        textDecoration: 'underline',
        textUnderlineOffset: 3,
      }}
    >
      All your views →
    </button>
  );

  const linkPreview = isMobile ? null : (
    <div
      style={{
        display: 'grid',
        gap: 6,
        padding: 10,
        border: `1px solid ${lupiUserColors.line}`,
        borderRadius: 6,
        background: 'rgba(244,239,229,0.04)',
      }}
    >
      <span style={labelStyle}>{savedUrl ? 'Saved link' : 'Link preview — not saved yet'}</span>
      <span
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: lupiUserColors.cyan,
          fontFamily: 'var(--font-mono), ui-monospace, monospace',
          fontSize: 11,
        }}
      >
        {urlPreview}
      </span>
    </div>
  );

  const notices = (
    <>
      {savedUrl && !isMobile && (
        <LupiNotice>
          Your link contains the view as it was when saved. Save again to include later changes.
        </LupiNotice>
      )}
      {error && <LupiNotice tone="pink">{error}</LupiNotice>}
      {status && <LupiNotice tone="green">{status}</LupiNotice>}
    </>
  );

  const saveButton = (
    <LupiButton tone="primary" size={controlSize} onClick={() => void handleSave(false)} disabled={busy || !idToken}>
      {busy ? 'Saving' : ownsActiveView ? 'Update view' : savedUrl ? (isMobile ? 'Save again' : 'Save') : 'Save'}
    </LupiButton>
  );
  const saveAsNewButton = ownsActiveView ? (
    <LupiButton size={controlSize} onClick={() => void handleSave(true)} disabled={busy || !idToken}>
      Save as new
    </LupiButton>
  ) : null;
  const refreshButton = !idToken && user ? (
    <LupiButton size={controlSize} onClick={handleRefreshSession} disabled={busy}>
      Refresh session
    </LupiButton>
  ) : null;
  const copyButton = savedUrl ? (
    <LupiButton tone={isMobile ? 'primary' : 'quiet'} size={controlSize} onClick={handleCopy}>
      {isMobile ? 'Copy link' : 'Copy'}
    </LupiButton>
  ) : null;
  const shareButtons = savedUrl ? (
    <>
      {canNativeShare && <LupiButton size={controlSize} onClick={handleNativeShare}>Share</LupiButton>}
      <LupiButton size={controlSize} onClick={() => handleExternalShare('linkedin')}>LinkedIn</LupiButton>
      <LupiButton size={controlSize} onClick={() => handleExternalShare('x')}>X</LupiButton>
    </>
  ) : null;

  // Desktop keeps Save first; the phone footer leads with Copy once a link exists.
  const actions = isMobile ? (
    savedUrl ? (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: canNativeShare ? '1fr 1fr' : '1fr', gap: 8 }}>
          {copyButton}
          {canNativeShare && <LupiButton size="touch" onClick={handleNativeShare}>Share</LupiButton>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: saveAsNewButton ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8 }}>
          {saveButton}
          {saveAsNewButton}
          {!saveAsNewButton && <LupiButton size="touch" onClick={() => handleExternalShare('linkedin')}>LinkedIn</LupiButton>}
          {!saveAsNewButton && <LupiButton size="touch" onClick={() => handleExternalShare('x')}>X</LupiButton>}
        </div>
      </>
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: refreshButton ? '1fr 1fr' : '1fr', gap: 8 }}>
        {saveButton}
        {refreshButton}
      </div>
    )
  ) : (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: savedUrl || saveAsNewButton ? '1fr 1fr' : '1fr', gap: 8 }}>
        {saveButton}
        {saveAsNewButton}
        {refreshButton}
        {copyButton}
      </div>
      {savedUrl && (
        <div style={{ display: 'grid', gridTemplateColumns: canNativeShare ? '1fr 1fr 1fr' : '1fr 1fr', gap: 8 }}>
          {shareButtons}
        </div>
      )}
    </>
  );

  const recentLimit = isMobile ? 3 : 4;
  const recentLinks = recentViews.length > 0 && (
    <div style={{ display: 'grid', gap: 7 }}>
      <span style={labelStyle}>Recent views</span>
      {recentViews.slice(0, recentLimit).map(view => (
        <LupiIndexRow
          key={view.slug}
          href={makeSavedViewUrl(view.slug)}
          label={view.title}
          after={
            <span
              style={{
                color: lupiUserColors.amber,
                fontFamily: 'var(--font-mono), ui-monospace, monospace',
                fontSize: 10,
                maxWidth: isMobile ? '45%' : undefined,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {view.slug}
            </span>
          }
        />
      ))}
    </div>
  );

  const signedIn: ReactNode = (
    <>
      {fields}
      {visibilityControl}
      {linkPreview}
      {notices}
      {!isMobile && actions}
      {recentLinks}
      {libraryLink}
    </>
  );

  const body = (
    <div style={panelBodyStyle}>
      {summary}
      {user ? signedIn : signedOut}
    </div>
  );

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <LupiUserTrigger
        active={Boolean(savedUrl) || open}
        compact={compact}
        controls={panelId}
        expanded={open}
        glyph={<BookmarkGlyph />}
        label="Save"
        testId="lupi-save-view-button"
        title="Save view"
        onClick={() => setOpen(current => !current)}
      />

      {open && isMobile && (
        <LupiSheet
          testId="lupi-save-view-panel"
          labelledBy={titleId}
          header={header}
          footer={user ? actions : undefined}
          onDismiss={() => close(true)}
          sheetRef={node => {
            sheetRef.current = node;
            if (node) node.id = panelId;
          }}
        >
          {body}
        </LupiSheet>
      )}

      {open && !isMobile && (
        <div id={panelId} role="dialog" aria-labelledby={titleId}>
          <LupiPanel testId="lupi-save-view-panel" width={386} align="left">
            {header}
            {body}
          </LupiPanel>
        </div>
      )}
    </div>
  );
}

function readPendingDraft(): SaveDraft | null {
  try {
    const raw = localStorage.getItem(PENDING_SAVE_KEY);
    return raw ? (JSON.parse(raw) as SaveDraft) : null;
  } catch {
    return null;
  }
}

function writePendingDraft(draft: SaveDraft) {
  localStorage.setItem(PENDING_SAVE_KEY, JSON.stringify(draft));
}
