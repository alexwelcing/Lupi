import assert from "node:assert/strict";
import test from "node:test";

import { initialViewerCommand } from "../viewer/viewer-session";
import {
  DEFAULT_VISUAL_QA_SCENARIO_ID,
  isVisualQaEnabled,
  isVisualQaViewerReady,
  resolveVisualQaScenario,
} from "./visual-qa-scenarios";
import {
  AR_CAFFEINE_INTRO_SCENARIO_ID,
  resolveVisualQaArScenario,
} from "./visual-qa-ar-scenarios";

test("visual QA is enabled only by the explicit public flag", () => {
  assert.equal(isVisualQaEnabled("1"), true);
  assert.equal(isVisualQaEnabled("true"), false);
  assert.equal(isVisualQaEnabled("0"), false);
  assert.equal(isVisualQaEnabled(undefined), false);
});

test("the route resolves to one deterministic Gallery-backed caffeine scenario by default", () => {
  const scenario = resolveVisualQaScenario(undefined);
  const sameScenario = resolveVisualQaScenario(DEFAULT_VISUAL_QA_SCENARIO_ID);

  assert.ok(scenario);
  assert.equal(scenario?.id, DEFAULT_VISUAL_QA_SCENARIO_ID);
  assert.deepEqual(scenario?.molecule, {
    inputType: "gallery",
    input: "caffeine",
    atomCount: 24,
  });
  assert.deepEqual(initialViewerCommand(scenario.molecule), {
    tool: "lupi.open_gallery_example",
    arguments: {
      id: "caffeine",
      expectedAtomCount: 24,
      maxAtomCount: 50_000,
    },
  });
  assert.equal(scenario?.viewerContract.expectedAtomCount, 24);
  assert.equal(scenario?.summary.formula, "C8H10N4O2");
  assert.deepEqual(scenario?.viewerContract.settlingCommands, [
    {
      tool: "lupi.set_viewer",
      arguments: { cameraPreset: "iso", showBonds: true },
    },
    { tool: "lupi.fit_camera", arguments: {} },
  ]);
  assert.equal(
    scenario?.viewerContract,
    sameScenario?.viewerContract,
    "the render contract must retain object identity across route resolution",
  );
});

test("scenario lookup accepts Expo Router arrays and fails closed on unknown input", () => {
  assert.equal(
    resolveVisualQaScenario([DEFAULT_VISUAL_QA_SCENARIO_ID, "ignored"])?.id,
    DEFAULT_VISUAL_QA_SCENARIO_ID,
  );
  assert.equal(resolveVisualQaScenario("viewer-unknown"), null);
  assert.equal(resolveVisualQaScenario(["viewer-unknown"]), null);
});

test("readiness requires correlated viewer settling and the exact caffeine atom count", () => {
  const ready = {
    atomCount: 24,
    bridgeReady: true,
    commandsComplete: true,
    expectedAtomCount: 24,
    hasError: false,
    moleculeLoaded: true,
  };

  assert.equal(isVisualQaViewerReady(ready), true);
  assert.equal(isVisualQaViewerReady({ ...ready, atomCount: 23 }), false);
  assert.equal(
    isVisualQaViewerReady({ ...ready, commandsComplete: false }),
    false,
  );
  assert.equal(isVisualQaViewerReady({ ...ready, hasError: true }), false);
  assert.equal(isVisualQaViewerReady({ ...ready, bridgeReady: false }), false);
  assert.equal(
    isVisualQaViewerReady({ ...ready, moleculeLoaded: false }),
    false,
  );
});

test("the AR visual route resolves one stable camera-free Caffeine intro", () => {
  const scenario = resolveVisualQaArScenario(AR_CAFFEINE_INTRO_SCENARIO_ID);
  const repeated = resolveVisualQaArScenario([
    AR_CAFFEINE_INTRO_SCENARIO_ID,
    "ignored",
  ]);

  assert.equal(scenario?.scene.molecule.name, "Caffeine");
  assert.equal(scenario?.scene.molecule.atomCount, 24);
  assert.equal(scenario?.scene, repeated?.scene);
  assert.equal(resolveVisualQaArScenario("ar-unknown"), null);
  assert.equal(resolveVisualQaArScenario(undefined), null);
});
