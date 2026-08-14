import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";

import { ArEntryScreen } from "@/src/features/ar/ar-entry-screen";
import {
  readArSession,
  removeArSession,
} from "@/src/features/ar/ar-session-store";

export default function ArRoute() {
  const params = useLocalSearchParams<{ session?: string | string[] }>();
  const sessionId = firstParam(params.session);
  const scene = useMemo(() => readArSession(sessionId), [sessionId]);

  useEffect(
    () => () => {
      if (sessionId) removeArSession(sessionId);
    },
    [sessionId],
  );

  return <ArEntryScreen scene={scene} />;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
