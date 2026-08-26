import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { VisualQaScreen } from "@/src/features/visual-qa/visual-qa-screen";
import { resolveVisualQaArScenario } from "@/src/features/visual-qa/visual-qa-ar-scenarios";
import {
  isVisualQaEnabled,
  resolveVisualQaScenario,
} from "@/src/features/visual-qa/visual-qa-scenarios";

export default function VisualQaRoute() {
  const params = useLocalSearchParams<{ scenario?: string | string[] }>();
  const arScenario = resolveVisualQaArScenario(params.scenario);
  const viewerScenario = resolveVisualQaScenario(params.scenario);
  const screenOptions = useMemo(
    () => ({
      animation: "none" as const,
      headerShown: arScenario === null,
      title: viewerScenario?.displayName ?? "Lupi",
    }),
    [arScenario, viewerScenario?.displayName],
  );

  if (!isVisualQaEnabled(process.env.EXPO_PUBLIC_VISUAL_QA))
    return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <VisualQaScreen scenarioId={params.scenario} />
    </>
  );
}
