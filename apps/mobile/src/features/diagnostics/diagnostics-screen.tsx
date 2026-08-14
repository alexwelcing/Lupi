import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Share, Text, View } from "react-native";

import { SectionHeading } from "@/src/components/section-heading";
import { getLupiWebBaseUrl } from "@/src/config/lupi";
import { colors } from "@/src/theme/colors";

import {
  diagnosticReport,
  parseRemoteHealthIdentity,
  readProjectId,
  readReleaseMetadata,
  runtimeUpdateDiagnosticRows,
  softWrapDiagnosticValue,
  type DiagnosticRow,
  type RemoteHealthIdentity,
} from "./release-identity";

type HealthState =
  | { status: "loading" }
  | { status: "ready"; identity: RemoteHealthIdentity }
  | { status: "error"; message: string };

export function DiagnosticsScreen() {
  const origin = getLupiWebBaseUrl();
  const extra = Constants.expoConfig?.extra;
  const release = readReleaseMetadata(extra);
  const projectId = Constants.easConfig?.projectId ?? readProjectId(extra);
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  const requestHealth = useCallback(
    async (signal?: AbortSignal): Promise<HealthState | null> => {
      try {
        const response = await fetch(`${origin}/health`, {
          headers: { Accept: "application/json" },
          signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const identity = parseRemoteHealthIdentity(await response.json());
        if (!identity) throw new Error("invalid health identity");
        return { status: "ready", identity };
      } catch (error) {
        if (signal?.aborted) return null;
        return {
          status: "error",
          message: error instanceof Error ? error.message : "unknown error",
        };
      }
    },
    [origin],
  );

  const refreshHealth = useCallback(async () => {
    setHealth({ status: "loading" });
    const next = await requestHealth();
    if (next) setHealth(next);
  }, [requestHealth]);

  useEffect(() => {
    const controller = new AbortController();
    void requestHealth(controller.signal).then((next) => {
      if (next && !controller.signal.aborted) setHealth(next);
    });
    return () => controller.abort();
  }, [requestHealth]);

  const rows = useMemo<DiagnosticRow[]>(() => {
    const remote = health.status === "ready" ? health.identity : undefined;
    return [
      {
        label: "Native version",
        value: `${Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "development"} (${Constants.nativeBuildVersion ?? "local"})`,
      },
      {
        label: "Bundle identifier",
        value: Constants.expoConfig?.ios?.bundleIdentifier ?? "unavailable",
      },
      { label: "Expo project", value: projectId ?? "not linked" },
      {
        label: "EAS profile",
        value: release.buildProfile ?? "local / unavailable",
      },
      { label: "EAS build", value: release.easBuildId ?? "unavailable" },
      { label: "Git commit", value: release.gitCommit ?? "unavailable" },
      ...runtimeUpdateDiagnosticRows({
        channel: Updates.channel,
        createdAt: Updates.createdAt,
        isEmbeddedLaunch: Updates.isEmbeddedLaunch,
        isEnabled: Updates.isEnabled,
        runtimeVersion: Updates.runtimeVersion,
        updateId: Updates.updateId,
      }),
      {
        label: "Execution environment",
        value: String(Constants.executionEnvironment),
      },
      { label: "Viewer origin", value: origin },
      {
        label: "Remote service",
        value: remote ? `${remote.name} ${remote.version}` : health.status,
      },
      {
        label: "Remote tools",
        value: remote?.toolCount?.toString() ?? "unavailable",
      },
      {
        label: "Remote release",
        value: remote?.releaseTag ?? remote?.releaseId ?? "unavailable",
      },
      {
        label: "Remote timestamp",
        value: remote?.releaseTimestamp ?? "unavailable",
      },
    ];
  }, [
    health,
    origin,
    projectId,
    release.buildProfile,
    release.easBuildId,
    release.gitCommit,
  ]);

  const shareDiagnostics = async () => {
    try {
      await Share.share({ message: diagnosticReport(rows) });
    } catch {
      // The selectable report stays visible if the share sheet is unavailable.
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: 28, padding: 18, paddingBottom: 52 }}
      style={{ backgroundColor: colors.background }}
    >
      <View style={{ gap: 12 }}>
        <SectionHeading
          title="Build identity"
          detail="Include this report with every TestFlight bug so native and remote releases can be distinguished."
        />
        <View
          style={{
            backgroundColor: colors.backgroundElevated,
            borderColor: colors.border,
            borderRadius: 18,
            borderWidth: 1,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {rows.map((row, index) => (
            <View
              key={row.label}
              style={{
                borderTopColor: colors.border,
                borderTopWidth: index ? 1 : 0,
                gap: 4,
                minWidth: 0,
                paddingHorizontal: 15,
                paddingVertical: 12,
              }}
            >
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 12,
                  fontWeight: "700",
                }}
              >
                {row.label}
              </Text>
              <Text
                selectable
                style={{
                  color: colors.text,
                  flexShrink: 1,
                  fontFamily: "monospace",
                  fontSize: 13,
                  lineHeight: 18,
                  minWidth: 0,
                }}
              >
                {softWrapDiagnosticValue(row.value)}
              </Text>
            </View>
          ))}
        </View>
        {health.status === "error" ? (
          <Text
            accessibilityRole="alert"
            selectable
            style={{ color: colors.warning, fontSize: 13 }}
          >
            Remote health check failed: {health.message}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Action label="Refresh remote" onPress={() => void refreshHealth()} />
          <Action
            label="Share report"
            onPress={() => void shareDiagnostics()}
          />
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <SectionHeading
          title="Privacy boundary"
          detail="What this hybrid beta sends, stores, and opens."
        />
        <PrivacyCard
          title="Remote processing"
          body={`Gallery filtering stays on device. The interactive 3D viewer is a trusted WebView from ${origin}; selected XYZ coordinates enter that page's memory for rendering. Use synthetic or non-sensitive structures in this internal beta.`}
        />
        <PrivacyCard
          title="On-device history"
          body="Recent catalog structures are stored locally with Expo SQLite and can be erased from Library. Imported XYZ contents are not added to recents or uploaded by the native picker."
        />
        <PrivacyCard
          title="Web storage and external links"
          body="The embedded viewer keeps its own sandboxed web storage. System-browser cookies are not shared. External links open only after an explicit top-level tap, and saved views require a separate Safari handoff."
        />
      </View>
    </ScrollView>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? colors.cardPressed : colors.card,
        borderColor: colors.border,
        borderRadius: 14,
        borderWidth: 1,
        justifyContent: "center",
        minHeight: 44,
        paddingHorizontal: 16,
      })}
    >
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: "800" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function PrivacyCard({ title, body }: { title: string; body: string }) {
  return (
    <View
      style={{
        backgroundColor: colors.backgroundElevated,
        borderColor: colors.border,
        borderRadius: 18,
        borderWidth: 1,
        gap: 6,
        padding: 16,
      }}
    >
      <Text
        accessibilityRole="header"
        selectable
        style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}
      >
        {title}
      </Text>
      <Text
        selectable
        style={{ color: colors.textMuted, fontSize: 14, lineHeight: 21 }}
      >
        {body}
      </Text>
    </View>
  );
}
