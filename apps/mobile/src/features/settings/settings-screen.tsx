import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useMemo, useState, type ReactNode } from "react";
import {
  Pressable,
  SectionList,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { getLupiWebBaseUrl } from "@/src/config/lupi";
import { normalizeSavedViewInput } from "@/src/domain/saved-views";
import { colors } from "@/src/theme/colors";
import { layout, radii, spacing, typeScale } from "@/src/theme/tokens";

import {
  buildSettingsSections,
  INVALID_SAVED_VIEW_MESSAGE,
  type SettingsItem,
  type SettingsRoute,
  type SettingsSection,
} from "./settings-sections";

export function SettingsScreen() {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.2;
  const sections = useMemo(() => buildSettingsSections(), []);
  const [savedViewInput, setSavedViewInput] = useState("");
  const [savedViewError, setSavedViewError] = useState<string | null>(null);

  const select = (action: () => void) => {
    if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
    action();
  };

  const openRoute = (route: SettingsRoute) => {
    select(() => router.push(route));
  };

  const openSavedView = () => {
    const slug = normalizeSavedViewInput(savedViewInput, getLupiWebBaseUrl());
    if (!slug) {
      setSavedViewError(INVALID_SAVED_VIEW_MESSAGE);
      if (process.env.EXPO_OS === "ios") {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning,
        );
      }
      return;
    }

    setSavedViewError(null);
    select(() => router.push({ pathname: "/view/[slug]", params: { slug } }));
  };

  const renderItem = ({
    index,
    item,
    section,
  }: {
    index: number;
    item: SettingsItem;
    section: SettingsSection;
  }) => {
    const grouped = {
      first: index === 0,
      last: index === section.data.length - 1,
    };

    switch (item.kind) {
      case "route":
        return (
          <NativeActionRow
            {...grouped}
            accessibilityHint={
              item.route === "/import"
                ? "Opens the iPhone document picker"
                : "Opens app, service, and privacy details"
            }
            detail={item.detail}
            icon={item.icon}
            onPress={() => openRoute(item.route)}
            title={item.title}
          />
        );
      case "saved-view":
        return (
          <GroupedSurface {...grouped} gap={spacing.sm}>
            <View style={{ gap: spacing.xxs }}>
              <Text
                selectable
                style={{
                  color: colors.text,
                  fontSize: typeScale.callout,
                  fontWeight: "700",
                }}
              >
                {item.title}
              </Text>
              <Text
                selectable
                style={{
                  color: colors.textMuted,
                  fontSize: typeScale.footnote,
                  lineHeight: 19,
                }}
              >
                {item.detail}
              </Text>
            </View>
            <View
              style={{
                alignItems: "stretch",
                flexDirection: largeText ? "column" : "row",
                gap: spacing.xs,
              }}
            >
              <TextInput
                accessibilityLabel="Saved view slug or URL"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                keyboardType="url"
                onChangeText={(value) => {
                  setSavedViewInput(value);
                  if (savedViewError) setSavedViewError(null);
                }}
                onSubmitEditing={openSavedView}
                placeholder="view-slug or lupi.live/view/…"
                placeholderTextColor="#6F8994"
                returnKeyType="go"
                selectionColor={colors.accent}
                style={{
                  backgroundColor: colors.background,
                  borderColor: savedViewError ? colors.danger : colors.border,
                  borderCurve: "continuous",
                  borderRadius: radii.control,
                  borderWidth: 1,
                  color: colors.text,
                  flex: 1,
                  fontSize: typeScale.body,
                  minHeight: 46,
                  minWidth: 0,
                  paddingHorizontal: 12,
                }}
                value={savedViewInput}
              />
              <Pressable
                accessibilityHint="Validates this saved view before opening it"
                accessibilityLabel="Open saved view"
                accessibilityRole="button"
                onPress={openSavedView}
                style={({ pressed }) => ({
                  alignItems: "center",
                  backgroundColor: pressed
                    ? colors.accentStrong
                    : colors.accent,
                  borderCurve: "continuous",
                  borderRadius: radii.control,
                  justifyContent: "center",
                  minHeight: 46,
                  minWidth: 64,
                  paddingHorizontal: 13,
                })}
              >
                <Text
                  style={{
                    color: colors.background,
                    fontSize: 14,
                    fontWeight: "800",
                  }}
                >
                  Open
                </Text>
              </Pressable>
            </View>
            {savedViewError ? (
              <Text
                accessibilityRole="alert"
                selectable
                style={{ color: colors.danger, fontSize: 13, lineHeight: 19 }}
              >
                {savedViewError}
              </Text>
            ) : null}
          </GroupedSurface>
        );
      case "privacy-note":
        return (
          <View style={groupedStyle(grouped.first, grouped.last, false)}>
            <RowIcon name={item.icon} tintColor={colors.success} />
            <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
              <Text
                selectable
                style={{
                  color: colors.text,
                  fontSize: typeScale.callout,
                  fontWeight: "700",
                }}
              >
                {item.title}
              </Text>
              <Text
                selectable
                style={{
                  color: colors.textMuted,
                  fontSize: typeScale.footnote,
                  lineHeight: 19,
                }}
              >
                {item.detail}
              </Text>
            </View>
          </View>
        );
    }
  };

  return (
    <SectionList<SettingsItem, SettingsSection>
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingBottom: layout.contentBottom,
        paddingHorizontal: layout.screenPadding,
        paddingTop: process.env.EXPO_OS === "web" ? spacing.xl : spacing.xs,
      }}
      keyboardDismissMode={
        process.env.EXPO_OS === "ios" ? "interactive" : "on-drag"
      }
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        process.env.EXPO_OS === "web" ? (
          <View style={{ gap: spacing.xxs, paddingBottom: spacing.lg }}>
            <Text
              accessibilityRole="header"
              style={{ color: colors.text, fontSize: 28, fontWeight: "800" }}
            >
              Settings
            </Text>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: typeScale.body,
                lineHeight: 22,
              }}
            >
              Open files, review privacy, and check the app.
            </Text>
          </View>
        ) : null
      }
      renderItem={renderItem}
      renderSectionFooter={() => <View style={{ height: spacing.lg }} />}
      renderSectionHeader={({ section }) => (
        <View
          style={{
            justifyContent: "center",
            minHeight: 34,
            paddingHorizontal: spacing.xxs,
          }}
        >
          <Text
            accessibilityRole="header"
            selectable
            style={{
              color: colors.textMuted,
              fontSize: typeScale.metadata,
              fontWeight: "700",
            }}
          >
            {section.title}
          </Text>
        </View>
      )}
      sections={sections}
      stickySectionHeadersEnabled={false}
      style={{ backgroundColor: colors.background }}
      testID="settings-screen"
    />
  );
}

function NativeActionRow({
  accessibilityHint,
  detail,
  first,
  icon,
  last,
  onPress,
  title,
}: {
  accessibilityHint: string;
  detail: string;
  first: boolean;
  icon: SFSymbol;
  last: boolean;
  onPress: () => void;
  title: string;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => groupedStyle(first, last, pressed)}
    >
      <RowIcon name={icon} />
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <Text
          selectable
          style={{
            color: colors.text,
            fontSize: typeScale.callout,
            fontWeight: "700",
          }}
        >
          {title}
        </Text>
        <Text
          selectable
          style={{
            color: colors.textMuted,
            fontSize: typeScale.footnote,
            lineHeight: 19,
          }}
        >
          {detail}
        </Text>
      </View>
      <RowChevron />
    </Pressable>
  );
}

function GroupedSurface({
  children,
  first,
  gap = 5,
  last,
}: {
  children: ReactNode;
  first: boolean;
  gap?: number;
  last: boolean;
}) {
  return (
    <View
      style={{
        ...groupedStyle(first, last, false),
        alignItems: "stretch",
        flexDirection: "column",
        gap,
      }}
    >
      {children}
    </View>
  );
}

function RowIcon({
  name,
  tintColor = colors.accent,
}: {
  name: SFSymbol;
  tintColor?: string;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        alignItems: "center",
        backgroundColor: colors.cardPressed,
        borderCurve: "continuous",
        borderRadius: radii.control,
        height: 36,
        justifyContent: "center",
        width: 36,
      }}
    >
      <SymbolView
        name={name}
        size={18}
        tintColor={tintColor}
        style={{ height: 18, width: 18 }}
      />
    </View>
  );
}

function RowChevron() {
  return (
    <SymbolView
      accessibilityElementsHidden
      name="chevron.right"
      size={14}
      tintColor={colors.textMuted}
      style={{ height: 14, width: 9 }}
    />
  );
}

function groupedStyle(first: boolean, last: boolean, pressed: boolean) {
  return {
    alignItems: "center" as const,
    backgroundColor: pressed ? colors.cardPressed : colors.card,
    borderBottomLeftRadius: last ? radii.card : 0,
    borderBottomRightRadius: last ? radii.card : 0,
    borderBottomColor: colors.border,
    borderCurve: "continuous" as const,
    borderTopLeftRadius: first ? radii.card : 0,
    borderTopRightRadius: first ? radii.card : 0,
    borderBottomWidth: last ? 0 : 1,
    flexDirection: "row" as const,
    gap: spacing.sm,
    minHeight: 62,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  };
}
