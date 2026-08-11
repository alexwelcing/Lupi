import { NativeTabs } from "expo-router/unstable-native-tabs";

import { colors } from "@/src/theme/colors";

export default function TabLayout() {
  return (
    <NativeTabs
      backgroundColor={colors.backgroundElevated}
      blurEffect="systemMaterialDark"
      disableTransparentOnScrollEdge
      iconColor={{ default: colors.textMuted, selected: colors.accent }}
      labelStyle={{
        default: { color: colors.textMuted },
        selected: { color: colors.accent },
      }}
      minimizeBehavior="onScrollDown"
      shadowColor={colors.border}
      tintColor={colors.accent}
    >
      <NativeTabs.Trigger name="(explore)">
        <NativeTabs.Trigger.Icon sf="square.grid.2x2.fill" />
        <NativeTabs.Trigger.Label>Gallery</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(library)">
        <NativeTabs.Trigger.Icon sf="clock" />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <NativeTabs.Trigger.Icon sf="gearshape.fill" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
