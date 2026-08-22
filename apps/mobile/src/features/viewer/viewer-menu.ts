export type ViewerMenuId = "camera" | "appearance" | "more";

export interface ViewerCommandDescriptor {
  tool: string;
  arguments?: Record<string, unknown>;
}

interface ViewerMenuActionBase {
  id: string;
  title: string;
  requiresReady: boolean;
}

export type ViewerMenuAction = ViewerMenuActionBase &
  ({ kind: "command"; command: ViewerCommandDescriptor } | { kind: "reload" });

export interface ViewerMenuDefinition {
  id: ViewerMenuId;
  title: string;
  message: string;
  actions: readonly ViewerMenuAction[];
}

const CAMERA_ACTIONS = [
  commandAction("camera-iso", "Isometric", "lupi.set_camera_preset", {
    preset: "iso",
  }),
  commandAction("camera-top", "Top", "lupi.set_camera_preset", {
    preset: "top",
  }),
  commandAction("camera-front", "Front", "lupi.set_camera_preset", {
    preset: "front",
  }),
  commandAction("camera-side", "Side", "lupi.set_camera_preset", {
    preset: "side",
  }),
] as const;

const APPEARANCE_ACTIONS = [
  commandAction("appearance-studio", "Studio", "lupi.set_viewer", {
    backgroundPreset: "studio",
    postprocessPreset: "studio",
  }),
  commandAction("appearance-paper", "Paper", "lupi.set_viewer", {
    backgroundPreset: "white",
    postprocessPreset: "paper",
  }),
  commandAction("appearance-blueprint", "Blueprint", "lupi.set_viewer", {
    backgroundPreset: "blueprint",
    postprocessPreset: "diagram",
  }),
  commandAction("appearance-dark", "Deep Field", "lupi.set_viewer", {
    backgroundPreset: "deep",
    postprocessPreset: "studio",
  }),
] as const;

const MORE_ACTIONS = [
  commandAction("motion-play", "Play Trajectory", "lupi.play"),
  commandAction("motion-pause", "Pause Trajectory", "lupi.pause"),
  commandAction("bonds-hide", "Hide Bonds", "lupi.set_viewer", {
    showBonds: false,
  }),
  commandAction("bonds-show", "Show Bonds", "lupi.set_viewer", {
    showBonds: true,
  }),
  commandAction("viewer-reset", "Reset Viewer", "lupi.reset_viewer"),
  {
    id: "viewer-reload",
    title: "Reload Viewer",
    kind: "reload",
    requiresReady: false,
  },
] as const satisfies readonly ViewerMenuAction[];

export const VIEWER_MENUS: Record<ViewerMenuId, ViewerMenuDefinition> = {
  camera: {
    id: "camera",
    title: "Camera",
    message: "Choose a viewing angle.",
    actions: CAMERA_ACTIONS,
  },
  appearance: {
    id: "appearance",
    title: "Appearance",
    message: "Choose a background and rendering style.",
    actions: APPEARANCE_ACTIONS,
  },
  more: {
    id: "more",
    title: "More Viewer Actions",
    message: "Control motion, bonds, or recover the viewer.",
    actions: MORE_ACTIONS,
  },
};

export function viewerMenuDefinition(
  menuId: ViewerMenuId,
): ViewerMenuDefinition {
  return VIEWER_MENUS[menuId];
}

export function isViewerMenuActionEnabled(
  action: ViewerMenuAction,
  viewerReady: boolean,
): boolean {
  return viewerReady || !action.requiresReady;
}

export function makeViewerActionSheet(
  menuId: ViewerMenuId,
  viewerReady: boolean,
): {
  options: string[];
  cancelButtonIndex: number;
  disabledButtonIndices: number[];
} {
  const menu = viewerMenuDefinition(menuId);
  const options = [...menu.actions.map((action) => action.title), "Cancel"];
  return {
    options,
    cancelButtonIndex: options.length - 1,
    disabledButtonIndices: menu.actions.flatMap((action, index) =>
      isViewerMenuActionEnabled(action, viewerReady) ? [] : [index],
    ),
  };
}

export function executeViewerMenuAction(
  action: ViewerMenuAction,
  handlers: {
    onCommand: (tool: string, args?: Record<string, unknown>) => void;
    onReload: () => void;
  },
): void {
  if (action.kind === "reload") {
    handlers.onReload();
    return;
  }
  handlers.onCommand(action.command.tool, action.command.arguments);
}

function commandAction(
  id: string,
  title: string,
  tool: string,
  argumentsValue?: Record<string, unknown>,
): ViewerMenuAction {
  return {
    id,
    title,
    kind: "command",
    requiresReady: true,
    command: {
      tool,
      ...(argumentsValue ? { arguments: argumentsValue } : {}),
    },
  };
}
