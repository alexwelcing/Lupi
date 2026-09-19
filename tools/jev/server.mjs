import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Development demo only: loopback, same-origin POST, bounded inputs/concurrency/budget.
// A production deployment needs its own user authentication and durable rate limits.
export function startDemo({ port, assets, evaluate, data = () => ({}) }) {
  const origin = `http://127.0.0.1:${port}`;
  let active = 0, calls = 0, windowStart = Date.now(), windowCalls = 0;
  const server = createServer(async (request, response) => {
    const send = (status, value, type = 'application/json') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src https://lupi.live; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
      response.end(type === 'application/json' ? JSON.stringify(value) : value);
    };
    if (request.headers.host !== new URL(origin).host) return send(403, { error: 'Invalid host' });
    const url = new URL(request.url, origin);
    if (request.method === 'GET' && Object.hasOwn(assets, url.pathname)) {
      const [path, type] = assets[url.pathname];
      try { return send(200, await readFile(path), type); }
      catch { return send(404, { error: 'Demo asset unavailable' }); }
    }
    if (request.method === 'GET' && url.pathname === '/api/data') return send(200, data());
    if (request.method !== 'POST' || url.pathname !== '/api/evaluate') return send(404, { error: 'Not found' });
    if (request.headers.origin !== origin || !request.headers['content-type']?.startsWith('application/json')) return send(403, { error: 'Same-origin JSON required' });
    if (Date.now() - windowStart > 60000) { windowStart = Date.now(); windowCalls = 0; }
    if (active >= 2 || calls >= 100 || windowCalls >= 60) return send(429, { error: 'Demo request limit reached' });
    active++; calls++; windowCalls++;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 4096) { send(413, { error: 'Request too large' }); request.resume(); return; }
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'Invalid JSON' }); }
      if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 600) return send(400, { error: 'Enter 1–600 characters' });
      return send(200, await evaluate(input.text));
    } catch { return send(500, { error: 'Demo unavailable' }); }
    finally { active--; }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.listen(port, '127.0.0.1', () => console.log(`Jev demo: ${origin}`));
  return server;
}
