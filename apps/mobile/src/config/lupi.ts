export const DEFAULT_LUPI_WEB_URL = "https://lupi.live";
export const APPROVED_LUPI_RELEASE_ORIGINS = [DEFAULT_LUPI_WEB_URL] as const;

interface LupiWebUrlValidationOptions {
  release?: boolean;
}

export function validateLupiWebBaseUrl(
  configured: string,
  { release = true }: LupiWebUrlValidationOptions = {},
): string {
  const value = configured.trim();
  if (!value) throw new Error("Lupi web origin is empty.");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Lupi web origin must be a valid absolute URL.");
  }

  if (url.username || url.password)
    throw new Error("Lupi web origin cannot contain credentials.");
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      "Lupi web origin cannot contain a path, query, or fragment.",
    );
  }

  const isLocalDevelopmentOrigin =
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]");

  if (release) {
    if (url.protocol !== "https:")
      throw new Error("Lupi release builds require HTTPS.");
    if (
      !APPROVED_LUPI_RELEASE_ORIGINS.includes(
        url.origin as typeof DEFAULT_LUPI_WEB_URL,
      )
    ) {
      throw new Error(`Unapproved Lupi release origin: ${url.origin}`);
    }
  } else if (url.protocol !== "https:" && !isLocalDevelopmentOrigin) {
    throw new Error("Development builds require HTTPS or a local HTTP origin.");
  }

  return url.origin;
}

export function getLupiWebBaseUrl(): string {
  const configured =
    process.env.EXPO_PUBLIC_LUPI_WEB_URL?.trim() || DEFAULT_LUPI_WEB_URL;
  const release = typeof __DEV__ === "undefined" || !__DEV__;
  return validateLupiWebBaseUrl(configured, { release });
}

export function getLupiEmbeddedViewerUrl(): string {
  // `?load` keeps today's deployed web app on its immediate viewer code path.
  // The hash is the first-class chrome-free route used by newer deployments.
  // Together they give Expo a backwards-compatible bridge surface without
  // mounting the visible MCP harness or its default-Benzene side effect.
  return `${getLupiWebBaseUrl()}/?load#/embed/mobile`;
}

export function getLupiSavedViewUrl(savedViewSlug: string): string {
  return `${getLupiWebBaseUrl()}/view/${encodeURIComponent(savedViewSlug)}`;
}
