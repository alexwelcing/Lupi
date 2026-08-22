import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { getLupiWebBaseUrl } from "@/src/config/lupi";
import { moleculeRouteParams } from "@/src/domain/molecules";
import { colors } from "@/src/theme/colors";
import { layout, radii, spacing, typeScale } from "@/src/theme/tokens";

import {
  CURATED_GALLERY,
  GALLERY_FILTERS,
  galleryFilterCount,
  galleryFilterLabel,
  galleryThumbnailUrl,
  selectGalleryPresentation,
  type CuratedGalleryItem,
  type GalleryFilter,
} from "./gallery-catalog";
import { GalleryCard } from "./gallery-card";

export function GalleryScreen({
  onClearQuery,
  onQueryChange,
  query,
}: {
  onClearQuery: () => void;
  onQueryChange: (query: string) => void;
  query: string;
}) {
  const router = useRouter();
  const { fontScale, width } = useWindowDimensions();
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const largeText = fontScale >= 1.2;
  const columns = largeText ? 1 : width >= 720 ? 3 : width >= 360 ? 2 : 1;
  const featuredCardWidth = Math.min(Math.max(width - 44, 280), 338);
  const presentation = useMemo(
    () => selectGalleryPresentation(CURATED_GALLERY, query, filter),
    [filter, query],
  );
  const baseUrl = useMemo(() => getLupiWebBaseUrl(), []);
  const hasRefinement = query.trim().length > 0 || filter !== "all";
  const collectionTitle = query.trim()
    ? "Search results"
    : filter !== "all"
      ? galleryFilterLabel(filter)
      : presentation.featured.length
        ? "More to explore"
        : "Explore the collection";

  const openMolecule = (item: CuratedGalleryItem) => {
    router.navigate({ pathname: "/viewer", params: moleculeRouteParams(item) });
  };

  const selectFilter = (next: GalleryFilter) => {
    if (process.env.EXPO_OS === "ios") {
      void Haptics.selectionAsync().catch(() => undefined);
    }
    setFilter(next);
  };

  const chooseFilter = () => {
    const labels = GALLERY_FILTERS.map((option) => {
      const selected = option.id === filter ? "✓ " : "";
      return `${selected}${option.label} (${galleryFilterCount(option.id)})`;
    });

    if (process.env.EXPO_OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          cancelButtonIndex: labels.length,
          message: "Choose the structures you want to browse.",
          options: [...labels, "Cancel"],
          title: "Filter Gallery",
          userInterfaceStyle: "dark",
        },
        (selectedIndex) => {
          const selected = GALLERY_FILTERS[selectedIndex];
          if (selected) selectFilter(selected.id);
        },
      );
      return;
    }

    Alert.alert("Filter Gallery", "Choose the structures you want to browse.", [
      ...GALLERY_FILTERS.map((option) => ({
        onPress: () => selectFilter(option.id),
        text: `${option.id === filter ? "✓ " : ""}${option.label} (${galleryFilterCount(option.id)})`,
      })),
      { style: "cancel", text: "Cancel" },
    ]);
  };

  const clearSearchAndFilters = () => {
    onClearQuery();
    selectFilter("all");
  };

  return (
    <FlatList
      key={`gallery-${columns}`}
      accessibilityLabel="Lupi molecular gallery"
      columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
      contentContainerStyle={{
        flexGrow: presentation.resultCount ? undefined : 1,
        gap: spacing.sm,
        paddingBottom: layout.contentBottom,
        paddingHorizontal: layout.screenPadding,
        paddingTop: process.env.EXPO_OS === "web" ? spacing.xl : spacing.xs,
      }}
      contentInsetAdjustmentBehavior="automatic"
      data={presentation.catalog}
      initialNumToRender={8}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        presentation.resultCount === 0 ? (
          <GalleryEmptyState onReset={clearSearchAndFilters} query={query} />
        ) : null
      }
      ListHeaderComponent={
        <View style={{ gap: spacing.lg, paddingBottom: spacing.xxs }}>
          {process.env.EXPO_OS === "web" ? (
            <View style={{ gap: spacing.xxs, maxWidth: layout.readableWidth }}>
              <Text
                accessibilityRole="header"
                selectable
                style={{
                  color: colors.text,
                  fontSize: typeScale.title1,
                  fontWeight: "800",
                  letterSpacing: -0.5,
                }}
              >
                Gallery
              </Text>
              <Text
                selectable
                style={{
                  color: colors.textMuted,
                  fontSize: typeScale.body,
                  lineHeight: 22,
                }}
              >
                Interactive molecules, materials, and trajectories selected for
                iPhone.
              </Text>
            </View>
          ) : null}

          {process.env.EXPO_OS === "web" ? (
            <TextInput
              accessibilityLabel="Search gallery"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={onQueryChange}
              placeholder="Search molecules, materials, and trajectories"
              placeholderTextColor="#6F8994"
              returnKeyType="search"
              selectionColor={colors.accent}
              style={{
                backgroundColor: colors.backgroundElevated,
                borderColor: colors.border,
                borderCurve: "continuous",
                borderRadius: radii.card,
                borderWidth: 1,
                color: colors.text,
                fontSize: 16,
                minHeight: 48,
                paddingHorizontal: 15,
              }}
              value={query}
            />
          ) : null}

          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              flexWrap: "wrap",
              gap: spacing.xs,
              justifyContent: "space-between",
              minHeight: layout.minimumTarget,
            }}
          >
            <Text
              accessibilityLiveRegion="polite"
              selectable
              style={{
                color: colors.textMuted,
                fontSize: typeScale.footnote,
                fontVariant: ["tabular-nums"],
              }}
            >
              {presentation.resultCount}{" "}
              {presentation.resultCount === 1 ? "structure" : "structures"}
            </Text>

            <View
              style={{
                alignItems: "center",
                flexDirection: "row",
                flexWrap: "wrap",
                gap: spacing.xs,
              }}
            >
              {hasRefinement ? (
                <Pressable
                  accessibilityLabel="Clear gallery search and filters"
                  accessibilityRole="button"
                  onPress={clearSearchAndFilters}
                  style={({ pressed }) => ({
                    justifyContent: "center",
                    minHeight: layout.minimumTarget,
                    opacity: pressed ? 0.62 : 1,
                    paddingHorizontal: 6,
                  })}
                >
                  <Text
                    style={{
                      color: colors.accent,
                      fontSize: 14,
                      fontWeight: "700",
                    }}
                  >
                    Reset
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                accessibilityHint="Shows gallery categories in a native action sheet"
                accessibilityLabel="Filter gallery"
                accessibilityRole="button"
                accessibilityState={{ selected: filter !== "all" }}
                accessibilityValue={{ text: galleryFilterLabel(filter) }}
                onPress={chooseFilter}
                style={({ pressed }) => ({
                  alignItems: "center",
                  backgroundColor: pressed
                    ? colors.cardPressed
                    : colors.backgroundElevated,
                  borderCurve: "continuous",
                  borderRadius: radii.round,
                  flexDirection: "row",
                  gap: 7,
                  justifyContent: "center",
                  minHeight: layout.minimumTarget,
                  paddingHorizontal: 14,
                })}
              >
                <SymbolView
                  accessibilityElementsHidden
                  name="line.3.horizontal.decrease"
                  size={14}
                  tintColor={
                    filter === "all" ? colors.textMuted : colors.accent
                  }
                />
                <Text
                  style={{
                    color: filter === "all" ? colors.text : colors.accent,
                    fontSize: 14,
                    fontWeight: "700",
                  }}
                >
                  {filter === "all" ? "Filter" : galleryFilterLabel(filter)}
                </Text>
              </Pressable>
            </View>
          </View>

          {presentation.featured.length ? (
            <View style={{ gap: spacing.sm }}>
              <GallerySectionHeading
                detail="Distinct starting points across chemistry, materials, and motion."
                title="Featured"
              />
              <ScrollView
                accessibilityLabel="Featured structures"
                contentContainerStyle={{
                  gap: spacing.sm,
                  paddingRight: layout.screenPadding,
                }}
                decelerationRate="fast"
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToAlignment="start"
                snapToInterval={featuredCardWidth + spacing.sm}
              >
                {presentation.featured.map((item) => (
                  <View key={item.id} style={{ width: featuredCardWidth }}>
                    <GalleryCard
                      featured
                      imageUrl={galleryThumbnailUrl(item, baseUrl)}
                      item={item}
                      largeText={largeText}
                      onPress={() => openMolecule(item)}
                      singleColumn
                    />
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {presentation.catalog.length ? (
            <GallerySectionHeading
              detail={
                presentation.featured.length
                  ? `${presentation.catalog.length} more structures to discover.`
                  : undefined
              }
              title={collectionTitle}
            />
          ) : null}
        </View>
      }
      maxToRenderPerBatch={8}
      numColumns={columns}
      renderItem={({ item }) => (
        <View
          style={{
            flex: 1,
            maxWidth: columns === 3 ? "33%" : columns === 2 ? "50%" : "100%",
          }}
        >
          <GalleryCard
            imageUrl={galleryThumbnailUrl(item, baseUrl)}
            item={item}
            largeText={largeText}
            onPress={() => openMolecule(item)}
            singleColumn={columns === 1}
          />
        </View>
      )}
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: colors.background }}
      testID="gallery-screen"
      windowSize={5}
    />
  );
}

function GallerySectionHeading({
  detail,
  title,
}: {
  detail?: string;
  title: string;
}) {
  return (
    <View style={{ gap: spacing.xxs }}>
      <Text
        accessibilityRole="header"
        selectable
        style={{
          color: colors.text,
          fontSize: typeScale.title3,
          fontWeight: "800",
        }}
      >
        {title}
      </Text>
      {detail ? (
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
      ) : null}
    </View>
  );
}

function GalleryEmptyState({
  onReset,
  query,
}: {
  onReset: () => void;
  query: string;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        alignItems: "center",
        flex: 1,
        gap: spacing.sm,
        justifyContent: "center",
        padding: spacing.xxl,
      }}
    >
      <Text
        accessibilityRole="header"
        selectable
        style={{
          color: colors.text,
          fontSize: typeScale.title2,
          fontWeight: "800",
          textAlign: "center",
        }}
      >
        No structures found
      </Text>
      <Text
        selectable
        style={{
          color: colors.textMuted,
          fontSize: typeScale.body,
          lineHeight: 22,
          textAlign: "center",
        }}
      >
        {query.trim()
          ? `Nothing in the gallery matches “${query.trim()}”.`
          : "Nothing matches the selected category."}
      </Text>
      <Pressable
        accessibilityLabel="Show all gallery structures"
        accessibilityRole="button"
        onPress={onReset}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: pressed ? colors.accentStrong : colors.accent,
          borderCurve: "continuous",
          borderRadius: radii.control,
          justifyContent: "center",
          minHeight: layout.minimumTarget,
          paddingHorizontal: 18,
        })}
      >
        <Text
          style={{ color: colors.background, fontSize: 15, fontWeight: "900" }}
        >
          Show All Structures
        </Text>
      </Pressable>
    </View>
  );
}
