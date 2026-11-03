import registry from '../../web/public/launch/campaigns.json' with { type: 'json' };

interface LaunchAssets {
  fetch(request: Request): Promise<Response>;
}

const PAGE_MARKER = '<meta name="lupi-launch" content="v1">';
const pages = new Set(['/launch/', ...registry.campaigns.flatMap((campaign) => [
  `/launch/${campaign.slug}/`,
  ...campaign.placements.map((placement) => `/launch/${campaign.slug}/${placement.id}/`),
])]);
const assets = new Map([
  ['/launch/campaigns.json', 'json'],
  ['/launch/model.mjs', 'javascript'],
  ['/launch/page.mjs', 'javascript'],
  ['/launch/style.css', 'css'],
  ...registry.campaigns.filter((campaign) => campaign.heroImage.startsWith('/launch/assets/'))
    .map((campaign) => [campaign.heroImage, 'png']),
] as [string, string][]);

function error(request: Request, status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(request.method === 'HEAD' ? null : message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', ...extra },
  });
}

async function boundedBody(response: Response, maximum: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function validContent(kind: string, mime: string, body: Uint8Array): boolean {
  if (kind === 'png') {
    return mime === 'image/png' && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => body[i] === value);
  }
  const text = new TextDecoder().decode(body);
  if (kind === 'page') return mime === 'text/html' && text.includes(PAGE_MARKER);
  if (kind === 'json') {
    if (mime !== 'application/json') return false;
    try { return JSON.parse(text)?.schema === 'lupi.launch.v1'; } catch { return false; }
  }
  if (kind === 'javascript' && !['application/javascript', 'text/javascript'].includes(mime)) return false;
  if (kind === 'css' && mime !== 'text/css') return false;
  return text.trim().length > 0 && !text.trimStart().startsWith('<');
}

/** Reserve the launch namespace so unknown pages and missing files never reach the SPA. */
export async function handleLaunchRequest(request: Request, binding?: LaunchAssets): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== '/launch' && !path.startsWith('/launch/')) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return error(request, 405, 'Method not allowed.', { allow: 'GET, HEAD' });
  }
  const canonical = path.endsWith('/') ? path : `${path}/`;
  const page = pages.has(canonical);
  const kind = page ? 'page' : assets.get(path);
  if (!kind) return error(request, 404, 'Launch page or asset not found.');
  if (page && path !== canonical) {
    return new Response(null, { status: 308, headers: { location: canonical + url.search } });
  }
  if (!binding) return error(request, 503, 'Launch assets are unavailable.');
  try {
    // A fresh GET verifies HEAD requests too. Do not forward browser credentials or ranges.
    const response = await binding.fetch(new Request(url.origin + path, {
      method: 'GET', credentials: 'omit', redirect: 'manual',
    }));
    if (response.status === 404) return error(request, 404, 'Launch page or asset not found.');
    if (response.status !== 200) return error(request, 503, 'Launch assets are unavailable.');
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const body = await boundedBody(response, kind === 'png' ? 8 * 1024 * 1024 : 256 * 1024);
    if (!body || !validContent(kind, mime, body)) return error(request, 503, 'Launch asset is missing or invalid.');
    const headers = new Headers(response.headers);
    headers.delete('set-cookie');
    headers.delete('content-encoding');
    headers.set('content-length', String(body.byteLength));
    headers.set('x-content-type-options', 'nosniff');
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
  } catch {
    return error(request, 503, 'Launch assets are unavailable.');
  }
}
