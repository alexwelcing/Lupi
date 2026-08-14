import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useState } from "react";
import {
  ActivityIndicator,
  ActionSheetIOS,
  Modal,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "@/src/theme/colors";

import {
  executeViewerMenuAction,
  isViewerMenuActionEnabled,
  makeViewerActionSheet,
  viewerMenuDefinition,
  type ViewerMenuId,
} from "./viewer-menu";

export interface ViewerControlBarProps {
  arEnabled: boolean;
  arPreparing: boolean;
  enabled: boolean;
  onCommand: (tool: string, args?: Record<string, unknown>) => void;
  onOpenAr: () => void;
  onReload: () => void;
  onShare: () => void;
}

export function ViewerControlBar({
  arEnabled,
  arPreparing,
  enabled,
  onCommand,
  onOpenAr,
  onReload,
  onShare,
}: ViewerControlBarProps) {
  const { fontScale, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [fallbackMenu, setFallbackMenu] = useState<ViewerMenuId | null>(null);
  const showLabels = width >= 360 && fontScale < 1.4;

  const run = (action: () => void) => {
    if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
    action();
  };

  const runMenuAction = (menuId: ViewerMenuId, actionIndex: number) => {
    const action = viewerMenuDefinition(menuId).actions[actionIndex];
    if (!action || !isViewerMenuActionEnabled(action, enabled)) return;
    run(() => executeViewerMenuAction(action, { onCommand, onReload }));
  };

  const openMenu = (menuId: ViewerMenuId) => {
    run(() => {
      if (process.env.EXPO_OS !== "ios") {
        setFallbackMenu(menuId);
        return;
      }

      const menu = viewerMenuDefinition(menuId);
      const sheet = makeViewerActionSheet(menuId, enabled);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: menu.title,
          message: menu.message,
          options: sheet.options,
          cancelButtonIndex: sheet.cancelButtonIndex,
          disabledButtonIndices: sheet.disabledButtonIndices,
        },
        (buttonIndex) => {
          if (buttonIndex === sheet.cancelButtonIndex) return;
          runMenuAction(menuId, buttonIndex);
        },
      );
    });
  };

  return (
    <>
      <View
        accessibilityLabel="Molecular viewer controls"
        style={{
          backgroundColor: colors.backgroundElevated,
          flexDirection: "row",
          gap: 2,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingHorizontal: 6,
          paddingTop: 6,
        }}
      >
        <ToolbarControl
          accessibilityHint="Opens a native ARKit view for placing and interacting with this molecule in your room"
          accessibilityLabel="View molecule in your room"
          busy={arPreparing}
          disabled={!arEnabled || arPreparing}
          highlighted
          icon="arkit"
          label="Room"
          onPress={() => run(onOpenAr)}
          showLabel={showLabels}
        />
        <ToolbarControl
          accessibilityHint="Centers the loaded molecule in the viewer"
          accessibilityLabel="Fit molecule to view"
          label="Fit"
          icon="scope"
          disabled={!enabled}
          showLabel={showLabels}
          onPress={() => run(() => onCommand("lupi.fit_camera"))}
        />
        <ToolbarControl
          accessibilityHint="Opens native camera-angle choices"
          accessibilityLabel="Camera options"
          label="Camera"
          icon="camera.viewfinder"
          disabled={!enabled}
          showLabel={showLabels}
          onPress={() => openMenu("camera")}
        />
        <ToolbarControl
          accessibilityHint="Opens native background and rendering choices"
          accessibilityLabel="Appearance options"
          label="Look"
          icon="circle.lefthalf.filled"
          disabled={!enabled}
          showLabel={showLabels}
          onPress={() => openMenu("appearance")}
        />
        <ToolbarControl
          accessibilityHint="Opens bond, reset, and reload actions"
          accessibilityLabel="More viewer options"
          label="More"
          icon="ellipsis.circle"
          showLabel={showLabels}
          onPress={() => openMenu("more")}
        />
        <ToolbarControl
          accessibilityHint="Opens the iOS share sheet for the current molecular view"
          accessibilityLabel="Share molecular view"
          label="Share"
          icon="square.and.arrow.up"
          disabled={!enabled}
          showLabel={showLabels}
          onPress={() => run(onShare)}
        />
      </View>
      <ViewerMenuFallback
        enabled={enabled}
        menuId={fallbackMenu}
        onClose={() => setFallbackMenu(null)}
        onSelect={(menuId, actionIndex) => {
          setFallbackMenu(null);
          runMenuAction(menuId, actionIndex);
        }}
        safeAreaBottom={insets.bottom}
      />
    </>
  );
}

function ToolbarControl({
  accessibilityHint,
  accessibilityLabel,
  busy = false,
  highlighted = false,
  icon,
  label,
  showLabel,
  disabled = false,
  onPress,
}: {
  accessibilityHint: string;
  accessibilityLabel: string;
  busy?: boolean;
  highlighted?: boolean;
  icon: SFSymbol;
  label: string;
  showLabel: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed
          ? colors.cardPressed
          : highlighted && !disabled
            ? "rgba(111,231,247,0.1)"
            : "transparent",
        borderCurve: "continuous",
        borderRadius: 12,
        flex: 1,
        gap: 2,
        justifyContent: "center",
        minHeight: 50,
        minWidth: 0,
        opacity: disabled ? 0.42 : 1,
        paddingHorizontal: 3,
        paddingVertical: 4,
      })}
    >
      {busy ? (
        <ActivityIndicator
          color={colors.accent}
          size="small"
          style={{ height: 19, width: 19 }}
        />
      ) : (
        <SymbolView
          accessibilityElementsHidden
          name={icon}
          size={19}
          tintColor={highlighted && !disabled ? colors.accent : colors.text}
          style={{ height: 19, width: 19 }}
        />
      )}
      {showLabel ? (
        <Text
          numberOfLines={1}
          style={{
            color: highlighted && !disabled ? colors.accent : colors.textMuted,
            fontSize: 10,
            fontWeight: "600",
          }}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ViewerMenuFallback({
  enabled,
  menuId,
  onClose,
  onSelect,
  safeAreaBottom,
}: {
  enabled: boolean;
  menuId: ViewerMenuId | null;
  onClose: () => void;
  onSelect: (menuId: ViewerMenuId, actionIndex: number) => void;
  safeAreaBottom: number;
}) {
  const menu = menuId ? viewerMenuDefinition(menuId) : null;

  return (
    <Modal
      accessibilityViewIsModal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={menu !== null}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          accessibilityHint="Dismisses the viewer options"
          accessibilityLabel="Close viewer options"
          accessibilityRole="button"
          onPress={onClose}
          style={{
            backgroundColor: "rgba(0,0,0,0.5)",
            bottom: 0,
            left: 0,
            position: "absolute",
            right: 0,
            top: 0,
          }}
        />
        {menu ? (
          <View
            style={{
              backgroundColor: colors.backgroundElevated,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              gap: 12,
              paddingHorizontal: 12,
              paddingTop: 8,
              paddingBottom: Math.max(safeAreaBottom, 24),
            }}
          >
            <View
              accessibilityElementsHidden
              style={{
                alignSelf: "center",
                backgroundColor: colors.border,
                borderRadius: 3,
                height: 5,
                width: 38,
              }}
            />
            <View style={{ gap: 4, paddingHorizontal: 4, paddingBottom: 2 }}>
              <Text
                accessibilityRole="header"
                selectable
                style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}
              >
                {menu.title}
              </Text>
              <Text
                selectable
                style={{
                  color: colors.textMuted,
                  fontSize: 13,
                  lineHeight: 18,
                }}
              >
                {menu.message}
              </Text>
            </View>
            <View
              style={{
                backgroundColor: colors.card,
                borderCurve: "continuous",
                borderRadius: 16,
                overflow: "hidden",
              }}
            >
              {menu.actions.map((action, actionIndex) => {
                const actionEnabled = isViewerMenuActionEnabled(
                  action,
                  enabled,
                );
                return (
                  <Pressable
                    key={action.id}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !actionEnabled }}
                    disabled={!actionEnabled}
                    onPress={() => onSelect(menu.id, actionIndex)}
                    style={({ pressed }) => ({
                      alignItems: "center",
                      backgroundColor: pressed
                        ? colors.cardPressed
                        : "transparent",
                      borderBottomColor: colors.border,
                      borderBottomWidth:
                        actionIndex === menu.actions.length - 1 ? 0 : 1,
                      justifyContent: "center",
                      minHeight: 52,
                      opacity: actionEnabled ? 1 : 0.42,
                      paddingHorizontal: 14,
                    })}
                  >
                    <Text
                      style={{
                        color: colors.text,
                        fontSize: 16,
                        fontWeight: "600",
                      }}
                    >
                      {action.title}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => ({
                alignItems: "center",
                backgroundColor: pressed ? colors.cardPressed : colors.card,
                borderCurve: "continuous",
                borderRadius: 16,
                justifyContent: "center",
                minHeight: 52,
              })}
            >
              <Text
                style={{
                  color: colors.accent,
                  fontSize: 16,
                  fontWeight: "700",
                }}
              >
                Cancel
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
