import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { colors } from "@/src/theme/colors";
import { VIEWER_STACK_OPTIONS } from "@/src/features/viewer/viewer-navigation";

export { RootErrorBoundary as ErrorBoundary } from "@/src/components/root-error-boundary";

export const unstable_settings = {
  anchor: "(tabs)",
};

const lupiNavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.backgroundElevated,
    text: colors.text,
    border: colors.border,
    notification: colors.warning,
  },
};

function RootNavigation() {
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
        <Stack.Screen name="viewer" options={VIEWER_STACK_OPTIONS} />
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

export default function RootLayout() {
  return (
    <ThemeProvider value={lupiNavigationTheme}>
      <RootNavigation />
    </ThemeProvider>
  );
}
