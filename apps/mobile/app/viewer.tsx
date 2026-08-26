import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import {
  moleculeFromRouteParams,
  moleculeSummaryFromRouteParams,
  type MoleculeLoadInput,
} from "@/src/domain/molecules";
import { CURATED_GALLERY } from "@/src/features/gallery/gallery-catalog";
import { ViewerScreen } from "@/src/features/viewer/viewer-screen";

export default function ViewerRoute() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const inputType = firstParam(params.inputType);
  const input = firstParam(params.input);
  const atomCount = firstParam(params.atomCount);
  const element = firstParam(params.element);
  const lattice = firstParam(params.lattice);
  const moleculeId = firstParam(params.moleculeId);
  const moleculeName = firstParam(params.moleculeName);
  const moleculeFormula = firstParam(params.moleculeFormula);
  const moleculeTags = firstParam(params.moleculeTags);
  const { load, summary } = useMemo(() => {
    const stableParams = {
      inputType,
      input,
      atomCount,
      element,
      lattice,
      moleculeId,
      moleculeName,
      moleculeFormula,
      moleculeTags,
    };
    const parsedSummary = moleculeSummaryFromRouteParams(stableParams);
    const parsedLoad =
      parsedSummary?.load ?? moleculeFromRouteParams(stableParams);
    return {
      load: parsedLoad,
      summary:
        parsedLoad.inputType === "gallery"
          ? CURATED_GALLERY.find((item) => item.id === parsedLoad.input)
          : parsedSummary,
    };
  }, [
    atomCount,
    element,
    input,
    inputType,
    lattice,
    moleculeFormula,
    moleculeId,
    moleculeName,
    moleculeTags,
  ]);
  const viewerTitle = summary?.name ?? fallbackViewerName(load);
  const screenOptions = useMemo(() => ({ title: viewerTitle }), [viewerTitle]);

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <ViewerScreen
        displayName={viewerTitle}
        initialMolecule={load}
        initialSummary={summary ?? undefined}
      />
    </>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function fallbackViewerName(load: MoleculeLoadInput): string {
  if (load.inputType === "xyz") return "Imported structure";
  if (load.inputType === "procedural") {
    return load.element ? `${load.element} structure` : "Generated structure";
  }
  return load.input.trim().slice(0, 160) || "Molecule";
}
