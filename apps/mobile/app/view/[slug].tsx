import { useLocalSearchParams } from "expo-router";

import { SavedViewHandoffScreen } from "@/src/features/saved-view/saved-view-handoff-screen";

export default function SavedViewRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <SavedViewHandoffScreen slug={Array.isArray(slug) ? slug[0] : slug} />;
}
