import { EXTERNAL_RESEARCH_DATASETS, externalResearchLoadPath } from '@atlas/core';

export type RemoteMoleculeUrlContext = 'mcp' | 'human-load' | 'saved-view';

export interface AllowedRemoteMoleculeUrl {
  /** Normalized fetch target. Root-relative inputs remain root-relative for portable saved views. */
  url: string;
  absoluteUrl: string;
  sameOriginStrict: boolean;
}

export class RemoteMoleculeUrlPolicyError extends Error {
  readonly code = 'unsafe-remote-molecule-url';

  constructor(message = 'This remote molecule link is not allowed. Use a trusted Lupi gallery or catalog source.') {
    super(message);
    this.name = 'RemoteMoleculeUrlPolicyError';
  }
}

const MOLECULE_PATH_RE = /\.(?:glimbin|xyz|extxyz|dump|lammpstrj|lammps|data)$/i;
const LUPI_HOSTS = new Set(['lupi.live', 'www.lupi.live']);
const GCS_PREFIXES = [
  '/shed-489901-nist-demos/',
  '/shed-489901-omol25/',
] as const;
const OMOL_COLLECTION_IDS = new Set([
  'neutral-train',
  'neutral-validation',
  'all-train-preview',
  'train-4m-preview',
  'validation-preview',
]);
const RESEARCH_DATA_PATHS = new Set(EXTERNAL_RESEARCH_DATASETS.map(externalResearchLoadPath));
const GENERATED_GALLERY_PATHS = new Set([
  '/generated/lupine-wiki/sphere-grid.lammpstrj',
]);

/**
 * The sole trust boundary for automatic remote molecule loads.
 * Generic URL recognition may be broad; execution must pass through here.
 */
export function assertAllowedRemoteMoleculeUrl(
  input: string,
  context: RemoteMoleculeUrlContext,
  currentOrigin: string,
): AllowedRemoteMoleculeUrl {
  if (typeof input !== 'string' || input.length === 0 || input !== input.trim() || input.includes('\\')) {
    throw new RemoteMoleculeUrlPolicyError();
  }

  const origin = parseOrigin(currentOrigin);
  const rootRelative = input.startsWith('/') && !input.startsWith('//');
  if (rootRelative) {
    if (context === 'mcp') throw new RemoteMoleculeUrlPolicyError('MCP molecule URLs must be absolute HTTPS URLs.');
    const parsed = new URL(input, origin);
    // A root-relative URL cannot redirect the initial request away from the
    // current origin. Permit the local HTTP origin used to serve a production
    // bundle in preview/CI; strictRemote still rejects any redirect response.
    assertSafeUrlShape(parsed, isLocalDevelopmentHost(origin.hostname.toLowerCase()));
    assertMoleculePath(parsed.pathname);
    if (!parsed.pathname.startsWith('/gallery/')
      && !GENERATED_GALLERY_PATHS.has(parsed.pathname)
      && !isTrustedScienceDataUrl(parsed)) {
      throw new RemoteMoleculeUrlPolicyError();
    }
    return {
      url: `${parsed.pathname}${parsed.search}${parsed.hash}`,
      absoluteUrl: parsed.toString(),
      sameOriginStrict: true,
    };
  }

  if (input.startsWith('//') || !/^https?:\/\//i.test(input)) {
    throw new RemoteMoleculeUrlPolicyError(context === 'mcp'
      ? 'MCP molecule URLs must be absolute HTTPS URLs.'
      : undefined);
  }
  if (context === 'mcp' && /^http:\/\//i.test(input)) {
    throw new RemoteMoleculeUrlPolicyError('MCP molecule URLs must be absolute HTTPS URLs.');
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new RemoteMoleculeUrlPolicyError();
  }
  const hostname = parsed.hostname.toLowerCase();
  const localDevelopmentTarget = context === 'human-load'
    && isLocalDevelopmentHost(hostname)
    && isLocalDevelopmentHost(origin.hostname.toLowerCase())
    && isDevelopmentOrTest();
  assertSafeUrlShape(parsed, localDevelopmentTarget);
  assertMoleculePath(parsed.pathname);

  if (isLocalDevelopmentHost(hostname)) {
    if (!localDevelopmentTarget) throw new RemoteMoleculeUrlPolicyError();
    return { url: parsed.toString(), absoluteUrl: parsed.toString(), sameOriginStrict: false };
  }

  if (isIpLiteral(hostname) || hostname.endsWith('.local')) throw new RemoteMoleculeUrlPolicyError();

  const allowed = (LUPI_HOSTS.has(hostname)
      && (parsed.pathname.startsWith('/gallery/') || isTrustedScienceDataUrl(parsed)))
    || (hostname === 'storage.googleapis.com' && GCS_PREFIXES.some(prefix => parsed.pathname.startsWith(prefix)));
  if (!allowed) throw new RemoteMoleculeUrlPolicyError();

  return { url: parsed.toString(), absoluteUrl: parsed.toString(), sameOriginStrict: false };
}

function parseOrigin(currentOrigin: string): URL {
  try {
    const origin = new URL(currentOrigin);
    if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password) throw new Error('bad origin');
    return origin;
  } catch {
    throw new RemoteMoleculeUrlPolicyError('Lupi could not validate this link against the current site origin.');
  }
}

function assertSafeUrlShape(url: URL, allowLocalHttp = false): void {
  const allowedProtocol = url.protocol === 'https:' || (allowLocalHttp && url.protocol === 'http:');
  if (!allowedProtocol || url.username || url.password || (url.port && !allowLocalHttp && url.port !== '443')) {
    throw new RemoteMoleculeUrlPolicyError();
  }
}

function assertMoleculePath(pathname: string): void {
  if (!MOLECULE_PATH_RE.test(pathname)) throw new RemoteMoleculeUrlPolicyError('The remote link must point to a supported molecule file.');
}

function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isDevelopmentOrTest(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === 'test';
}

function isTrustedScienceDataUrl(url: URL): boolean {
  if (url.search || url.hash) return false;
  const omol = url.pathname.match(/^\/v1\/datasets\/omol25\/([a-z0-9-]+)\/structures\/\d+\.xyz$/);
  return Boolean(omol && OMOL_COLLECTION_IDS.has(omol[1])) || RESEARCH_DATA_PATHS.has(url.pathname);
}
