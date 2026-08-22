import Constants from "expo-constants";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { StatusBar } from "expo-status-bar";
import { lazy, Suspense } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/theme/colors";

import { canEnterNativeArRoute } from "./ar-build-policy";
import type { MoleculeArScene } from "./ar-scene";

const NativeArScreen = lazy(async () => {
  const module = await import("./ar-screen");
  return { default: module.ArScreen };
});

export function ArEntryScreen({ scene }: { scene: MoleculeArScene | null }) {
  if (!canEnterNativeArRoute(Constants.executionEnvironment)) {
    return (
      <ArBuildRequired
        message="Expo Go cannot load Lupi's native ARKit renderer. Install the Lupi development build on this iPhone, then choose Room again."
        title="Development build required"
      />
    );
  }

  return (
    <Suspense fallback={<ArLoadingState />}>
      <NativeArScreen scene={scene} />
    </Suspense>
  );
}

function ArLoadingState() {
  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={{
        alignItems: "center",
        backgroundColor: colors.background,
        flex: 1,
        gap: 12,
        justifyContent: "center",
        padding: 24,
      }}
    >
      <StatusBar style="light" />
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={{ color: colors.textMuted, fontSize: 15 }}>
        Preparing native room view…
      </Text>
    </SafeAreaView>
  );
}

function ArBuildRequired({
  message,
  title,
}: {
  message: string;
  title: string;
}) {
  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={{ backgroundColor: colors.background, flex: 1 }}
    >
      <StatusBar style="light" />
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 24,
        }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View
          style={{
            alignSelf: "center",
            backgroundColor: colors.backgroundElevated,
            borderColor: colors.border,
            borderCurve: "continuous",
            borderRadius: 24,
            borderWidth: 1,
            gap: 14,
            maxWidth: 520,
            padding: 22,
            width: "100%",
          }}
        >
          <SymbolView name="arkit" size={30} tintColor={colors.accent} />
          <Text
            accessibilityRole="header"
            selectable
            style={{ color: colors.text, fontSize: 25, fontWeight: "900" }}
          >
            {title}
          </Text>
          <Text
            selectable
            style={{ color: colors.textMuted, fontSize: 15, lineHeight: 22 }}
          >
            {message}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: pressed ? colors.accentStrong : colors.accent,
              borderCurve: "continuous",
              borderRadius: 16,
              flexDirection: "row",
              gap: 8,
              justifyContent: "center",
              minHeight: 52,
              paddingHorizontal: 18,
              paddingVertical: 10,
            })}
          >
            <SymbolView
              name="chevron.backward"
              size={17}
              tintColor={colors.background}
            />
            <Text
              style={{
                color: colors.background,
                flexShrink: 1,
                fontSize: 16,
                fontWeight: "900",
                textAlign: "center",
              }}
            >
              Return to Molecule
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
