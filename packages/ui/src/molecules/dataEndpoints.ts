const NIST_BASE = String(import.meta.env.VITE_NIST_BASE_URL ?? '/nist').replace(/\/+$/, '');

/** Resolve the small bundled catalog and externally hosted NIST demos through
 * one endpoint contract so Search, the panel, and MCP cannot drift apart. */
export function nistCatalogUrl(): string {
  return `${NIST_BASE}/nist_catalog.json`;
}

export function nistDemoUrl(demoPath: string): string {
  if (/^https:\/\//i.test(demoPath)) return demoPath;
  const relative = demoPath.replace(/^\/+/, '');
  return `${NIST_BASE}/${relative}`;
}

/** Scientific dataset routes are same-origin in production and forwarded to
 * the local Worker by Vite during development. */
export function scienceDataUrl(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
