import { Text, View } from "react-native";

import { ArEntryScreen } from "@/src/features/ar/ar-entry-screen";
import { colors } from "@/src/theme/colors";
import { ViewerScreen } from "@/src/features/viewer/viewer-screen";

import { resolveVisualQaArScenario } from "./visual-qa-ar-scenarios";
import { resolveVisualQaScenario } from "./visual-qa-scenarios";

export function VisualQaScreen({
  scenarioId,
}: {
  scenarioId?: string | string[];
}) {
  const arScenario = resolveVisualQaArScenario(scenarioId);
  if (arScenario) {
    return (
      <View
        collapsable={false}
        style={{ backgroundColor: colors.background, flex: 1 }}
        testID={`visual-qa-scenario-${arScenario.id}`}
      >
        <ArEntryScreen scene={arScenario.scene} />
      </View>
    );
  }

  const scenario = resolveVisualQaScenario(scenarioId);

  if (!scenario) {
    return (
      <View
        testID="visual-qa-invalid-scenario"
        style={{
          alignItems: "center",
          backgroundColor: colors.background,
          flex: 1,
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Text
          accessibilityRole="alert"
          style={{ color: colors.text, fontSize: 17, textAlign: "center" }}
        >
          Unknown visual QA scenario.
        </Text>
      </View>
    );
  }

  return (
    <View
      testID={`visual-qa-scenario-${scenario.id}`}
      style={{ backgroundColor: colors.background, flex: 1 }}
    >
      <ViewerScreen
        displayName={scenario.displayName}
        initialMolecule={scenario.molecule}
        initialSummary={scenario.summary}
        visualQa={scenario.viewerContract}
      />
    </View>
  );
}
