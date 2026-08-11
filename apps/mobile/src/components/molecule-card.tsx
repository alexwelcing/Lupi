import * as Haptics from "expo-haptics";
import { Pressable, Text, View } from "react-native";

import type { MoleculeSummary } from "@/src/domain/molecules";
import { colors } from "@/src/theme/colors";

export function MoleculeCard({
  molecule,
  onPress,
}: {
  molecule: MoleculeSummary;
  onPress: () => void;
}) {
  const handlePress = () => {
    if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
    onPress();
  };

  return (
    <Pressable
      accessibilityHint="Opens this structure in the molecular viewer"
      accessibilityLabel={`Open ${molecule.name}, ${molecule.formula}`}
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.cardPressed : colors.card,
        borderColor: colors.border,
        borderCurve: "continuous",
        borderRadius: 20,
        borderWidth: 1,
        boxShadow: pressed
          ? "0 1px 2px rgba(0,0,0,0.14)"
          : "0 10px 30px rgba(0,0,0,0.18)",
        gap: 12,
        padding: 18,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <View
        style={{
          alignItems: "flex-start",
          flexDirection: "row",
          gap: 14,
          justifyContent: "space-between",
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Text
            selectable
            style={{ color: colors.text, fontSize: 20, fontWeight: "800" }}
          >
            {molecule.name}
          </Text>
          <Text
            selectable
            style={{
              color: colors.accent,
              fontSize: 15,
              fontVariant: ["tabular-nums"],
              fontWeight: "700",
            }}
          >
            {molecule.formula}
          </Text>
        </View>
        <Text style={{ color: colors.accent, fontSize: 22, fontWeight: "500" }}>
          ›
        </Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
        {molecule.tags.slice(0, 4).map((tag) => (
          <View
            key={tag}
            style={{
              backgroundColor: "#17333E",
              borderCurve: "continuous",
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 5,
            }}
          >
            <Text
              selectable
              style={{
                color: colors.textMuted,
                fontSize: 12,
                fontWeight: "700",
              }}
            >
              {tag}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}
