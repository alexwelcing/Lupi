import { Text, View } from "react-native";

import { colors } from "@/src/theme/colors";

export function SectionHeading({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <View style={{ gap: 5 }}>
      <Text
        accessibilityRole="header"
        selectable
        style={{ color: colors.text, fontSize: 22, fontWeight: "800" }}
      >
        {title}
      </Text>
      {detail ? (
        <Text
          selectable
          style={{ color: colors.textMuted, fontSize: 15, lineHeight: 21 }}
        >
          {detail}
        </Text>
      ) : null}
    </View>
  );
}
