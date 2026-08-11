export interface ViewerBridgeRequest {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface ViewerBridgeStatus {
  ready: boolean;
  version?: string;
  toolCount?: number;
  toolNames?: string[];
  moleculeLoaded?: boolean;
  atomCount?: number;
  frame?: number;
  playing?: boolean;
}

export interface ViewerBridgeResponse {
  id?: string;
  tool?: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: {
    code?: string;
    message?: string;
  };
  transcript?: string[];
}

type ViewerSurfaceMessagePayload =
  | { type: "status"; status: ViewerBridgeStatus }
  | { type: "probe"; id: string; status: ViewerBridgeStatus }
  | { type: "response"; response: ViewerBridgeResponse }
  | {
      type: "error";
      message: string;
      source?: "native-surface" | "web-runtime";
      stack?: string;
    };

export type ViewerSurfaceMessage = ViewerSurfaceMessagePayload & {
  documentEpoch?: number;
};

let requestSequence = 0;

export function makeViewerRequest(
  tool: string,
  args: Record<string, unknown> = {},
): ViewerBridgeRequest {
  requestSequence = (requestSequence + 1) % Number.MAX_SAFE_INTEGER;
  return {
    id: `mobile-${tool.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}-${requestSequence}`,
    tool,
    arguments: args,
  };
}

export function parseViewerSurfaceMessage(
  serialized: string,
): ViewerSurfaceMessage | null {
  try {
    const value = JSON.parse(serialized) as ViewerSurfaceMessage;
    if (!value || typeof value !== "object" || typeof value.type !== "string")
      return null;
    if (
      value.documentEpoch !== undefined &&
      !validDocumentEpoch(value.documentEpoch)
    )
      return null;
    if (
      value.type === "status" &&
      value.status &&
      typeof value.status.ready === "boolean"
    )
      return value;
    if (
      value.type === "probe" &&
      typeof value.id === "string" &&
      value.status &&
      typeof value.status.ready === "boolean"
    )
      return value;
    if (
      value.type === "response" &&
      value.response &&
      typeof value.response.ok === "boolean"
    )
      return value;
    if (value.type === "error" && typeof value.message === "string") {
      return {
        type: "error",
        message: value.message.slice(0, 2_000),
        ...(value.source === "native-surface" || value.source === "web-runtime"
          ? { source: value.source }
          : {}),
        ...(typeof value.stack === "string"
          ? { stack: value.stack.slice(0, 8_000) }
          : {}),
        ...(value.documentEpoch !== undefined
          ? { documentEpoch: value.documentEpoch }
          : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function makeBridgeBootstrapScript(documentEpoch = 0): string {
  const safeDocumentEpoch = normalizedDocumentEpoch(documentEpoch);
  return `
    (function () {
      if (window.__lupiNativeBridgeInstalled) return;
      window.__lupiNativeBridgeInstalled = true;
      var documentEpoch = ${safeDocumentEpoch};
      var send = function (value) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify(
            Object.assign({}, value, { documentEpoch: documentEpoch })
          ));
        } catch (_) {}
      };
      window.__lupiPostNative = send;
      var attempts = 0;
      var report = function () {
        attempts += 1;
        try {
          var bridge = window.__lupiViewerMcp;
          var status = bridge && typeof bridge.status === 'function'
            ? bridge.status()
            : { ready: false, toolCount: 0, moleculeLoaded: false };
          if (bridge && typeof bridge.tools === 'function') {
            status = Object.assign({}, status, {
              toolNames: bridge.tools().map(function (tool) { return tool.name; })
            });
          }
          send({ type: 'status', status: status });
          if (status && status.ready && status.toolCount > 0) {
            clearInterval(timer);
          } else if (attempts > 120) {
            clearInterval(timer);
            send({ type: 'error', message: 'The Lupi viewer bridge did not become ready.' });
          }
        } catch (error) {
          send({ type: 'error', message: String(error && error.message ? error.message : error) });
        }
      };
      var timer = setInterval(report, 250);
      report();
      var reportRuntimeError = function (message, error) {
        send({
          type: 'error',
          source: 'web-runtime',
          message: message || 'The embedded viewer reported an error.',
          stack: error && typeof error.stack === 'string' ? error.stack : undefined
        });
      };
      window.addEventListener('error', function (event) {
        reportRuntimeError(event.message, event.error);
      });
      window.addEventListener('unhandledrejection', function (event) {
        var reason = event.reason;
        reportRuntimeError(
          reason && reason.message ? reason.message : String(reason || 'The embedded viewer rejected an operation.'),
          reason
        );
      });
    })();
    true;
  `;
}

export function makeBridgeProbeScript(id: string, documentEpoch = 0): string {
  const serializedId = JSON.stringify(id)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const safeDocumentEpoch = normalizedDocumentEpoch(documentEpoch);

  return `
    (function () {
      var documentEpoch = ${safeDocumentEpoch};
      var send = window.__lupiPostNative || function (value) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify(
            Object.assign({}, value, { documentEpoch: documentEpoch })
          ));
        } catch (_) {}
      };
      var bridge = window.__lupiViewerMcp;
      var status = bridge && typeof bridge.status === 'function'
        ? bridge.status()
        : { ready: false, toolCount: 0, moleculeLoaded: false };
      if (bridge && typeof bridge.tools === 'function') {
        status = Object.assign({}, status, {
          toolNames: bridge.tools().map(function (tool) { return tool.name; })
        });
      }
      send({ type: 'probe', id: ${serializedId}, status: status });
    })();
    true;
  `;
}

export function makeBridgeExecutionScript(
  request: ViewerBridgeRequest,
  documentEpoch = 0,
): string {
  const serialized = JSON.stringify(request)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const safeDocumentEpoch = normalizedDocumentEpoch(documentEpoch);

  return `
    (function () {
      var documentEpoch = ${safeDocumentEpoch};
      var send = window.__lupiPostNative || function (value) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify(
            Object.assign({}, value, { documentEpoch: documentEpoch })
          ));
        } catch (_) {}
      };
      var bridge = window.__lupiViewerMcp;
      if (!bridge || bridge.ready !== true || typeof bridge.execute !== 'function') {
        send({ type: 'error', message: 'The Lupi viewer is still starting.' });
        return;
      }
      Promise.resolve(bridge.execute(${serialized}))
        .then(function (response) {
          send({ type: 'response', response: response });
          try {
            var status = bridge.status();
            if (typeof bridge.tools === 'function') {
              status = Object.assign({}, status, {
                toolNames: bridge.tools().map(function (tool) { return tool.name; })
              });
            }
            send({ type: 'status', status: status });
          } catch (_) {}
        })
        .catch(function (error) {
          send({ type: 'error', message: String(error && error.message ? error.message : error) });
        });
    })();
    true;
  `;
}

function normalizedDocumentEpoch(value: number): number {
  return validDocumentEpoch(value) ? value : 0;
}

function validDocumentEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
