import type {
  MoleculeLoadInput,
  MoleculeSummary,
} from "@/src/domain/molecules";

export const DEFAULT_VISUAL_QA_SCENARIO_ID = "viewer-caffeine-ready";

export interface VisualQaViewerCommand {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface VisualQaViewerContract {
  expectedAtomCount: number;
  readyTestID: string;
  scenarioId: string;
  settlingCommands: VisualQaViewerCommand[];
}

export interface VisualQaViewerScenario {
  id: string;
  displayName: string;
  molecule: MoleculeLoadInput;
  summary: MoleculeSummary;
  viewerContract: VisualQaViewerContract;
}

export interface VisualQaViewerReadiness {
  atomCount?: number;
  bridgeReady: boolean;
  commandsComplete: boolean;
  expectedAtomCount: number;
  hasError: boolean;
  moleculeLoaded: boolean;
}

const CAFFEINE_MOLECULE: MoleculeLoadInput = {
  inputType: "gallery",
  input: "caffeine",
  atomCount: 24,
};

const CAFFEINE_VIEWER_CONTRACT: VisualQaViewerContract = {
  expectedAtomCount: 24,
  readyTestID: "visual-qa-ready-viewer-caffeine-ready",
  scenarioId: DEFAULT_VISUAL_QA_SCENARIO_ID,
  settlingCommands: [
    {
      tool: "lupi.set_viewer",
      arguments: {
        cameraPreset: "iso",
        showBonds: true,
      },
    },
    {
      tool: "lupi.fit_camera",
      arguments: {},
    },
  ],
};

const VIEWER_CAFFEINE_READY: VisualQaViewerScenario = {
  id: DEFAULT_VISUAL_QA_SCENARIO_ID,
  displayName: "Caffeine",
  molecule: CAFFEINE_MOLECULE,
  summary: {
    id: "caffeine",
    name: "Caffeine",
    formula: "C8H10N4O2",
    tags: ["organic", "alkaloid"],
    load: CAFFEINE_MOLECULE,
  },
  viewerContract: CAFFEINE_VIEWER_CONTRACT,
};

const VISUAL_QA_SCENARIOS: Record<string, VisualQaViewerScenario> = {
  [VIEWER_CAFFEINE_READY.id]: VIEWER_CAFFEINE_READY,
};

export function isVisualQaEnabled(value: string | undefined): boolean {
  return value === "1";
}

export function resolveVisualQaScenario(
  requested: string | string[] | undefined,
): VisualQaViewerScenario | null {
  const requestedId = Array.isArray(requested) ? requested[0] : requested;
  const scenarioId = requestedId?.trim() || DEFAULT_VISUAL_QA_SCENARIO_ID;
  if (!Object.prototype.hasOwnProperty.call(VISUAL_QA_SCENARIOS, scenarioId))
    return null;
  return VISUAL_QA_SCENARIOS[scenarioId] ?? null;
}

export function isVisualQaViewerReady(
  readiness: VisualQaViewerReadiness,
): boolean {
  return (
    readiness.bridgeReady &&
    readiness.moleculeLoaded &&
    readiness.commandsComplete &&
    !readiness.hasError &&
    readiness.atomCount === readiness.expectedAtomCount
  );
}
