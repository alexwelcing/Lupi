// /scale addresses: `?e=<entry>` for a catalog entry and `?ref=lsr1:…` for a
// piece (scale-spec §7.1's text form). The reference is the whole view's
// identity: its records are embedded, so the link opens the same piece on any
// device, with no server state.

export const SCALE_PATH = '/scale';

export interface ScaleAddress {
  entryId?: string | null;
  ref?: string | null;
}

/** Base64url and the `lsr1:` prefix need no escaping in a query, so the link stays readable. */
export function scaleUrl(address: ScaleAddress): string {
  if (address.ref) return `${SCALE_PATH}?ref=${address.ref}`;
  if (address.entryId) return `${SCALE_PATH}?e=${encodeURIComponent(address.entryId)}`;
  return SCALE_PATH;
}

export function readScaleUrl(search: string): { entryId: string | null; ref: string | null } {
  const params = new URLSearchParams(search);
  const ref = params.get('ref');
  return {
    entryId: params.get('e'),
    ref: ref && /^lsr1:[A-Za-z0-9_-]+$/.test(ref.trim()) ? ref.trim() : null,
  };
}
