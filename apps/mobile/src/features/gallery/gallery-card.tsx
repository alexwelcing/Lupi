import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { colors } from "@/src/theme/colors";
import { radii, spacing, typeScale } from "@/src/theme/tokens";

import type { CuratedGalleryItem } from "./gallery-catalog";

type PreviewState = "failed" | "fallback" | "loaded" | "loading";

interface GalleryCardProps {
  featured?: boolean;
  imageUrl: string | null;
  item: CuratedGalleryItem;
  largeText: boolean;
  onPress: () => void;
  singleColumn: boolean;
}

export function GalleryCard(props: GalleryCardProps) {
  return (
    <GalleryCardContent key={JSON.stringify([props.imageUrl])} {...props} />
  );
}

function GalleryCardContent({
  featured = false,
  imageUrl,
  item,
  largeText,
  onPress,
  singleColumn,
}: GalleryCardProps) {
  const [previewState, setPreviewState] = useState<PreviewState>(
    imageUrl ? "loading" : "fallback",
  );

  const open = () => {
    if (process.env.EXPO_OS === "ios") {
      void Haptics.selectionAsync().catch(() => undefined);
    }
    onPress();
  };

  const facts =
    item.frameCount > 1
      ? `${formatCount(item.atomCount)} atoms, ${formatCount(item.frameCount)} frames`
      : `${formatCount(item.atomCount)} atoms`;
  const showFullCopy = largeText || featured;
  const showImage = imageUrl && previewState !== "failed";

  return (
    <Pressable
      accessibilityHint="Opens an interactive 3D view"
      accessibilityLabel={`Open ${item.name}, ${item.formula}. ${categoryLabel(item)} in ${item.domain}, with ${facts}. ${item.subtitle}`}
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.cardPressed : colors.card,
        borderColor: pressed ? colors.accentStrong : "transparent",
        borderCurve: "continuous",
        borderRadius: radii.card,
        borderWidth: 1,
        boxShadow: pressed
          ? "0 2px 8px rgba(0,0,0,0.16)"
          : "0 8px 22px rgba(0,0,0,0.18)",
        flex: 1,
        minHeight: featured ? 316 : singleColumn ? 248 : 276,
        overflow: "hidden",
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <View
        style={{
          aspectRatio: featured ? 1.72 : singleColumn ? 1.92 : 1.2,
          backgroundColor: item.palette[2],
          overflow: "hidden",
          position: "relative",
        }}
      >
        <PalettePreview item={item} />

        {showImage ? (
          <Image
            accessible={false}
            cachePolicy="memory-disk"
            contentFit="cover"
            contentPosition="center"
            onError={() => setPreviewState("failed")}
            onLoad={() => setPreviewState("loaded")}
            onLoadStart={() => setPreviewState("loading")}
            recyclingKey={item.id}
            source={{ uri: imageUrl }}
            style={{
              height: "100%",
              left: 0,
              position: "absolute",
              top: 0,
              transform: [{ scale: 1.12 }],
              width: "100%",
            }}
            transition={180}
          />
        ) : null}

        {previewState === "loading" ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              alignItems: "center",
              backgroundColor: "rgba(3, 10, 15, 0.22)",
              bottom: 0,
              justifyContent: "center",
              left: 0,
              position: "absolute",
              right: 0,
              top: 0,
            }}
          >
            <ActivityIndicator color={colors.text} />
          </View>
        ) : null}

        <View
          style={{
            backgroundColor: "rgba(3, 10, 15, 0.78)",
            borderCurve: "continuous",
            borderRadius: radii.round,
            left: spacing.sm,
            minHeight: 28,
            paddingHorizontal: spacing.sm,
            position: "absolute",
            top: spacing.sm,
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: typeScale.caption,
              fontWeight: "700",
            }}
          >
            {categoryLabel(item)}
          </Text>
        </View>

        {previewState === "failed" ? (
          <View
            style={{
              backgroundColor: "rgba(3, 10, 15, 0.76)",
              borderCurve: "continuous",
              borderRadius: radii.round,
              bottom: spacing.sm,
              minHeight: 28,
              paddingHorizontal: spacing.sm,
              position: "absolute",
              right: spacing.sm,
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                color: colors.textMuted,
                fontSize: typeScale.caption,
                fontWeight: "700",
              }}
            >
              Preview unavailable
            </Text>
          </View>
        ) : null}
      </View>

      <View
        style={{
          flex: 1,
          gap: spacing.xs,
          padding: featured ? spacing.md : spacing.sm,
        }}
      >
        <View style={{ gap: 3 }}>
          <Text
            numberOfLines={showFullCopy ? undefined : 2}
            selectable
            style={{
              color: colors.text,
              fontSize: featured ? typeScale.title3 : singleColumn ? 18 : 16,
              fontWeight: "800",
              lineHeight: featured ? 24 : singleColumn ? 22 : 20,
            }}
          >
            {item.name}
          </Text>
          <Text
            numberOfLines={largeText ? undefined : 1}
            selectable
            style={{
              color: colors.accent,
              fontSize: typeScale.metadata,
              fontVariant: ["tabular-nums"],
              fontWeight: "700",
            }}
          >
            {item.formula}
          </Text>
        </View>

        <Text
          numberOfLines={showFullCopy ? undefined : 3}
          selectable
          style={{
            color: colors.textMuted,
            flex: 1,
            fontSize: typeScale.footnote,
            lineHeight: 18,
          }}
        >
          {item.subtitle}
        </Text>

        <View
          style={{
            alignItems: largeText ? "flex-start" : "center",
            flexDirection: largeText ? "column" : "row",
            gap: largeText ? spacing.xxs : spacing.xs,
            justifyContent: "space-between",
          }}
        >
          <Text
            numberOfLines={largeText ? undefined : 1}
            selectable
            style={{
              color: colors.textMuted,
              flex: largeText ? undefined : 1,
              fontSize: typeScale.caption,
              fontWeight: "700",
            }}
          >
            {item.domain}
          </Text>
          <Text
            selectable
            style={{
              color: colors.text,
              fontSize: typeScale.caption,
              fontVariant: ["tabular-nums"],
              fontWeight: "800",
            }}
          >
            {item.frameCount > 1
              ? `${formatCount(item.frameCount)} frames`
              : `${formatCount(item.atomCount)} atoms`}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function PalettePreview({ item }: { item: CuratedGalleryItem }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flex: 1 }}
    >
      <View
        style={{
          backgroundColor: item.palette[0],
          borderRadius: radii.round,
          height: 58,
          left: "17%",
          opacity: 0.92,
          position: "absolute",
          top: "21%",
          width: 58,
        }}
      />
      <View
        style={{
          backgroundColor: item.palette[1],
          borderRadius: radii.round,
          height: 44,
          left: "49%",
          opacity: 0.9,
          position: "absolute",
          top: "34%",
          width: 44,
        }}
      />
      <View
        style={{
          backgroundColor: item.palette[0],
          borderRadius: radii.round,
          height: 30,
          left: "40%",
          opacity: 0.82,
          position: "absolute",
          top: "12%",
          width: 30,
        }}
      />
      <View
        style={{
          backgroundColor: item.palette[1],
          borderRadius: radii.round,
          height: 26,
          left: "65%",
          opacity: 0.78,
          position: "absolute",
          top: "18%",
          width: 26,
        }}
      />
      <View
        style={{
          backgroundColor: colors.background,
          height: 3,
          left: "35%",
          opacity: 0.5,
          position: "absolute",
          top: "43%",
          transform: [{ rotate: "-11deg" }],
          width: "24%",
        }}
      />
      <View
        style={{
          backgroundColor: colors.background,
          height: 3,
          left: "43%",
          opacity: 0.42,
          position: "absolute",
          top: "26%",
          transform: [{ rotate: "46deg" }],
          width: "18%",
        }}
      />
      <View
        style={{
          backgroundColor: colors.background,
          height: 3,
          left: "58%",
          opacity: 0.38,
          position: "absolute",
          top: "29%",
          transform: [{ rotate: "-28deg" }],
          width: "14%",
        }}
      />
      <View
        style={{
          alignItems: "center",
          bottom: spacing.sm,
          left: spacing.sm,
          position: "absolute",
          right: spacing.sm,
        }}
      >
        <Text
          adjustsFontSizeToFit
          numberOfLines={1}
          style={{
            color: colors.text,
            fontSize: 18,
            fontWeight: "800",
            opacity: 0.88,
          }}
        >
          {item.formula}
        </Text>
      </View>
    </View>
  );
}

function categoryLabel(item: CuratedGalleryItem): string {
  if (item.category === "trajectory") return "Trajectory";
  if (item.category === "material") return "Material";
  return "Molecule";
}

function formatCount(value: number): string {
  if (value >= 10_000) return `${trimDecimal(value / 1_000)}K`;
  return value.toLocaleString("en-US");
}

function trimDecimal(value: number): string {
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}
