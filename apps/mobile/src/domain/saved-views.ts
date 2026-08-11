export function normalizeSavedViewInput(
  value: string,
  trustedBaseUrl: string,
): string | null {
  let candidate = value.trim();
  if (!candidate) return null;

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      if (
        parsed.origin !== new URL(trustedBaseUrl).origin ||
        parsed.search ||
        parsed.hash
      )
        return null;
      const match = parsed.pathname.match(/^\/view\/([^/]+)\/?$/i);
      if (!match?.[1]) return null;
      candidate = decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  } else {
    candidate = candidate.replace(/^\/?view\//i, "").replace(/^\/+|\/+$/g, "");
  }

  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(candidate) && candidate.length <= 80
    ? candidate.toLowerCase()
    : null;
}
