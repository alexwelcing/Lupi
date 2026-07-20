import { useEffect, useRef, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SavedMolecularView } from '../savedViews';

type SavedViewQuery = Pick<
  UseQueryResult<SavedMolecularView, Error>,
  'error' | 'isError' | 'isFetching' | 'isPending' | 'refetch'
>;

export type SavedViewFailureKind = 'not-found' | 'permission' | 'generic';

const NOT_FOUND_RE = /^No Lupi view found for "([^"]+)"\.$/;

export function classifySavedViewError(error: unknown): SavedViewFailureKind {
  if (typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'permission-denied') {
    return 'permission';
  }
  const message = error instanceof Error ? error.message : '';
  return NOT_FOUND_RE.test(message) ? 'not-found' : 'generic';
}

function displaySlug(slug: string): string {
  const safe = slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return (safe || 'requested-view').slice(0, 80);
}

export function SavedViewLoadState({ slug, query }: { slug: string; query: SavedViewQuery }) {
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const loading = query.isPending || query.isFetching || retrying;
  const failureKind = query.isError ? classifySavedViewError(query.error) : null;

  useEffect(() => {
    if (failureKind) alertRef.current?.focus();
  }, [failureKind]);

  const retry = async () => {
    setRetryMessage(null);
    setRetrying(true);
    const result = await query.refetch();
    setRetrying(false);
    if (result.isError) {
      const kind = classifySavedViewError(result.error);
      setRetryMessage(kind === 'not-found'
        ? 'Retry completed; view still not found.'
        : 'Retry completed; the view still could not be opened.');
    }
  };

  if (loading) {
    return (
      <section role="status" aria-live="polite" aria-label="Saved view loading" style={shellStyle}>
        <p style={eyebrowStyle}>Saved Lupi view</p>
        <h1 style={headingStyle}>Opening view…</h1>
        <p style={copyStyle}>Loading “{displaySlug(slug)}” and its molecule.</p>
      </section>
    );
  }

  if (!failureKind) return null;

  const notFound = failureKind === 'not-found';
  const permission = failureKind === 'permission';
  return (
    <section
      ref={alertRef}
      role="alert"
      aria-labelledby="saved-view-error-title"
      tabIndex={-1}
      style={shellStyle}
    >
      <p style={eyebrowStyle}>Saved Lupi view</p>
      <h1 id="saved-view-error-title" style={headingStyle}>
        {notFound ? 'View not found' : 'This view could not be opened'}
      </h1>
      <p style={copyStyle}>
        {notFound
          ? `No public view is available for “${displaySlug(slug)}”.`
          : permission
            ? 'Lupi was not permitted to read this view. It may be private or access may have changed.'
            : 'Lupi could not load this saved view. Check your connection and try again.'}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
        <button type="button" onClick={() => void retry()} style={primaryButtonStyle}>Retry</button>
        <a href="/#gallery" style={secondaryLinkStyle}>Back to Explore</a>
      </div>
      {retryMessage && <p role="status" aria-live="polite" style={retryStyle}>{retryMessage}</p>}
    </section>
  );
}

const shellStyle = {
  width: 'min(560px, calc(100% - 40px))',
  margin: 'clamp(96px, 18vh, 180px) auto 48px',
  padding: '32px',
  color: '#f8fafc',
  background: 'rgba(10, 12, 18, 0.94)',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: 16,
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.45)',
} as const;

const eyebrowStyle = { margin: '0 0 10px', color: '#67e8f9', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase' } as const;
const headingStyle = { margin: 0, fontSize: 'clamp(28px, 5vw, 42px)', lineHeight: 1.05 } as const;
const copyStyle = { margin: '16px 0 0', color: '#cbd5e1', fontSize: 16, lineHeight: 1.6 } as const;
const retryStyle = { margin: '18px 0 0', color: '#a5f3fc', fontSize: 14 } as const;
const primaryButtonStyle = { border: 0, borderRadius: 8, padding: '10px 18px', background: '#22d3ee', color: '#082f49', fontWeight: 700, cursor: 'pointer' } as const;
const secondaryLinkStyle = { display: 'inline-flex', alignItems: 'center', borderRadius: 8, padding: '10px 18px', border: '1px solid #475569', color: '#e2e8f0', textDecoration: 'none', fontWeight: 600 } as const;
