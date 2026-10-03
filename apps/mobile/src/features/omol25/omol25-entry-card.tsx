import { Pressable, Text, View } from "react-native";

import { colors } from "@/src/theme/colors";
import { layout, radii, spacing, typeScale } from "@/src/theme/tokens";

export function Omol25EntryCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityHint="Browses the public OMol25 source collections in Lupi"
      accessibilityLabel="Explore OMol25 molecules"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed
          ? colors.cardPressed
          : colors.backgroundElevated,
        borderColor: colors.accent,
        borderCurve: "continuous",
        borderRadius: radii.card,
        borderWidth: 1,
        gap: spacing.sm,
        padding: spacing.lg,
      })}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: spacing.sm,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{
            color: colors.text,
            fontSize: typeScale.title2,
            fontWeight: "800",
          }}
        >
          Explore OMol25
        </Text>
        <Text
          style={{
            color: colors.accent,
            fontSize: typeScale.title3,
            fontWeight: "800",
          }}
        >
          →
        </Text>
      </View>
      <Text
        selectable
        style={{
          color: colors.textMuted,
          fontSize: typeScale.body,
          lineHeight: 22,
        }}
      >
        Browse the complete public neutral training split, or choose an indexed
        preview. Open source 3D coordinates in the viewer.
      </Text>
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.xs,
          minHeight: layout.minimumTarget,
        }}
      >
        <Text
          style={{
            color: colors.accent,
            fontSize: typeScale.footnote,
            fontWeight: "700",
          }}
        >
          Complete public neutral split
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: typeScale.footnote }}>
          · Source bonds not provided
        </Text>
      </View>
    </Pressable>
  );
}
