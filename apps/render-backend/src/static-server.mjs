import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.glb', 'model/gltf-binary'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.xyz', 'chemical/x-xyz; charset=utf-8'],
]);

function parsePort(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('VIEWER_PORT must be an integer from 1 through 65535.');
  }
  return parsed;
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function fileIfPresent(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

export async function startStaticServer(environment = process.env) {
  const root = resolve(environment.WEB_DIST || '/app/web-dist');
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo?.isDirectory()) throw new Error(`WEB_DIST is not a readable directory: ${root}`);
  const indexPath = resolve(root, 'index.html');
  if (!await fileIfPresent(indexPath)) throw new Error('WEB_DIST does not contain index.html.');
  const port = parsePort(environment.VIEWER_PORT, 4173);

  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      sendText(response, 200, 'ok\n');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'Method not allowed.\n');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    } catch {
      sendText(response, 400, 'Bad request.\n');
      return;
    }
    const candidate = resolve(root, `.${pathname}`);
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      sendText(response, 403, 'Forbidden.\n');
      return;
    }
    const candidateInfo = await fileIfPresent(candidate);
    const acceptsHtml = String(request.headers.accept ?? '').includes('text/html');
    const mayUseSpaFallback = pathname === '/' || (acceptsHtml && extname(pathname) === '');
    if (!candidateInfo && !mayUseSpaFallback) {
      sendText(response, 404, 'Not found.\n');
      return;
    }
    const path = candidateInfo ? candidate : indexPath;
    const info = candidateInfo ?? await stat(indexPath);
    const contentType = CONTENT_TYPES.get(extname(path).toLowerCase()) ?? 'application/octet-stream';
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': info.size,
      'cache-control': path === indexPath ? 'no-store' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(path).on('error', () => response.destroy()).pipe(response);
  });
  await new Promise((resolveListen, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolveListen();
    });
  });
  console.log(`[render-backend] local viewer listening on 127.0.0.1:${port}`);
  return server;
}

export function stopStaticServer(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}
