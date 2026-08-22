import assert from "node:assert/strict";
import test from "node:test";

import {
  executeViewerMenuAction,
  makeViewerActionSheet,
  viewerMenuDefinition,
} from "./viewer-menu";

test("camera menu maps native choices to exact bridge presets", () => {
  const camera = viewerMenuDefinition("camera");

  assert.deepEqual(
    camera.actions.map((action) =>
      action.kind === "command" ? action.command : action.kind,
    ),
    [
      { tool: "lupi.set_camera_preset", arguments: { preset: "iso" } },
      { tool: "lupi.set_camera_preset", arguments: { preset: "top" } },
      { tool: "lupi.set_camera_preset", arguments: { preset: "front" } },
      { tool: "lupi.set_camera_preset", arguments: { preset: "side" } },
    ],
  );
});

test("appearance choices update background and postprocess together", () => {
  const appearance = viewerMenuDefinition("appearance");

  assert.deepEqual(
    appearance.actions.map((action) =>
      action.kind === "command" ? action.command.arguments : null,
    ),
    [
      { backgroundPreset: "studio", postprocessPreset: "studio" },
      { backgroundPreset: "white", postprocessPreset: "paper" },
      { backgroundPreset: "blueprint", postprocessPreset: "diagram" },
      { backgroundPreset: "deep", postprocessPreset: "studio" },
    ],
  );
});

test("not-ready action sheets disable viewer commands but keep reload available", () => {
  assert.deepEqual(makeViewerActionSheet("camera", false), {
    options: ["Isometric", "Top", "Front", "Side", "Cancel"],
    cancelButtonIndex: 4,
    disabledButtonIndices: [0, 1, 2, 3],
  });
  assert.deepEqual(makeViewerActionSheet("more", false), {
    options: [
      "Play Trajectory",
      "Pause Trajectory",
      "Hide Bonds",
      "Show Bonds",
      "Reset Viewer",
      "Reload Viewer",
      "Cancel",
    ],
    cancelButtonIndex: 6,
    disabledButtonIndices: [0, 1, 2, 3, 4],
  });
});

test("menu action execution delegates without hiding bridge failures", () => {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  let reloads = 0;
  const handlers = {
    onCommand: (tool: string, args?: Record<string, unknown>) =>
      calls.push([tool, args]),
    onReload: () => {
      reloads += 1;
    },
  };

  const more = viewerMenuDefinition("more");
  const hideBonds = more.actions.find((action) => action.id === "bonds-hide");
  const reload = more.actions.find((action) => action.id === "viewer-reload");
  assert.ok(hideBonds);
  assert.ok(reload);
  executeViewerMenuAction(hideBonds, handlers);
  executeViewerMenuAction(reload, handlers);

  assert.deepEqual(calls, [["lupi.set_viewer", { showBonds: false }]]);
  assert.equal(reloads, 1);
});
