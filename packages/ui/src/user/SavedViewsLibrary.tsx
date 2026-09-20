import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFirebaseAuth } from '../auth/useFirebaseAuth';
import { MOBILE_MEDIA_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import {
  deleteSavedView,
  listUserSavedViews,
  makeSavedViewUrl,
  renameSavedView,
  savedViewMillis,
  updateSavedViewVisibility,
  type SavedMolecularView,
} from '../savedViews';
import { useStore, type SavedViewVisibility } from '../store';
import { formatRelativeTime } from './formatRelativeTime';
import {
  LupiButton,
  LupiNotice,
  LupiPanelHeader,
  LupiSheet,
  LupiStatusPill,
  labelStyle,
  lupiUserColors,
} from './LupiUserPrimitives';

export const savedViewsQueryKey = (uid: string | undefined) => ['savedViews', uid] as const;

/** Navigate the SPA to a saved view without a full reload. */
export function openSavedViewInViewer(slug: string) {
  window.history.pushState({}, '', makeSavedViewUrl(slug));
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Every view the signed-in person owns: open, copy the link, rename, switch
 * between public and unlisted, or delete. A bottom sheet on phones and a
 * centered dialog on desktop; opened from the Account menu or the Save panel.
 */
export function SavedViewsLibrary() {
  const { user } = useFirebaseAuth();
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);
  const close = useStore(s => s.setSavedViewsLibraryOpen);
  const activeSlug = useStore(s => s.activeSavedView?.slug ?? null);
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [notice, setNotice] = useState<{ tone: 'green' | 'pink'; text: string } | null>(null);
  const queryClient = useQueryClient();

  const views = useQuery({
    queryKey: savedViewsQueryKey(user?.uid),
    queryFn: () => listUserSavedViews(user!.uid),
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!user) close(false);
  }, [user, close]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: savedViewsQueryKey(user?.uid) });
  const fail = (err: unknown, fallback: string) =>
    setNotice({ tone: 'pink', text: err instanceof Error ? err.message : fallback });

  const rename = useMutation({
    mutationFn: ({ slug, title }: { slug: string; title: string }) => renameSavedView(slug, title),
    onSuccess: () => { setNotice({ tone: 'green', text: 'Renamed.' }); void invalidate(); },
    onError: err => fail(err, 'Rename failed.'),
  });
  const visibility = useMutation({
    mutationFn: ({ slug, next }: { slug: string; next: SavedViewVisibility }) => updateSavedViewVisibility(slug, next),
    onSuccess: (_, { next }) => {
      setNotice({ tone: 'green', text: next === 'unlisted' ? 'Now unlisted. Only people with the link can open it.' : 'Now public.' });
      void invalidate();
    },
    onError: err => fail(err, 'Could not change visibility.'),
  });
  const remove = useMutation({
    mutationFn: (slug: string) => deleteSavedView(slug),
    onSuccess: () => { setNotice({ tone: 'green', text: 'Deleted.' }); void invalidate(); },
    onError: err => fail(err, 'Delete failed.'),
  });

  const copyLink = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(makeSavedViewUrl(slug));
      setNotice({ tone: 'green', text: 'Link copied.' });
    } catch {
      setNotice({ tone: 'pink', text: 'Could not copy. Open the view and copy its address.' });
    }
  };

  if (!user) return null;
  const list = views.data ?? [];
  const busy = rename.isPending || visibility.isPending || remove.isPending;

  return (
    <LupiSheet
      testId="lupi-saved-views-library"
      labelledBy={titleId}
      variant={isMobile ? 'sheet' : 'dialog'}
      maxWidth={780}
      onDismiss={() => close(false)}
      sheetRef={node => { sheetRef.current = node; }}
      header={
        <LupiPanelHeader
          kicker="Your space"
          title="Your views"
          titleId={titleId}
          accessory={views.data ? <LupiStatusPill label={`${list.length} saved`} tone="cyan" /> : undefined}
          onClose={() => close(false)}
        />
      }
    >
      <div style={{ display: 'grid', gap: 12, padding: 14 }}>
        {notice && <LupiNotice tone={notice.tone}>{notice.text}</LupiNotice>}
        {views.isPending && <p style={mutedCopy}>Loading your views…</p>}
        {views.isError && (
          <LupiNotice tone="pink">
            Your views could not be loaded.{' '}
            <button type="button" onClick={() => void views.refetch()} style={inlineLink}>Try again</button>
          </LupiNotice>
        )}
        {views.data && list.length === 0 && (
          <div style={{ display: 'grid', gap: 8, padding: '18px 4px' }}>
            <span style={{ ...labelStyle, color: lupiUserColors.amber }}>Nothing saved yet</span>
            <p style={mutedCopy}>
              Open a molecule, set it up the way you like, then use Save in the top bar. Each view gets a link you can share, and it will show up here.
            </p>
          </div>
        )}
        {list.length > 0 && (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: 10,
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(230px, 1fr))',
            }}
          >
            {list.map(view => (
              <li key={view.slug}>
                <SavedViewCard
                  view={view}
                  active={view.slug === activeSlug}
                  busy={busy}
                  onOpen={() => { openSavedViewInViewer(view.slug); close(false); }}
                  onCopy={() => void copyLink(view.slug)}
                  onRename={title => rename.mutate({ slug: view.slug, title })}
                  onToggleVisibility={() =>
                    visibility.mutate({ slug: view.slug, next: view.visibility === 'unlisted' ? 'public' : 'unlisted' })}
                  onDelete={() => remove.mutate(view.slug)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </LupiSheet>
  );
}

function SavedViewCard({
  active,
  busy,
  onCopy,
  onDelete,
  onOpen,
  onRename,
  onToggleVisibility,
  view,
}: {
  active: boolean;
  busy: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onRename: (title: string) => void;
  onToggleVisibility: () => void;
  view: SavedMolecularView;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(view.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const unlisted = view.visibility === 'unlisted';
  const updated = formatRelativeTime(savedViewMillis(view.updatedAt ?? view.createdAt));

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = window.setTimeout(() => setConfirmDelete(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== view.title) onRename(next);
    else setDraft(view.title);
  };

  return (
    <article
      data-testid="lupi-saved-view-card"
      style={{
        display: 'grid',
        gap: 10,
        padding: 10,
        border: `1px solid ${active ? 'rgba(242,170,69,0.6)' : lupiUserColors.line}`,
        borderRadius: 10,
        background: 'rgba(244,239,229,0.04)',
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${view.title}`}
        style={{
          position: 'relative',
          display: 'block',
          width: '100%',
          aspectRatio: '16 / 10',
          padding: 0,
          border: `1px solid ${lupiUserColors.line}`,
          borderRadius: 8,
          overflow: 'hidden',
          background: 'radial-gradient(circle at 50% 40%, rgba(132,215,255,0.16), rgba(5,5,5,0.9) 70%)',
          cursor: 'pointer',
        }}
      >
        {view.thumbnail?.dataUrl ? (
          <img
            src={view.thumbnail.dataUrl}
            alt=""
            width={view.thumbnail.width}
            height={view.thumbnail.height}
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: lupiUserColors.muted,
              fontFamily: 'var(--font-mono), ui-monospace, monospace',
              fontSize: 11,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            {view.molecule.name.replace(/\.[a-z0-9]+$/i, '')}
          </span>
        )}
        <span style={{ position: 'absolute', left: 8, top: 8, display: 'flex', gap: 6 }}>
          {active && <Badge tone={lupiUserColors.amber}>On screen</Badge>}
          {unlisted && <Badge tone={lupiUserColors.cyan}>Unlisted</Badge>}
        </span>
      </button>

      <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
        {editing ? (
          <input
            autoFocus
            aria-label="View name"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={event => {
              if (event.key === 'Enter') commitRename();
              if (event.key === 'Escape') { setDraft(view.title); setEditing(false); }
            }}
            style={{
              width: '100%',
              height: 36,
              padding: '0 10px',
              borderRadius: 6,
              border: `1px solid ${lupiUserColors.lineStrong}`,
              background: 'rgba(5,5,5,0.6)',
              color: lupiUserColors.paper,
              fontSize: 16,
              outline: 'none',
            }}
          />
        ) : (
          <span style={{ color: lupiUserColors.paper, fontSize: 14, fontWeight: 760, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {view.title}
          </span>
        )}
        <span style={{ ...metaStyle }}>
          {view.molecule.atomCount.toLocaleString()} atoms
          {updated ? ` · ${updated}` : ''}
          {' · '}
          <span style={{ color: lupiUserColors.cyan }}>/view/{view.slug}</span>
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <LupiButton tone="primary" onClick={onOpen}>Open</LupiButton>
        <LupiButton onClick={onCopy}>Copy link</LupiButton>
        <LupiButton onClick={() => { setDraft(view.title); setEditing(true); }} disabled={busy}>Rename</LupiButton>
        <LupiButton onClick={onToggleVisibility} disabled={busy}>{unlisted ? 'Make public' : 'Make unlisted'}</LupiButton>
        {confirmDelete ? (
          <LupiButton tone="danger" onClick={() => { setConfirmDelete(false); onDelete(); }} disabled={busy}>Confirm delete</LupiButton>
        ) : (
          <LupiButton onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</LupiButton>
        )}
        {confirmDelete && <LupiButton onClick={() => setConfirmDelete(false)}>Keep</LupiButton>}
      </div>
    </article>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: string }) {
  return (
    <span
      style={{
        padding: '3px 7px',
        borderRadius: 999,
        border: `1px solid ${tone}88`,
        background: 'rgba(5,5,5,0.7)',
        color: tone,
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </span>
  );
}

const mutedCopy = {
  margin: 0,
  color: lupiUserColors.muted,
  fontSize: 13,
  lineHeight: 1.5,
} as const;

const metaStyle = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: lupiUserColors.muted,
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: 10.5,
} as const;

const inlineLink = {
  background: 'none',
  border: 0,
  padding: 0,
  color: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
  font: 'inherit',
} as const;
