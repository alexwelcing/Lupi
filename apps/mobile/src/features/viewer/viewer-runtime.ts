const REACT_UPDATE_LOOP_PATTERNS = [
  "Minified React error #185",
  "Maximum update depth exceeded",
] as const;

export interface ViewerRuntimeErrorDisposition {
  autoReload: boolean;
  diagnosticMessage: string;
  userMessage: string;
}

export function classifyViewerRuntimeError(
  message: string,
  automaticRecoveryAttempts: number,
): ViewerRuntimeErrorDisposition {
  const diagnosticMessage =
    message.trim() || "The embedded viewer reported an unknown error.";
  const isReactUpdateLoop = REACT_UPDATE_LOOP_PATTERNS.some((pattern) =>
    diagnosticMessage.includes(pattern),
  );

  if (isReactUpdateLoop && automaticRecoveryAttempts < 1) {
    return {
      autoReload: true,
      diagnosticMessage,
      userMessage: "The molecular viewer restarted after a rendering problem.",
    };
  }

  if (isReactUpdateLoop) {
    return {
      autoReload: false,
      diagnosticMessage,
      userMessage:
        "The molecular viewer could not recover. Close this structure and try it again.",
    };
  }

  return {
    autoReload: false,
    diagnosticMessage,
    userMessage: diagnosticMessage,
  };
}

export function makeViewerDocumentUrl(
  sourceUrl: string,
  clientRevision: string | null | undefined,
  reloadRevision: number,
): string {
  const url = new URL(sourceUrl);
  const normalizedClientRevision = clientRevision?.trim();
  if (normalizedClientRevision) {
    url.searchParams.set(
      "lupiNativeBuild",
      normalizedClientRevision.slice(0, 64),
    );
  }
  if (reloadRevision > 0) {
    url.searchParams.set("lupiReload", String(reloadRevision));
  }
  return url.toString();
}

export function isViewerMessageFromActiveDocument(
  messageDocumentEpoch: number | undefined,
  activeDocumentEpoch: number,
): boolean {
  return (
    Number.isSafeInteger(messageDocumentEpoch) &&
    Number.isSafeInteger(activeDocumentEpoch) &&
    messageDocumentEpoch === activeDocumentEpoch
  );
}
