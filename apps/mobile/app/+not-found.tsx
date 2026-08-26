import { Link } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { colors } from "@/src/theme/colors";

export default function NotFoundRoute() {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        padding: 24,
      }}
      style={{ backgroundColor: colors.background }}
    >
      <View style={{ gap: 16 }}>
        <Text
          selectable
          style={{ color: colors.text, fontSize: 30, fontWeight: "800" }}
        >
          This molecule drifted away.
        </Text>
        <Text
          selectable
          style={{ color: colors.textMuted, fontSize: 17, lineHeight: 24 }}
        >
          The requested Lupi screen does not exist or its link is incomplete.
        </Text>
        <Link href="/" asChild>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              backgroundColor: pressed ? colors.accentStrong : colors.accent,
              borderCurve: "continuous",
              borderRadius: 14,
              paddingHorizontal: 18,
              paddingVertical: 12,
            })}
          >
            <Text
              style={{
                color: colors.background,
                fontSize: 16,
                fontWeight: "800",
              }}
            >
              Back to Explore
            </Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}
