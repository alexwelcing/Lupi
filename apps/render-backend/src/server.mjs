import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import {
  BrowserRenderError,
  RendererDeadlineError,
  enqueueRender,
  rendererLaneState,
} from './engine.mjs';
import {
  MAX_REQUEST_BODY_BYTES,
  RENDERER_REQUEST_PROTOCOL,
  RENDERER_RESPONSE_PROTOCOL,
  RendererRequestError,
  validateRendererEnvelope,
} from './protocol.mjs';

const DEFAULT_RENDER_DEADLINE_MS = 85_000;
const MIN_RENDER_DEADLINE_MS = 5_000;
const MAX_RENDER_DEADLINE_MS = 300_000;

function parsePort(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be an integer from 1 through 65535.`);
  }
  return parsed;
}

function parseDeadline(value) {
  const parsed = Number(value ?? DEFAULT_RENDER_DEADLINE_MS);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < MIN_RENDER_DEADLINE_MS
    || parsed > MAX_RENDER_DEADLINE_MS
  ) {
    throw new Error(
      `RENDER_DEADLINE_MS must be an integer from ${MIN_RENDER_DEADLINE_MS} through ${MAX_RENDER_DEADLINE_MS}.`,
    );
  }
  return parsed;
}

export function requireRendererToken(environment = process.env) {
  const token = environment.RENDERER_TOKEN;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('RENDERER_TOKEN is required; refusing to start the render backend.');
  }
  return token.trim();
}

function bearerMatches(header, expectedToken) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7), 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function sendJson(response, statusCode, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const contentLength = request.headers['content-length'];
    if (contentLength !== undefined) {
      const declared = Number(contentLength);
      if (!Number.isSafeInteger(declared) || declared < 0) {
        reject(new RendererRequestError('INVALID_CONTENT_LENGTH', 'Content-Length must be a non-negative integer.', 400));
        request.resume();
        return;
      }
      if (declared > MAX_REQUEST_BODY_BYTES) {
        reject(new RendererRequestError('BODY_TOO_LARGE', `JSON body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`, 413));
        request.resume();
        return;
      }
    }

    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(new RendererRequestError('BODY_TOO_LARGE', `JSON body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`, 413));
        return;
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
        resolve(JSON.parse(text));
      } catch {
        reject(new RendererRequestError('INVALID_JSON', 'Request body must be valid JSON.', 400));
      }
    });
    request.on('aborted', () => reject(new RendererRequestError('REQUEST_ABORTED', 'Request body was aborted.', 400)));
    request.on('error', () => reject(new RendererRequestError('REQUEST_READ_FAILED', 'Request body could not be read.', 400)));
  });
}

function withOverallDeadline(promise, deadlineAt) {
  const timeoutMs = Math.max(0, deadlineAt - Date.now());
  if (timeoutMs < 1) return Promise.reject(new RendererDeadlineError());
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new RendererDeadlineError()), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function errorResponse(error) {
  if (error instanceof RendererRequestError) {
    return { status: error.statusCode, code: error.code, message: error.message };
  }
  if (error instanceof RendererDeadlineError) {
    return { status: 504, code: error.code, message: error.message };
  }
  if (error instanceof BrowserRenderError) {
    return { status: 502, code: error.code, message: error.message };
  }
  return { status: 500, code: 'RENDER_FAILED', message: 'The renderer failed without producing an asset.' };
}

export function createRenderHttpServer({
  token: suppliedToken,
  renderDeadlineMs: suppliedDeadlineMs = DEFAULT_RENDER_DEADLINE_MS,
  renderJob = enqueueRender,
  readLaneState = rendererLaneState,
} = {}) {
  const token = requireRendererToken({ RENDERER_TOKEN: suppliedToken });
  const renderDeadlineMs = parseDeadline(suppliedDeadlineMs);
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, {
        ok: true,
        service: 'lupi-render-backend',
        requestProtocol: RENDERER_REQUEST_PROTOCOL,
        responseProtocol: RENDERER_RESPONSE_PROTOCOL,
        profile: {
          moleculeInputs: ['template', 'procedural'],
          format: 'png',
          alpha: 'opaque',
          maxBodyBytes: MAX_REQUEST_BODY_BYTES,
        },
        lane: readLaneState(),
      });
      return;
    }
    if (request.url !== '/render') {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
      return;
    }
    if (request.method !== 'POST') {
      sendJson(
        response,
        405,
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST /render is required.' } },
        { allow: 'POST' },
      );
      return;
    }
    const mediaType = String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
    if (mediaType !== 'application/json') {
      sendJson(response, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.' } });
      request.resume();
      return;
    }
    if (!bearerMatches(request.headers.authorization, token)) {
      sendJson(
        response,
        401,
        { error: { code: 'UNAUTHORIZED', message: 'A valid renderer bearer token is required.' } },
        { 'www-authenticate': 'Bearer' },
      );
      request.resume();
      return;
    }

    try {
      const deadlineAt = Date.now() + renderDeadlineMs;
      const body = await withOverallDeadline(readJsonBody(request), deadlineAt);
      const job = validateRendererEnvelope(body);
      const rendered = await withOverallDeadline(renderJob(job, deadlineAt), deadlineAt);
      const dataBase64 = rendered.png.toString('base64');
      sendJson(response, 200, {
        protocol: RENDERER_RESPONSE_PROTOCOL,
        jobId: job.jobId,
        asset: {
          mimeType: 'image/png',
          width: job.width,
          height: job.height,
          byteLength: rendered.png.length,
          dataBase64,
        },
        browserReceipt: rendered.browserReceipt,
      });
    } catch (error) {
      const failure = errorResponse(error);
      sendJson(response, failure.status, {
        error: { code: failure.code, message: failure.message },
      });
    }
  });

  server.requestTimeout = renderDeadlineMs + 10_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

export async function startRenderServer(environment = process.env) {
  const token = requireRendererToken(environment);
  const port = parsePort(environment.PORT, 8080, 'PORT');
  const renderDeadlineMs = parseDeadline(environment.RENDER_DEADLINE_MS);
  const server = createRenderHttpServer({ token, renderDeadlineMs });
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', onError);
      resolve();
    });
  });
  console.log(`[render-backend] listening on :${port}`);
  return server;
}

export function stopRenderServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
