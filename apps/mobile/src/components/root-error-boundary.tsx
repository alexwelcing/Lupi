import Constants from "expo-constants";
import type { ErrorBoundaryProps } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/theme/colors";

export function RootErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const version =
    Constants.nativeAppVersion ??
    Constants.expoConfig?.version ??
    "development";
  const build = Constants.nativeBuildVersion ?? "local";

  return (
    <SafeAreaView style={{ backgroundColor: colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View
          style={{
            backgroundColor: colors.backgroundElevated,
            borderColor: colors.border,
            borderRadius: 24,
            borderWidth: 1,
            gap: 14,
            padding: 22,
          }}
        >
          <Text
            accessibilityRole="header"
            selectable
            style={{ color: colors.text, fontSize: 26, fontWeight: "900" }}
          >
            Lupi hit an unexpected problem.
          </Text>
          <Text
            selectable
            style={{ color: colors.textMuted, fontSize: 15, lineHeight: 22 }}
          >
            Your recent catalog history remains on this device. Retry the app,
            then include the details below with a TestFlight report if it
            happens again.
          </Text>
          <Text
            accessibilityRole="alert"
            selectable
            style={{
              color: colors.danger,
              fontFamily: "monospace",
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            {error.message}
          </Text>
          <Text
            selectable
            style={{
              color: colors.textMuted,
              fontFamily: "monospace",
              fontSize: 12,
            }}
          >
            Lupi {version} ({build})
          </Text>
          <Pressable
            accessibilityHint="Retries the screen that failed"
            accessibilityLabel="Retry Lupi"
            accessibilityRole="button"
            onPress={retry}
            style={({ pressed }) => ({
              alignItems: "center",
              alignSelf: "flex-start",
              backgroundColor: pressed ? colors.accentStrong : colors.accent,
              borderRadius: 14,
              justifyContent: "center",
              minHeight: 48,
              paddingHorizontal: 20,
            })}
          >
            <Text
              style={{
                color: colors.background,
                fontSize: 15,
                fontWeight: "900",
              }}
            >
              Try Again
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
