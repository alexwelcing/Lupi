import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { getLupiSavedViewUrl, getLupiWebBaseUrl } from "@/src/config/lupi";
import { normalizeSavedViewInput } from "@/src/domain/saved-views";
import { colors } from "@/src/theme/colors";

export function SavedViewHandoffScreen({ slug }: { slug?: string }) {
  const normalizedSlug = normalizeSavedViewInput(
    slug ?? "",
    getLupiWebBaseUrl(),
  );
  const [error, setError] = useState<string | null>(null);

  const openInBrowser = async () => {
    if (!normalizedSlug) return;
    setError(null);
    try {
      await WebBrowser.openBrowserAsync(getLupiSavedViewUrl(normalizedSlug));
    } catch {
      setError("Lupi could not open this saved view in Safari.");
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        padding: 22,
      }}
      style={{ backgroundColor: colors.background }}
    >
      <View
        style={{
          backgroundColor: colors.backgroundElevated,
          borderColor: colors.border,
          borderCurve: "continuous",
          borderRadius: 26,
          borderWidth: 1,
          gap: 15,
          padding: 22,
        }}
      >
        <Text
          selectable
          style={{
            color: colors.accent,
            fontSize: 13,
            fontWeight: "900",
            letterSpacing: 1.1,
          }}
        >
          SAVED VIEW HANDOFF
        </Text>
        <Text
          selectable
          style={{
            color: colors.text,
            fontSize: 28,
            fontWeight: "900",
            letterSpacing: -0.7,
          }}
        >
          Open this view in Lupi Web.
        </Text>
        <Text
          selectable
          style={{ color: colors.textMuted, fontSize: 15, lineHeight: 22 }}
        >
          Saved views do not yet expose trusted atom-count metadata. To keep the
          iPhone app within its 50,000-atom workload, Lupi will not embed this
          view until it can preflight the dataset size.
        </Text>
        {normalizedSlug ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderCurve: "continuous",
              borderRadius: 15,
              gap: 5,
              padding: 14,
            }}
          >
            <Text
              selectable
              style={{
                color: colors.textMuted,
                fontSize: 12,
                fontWeight: "800",
              }}
            >
              VIEW SLUG
            </Text>
            <Text
              selectable
              style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}
            >
              {normalizedSlug}
            </Text>
          </View>
        ) : (
          <Text
            accessibilityRole="alert"
            selectable
            style={{ color: colors.danger, fontSize: 14, lineHeight: 20 }}
          >
            This is not a valid Lupi saved-view link.
          </Text>
        )}
        {error ? (
          <Text
            accessibilityRole="alert"
            selectable
            style={{ color: colors.danger, fontSize: 14, lineHeight: 20 }}
          >
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityHint="Leaves the app and opens the saved view in Safari"
          accessibilityRole="button"
          disabled={!normalizedSlug}
          onPress={() => void openInBrowser()}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: pressed ? colors.accentStrong : colors.accent,
            borderCurve: "continuous",
            borderRadius: 15,
            justifyContent: "center",
            minHeight: 52,
            opacity: normalizedSlug ? 1 : 0.45,
          })}
        >
          <Text
            style={{
              color: colors.background,
              fontSize: 16,
              fontWeight: "900",
            }}
          >
            Open in Safari
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
