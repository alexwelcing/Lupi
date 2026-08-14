import {
  MOBILE_MAX_ATOMS,
  type MoleculeLoadInput,
  type MoleculeSummary,
} from "@/src/domain/molecules";
import type {
  ViewerBridgeResponse,
  ViewerBridgeStatus,
  ViewerSurfaceMessage,
} from "./viewer-bridge";

export const HISTORY_PERSISTENCE_WARNING =
  "This structure loaded, but Lupi could not save it to Recent Structures on this device.";
export const INITIAL_VIEWER_COMMAND_TIMEOUT_MS = 20_000;

export interface InitialViewerCommand {
  tool: "lupi.generate_molecule" | "lupi.open_gallery_example";
  arguments: Record<string, unknown>;
}

export interface PendingInitialViewerRequest {
  id: string;
  moleculeKey: string;
  summary?: MoleculeSummary;
  tool: InitialViewerCommand["tool"];
}

export interface InitialViewerResponseResolution {
  errorMessage?: string;
  matched: boolean;
  pending: PendingInitialViewerRequest | null;
  succeeded: boolean;
  summary?: MoleculeSummary;
}

export interface InitialViewerTimeoutResolution {
  pending: PendingInitialViewerRequest | null;
  timedOut: boolean;
}

export function initialViewerCommand(
  molecule: MoleculeLoadInput,
): InitialViewerCommand {
  if (molecule.inputType === "gallery") {
    return {
      tool: "lupi.open_gallery_example",
      arguments: {
        id: molecule.input,
        expectedAtomCount: molecule.atomCount,
        maxAtomCount: MOBILE_MAX_ATOMS,
      },
    };
  }

  return {
    tool: "lupi.generate_molecule",
    arguments: { ...molecule },
  };
}

export function consumeInitialViewerResponse(
  pending: PendingInitialViewerRequest | null,
  response: ViewerBridgeResponse,
  activeMoleculeKey: string,
): InitialViewerResponseResolution {
  if (pending && pending.moleculeKey !== activeMoleculeKey) {
    return { matched: false, pending: null, succeeded: false };
  }
  if (!pending || response.id !== pending.id) {
    return { matched: false, pending, succeeded: false };
  }
  if (response.tool !== pending.tool) {
    return {
      errorMessage:
        "The viewer returned an invalid response for the requested structure.",
      matched: true,
      pending: null,
      succeeded: false,
    };
  }
  if (!response.ok) {
    return {
      errorMessage:
        response.error?.message || "The viewer could not load this structure.",
      matched: true,
      pending: null,
      succeeded: false,
    };
  }
  return {
    matched: true,
    pending: null,
    succeeded: true,
    ...(pending.summary ? { summary: pending.summary } : {}),
  };
}

export function consumeInitialViewerMessage(
  pending: PendingInitialViewerRequest | null,
  message: ViewerSurfaceMessage,
  activeMoleculeKey: string,
): InitialViewerResponseResolution {
  if (message.type === "response") {
    return consumeInitialViewerResponse(
      pending,
      message.response,
      activeMoleculeKey,
    );
  }
  if (pending && pending.moleculeKey !== activeMoleculeKey) {
    return { matched: false, pending: null, succeeded: false };
  }
  return { matched: false, pending, succeeded: false };
}

export function consumeInitialViewerTimeout(
  pending: PendingInitialViewerRequest | null,
  requestId: string,
  activeMoleculeKey: string,
): InitialViewerTimeoutResolution {
  if (
    !pending ||
    pending.id !== requestId ||
    pending.moleculeKey !== activeMoleculeKey
  ) {
    return { pending, timedOut: false };
  }
  return { pending: null, timedOut: true };
}

export function isResponseForTimedOutInitialRequest(
  response: ViewerBridgeResponse,
  timedOutRequestId: string | null,
): boolean {
  return timedOutRequestId !== null && response.id === timedOutRequestId;
}

export function confirmedMoleculeLoadedAfterStatus(
  currentlyConfirmed: boolean,
  status: ViewerBridgeStatus,
): boolean {
  return currentlyConfirmed && status.ready && status.moleculeLoaded !== false;
}

export async function persistLoadedMoleculeSummary(
  summary: MoleculeSummary,
  record: (molecule: MoleculeSummary) => Promise<void>,
): Promise<string | null> {
  try {
    await record(summary);
    return null;
  } catch {
    return HISTORY_PERSISTENCE_WARNING;
  }
}

export function shouldAttemptHistoryPersistence(
  attemptedMoleculeKey: string | null,
  moleculeKey: string,
  summary: MoleculeSummary | undefined,
): summary is MoleculeSummary {
  return summary !== undefined && attemptedMoleculeKey !== moleculeKey;
}

export function executionKeyAfterStatus(
  currentExecutionKey: string | null,
  status: ViewerBridgeStatus,
): string | null {
  return status.ready ? currentExecutionKey : null;
}

export function shouldExecuteInitialMolecule({
  bridgeReady,
  executionKey,
  hasSavedView,
  moleculeKey,
}: {
  bridgeReady: boolean;
  executionKey: string | null;
  hasSavedView: boolean;
  moleculeKey: string;
}): boolean {
  return bridgeReady && !hasSavedView && executionKey !== moleculeKey;
}
