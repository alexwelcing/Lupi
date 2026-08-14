import { Stack } from "expo-router";
import { Platform } from "react-native";

import { colors } from "@/src/theme/colors";

export const unstable_settings = {
  anchor: "library",
};

export default function LibraryLayout() {
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
      <Stack.Screen name="library" options={{ title: "Library" }} />
    </Stack>
  );
}
