import { Stack } from "expo-router";

import { colors } from "@/src/theme/colors";

export const unstable_settings = {
  anchor: "settings",
};

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerShown: process.env.EXPO_OS !== "web",
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
    </Stack>
  );
}
