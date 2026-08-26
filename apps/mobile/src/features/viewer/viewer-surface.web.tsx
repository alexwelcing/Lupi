import * as WebBrowser from "expo-web-browser";
import { forwardRef, useImperativeHandle } from "react";
import { Pressable, Text, View } from "react-native";

import { colors } from "@/src/theme/colors";

import type {
  ViewerSurfaceHandle,
  ViewerSurfaceProps,
} from "./viewer-surface.types";

export const ViewerSurface = forwardRef<
  ViewerSurfaceHandle,
  ViewerSurfaceProps
>(function ViewerSurface({ sourceUrl, onMessage }, forwardedRef) {
  useImperativeHandle(
    forwardedRef,
    () => ({
      execute() {
        onMessage({
          type: "error",
          message:
            "Native viewer commands are unavailable in the web shell preview.",
        });
      },
      probe(id) {
        onMessage({ type: "probe", id, status: { ready: false } });
      },
      reload() {},
    }),
    [onMessage],
  );

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: colors.background,
        flex: 1,
        gap: 14,
        justifyContent: "center",
        padding: 28,
      }}
    >
      <Text
        selectable
        style={{
          color: colors.text,
          fontSize: 24,
          fontWeight: "800",
          textAlign: "center",
        }}
      >
        The interactive viewer opens in Lupi Web.
      </Text>
      <Text
        selectable
        style={{
          color: colors.textMuted,
          fontSize: 15,
          lineHeight: 22,
          textAlign: "center",
        }}
      >
        This fallback keeps the Expo web export healthy. The embedded MCP bridge
        runs in the iPhone app.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void WebBrowser.openBrowserAsync(sourceUrl)}
        style={({ pressed }) => ({
          backgroundColor: pressed ? colors.accentStrong : colors.accent,
          borderCurve: "continuous",
          borderRadius: 14,
          paddingHorizontal: 18,
          paddingVertical: 12,
        })}
      >
        <Text
          style={{ color: colors.background, fontSize: 15, fontWeight: "900" }}
        >
          Open Viewer
        </Text>
      </Pressable>
    </View>
  );
});
