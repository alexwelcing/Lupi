import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SectionList,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  moleculeRouteParams,
  type MoleculeSummary,
} from "@/src/domain/molecules";
import {
  clearRecentMolecules,
  getRecentMolecules,
} from "@/src/storage/recent-molecules";
import { colors } from "@/src/theme/colors";
import { layout, radii, spacing, typeScale } from "@/src/theme/tokens";

import {
  buildLibrarySections,
  type LibraryHistoryState,
  type LibraryItem,
  type LibrarySection,
} from "./library-sections";

export function LibraryScreen() {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.2;
  const refreshGeneration = useRef(0);
  const [history, setHistory] = useState<LibraryHistoryState>({
    status: "loading",
  });
  const [isClearing, setIsClearing] = useState(false);
  const sections = useMemo(() => buildLibrarySections(history), [history]);
  const recent = history.status === "ready" ? history.molecules : [];

  const refresh = useCallback(() => {
    const generation = ++refreshGeneration.current;
    setHistory({ status: "loading" });
    void getRecentMolecules()
      .then((molecules) => {
        if (refreshGeneration.current === generation) {
          setHistory({ status: "ready", molecules });
        }
      })
      .catch(() => {
        if (refreshGeneration.current === generation) {
          setHistory({
            status: "error",
            message:
              "Recent structures are unavailable on this device right now.",
          });
        }
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      return () => {
        refreshGeneration.current += 1;
      };
    }, [refresh]),
  );

  const select = (action: () => void) => {
    if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
    action();
  };

  const openRecent = (molecule: MoleculeSummary) => {
    select(() => {
      router.navigate({
        pathname: "/viewer",
        params: moleculeRouteParams(molecule),
      });
    });
  };

  const clearHistory = async () => {
    setIsClearing(true);
    try {
      await clearRecentMolecules();
      setHistory({ status: "ready", molecules: [] });
      if (process.env.EXPO_OS === "ios") {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
      }
    } catch {
      if (process.env.EXPO_OS === "ios") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      Alert.alert(
        "Could Not Clear Recents",
        "Your recent structures are still available. Please try again.",
      );
    } finally {
      setIsClearing(false);
    }
  };

  const confirmClearHistory = () => {
    if (isClearing) return;
    select(() => {
      Alert.alert(
        "Clear Recent Structures?",
        "This removes the recent structures stored on this iPhone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Clear",
            style: "destructive",
            onPress: () => void clearHistory(),
          },
        ],
      );
    });
  };

  const renderItem = ({
    index,
    item,
    section,
  }: {
    index: number;
    item: LibraryItem;
    section: LibrarySection;
  }) => {
    const grouped = {
      first: index === 0,
      last: index === section.data.length - 1,
    };

    switch (item.kind) {
      case "recent":
        return (
          <RecentMoleculeRow
            {...grouped}
            largeText={largeText}
            molecule={item.molecule}
            onPress={() => openRecent(item.molecule)}
          />
        );
      case "loading":
        return (
          <GroupedSurface {...grouped}>
            <View
              accessibilityLiveRegion="polite"
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: spacing.sm,
                minHeight: 54,
              }}
            >
              <ActivityIndicator color={colors.accent} />
              <Text
                selectable
                style={{ color: colors.textMuted, fontSize: typeScale.body }}
              >
                Loading your library…
              </Text>
            </View>
          </GroupedSurface>
        );
      case "empty":
        return (
          <View
            style={{
              alignItems: "center",
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingVertical: 44,
            }}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                alignItems: "center",
                backgroundColor: colors.cardPressed,
                borderCurve: "continuous",
                borderRadius: 20,
                height: 52,
                justifyContent: "center",
                width: 52,
              }}
            >
              <SymbolView
                name="clock"
                size={23}
                tintColor={colors.accent}
                style={{ height: 24, width: 24 }}
              />
            </View>
            <View style={{ alignItems: "center", gap: spacing.xs }}>
              <Text
                selectable
                style={{
                  color: colors.text,
                  fontSize: typeScale.title3,
                  fontWeight: "800",
                  textAlign: "center",
                }}
              >
                No recent structures
              </Text>
              <Text
                selectable
                style={{
                  color: colors.textMuted,
                  fontSize: typeScale.body,
                  lineHeight: 22,
                  maxWidth: 300,
                  textAlign: "center",
                }}
              >
                Open a structure from Gallery and it will appear here for a
                quick return.
              </Text>
            </View>
            <Pressable
              accessibilityHint="Switches to the molecule gallery"
              accessibilityLabel="Browse the molecule gallery"
              accessibilityRole="button"
              onPress={() => select(() => router.navigate("/"))}
              style={({ pressed }) => ({
                alignItems: "center",
                backgroundColor: pressed ? colors.accentStrong : colors.accent,
                borderCurve: "continuous",
                borderRadius: radii.control,
                justifyContent: "center",
                minHeight: 48,
                paddingHorizontal: 18,
              })}
            >
              <Text
                style={{
                  color: colors.background,
                  fontSize: typeScale.body,
                  fontWeight: "800",
                }}
              >
                Browse Gallery
              </Text>
            </Pressable>
          </View>
        );
      case "history-error":
        return (
          <GroupedSurface {...grouped} gap={spacing.sm}>
            <View
              style={{
                alignItems: "flex-start",
                flexDirection: "row",
                gap: spacing.sm,
              }}
            >
              <RowIcon
                name="exclamationmark.triangle"
                tintColor={colors.warning}
              />
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  selectable
                  style={{
                    color: colors.text,
                    fontSize: typeScale.callout,
                    fontWeight: "800",
                  }}
                >
                  Library unavailable
                </Text>
                <Text
                  accessibilityRole="alert"
                  selectable
                  style={{
                    color: colors.textMuted,
                    fontSize: 14,
                    lineHeight: 20,
                  }}
                >
                  {item.message}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityHint="Tries to load recent structures again"
              accessibilityRole="button"
              onPress={refresh}
              style={({ pressed }) => ({
                alignItems: "center",
                alignSelf: "flex-start",
                backgroundColor: pressed ? colors.cardPressed : colors.card,
                borderColor: colors.border,
                borderCurve: "continuous",
                borderRadius: radii.control,
                borderWidth: 1,
                justifyContent: "center",
                minHeight: 44,
                paddingHorizontal: 16,
              })}
            >
              <Text
                style={{ color: colors.text, fontSize: 14, fontWeight: "800" }}
              >
                Try Again
              </Text>
            </Pressable>
          </GroupedSurface>
        );
    }
  };

  return (
    <SectionList<LibraryItem, LibrarySection>
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        paddingBottom: layout.contentBottom,
        paddingHorizontal: layout.screenPadding,
        paddingTop: process.env.EXPO_OS === "web" ? spacing.xl : spacing.xs,
      }}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        process.env.EXPO_OS === "web" ? (
          <View style={{ gap: spacing.xxs, paddingBottom: spacing.lg }}>
            <Text
              accessibilityRole="header"
              style={{ color: colors.text, fontSize: 28, fontWeight: "800" }}
            >
              Library
            </Text>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: typeScale.body,
                lineHeight: 22,
              }}
            >
              Return to structures you have opened on this device.
            </Text>
          </View>
        ) : null
      }
      renderItem={renderItem}
      renderSectionHeader={({ section }) => (
        <View
          style={{
            alignItems: largeText ? "flex-start" : "center",
            flexDirection: largeText ? "column" : "row",
            gap: largeText ? 4 : 0,
            justifyContent: "space-between",
            minHeight: 36,
            paddingHorizontal: spacing.xxs,
            paddingVertical: largeText ? 6 : 0,
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
          {recent.length > 0 ? (
            <View
              style={{ alignItems: "center", flexDirection: "row", gap: 8 }}
            >
              <Text
                accessibilityLabel={`${recent.length} recent structures`}
                selectable
                style={{
                  color: colors.textMuted,
                  fontSize: typeScale.metadata,
                  fontVariant: ["tabular-nums"],
                  fontWeight: "700",
                }}
              >
                {recent.length}
              </Text>
              <Pressable
                accessibilityHint="Removes all recent structures stored on this iPhone"
                accessibilityLabel={
                  isClearing
                    ? "Clearing recent structures"
                    : "Clear recent structures"
                }
                accessibilityRole="button"
                disabled={isClearing}
                hitSlop={8}
                onPress={confirmClearHistory}
                style={({ pressed }) => ({
                  alignItems: "center",
                  borderCurve: "continuous",
                  borderRadius: 10,
                  justifyContent: "center",
                  minHeight: 36,
                  opacity: isClearing ? 0.45 : pressed ? 0.65 : 1,
                  paddingHorizontal: 6,
                })}
              >
                <Text
                  style={{
                    color: colors.danger,
                    fontSize: 14,
                    fontWeight: "700",
                  }}
                >
                  {isClearing ? "Clearing…" : "Clear"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
      sections={sections}
      stickySectionHeadersEnabled={false}
      style={{ backgroundColor: colors.background }}
      testID="library-screen"
    />
  );
}

function RecentMoleculeRow({
  first,
  largeText,
  last,
  molecule,
  onPress,
}: {
  first: boolean;
  largeText: boolean;
  last: boolean;
  molecule: MoleculeSummary;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint="Opens this structure in the molecular viewer"
      accessibilityLabel={`Open ${molecule.name}, ${molecule.formula}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => groupedStyle(first, last, pressed)}
    >
      <RowIcon name="cube" />
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <Text
          numberOfLines={largeText ? undefined : 1}
          selectable
          style={{
            color: colors.text,
            fontSize: typeScale.callout,
            fontWeight: "700",
          }}
        >
          {molecule.name}
        </Text>
        <Text
          numberOfLines={largeText ? undefined : 1}
          selectable
          style={{
            color: colors.textMuted,
            fontSize: typeScale.footnote,
            fontVariant: ["tabular-nums"],
          }}
        >
          {[molecule.formula, ...molecule.tags.slice(0, 2)]
            .filter(Boolean)
            .join("  ·  ")}
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
  name: "cube" | "exclamationmark.triangle";
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
