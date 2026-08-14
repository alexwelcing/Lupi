import {
  moleculeArSceneFromXyz,
  type MoleculeArScene,
} from "@/src/features/ar/ar-scene";

export const AR_CAFFEINE_INTRO_SCENARIO_ID = "ar-caffeine-intro";

export interface VisualQaArScenario {
  id: typeof AR_CAFFEINE_INTRO_SCENARIO_ID;
  scene: MoleculeArScene;
}

const CAFFEINE_XYZ = [
  "24",
  "Caffeine",
  "C 1.028 -0.063 -0.111",
  "N 2.396 0.141 -0.069",
  "C 3.081 -0.954 -0.672",
  "N 2.419 -1.972 -1.224",
  "C 1.081 -1.853 -1.092",
  "C 0.316 -2.892 -1.572",
  "O -0.889 -2.770 -1.514",
  "N 0.437 -0.764 -0.589",
  "C 0.888 0.533 1.282",
  "O 2.800 1.108 0.533",
  "C 4.477 0.508 0.398",
  "C 3.064 -0.753 -2.787",
  "C -0.831 -0.416 -0.684",
  "C -1.184 0.962 -0.233",
  "H -0.871 1.712 -0.981",
  "H -0.729 1.251 0.726",
  "H -2.267 1.021 -0.109",
  "H 0.408 -0.117 1.864",
  "H 0.706 1.502 1.762",
  "H 1.965 0.439 1.433",
  "H 4.735 1.445 0.900",
  "H 4.658 0.640 -0.674",
  "H 5.133 -0.261 0.753",
  "H 2.544 -1.599 -3.250",
].join("\n");

const AR_CAFFEINE_INTRO_SCENE = moleculeArSceneFromXyz(CAFFEINE_XYZ, {
  expectedAtomCount: 24,
  formula: "C8H10N4O2",
  id: "caffeine",
  moleculeKey: "visual-qa:template:Caffeine",
  name: "Caffeine",
});

const AR_CAFFEINE_INTRO_SCENARIO: VisualQaArScenario = {
  id: AR_CAFFEINE_INTRO_SCENARIO_ID,
  scene: AR_CAFFEINE_INTRO_SCENE,
};

export function resolveVisualQaArScenario(
  requested: string | string[] | undefined,
): VisualQaArScenario | null {
  const requestedId = Array.isArray(requested) ? requested[0] : requested;
  return requestedId?.trim() === AR_CAFFEINE_INTRO_SCENARIO_ID
    ? AR_CAFFEINE_INTRO_SCENARIO
    : null;
}
