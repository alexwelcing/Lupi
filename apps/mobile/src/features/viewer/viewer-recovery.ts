import type { AppStateStatus } from "react-native";

import type { ViewerSurfaceMessage } from "./viewer-bridge";

export const VIEWER_PROCESS_TERMINATED_MESSAGE =
  "The iPhone released the viewer process. Lupi is reloading it now.";

export function contentProcessTerminationMessages(): ViewerSurfaceMessage[] {
  return [
    { type: "status", status: { ready: false, moleculeLoaded: false } },
    { type: "error", message: VIEWER_PROCESS_TERMINATED_MESSAGE },
  ];
}

export function shouldProbeViewerOnAppStateChange(
  previous: AppStateStatus,
  next: AppStateStatus,
): boolean {
  return previous !== "active" && next === "active";
}
