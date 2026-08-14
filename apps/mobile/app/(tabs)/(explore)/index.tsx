import { Stack } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import type { SearchBarCommands } from "react-native-screens";

import { GalleryScreen } from "@/src/features/gallery/gallery-screen";
import { colors } from "@/src/theme/colors";

export default function ExploreRoute() {
  const [query, setQuery] = useState("");
  // react-native-screens types omit the ref's initial null even though the
  // native search bar assigns it after mount.
  const searchBarRef = useRef<SearchBarCommands>(null!);
  const clearQuery = useCallback(() => {
    searchBarRef.current?.clearText();
    setQuery("");
  }, []);
  const options = useMemo(
    () => ({
      title: "Gallery",
      ...(Platform.OS !== "web"
        ? {
            headerSearchBarOptions: {
              autoCapitalize: "none" as const,
              barTintColor: colors.card,
              hideWhenScrolling: false,
              obscureBackground: false,
              onCancelButtonPress: clearQuery,
              onChangeText: (event: { nativeEvent: { text: string } }) =>
                setQuery(event.nativeEvent.text),
              placeholder: "Search molecules and materials",
              placement: "automatic" as const,
              ref: searchBarRef,
              textColor: colors.text,
              tintColor: colors.accent,
            },
          }
        : {}),
    }),
    [clearQuery],
  );

  return (
    <>
      <Stack.Screen options={options} />
      <GalleryScreen
        onClearQuery={clearQuery}
        onQueryChange={setQuery}
        query={query}
      />
    </>
  );
}
