import type { ViewerBridgeStatus } from "./viewer-bridge";

export const EXPECTED_VIEWER_BRIDGE_MAJOR = "0";
export const MINIMUM_DATED_VIEWER_BRIDGE_VERSION = "2026-07-07";
export const DATED_VIEWER_BRIDGE_FAMILY = "asset-export";
export const REQUIRED_VIEWER_TOOLS = [
  "lupi.generate_molecule",
  "lupi.fit_camera",
  "lupi.set_camera_preset",
  "lupi.set_viewer",
  "lupi.set_background",
  "lupi.reset_viewer",
  "lupi.play",
  "lupi.pause",
  "lupi.encode_view_url",
] as const;
export const GALLERY_VIEWER_TOOL = "lupi.open_gallery_example" as const;

export interface ViewerCompatibilityResult {
  compatible: boolean;
  message?: string;
}

export function isSupportedViewerBridgeVersion(
  version: string | undefined,
): boolean {
  if (!version) return false;
  if (/^0(?:\.|$)/.test(version)) return true;

  const match = /^(\d{4}-\d{2}-\d{2})\.asset-export$/.exec(version);
  if (!match) return false;

  const releaseDate = match[1];
  const parsedDate = new Date(`${releaseDate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== releaseDate
  )
    return false;
  return releaseDate >= MINIMUM_DATED_VIEWER_BRIDGE_VERSION;
}

export function checkViewerCompatibility(
  status: ViewerBridgeStatus,
  additionalRequiredTools: readonly string[] = [],
): ViewerCompatibilityResult {
  if (!status.ready)
    return { compatible: false, message: "The embedded viewer is not ready." };

  if (!isSupportedViewerBridgeVersion(status.version)) {
    return {
      compatible: false,
      message: `Unsupported Lupi viewer bridge ${status.version ?? "version"}; expected legacy v${EXPECTED_VIEWER_BRIDGE_MAJOR}.x or a dated ${DATED_VIEWER_BRIDGE_FAMILY} release from ${MINIMUM_DATED_VIEWER_BRIDGE_VERSION} onward.`,
    };
  }

  const available = new Set(status.toolNames ?? []);
  const required = [...REQUIRED_VIEWER_TOOLS, ...additionalRequiredTools];
  const missing = required.filter(
    (tool, index) => required.indexOf(tool) === index && !available.has(tool),
  );
  if (missing.length) {
    return {
      compatible: false,
      message: `The remote viewer is missing required mobile tools: ${missing.join(", ")}.`,
    };
  }

  return { compatible: true };
}
