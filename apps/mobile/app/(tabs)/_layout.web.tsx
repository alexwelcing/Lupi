import { Tabs } from "expo-router";

import { colors } from "@/src/theme/colors";

export default function WebTabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.accent,
        tabBarIcon: () => null,
        tabBarIconStyle: { display: "none" },
        tabBarInactiveTintColor: colors.textMuted,
        tabBarItemStyle: { justifyContent: "center" },
        tabBarLabelStyle: {
          fontSize: 13,
          fontWeight: "700",
        },
        tabBarStyle: {
          backgroundColor: colors.backgroundElevated,
          borderTopColor: colors.border,
          height: 58,
          paddingBottom: 0,
          paddingTop: 0,
        },
      }}
    >
      <Tabs.Screen name="(explore)" options={{ title: "Gallery" }} />
      <Tabs.Screen name="(library)" options={{ title: "Library" }} />
      <Tabs.Screen name="(settings)" options={{ title: "Settings" }} />
    </Tabs>
  );
}
