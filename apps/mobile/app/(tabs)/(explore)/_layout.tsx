import { Stack } from "expo-router";
import { Platform } from "react-native";

import { colors } from "@/src/theme/colors";

export default function ExploreLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerShown: Platform.OS !== "web",
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Gallery" }} />
    </Stack>
  );
}
