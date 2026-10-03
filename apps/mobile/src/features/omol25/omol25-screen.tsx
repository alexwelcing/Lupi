import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { getLupiWebBaseUrl } from "@/src/config/lupi";
import { moleculeRouteParams } from "@/src/domain/molecules";
import { colors } from "@/src/theme/colors";
import { layout, radii, spacing, typeScale } from "@/src/theme/tokens";

import {
  fetchOmol25Collections,
  fetchOmol25Page,
  Omol25RequestError,
} from "./omol25-client";
import {
  OMOL25_PAGE_SIZE,
  omol25MoleculeSummary,
  type Omol25Collection,
  type Omol25CollectionId,
  type Omol25Page,
  type Omol25Row,
} from "./omol25";

const ATTRIBUTION_URL =
  "https://huggingface.co/collections/colabfit/omol25-open-molecules-2025-colabfit";

type CatalogState =
  | { status: "loading" }
  | { status: "ready"; collections: Omol25Collection[] }
  | { status: "error"; message: string };
type PageState =
  | { status: "loading" }
  | {
      status: "ready";
      page: Omol25Page;
      query: string;
      searchMode: "text" | "formula";
    }
  | { status: "error"; message: string; warming: boolean };

export function Omol25Screen() {
  const router = useRouter();
  const origin = useMemo(() => getLupiWebBaseUrl(), []);
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [selectedId, setSelectedId] =
    useState<Omol25CollectionId>("neutral-train");
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"text" | "formula">("text");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [pageRetry, setPageRetry] = useState(0);
  const [pageState, setPageState] = useState<PageState>({ status: "loading" });
  const collections = catalog.status === "ready" ? catalog.collections : [];
  const collection = collections.find((item) => item.id === selectedId);

  useEffect(() => {
    const controller = new AbortController();
    void fetchOmol25Collections(origin, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted)
          setCatalog({ status: "ready", collections: next });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setCatalog({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Could not load OMol25 collections.",
          });
      });
    return () => controller.abort();
  }, [catalogRetry, origin]);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedQuery(query.trim()),
      query.trim() ? 400 : 0,
    );
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!collection) return;
    const controller = new AbortController();
    void fetchOmol25Page(origin, collection, {
      offset,
      query: debouncedQuery,
      searchMode,
      signal: controller.signal,
    })
      .then((page) => {
        if (!controller.signal.aborted)
          setPageState({
            status: "ready",
            page,
            query: debouncedQuery,
            searchMode,
          });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setPageState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Could not load this OMol25 page.",
            warming:
              error instanceof Omol25RequestError && error.kind === "warming",
          });
      });
    return () => controller.abort();
  }, [collection, debouncedQuery, offset, origin, pageRetry, searchMode]);

  const chooseCollection = (id: Omol25CollectionId) => {
    if (process.env.EXPO_OS === "ios")
      void Haptics.selectionAsync().catch(() => undefined);
    setPageState({ status: "loading" });
    setSelectedId(id);
    setOffset(0);
  };

  const openRow = (row: Omol25Row) => {
    if (!collection) return;
    if (process.env.EXPO_OS === "ios")
      void Haptics.selectionAsync().catch(() => undefined);
    router.push({
      pathname: "/viewer",
      params: moleculeRouteParams(omol25MoleculeSummary(collection.id, row)),
    });
  };

  const page =
    pageState.status === "ready" &&
    pageState.page.collection === selectedId &&
    pageState.page.offset === offset &&
    pageState.query === debouncedQuery &&
    pageState.searchMode === searchMode &&
    query.trim() === debouncedQuery
      ? pageState.page
      : null;
  const hasPrevious = offset > 0;
  const hasNext = Boolean(
    page &&
    collection &&
    page.rows.length === OMOL25_PAGE_SIZE &&
    offset + OMOL25_PAGE_SIZE < collection.indexedRows &&
    (page.matchedRows === null || offset + OMOL25_PAGE_SIZE < page.matchedRows),
  );

  return (
    <FlatList
      accessibilityLabel="OMol25 molecular collection"
      contentContainerStyle={{
        flexGrow: 1,
        gap: spacing.sm,
        paddingBottom: layout.contentBottom,
        paddingHorizontal: layout.screenPadding,
        paddingTop: spacing.md,
      }}
      data={page?.rows ?? []}
      keyExtractor={(row) => `${selectedId}:${row.rowIndex}`}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
          <View style={{ gap: spacing.xs }}>
            <Text
              accessibilityRole="header"
              style={{
                color: colors.text,
                fontSize: typeScale.title1,
                fontWeight: "800",
              }}
            >
              Explore OMol25
            </Text>
            <Text
              selectable
              style={{
                color: colors.textMuted,
                fontSize: typeScale.body,
                lineHeight: 22,
              }}
            >
              Browse public source coordinates, one structure at a time. OMol25
              does not provide bond topology; any bonds shown by the viewer are
              display inferences.
            </Text>
            <Pressable
              accessibilityLabel="About the ColabFit OMol25 source"
              accessibilityRole="link"
              onPress={() => void WebBrowser.openBrowserAsync(ATTRIBUTION_URL)}
              style={({ pressed }) => ({
                alignSelf: "flex-start",
                minHeight: 44,
                justifyContent: "center",
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <Text
                style={{
                  color: colors.accent,
                  fontSize: typeScale.footnote,
                  fontWeight: "700",
                }}
              >
                Source: ColabFit OMol25 · CC BY 4.0 ↗
              </Text>
            </Pressable>
          </View>

          {catalog.status === "loading" ? (
            <ActivityIndicator
              accessibilityLabel="Loading OMol25 collections"
              color={colors.accent}
            />
          ) : null}
          {catalog.status === "error" ? (
            <StateCard
              message={catalog.message}
              onRetry={() => {
                setCatalog({ status: "loading" });
                setPageState({ status: "loading" });
                setCatalogRetry((value) => value + 1);
              }}
              title="Collections unavailable"
            />
          ) : null}
          {catalog.status === "ready" ? (
            <>
              <ScrollView
                accessibilityLabel="OMol25 collections"
                contentContainerStyle={{
                  gap: spacing.xs,
                  paddingRight: spacing.md,
                }}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {collections.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityLabel={`${item.label}, ${item.coverage === "complete" ? "complete public split" : "indexed preview"}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: item.id === selectedId }}
                    onPress={() => chooseCollection(item.id)}
                    style={({ pressed }) => ({
                      backgroundColor:
                        item.id === selectedId
                          ? colors.accent
                          : pressed
                            ? colors.cardPressed
                            : colors.backgroundElevated,
                      borderColor:
                        item.id === selectedId ? colors.accent : colors.border,
                      borderCurve: "continuous",
                      borderRadius: radii.round,
                      borderWidth: 1,
                      justifyContent: "center",
                      minHeight: layout.minimumTarget,
                      paddingHorizontal: 14,
                    })}
                  >
                    <Text
                      style={{
                        color:
                          item.id === selectedId
                            ? colors.background
                            : colors.text,
                        fontSize: typeScale.footnote,
                        fontWeight: "700",
                      }}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {collection ? (
                <Text
                  selectable
                  style={{
                    color: colors.textMuted,
                    fontSize: typeScale.footnote,
                    lineHeight: 19,
                  }}
                >
                  {collection.coverage === "complete"
                    ? "Complete public split"
                    : "Indexed preview"}{" "}
                  · {collection.indexedRows.toLocaleString()} indexed rows ·{" "}
                  {collection.repository}
                </Text>
              ) : null}
              <TextInput
                accessibilityLabel="Search OMol25 rows"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                maxLength={120}
                onChangeText={(value) => {
                  setPageState({ status: "loading" });
                  setQuery(value);
                  setOffset(0);
                }}
                placeholder={
                  searchMode === "formula"
                    ? "Exact formula, for example H2O"
                    : "Search source row metadata"
                }
                placeholderTextColor={colors.textMuted}
                returnKeyType="search"
                style={{
                  backgroundColor: colors.backgroundElevated,
                  borderColor: colors.border,
                  borderCurve: "continuous",
                  borderRadius: radii.control,
                  borderWidth: 1,
                  color: colors.text,
                  fontSize: typeScale.body,
                  minHeight: 48,
                  paddingHorizontal: 14,
                }}
                value={query}
              />
              <View style={{ flexDirection: "row", gap: spacing.xs }}>
                <ModeButton
                  label="Text"
                  mode="text"
                  selected={searchMode}
                  onPress={() => {
                    setPageState({ status: "loading" });
                    setSearchMode("text");
                    setOffset(0);
                  }}
                />
                <ModeButton
                  label="Exact formula"
                  mode="formula"
                  selected={searchMode}
                  onPress={() => {
                    setPageState({ status: "loading" });
                    setSearchMode("formula");
                    setOffset(0);
                  }}
                />
              </View>
            </>
          ) : null}
          {(pageState.status === "loading" ||
            query.trim() !== debouncedQuery) &&
          collection ? (
            <ActivityIndicator
              accessibilityLabel="Loading OMol25 rows"
              color={colors.accent}
              style={{ marginTop: spacing.lg }}
            />
          ) : null}
          {pageState.status === "error" && collection ? (
            <StateCard
              message={pageState.message}
              onRetry={() => {
                setPageState({ status: "loading" });
                setPageRetry((value) => value + 1);
              }}
              title={
                pageState.warming ? "Search is warming" : "Rows unavailable"
              }
            />
          ) : null}
          {page ? (
            <Text
              accessibilityLiveRegion="polite"
              selectable
              style={{ color: colors.textMuted, fontSize: typeScale.footnote }}
            >
              {page.rows.length
                ? `Rows ${offset + 1}–${offset + page.rows.length}`
                : "No rows found"}
              {page.matchedRows !== null
                ? ` of ${page.matchedRows.toLocaleString()} matches`
                : ""}
              {page.partial ? " · partial index result" : ""}
            </Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        page && page.rows.length === 0 ? (
          <Text
            selectable
            style={{
              color: colors.textMuted,
              fontSize: typeScale.body,
              paddingVertical: spacing.xl,
              textAlign: "center",
            }}
          >
            No source rows match this search. Try another term or collection.
          </Text>
        ) : null
      }
      ListFooterComponent={
        page && page.rows.length ? (
          <View
            style={{
              flexDirection: "row",
              gap: spacing.sm,
              paddingTop: spacing.md,
            }}
          >
            <PageButton
              disabled={!hasPrevious}
              label="Previous"
              onPress={() => {
                setPageState({ status: "loading" });
                setOffset(Math.max(0, offset - OMOL25_PAGE_SIZE));
              }}
            />
            <PageButton
              disabled={!hasNext}
              label="Next"
              onPress={() => {
                setPageState({ status: "loading" });
                setOffset(offset + OMOL25_PAGE_SIZE);
              }}
            />
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <Omol25RowCard row={item} onPress={() => openRow(item)} />
      )}
      style={{ backgroundColor: colors.background }}
      testID="omol25-screen"
    />
  );
}

function Omol25RowCard({
  row,
  onPress,
}: {
  row: Omol25Row;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint="Opens source coordinates in the interactive Lupi viewer"
      accessibilityLabel={`${row.formula}, OMol25 row ${row.rowIndex}, ${row.atomCount} atoms, bonds not provided`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed
          ? colors.cardPressed
          : colors.backgroundElevated,
        borderColor: colors.border,
        borderCurve: "continuous",
        borderRadius: radii.card,
        borderWidth: 1,
        gap: spacing.xs,
        minHeight: 96,
        padding: spacing.md,
      })}
    >
      <Text
        style={{
          color: colors.text,
          fontSize: typeScale.title3,
          fontWeight: "800",
        }}
      >
        {row.formula}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: typeScale.footnote }}>
        Row {row.rowIndex.toLocaleString()} · {row.atomCount} atoms ·{" "}
        {row.elements.join(", ")}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: typeScale.metadata }}>
        Source coordinates · bonds not provided
        {row.method ? ` · ${row.method}` : ""}
      </Text>
    </Pressable>
  );
}

function ModeButton({
  label,
  mode,
  selected,
  onPress,
}: {
  label: string;
  mode: "text" | "formula";
  selected: "text" | "formula";
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: selected === mode }}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor:
          selected === mode
            ? colors.cardPressed
            : pressed
              ? colors.backgroundElevated
              : colors.background,
        borderColor: selected === mode ? colors.accent : colors.border,
        borderCurve: "continuous",
        borderRadius: radii.round,
        borderWidth: 1,
        justifyContent: "center",
        minHeight: layout.minimumTarget,
        paddingHorizontal: 14,
      })}
    >
      <Text
        style={{
          color: selected === mode ? colors.accent : colors.textMuted,
          fontSize: typeScale.footnote,
          fontWeight: "700",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function PageButton({
  disabled,
  label,
  onPress,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed
          ? colors.cardPressed
          : colors.backgroundElevated,
        borderColor: colors.border,
        borderCurve: "continuous",
        borderRadius: radii.control,
        borderWidth: 1,
        flex: 1,
        justifyContent: "center",
        minHeight: layout.minimumTarget,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <Text
        style={{
          color: colors.text,
          fontSize: typeScale.footnote,
          fontWeight: "700",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function StateCard({
  message,
  onRetry,
  title,
}: {
  message: string;
  onRetry: () => void;
  title: string;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.backgroundElevated,
        borderRadius: radii.card,
        gap: spacing.sm,
        padding: spacing.md,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text,
          fontSize: typeScale.title3,
          fontWeight: "800",
        }}
      >
        {title}
      </Text>
      <Text
        accessibilityRole="alert"
        selectable
        style={{
          color: colors.textMuted,
          fontSize: typeScale.body,
          lineHeight: 22,
        }}
      >
        {message}
      </Text>
      <Pressable
        accessibilityLabel={`Retry ${title.toLowerCase()}`}
        accessibilityRole="button"
        onPress={onRetry}
        style={{ justifyContent: "center", minHeight: layout.minimumTarget }}
      >
        <Text
          style={{
            color: colors.accent,
            fontSize: typeScale.body,
            fontWeight: "700",
          }}
        >
          Try Again
        </Text>
      </Pressable>
    </View>
  );
}
