import {
  moleculeArSceneFromExportResult,
  type MoleculeArScene,
  type MoleculeArSceneMetadata,
} from "@/src/features/ar/ar-scene";

import type { ViewerBridgeResponse } from "./viewer-bridge";

export const VIEWER_AR_EXPORT_TOOL = "lupi.export_xyz";
export const VIEWER_AR_EXPORT_TIMEOUT_MS = 8_000;

export interface PendingViewerArExport {
  id: string;
  metadata: MoleculeArSceneMetadata;
  moleculeKey: string;
}

export type ViewerArExportResolution =
  | { matched: false; pending: PendingViewerArExport | null }
  | {
      errorMessage?: string;
      matched: true;
      pending: null;
      scene?: MoleculeArScene;
    };

export function consumeViewerArExportResponse(
  pending: PendingViewerArExport | null,
  response: ViewerBridgeResponse,
  activeMoleculeKey: string,
): ViewerArExportResolution {
  if (!pending || response.id !== pending.id) {
    return { matched: false, pending };
  }
  if (
    pending.moleculeKey !== activeMoleculeKey ||
    response.tool !== VIEWER_AR_EXPORT_TOOL
  ) {
    return { matched: false, pending: null };
  }
  if (!response.ok) {
    return {
      errorMessage:
        response.error?.message ||
        "Lupi could not prepare this molecule for native AR.",
      matched: true,
      pending: null,
    };
  }

  try {
    return {
      matched: true,
      pending: null,
      scene: moleculeArSceneFromExportResult(response.result, pending.metadata),
    };
  } catch (error) {
    return {
      errorMessage:
        error instanceof Error
          ? error.message
          : "The native AR scene could not be prepared.",
      matched: true,
      pending: null,
    };
  }
}
