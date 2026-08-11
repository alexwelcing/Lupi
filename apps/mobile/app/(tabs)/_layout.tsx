import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";

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
        <Icon sf="square.grid.2x2.fill" />
        <Label>Gallery</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(library)">
        <Icon sf="clock" />
        <Label>Library</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <Icon sf="gearshape.fill" />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
