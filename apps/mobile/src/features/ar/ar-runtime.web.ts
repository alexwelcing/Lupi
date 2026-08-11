import type { MoleculeArSupport } from "./ar-runtime.types";

export async function checkMoleculeArSupport(): Promise<MoleculeArSupport> {
  return {
    supported: false,
    message: "Native room view must be tested in the Lupi iPhone app.",
  };
}

export async function requestMoleculeArCamera(): Promise<boolean> {
  return false;
}
