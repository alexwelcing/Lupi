/**
 * Hugging Face from the edge: Spaces as APIs, and the Hub's MCP server.
 *
 * The token stays here. The browser never holds it; it asks this Worker,
 * which calls a Space's Gradio API (upload, call, stream the result, fetch
 * the file) or the Hub MCP server (JSON-RPC over HTTP with a session) on
 * its behalf. Nothing in this file knows what SAM is; the routes that do
 * (`remote.ts`) build on these two clients.
 *
 * Gradio's HTTP API, as of 5.x/6.x:
 *   POST {host}/gradio_api/upload                 multipart `files` → ["<server path>", …]
 *   POST {host}/gradio_api/call/{api_name}        { data: [...] } → { event_id }
 *   GET  {host}/gradio_api/call/{api_name}/{id}   server-sent events; `complete` carries the outputs
 *   GET  {host}/gradio_api/file={path}            an output file
 * A file input is `{ path, meta: { _type: 'gradio.FileData' } }`; a file
 * output carries `url`. Spaces on ZeroGPU meter by the bearer token.
 */

export interface HfEnv {
  HF_TOKEN?: string;
}

export function hfConfigured(env: HfEnv): boolean {
  return typeof env.HF_TOKEN === 'string' && env.HF_TOKEN.trim().length > 0;
}

export class HfError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'HfError';
    this.status = status;
  }
}

/** The `*.hf.space` host of a Space id such as `owner/some-space`. */
export function spaceHost(spaceId: string): string {
  const slug = spaceId
    .trim()
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '-');
  return `https://${slug}.hf.space`;
}

export interface GradioFile {
  path: string;
  url?: string;
  orig_name?: string;
  mime_type?: string;
  size?: number;
  meta: { _type: 'gradio.FileData' };
}

export interface GradioOptions {
  token?: string;
  fetcher?: typeof fetch;
  /** Whole-call budget, submit to result. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Progress lines from the stream (`generating`, `heartbeat`, custom), for logs. */
  onEvent?: (event: string, data: string) => void;
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new HfError('Space call timed out.', 504)), timeoutMs);
  const relay = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', relay, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relay);
    },
  };
}

/** Upload one file to a Space; the returned object is what a file input takes. */
export async function gradioUpload(host: string, file: Blob, filename: string, options: GradioOptions = {}): Promise<GradioFile> {
  const fetcher = options.fetcher ?? fetch;
  const body = new FormData();
  body.append('files', file, filename);
  const response = await fetcher(`${host}/gradio_api/upload`, { method: 'POST', body, headers: authHeaders(options.token), signal: options.signal });
  if (!response.ok) throw new HfError(`Upload to ${host} answered ${response.status}.`, response.status);
  const paths = (await response.json()) as unknown;
  const path = Array.isArray(paths) && typeof paths[0] === 'string' ? paths[0] : null;
  if (!path) throw new HfError(`Upload to ${host} returned no path.`);
  return { path, orig_name: filename, mime_type: file.type || undefined, size: file.size, meta: { _type: 'gradio.FileData' } };
}

/** Parse a server-sent event stream into (event, data) pairs. */
async function* serverSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let data: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    buffer += done ? '\n\n' : decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut).replace(/\r$/, '');
      buffer = buffer.slice(cut + 1);
      if (line === '') {
        if (data.length) yield { event, data: data.join('\n') };
        event = 'message';
        data = [];
      } else if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (done) return;
  }
}

/**
 * Call a Space endpoint and wait for its outputs. `data` is the positional
 * input list the endpoint's `/gradio_api/info` describes.
 */
export async function gradioCall<T = unknown[]>(host: string, endpoint: string, data: unknown[], options: GradioOptions = {}): Promise<{ data: T; ms: number }> {
  const fetcher = options.fetcher ?? fetch;
  const started = Date.now();
  const clock = withTimeout(options.signal, options.timeoutMs ?? 180_000);
  try {
    const name = endpoint.replace(/^\//, '');
    const submit = await fetcher(`${host}/gradio_api/call/${name}`, {
      method: 'POST',
      headers: { ...authHeaders(options.token), 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
      signal: clock.signal,
    });
    if (!submit.ok) throw new HfError(`${host} /${name} answered ${submit.status}: ${(await submit.text()).slice(0, 200)}`, submit.status);
    const { event_id: eventId } = (await submit.json()) as { event_id?: string };
    if (!eventId) throw new HfError(`${host} /${name} returned no event id.`);
    const stream = await fetcher(`${host}/gradio_api/call/${name}/${eventId}`, { headers: { ...authHeaders(options.token), accept: 'text/event-stream' }, signal: clock.signal });
    if (!stream.ok || !stream.body) throw new HfError(`${host} /${name} stream answered ${stream.status}.`, stream.status);
    for await (const { event, data: payload } of serverSentEvents(stream.body)) {
      options.onEvent?.(event, payload);
      if (event === 'complete') return { data: JSON.parse(payload) as T, ms: Date.now() - started };
      if (event === 'error') throw new HfError(`${host} /${name} failed: ${payload.slice(0, 300) || 'no detail'}`);
    }
    throw new HfError(`${host} /${name} ended without a result.`);
  } finally {
    clock.done();
  }
}

/**
 * Fetch an output file a Space produced. The token goes only to the Space
 * itself: a `url` on any other origin is refused, so a Space cannot hand
 * back an address of its choosing and collect the credential.
 */
export async function gradioFetchFile(host: string, file: { url?: string; path?: string }, options: GradioOptions = {}): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const url = file.url ?? (file.path ? `${host}/gradio_api/file=${file.path}` : null);
  if (!url) throw new HfError('Output has neither url nor path.');
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new HfError('Output url is not a valid URL.');
  }
  if (origin !== new URL(host).origin) throw new HfError(`Output url is on ${origin}, not the Space; refused.`);
  const response = await fetcher(url, { headers: authHeaders(options.token), signal: options.signal });
  if (!response.ok) throw new HfError(`Fetching ${url} answered ${response.status}.`, response.status);
  return response;
}

/** Runtime state of a Space from the Hub API: whether it is up and on what hardware. */
export async function spaceRuntime(spaceId: string, options: GradioOptions = {}): Promise<{ stage: string; hardware: string | null }> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(`https://huggingface.co/api/spaces/${spaceId}`, { headers: authHeaders(options.token), signal: options.signal });
  if (!response.ok) throw new HfError(`Space ${spaceId} lookup answered ${response.status}.`, response.status);
  const body = (await response.json()) as { runtime?: { stage?: string; hardware?: { current?: string | null } } };
  return { stage: body.runtime?.stage ?? 'UNKNOWN', hardware: body.runtime?.hardware?.current ?? null };
}

/* ─── Hub MCP ─── */

const HF_MCP_URL = 'https://huggingface.co/mcp';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * A minimal client for the Hub's MCP server: initialize once, then list and
 * call tools. The server wants the session id back on every call after the
 * first; responses come as JSON or as one server-sent `message` event.
 */
export class HfMcpClient {
  private session: string | null = null;
  private nextId = 1;
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async rpc<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {
      ...authHeaders(this.token),
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.session) headers['mcp-session-id'] = this.session;
    const response = await this.fetcher(HF_MCP_URL, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }), signal });
    const session = response.headers.get('mcp-session-id');
    if (session) this.session = session;
    if (!response.ok) throw new HfError(`Hub MCP ${method} answered ${response.status}.`, response.status);
    const text = await response.text();
    let message: { result?: T; error?: { code: number; message: string } } | null = null;
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('text/event-stream')) {
      for (const line of text.split('\n')) if (line.startsWith('data:')) message = JSON.parse(line.slice(5));
    } else if (text.trim()) message = JSON.parse(text);
    if (!message) throw new HfError(`Hub MCP ${method} returned nothing.`);
    if (message.error) throw new HfError(`Hub MCP ${method}: ${message.error.message}`);
    return message.result as T;
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.session) return;
    await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lupi-edge', version: '0.1' } }, signal);
  }

  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    await this.initialize(signal);
    const result = await this.rpc<{ tools?: McpTool[] }>('tools/list', {}, signal);
    return result.tools ?? [];
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    await this.initialize(signal);
    return this.rpc<T>('tools/call', { name, arguments: args }, signal);
  }
}
