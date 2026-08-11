import { Text, View } from "react-native";

import { colors } from "@/src/theme/colors";

import type { MoleculeArSurfaceProps } from "./molecule-ar-surface.types";

export function MoleculeArSurface({ scene }: MoleculeArSurfaceProps) {
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: colors.background,
        flex: 1,
        gap: 10,
        justifyContent: "center",
        padding: 28,
      }}
      testID="ar-surface-web-fallback"
    >
      <Text
        accessibilityRole="header"
        selectable
        style={{
          color: colors.text,
          fontSize: 24,
          fontWeight: "900",
          textAlign: "center",
        }}
      >
        {scene.molecule.name}
      </Text>
      <Text
        selectable
        style={{
          color: colors.textMuted,
          fontSize: 15,
          lineHeight: 22,
          textAlign: "center",
        }}
      >
        Native room tracking and the camera composite are available in the Lupi
        iPhone development build.
      </Text>
    </View>
  );
}
