#!/usr/bin/env node
/** Local SDK host for the ChatGPT plugin. This is never a ChatGPT emulator or
 * a production endpoint. It executes the real Worker handler and PubChem fetch
 * path, and serves the built MCP UI resource in a sandboxed iframe. */
import { createServer, type IncomingMessage } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import {
  CHATGPT_MCP_PATH, CHATGPT_WIDGET_PATH, handleChatGptMcp, MoleculeService,
} from '../apps/mcp-worker/src/chatgpt.ts';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST_ROOT = join(REPO_ROOT, 'tools/chatgpt-host');
const WIDGET_HTML = join(REPO_ROOT, 'apps/chatgpt-widget/dist/index.html');

export function runStamp(): string { return new Date().toISOString().replace(/[:.]/g, '-'); }
export function gitEvidence() {
  try {
    // git diff alone omits newly created, untracked plugin sources. Bind the
    // evidence to the contents of every changed/untracked, non-ignored file.
    const changedPaths = [...new Set([
      ...execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\0'),
      ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\0'),
    ].filter(Boolean))].sort();
    const changedSources = changedPaths.map((path) => {
      const fullPath = join(REPO_ROOT, path);
      if (!existsSync(fullPath)) return { path, deleted: true };
      const bytes = readFileSync(fullPath);
      return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
    return {
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
      workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()),
      diffSha256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD'], { cwd: REPO_ROOT })).digest('hex'),
      changedSources,
      changedSourcesSha256: createHash('sha256').update(JSON.stringify(changedSources)).digest('hex'),
    };
  } catch { return { revision: 'unavailable', workingTreeDirty: true, diffSha256: null }; }
}

type EvidenceEntry = {
  id: number; kind: 'pubchem' | 'mcp'; startedAt: string; durationMs: number;
  request: { url: string; method: string; cache: RequestCache; headers: Record<string, string>; body?: string };
  response?: { status: number; headers: Record<string, string>; bytes: number; sha256: string; file: string };
  error?: string;
};

/** Each response is stored exactly as received. In particular, the live
 * acceptance path never reads checked-in or previously captured PubChem data. */
export class EvidenceRecorder {
  readonly entries: EvidenceEntry[] = [];
  private sequence = 0;
  constructor(readonly directory: string) {}
  async record(request: Request, run: () => Promise<Response>, kind: EvidenceEntry['kind']): Promise<Response> {
    const id = ++this.sequence;
    const start = performance.now();
    const entry: EvidenceEntry = {
      id, kind, startedAt: new Date().toISOString(), durationMs: 0,
      request: {
        url: request.url, method: request.method, cache: request.cache, headers: Object.fromEntries(request.headers),
        ...(request.method === 'POST' ? { body: await request.clone().text() } : {}),
      },
    };
    this.entries.push(entry);
    await mkdir(this.directory, { recursive: true });
    try {
      const response = await run();
      const bytes = Buffer.from(await response.clone().arrayBuffer());
      const file = `${String(id).padStart(4, '0')}-${kind}-response.${response.headers.get('content-type')?.includes('json') ? 'json' : 'txt'}`;
      await writeFile(join(this.directory, file), bytes);
      entry.response = {
        status: response.status, headers: Object.fromEntries(response.headers), bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), file,
      };
      return response;
    } catch (cause) {
      entry.error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      entry.durationMs = Math.round(performance.now() - start);
      await writeFile(join(this.directory, `${String(id).padStart(4, '0')}-${kind}-request.json`), `${JSON.stringify(entry, null, 2)}\n`);
    }
  }
  async flush() { await writeFile(join(this.directory, 'index.json'), `${JSON.stringify(this.entries, null, 2)}\n`); }
}

async function compileHost(): Promise<string> {
  const result = await build({
    configFile: false, root: HOST_ROOT, publicDir: false, logLevel: 'error',
    build: {
      write: false, target: 'es2022', minify: false,
      lib: { entry: join(HOST_ROOT, 'main.ts'), formats: ['es'] },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => 'output' in item ? item.output : []);
  const entry = outputs.find((item) => item.type === 'chunk' && item.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('The development host did not produce its JavaScript entry.');
  return entry.code;
}

async function incomingRequest(message: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of message) {
    bytes += chunk.length;
    if (bytes > 16_384) throw new Error('Development request exceeds 16 KiB.');
    chunks.push(Buffer.from(chunk));
  }
  const method = message.method ?? 'GET';
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
  }
  return new Request(new URL(message.url ?? '/', origin), {
    method, headers, ...(!['GET', 'HEAD'].includes(method) ? { body: Buffer.concat(chunks) } : {}),
  });
}

export interface DevServerOptions {
  port?: number;
  evidenceDirectory?: string;
}

export async function startChatGptDevServer(options: DevServerOptions = {}) {
  if (!existsSync(WIDGET_HTML)) throw new Error('Build the widget first: pnpm --filter @atlas/chatgpt-widget build');
  const recorder = new EvidenceRecorder(resolve(options.evidenceDirectory ?? join(REPO_ROOT, '.verify-artifacts/chatgpt', `dev-${runStamp()}`, 'http')));
  const hostJs = await compileHost();
  const hostHtml = await readFile(join(HOST_ROOT, 'index.html'), 'utf8');
  const upstream = globalThis.fetch;
  const service = new MoleculeService({
    fetch: (input, init) => {
      const request = new Request(input, init);
      return recorder.record(request, () => upstream(request), 'pubchem');
    },
  });
  const env = {
    WEB_ASSETS: {
      async fetch(request: Request) {
        if (new URL(request.url).pathname !== CHATGPT_WIDGET_PATH) return new Response('Not found', { status: 404 });
        return new Response(await readFile(WIDGET_HTML, 'utf8'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      },
    },
  };
  let origin = '';
  const server = createServer(async (message, output) => {
    try {
      const request = await incomingRequest(message, origin);
      const path = new URL(request.url).pathname;
      let response: Response;
      if (path === CHATGPT_MCP_PATH) {
        response = await recorder.record(request, () => handleChatGptMcp(request, env, service), 'mcp');
      } else if (path === '/' && request.method === 'GET') {
        response = new Response(hostHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      } else if (path === '/host.js' && request.method === 'GET') {
        response = new Response(hostJs, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
      } else if (path === '/health' && request.method === 'GET') {
        response = Response.json({ status: 'ok', host: 'Development MCP host', actualChatGpt: false, endpoint: CHATGPT_MCP_PATH });
      } else response = new Response('Not found', { status: 404 });
      output.writeHead(response.status, { ...Object.fromEntries(response.headers), 'cache-control': 'no-store' });
      output.end(Buffer.from(await response.arrayBuffer()));
    } catch (cause) {
      output.writeHead(500, { 'content-type': 'application/json' });
      output.end(JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) }));
    }
  });
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4319, '127.0.0.1', () => accept());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Development listener did not expose a TCP port.');
  origin = `http://127.0.0.1:${address.port}`;
  await mkdir(recorder.directory, { recursive: true });
  await writeFile(join(recorder.directory, 'run.json'), `${JSON.stringify({
    createdAt: new Date().toISOString(), ...gitEvidence(), origin,
    host: 'Development MCP host', actualChatGpt: false,
    widgetSha256: createHash('sha256').update(await readFile(WIDGET_HTML)).digest('hex'),
    upstream: 'Live PubChem PUG REST; no fixture fallback',
  }, null, 2)}\n`);
  return {
    origin, recorder,
    async close() {
      await recorder.flush();
      await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const portArg = process.argv.find((arg) => arg.startsWith('--port='))?.slice(7);
  const evidenceArg = process.argv.find((arg) => arg.startsWith('--evidence='))?.slice(11);
  const server = await startChatGptDevServer({ port: Number(portArg ?? process.env.PORT ?? 4319), evidenceDirectory: evidenceArg });
  console.log(`Development MCP host: ${server.origin}\nLocal MCP endpoint: ${server.origin}${CHATGPT_MCP_PATH}\nThis is a local SDK test host, not ChatGPT. HTTP evidence: ${server.recorder.directory}`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    if (closing) return;
    closing = true;
    void server.close().then(() => process.exit(0));
  });
}
