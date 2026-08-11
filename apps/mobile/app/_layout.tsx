import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { colors } from "@/src/theme/colors";

export { RootErrorBoundary as ErrorBoundary } from "@/src/components/root-error-boundary";

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.backgroundElevated },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="viewer"
          options={{
            animation: "slide_from_right",
            gestureEnabled: true,
            headerLargeTitle: false,
            presentation: "card",
            title: "Molecule",
          }}
        />
        <Stack.Screen
          name="ar"
          options={{
            animation: "fade",
            gestureEnabled: false,
            headerShown: false,
            presentation: "fullScreenModal",
          }}
        />
        <Stack.Screen
          name="import"
          options={{ title: "Open XYZ File", headerLargeTitle: false }}
        />
        <Stack.Screen
          name="diagnostics"
          options={{ title: "About & Diagnostics", headerLargeTitle: false }}
        />
        <Stack.Screen
          name="view/[slug]"
          options={{ title: "Saved View", headerLargeTitle: false }}
        />
        <Stack.Screen
          name="__visual"
          options={{ animation: "none", headerShown: false }}
        />
        <Stack.Screen name="+not-found" options={{ title: "Not Found" }} />
      </Stack>
      <StatusBar style="light" />
    </GestureHandlerRootView>
  );
}
