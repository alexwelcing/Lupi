import {
  isARSupportedOnDevice,
  requestRequiredPermissions,
} from "@reactvision/react-viro";

import type { MoleculeArSupport } from "./ar-runtime.types";

export async function checkMoleculeArSupport(): Promise<MoleculeArSupport> {
  try {
    const result = await isARSupportedOnDevice();
    return result.isARSupported
      ? { supported: true }
      : {
          supported: false,
          message: "This iPhone does not support the native room viewer.",
        };
  } catch {
    return {
      supported: false,
      message:
        "Native AR is unavailable in this build. Open Lupi in a development build or TestFlight.",
    };
  }
}

export async function requestMoleculeArCamera(): Promise<boolean> {
  try {
    const result = await requestRequiredPermissions(["camera"]);
    return result.camera === true;
  } catch {
    return false;
  }
}
