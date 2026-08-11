import Constants from "expo-constants";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
  type AppStateStatus,
} from "react-native";

import { getLupiEmbeddedViewerUrl, getLupiWebBaseUrl } from "@/src/config/lupi";
import type {
  MoleculeLoadInput,
  MoleculeSummary,
} from "@/src/domain/molecules";
import {
  isVisualQaViewerReady,
  type VisualQaViewerContract,
} from "@/src/features/visual-qa/visual-qa-scenarios";
import { NATIVE_AR_MAX_ATOMS } from "@/src/features/ar/ar-scene";
import { createArSession } from "@/src/features/ar/ar-session-store";
import { canEnterNativeArRoute } from "@/src/features/ar/ar-build-policy";
import { recordRecentMolecule } from "@/src/storage/recent-molecules";
import { colors } from "@/src/theme/colors";

import {
  VIEWER_AR_EXPORT_TIMEOUT_MS,
  VIEWER_AR_EXPORT_TOOL,
  consumeViewerArExportResponse,
  type PendingViewerArExport,
} from "./viewer-ar-handoff";
import {
  makeViewerRequest,
  type ViewerBridgeStatus,
  type ViewerSurfaceMessage,
} from "./viewer-bridge";
import {
  checkViewerCompatibility,
  GALLERY_VIEWER_TOOL,
} from "./viewer-compatibility";
import { ViewerControlBar } from "./viewer-control-bar";
import { shouldProbeViewerOnAppStateChange } from "./viewer-recovery";
import { classifyViewerRuntimeError } from "./viewer-runtime";
import {
  confirmedMoleculeLoadedAfterStatus,
  consumeInitialViewerMessage,
  consumeInitialViewerTimeout,
  executionKeyAfterStatus,
  INITIAL_VIEWER_COMMAND_TIMEOUT_MS,
  initialViewerCommand,
  isResponseForTimedOutInitialRequest,
  persistLoadedMoleculeSummary,
  shouldAttemptHistoryPersistence,
  shouldExecuteInitialMolecule,
  type PendingInitialViewerRequest,
} from "./viewer-session";
import { normalizeTrustedShareUrl } from "./viewer-share";
import { ViewerSurface, type ViewerSurfaceHandle } from "./viewer-surface";

const DEFAULT_MOLECULE: MoleculeLoadInput = {
  inputType: "template",
  input: "Caffeine",
};

interface PendingVisualQaCommand {
  commandIndex: number;
  id: string;
}

interface ViewerScreenProps {
  displayName?: string;
  initialMolecule?: MoleculeLoadInput;
  initialSummary?: MoleculeSummary;
  visualQa?: VisualQaViewerContract;
}

interface ViewerScreenSessionProps extends ViewerScreenProps {
  molecule: MoleculeLoadInput;
  moleculeKey: string;
  sourceUrl: string;
}

export function ViewerScreen(props: ViewerScreenProps) {
  const molecule = props.initialMolecule ?? DEFAULT_MOLECULE;
  const moleculeKey = useMemo(() => moleculeIdentity(molecule), [molecule]);
  const sourceUrl = useMemo(() => getLupiEmbeddedViewerUrl(), []);
  const sessionKey = JSON.stringify([
    sourceUrl,
    moleculeKey,
    props.visualQa !== undefined,
    props.visualQa?.scenarioId ?? null,
  ]);

  return (
    <ViewerScreenSession
      key={sessionKey}
      {...props}
      molecule={molecule}
      moleculeKey={moleculeKey}
      sourceUrl={sourceUrl}
    />
  );
}

function ViewerScreenSession({
  displayName,
  initialSummary,
  molecule,
  moleculeKey,
  sourceUrl,
  visualQa,
}: ViewerScreenSessionProps) {
  const historySummary =
    initialSummary && sameMoleculeLoad(initialSummary.load, molecule)
      ? initialSummary
      : undefined;
  const visualQaEnabled = visualQa !== undefined;
  const surfaceRef = useRef<ViewerSurfaceHandle>(null);
  const initialExecutionKey = useRef<string | null>(null);
  const pendingInitialRequest = useRef<PendingInitialViewerRequest | null>(
    null,
  );
  const initialRequestTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const timedOutInitialRequestId = useRef<string | null>(null);
  const historyAttemptedKey = useRef<string | null>(null);
  const pendingHistoryWriteKey = useRef<string | null>(null);
  const pendingShareId = useRef<string | null>(null);
  const shareTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArExport = useRef<PendingViewerArExport | null>(null);
  const arExportTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bridgeVersion = useRef<string | undefined>(undefined);
  const pendingResumeProbeId = useRef<string | null>(null);
  const resumeProbeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVisualQaCommand = useRef<PendingVisualQaCommand | null>(null);
  const previousAppState = useRef<AppStateStatus>(AppState.currentState);
  const automaticRuntimeRecoveryAttempts = useRef(0);
  const [bridgeReadyMoleculeKey, setBridgeReadyMoleculeKey] = useState<
    string | null
  >(null);
  const [moleculeLoaded, setMoleculeLoaded] = useState(false);
  const [atomCount, setAtomCount] = useState<number | undefined>();
  const [lastError, setLastError] = useState<string | null>(null);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [arAvailable, setArAvailable] = useState(false);
  const [arPreparing, setArPreparing] = useState(false);
  const [visualQaCommandsComplete, setVisualQaCommandsComplete] =
    useState(!visualQaEnabled);
  const bridgeReady = bridgeReadyMoleculeKey === moleculeKey;
  const clearInitialRequestTimeout = useCallback(() => {
    if (initialRequestTimeout.current)
      clearTimeout(initialRequestTimeout.current);
    initialRequestTimeout.current = null;
  }, []);

  useEffect(
    () => () => {
      clearInitialRequestTimeout();
      pendingHistoryWriteKey.current = null;
      if (shareTimeout.current) clearTimeout(shareTimeout.current);
      if (resumeProbeTimeout.current) clearTimeout(resumeProbeTimeout.current);
      if (arExportTimeout.current) clearTimeout(arExportTimeout.current);
      pendingVisualQaCommand.current = null;
    },
    [clearInitialRequestTimeout],
  );

  useEffect(() => {
    if (
      !shouldExecuteInitialMolecule({
        bridgeReady,
        executionKey: initialExecutionKey.current,
        hasSavedView: false,
        moleculeKey,
      })
    )
      return;
    clearInitialRequestTimeout();
    setAtomCount(undefined);
    timedOutInitialRequestId.current = null;
    initialExecutionKey.current = moleculeKey;
    const command = initialViewerCommand(molecule);
    const request = makeViewerRequest(command.tool, command.arguments);
    pendingInitialRequest.current = {
      id: request.id,
      moleculeKey,
      ...(historySummary ? { summary: historySummary } : {}),
      tool: command.tool,
    };
    surfaceRef.current?.execute(request);
    initialRequestTimeout.current = setTimeout(() => {
      const timeoutResolution = consumeInitialViewerTimeout(
        pendingInitialRequest.current,
        request.id,
        moleculeKey,
      );
      pendingInitialRequest.current = timeoutResolution.pending;
      initialRequestTimeout.current = null;
      if (!timeoutResolution.timedOut) return;
      timedOutInitialRequestId.current = request.id;
      setMoleculeLoaded(false);
      setLastError(
        "This structure took too long to open. Try loading it again.",
      );
    }, INITIAL_VIEWER_COMMAND_TIMEOUT_MS);
  }, [
    bridgeReady,
    clearInitialRequestTimeout,
    historySummary,
    molecule,
    moleculeKey,
  ]);

  const applyBridgeStatus = (status: ViewerBridgeStatus) => {
    initialExecutionKey.current = executionKeyAfterStatus(
      initialExecutionKey.current,
      status,
    );
    setMoleculeLoaded((currentlyConfirmed) =>
      confirmedMoleculeLoadedAfterStatus(currentlyConfirmed, status),
    );
    if (!status.ready) {
      clearInitialRequestTimeout();
      pendingInitialRequest.current = null;
      pendingVisualQaCommand.current = null;
      setVisualQaCommandsComplete(!visualQaEnabled);
      pendingShareId.current = null;
      if (shareTimeout.current) clearTimeout(shareTimeout.current);
      shareTimeout.current = null;
      pendingArExport.current = null;
      if (arExportTimeout.current) clearTimeout(arExportTimeout.current);
      arExportTimeout.current = null;
      setArPreparing(false);
      setArAvailable(false);
      setAtomCount(undefined);
      setBridgeReadyMoleculeKey(null);
      return;
    }

    const compatibility = checkViewerCompatibility(
      status,
      molecule.inputType === "gallery" ? [GALLERY_VIEWER_TOOL] : [],
    );
    if (!compatibility.compatible) {
      clearInitialRequestTimeout();
      initialExecutionKey.current = null;
      pendingInitialRequest.current = null;
      pendingVisualQaCommand.current = null;
      setVisualQaCommandsComplete(!visualQaEnabled);
      setBridgeReadyMoleculeKey(null);
      setMoleculeLoaded(false);
      setAtomCount(undefined);
      setLastError(
        compatibility.message ??
          "The remote viewer is incompatible with this app build.",
      );
      return;
    }

    setBridgeReadyMoleculeKey(moleculeKey);
    bridgeVersion.current = status.version;
    setArAvailable(status.toolNames?.includes(VIEWER_AR_EXPORT_TOOL) === true);
    if (typeof status.atomCount === "number") setAtomCount(status.atomCount);
  };

  const reloadViewer = (notice = "Preparing a fresh 3D view…") => {
    clearInitialRequestTimeout();
    setLastError(null);
    setRecoveryNotice(notice);
    setBridgeReadyMoleculeKey(null);
    setMoleculeLoaded(false);
    setAtomCount(undefined);
    initialExecutionKey.current = null;
    pendingInitialRequest.current = null;
    timedOutInitialRequestId.current = null;
    pendingShareId.current = null;
    if (shareTimeout.current) clearTimeout(shareTimeout.current);
    shareTimeout.current = null;
    pendingArExport.current = null;
    if (arExportTimeout.current) clearTimeout(arExportTimeout.current);
    arExportTimeout.current = null;
    setArPreparing(false);
    setArAvailable(false);
    pendingResumeProbeId.current = null;
    if (resumeProbeTimeout.current) clearTimeout(resumeProbeTimeout.current);
    resumeProbeTimeout.current = null;
    pendingVisualQaCommand.current = null;
    setVisualQaCommandsComplete(!visualQaEnabled);
    surfaceRef.current?.reload();
  };

  const runVisualQaSettlingCommand = (commandIndex: number) => {
    const command = visualQa?.settlingCommands[commandIndex];
    if (!visualQa || !command) {
      pendingVisualQaCommand.current = null;
      setVisualQaCommandsComplete(true);
      return;
    }

    const request = makeViewerRequest(command.tool, command.arguments);
    pendingVisualQaCommand.current = { commandIndex, id: request.id };
    surfaceRef.current?.execute(request);
  };

  const handleMessage = (message: ViewerSurfaceMessage) => {
    if (
      message.type === "response" &&
      isResponseForTimedOutInitialRequest(
        message.response,
        timedOutInitialRequestId.current,
      )
    )
      return;
    if (
      message.type === "response" &&
      message.response.id === pendingVisualQaCommand.current?.id
    ) {
      const completedCommand = pendingVisualQaCommand.current;
      pendingVisualQaCommand.current = null;
      if (!completedCommand) return;
      if (!message.response.ok) {
        setVisualQaCommandsComplete(false);
        setLastError(
          message.response.error?.message ||
            "The visual QA viewer could not reach its deterministic state.",
        );
        return;
      }
      runVisualQaSettlingCommand(completedCommand.commandIndex + 1);
      return;
    }
    const pendingBeforeMessage = pendingInitialRequest.current;
    const pendingInitialRequestId = pendingBeforeMessage?.id;
    const initialResolution = consumeInitialViewerMessage(
      pendingInitialRequest.current,
      message,
      moleculeKey,
    );
    pendingInitialRequest.current = initialResolution.pending;
    if (pendingBeforeMessage && initialResolution.pending === null) {
      clearInitialRequestTimeout();
    }
    if (initialResolution.matched) {
      if (!initialResolution.succeeded) {
        setMoleculeLoaded(false);
        setVisualQaCommandsComplete(!visualQaEnabled);
        setLastError(
          initialResolution.errorMessage ??
            "The viewer could not load this structure.",
        );
        return;
      }

      setLastError(null);
      setRecoveryNotice(null);
      setMoleculeLoaded(true);
      const summary = initialResolution.summary;
      if (
        shouldAttemptHistoryPersistence(
          historyAttemptedKey.current,
          moleculeKey,
          summary,
        )
      ) {
        historyAttemptedKey.current = moleculeKey;
        const historyWriteKey = `${moleculeKey}:${pendingInitialRequestId}`;
        pendingHistoryWriteKey.current = historyWriteKey;
        setHistoryWarning(null);
        void persistLoadedMoleculeSummary(summary, recordRecentMolecule).then(
          (warning) => {
            if (pendingHistoryWriteKey.current !== historyWriteKey) return;
            pendingHistoryWriteKey.current = null;
            if (warning) setHistoryWarning(warning);
          },
        );
      }
      if (visualQa) {
        setVisualQaCommandsComplete(false);
        runVisualQaSettlingCommand(0);
      } else {
        setTimeout(
          () =>
            surfaceRef.current?.execute(makeViewerRequest("lupi.fit_camera")),
          120,
        );
      }
      return;
    }
    if (message.type === "status") {
      applyBridgeStatus(message.status);
      return;
    }
    if (message.type === "probe") {
      if (message.id !== pendingResumeProbeId.current) return;
      pendingResumeProbeId.current = null;
      if (resumeProbeTimeout.current) clearTimeout(resumeProbeTimeout.current);
      resumeProbeTimeout.current = null;
      applyBridgeStatus(message.status);
      if (!message.status.ready) {
        setLastError(
          "The viewer stopped while Lupi was in the background. Reloading now.",
        );
        surfaceRef.current?.reload();
      }
      return;
    }
    if (message.type === "error") {
      if (message.source === "web-runtime") {
        const disposition = classifyViewerRuntimeError(
          message.message,
          automaticRuntimeRecoveryAttempts.current,
        );
        if (disposition.autoReload) {
          automaticRuntimeRecoveryAttempts.current += 1;
          reloadViewer(disposition.userMessage);
          return;
        }
        if (disposition.userMessage !== disposition.diagnosticMessage) {
          setMoleculeLoaded(false);
        }
        setLastError(disposition.userMessage);
        return;
      }
      setLastError(message.message);
      return;
    }
    const pendingArBeforeMessage = pendingArExport.current;
    const arResolution = consumeViewerArExportResponse(
      pendingArBeforeMessage,
      message.response,
      moleculeKey,
    );
    pendingArExport.current = arResolution.pending;
    if (pendingArBeforeMessage && arResolution.pending === null) {
      if (arExportTimeout.current) clearTimeout(arExportTimeout.current);
      arExportTimeout.current = null;
      setArPreparing(false);
    }
    if (arResolution.matched) {
      if (!arResolution.scene) {
        setLastError(
          arResolution.errorMessage ??
            "Lupi could not prepare this molecule for native AR.",
        );
        return;
      }
      setLastError(null);
      const session = createArSession(arResolution.scene);
      router.navigate({ pathname: "/ar", params: { session } });
      return;
    }
    if (pendingArBeforeMessage && arResolution.pending === null) return;
    if (message.response.id === pendingShareId.current) {
      pendingShareId.current = null;
      if (shareTimeout.current) clearTimeout(shareTimeout.current);
      shareTimeout.current = null;
      const encodedUrl = normalizeTrustedShareUrl(
        message.response.result?.url,
        getLupiWebBaseUrl(),
      );
      if (message.response.ok && encodedUrl) {
        setLastError(null);
        void shareUrl(encodedUrl);
      } else {
        setLastError(
          message.response.error?.message ||
            "Lupi could not encode this view for sharing.",
        );
      }
      return;
    }
    if (!message.response.ok) {
      setLastError(
        message.response.error?.message || "The viewer command failed.",
      );
      return;
    }
    setLastError(null);
  };

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previous = previousAppState.current;
      previousAppState.current = nextState;
      if (!shouldProbeViewerOnAppStateChange(previous, nextState)) return;

      const id = `resume-${Date.now()}`;
      pendingResumeProbeId.current = id;
      surfaceRef.current?.probe(id);
      if (resumeProbeTimeout.current) clearTimeout(resumeProbeTimeout.current);
      resumeProbeTimeout.current = setTimeout(() => {
        if (pendingResumeProbeId.current !== id) return;
        pendingResumeProbeId.current = null;
        setLastError("The viewer did not respond after resume. Reloading now.");
        surfaceRef.current?.reload();
      }, 2_500);
    });
    return () => subscription.remove();
  }, []);

  const execute = (tool: string, args: Record<string, unknown> = {}) => {
    setLastError(null);
    surfaceRef.current?.execute(makeViewerRequest(tool, args));
  };

  const share = () => {
    if (!bridgeReady || !moleculeLoaded) {
      setLastError(
        "Wait for the molecule to finish loading before sharing this view.",
      );
      return;
    }
    const request = makeViewerRequest("lupi.encode_view_url");
    pendingShareId.current = request.id;
    surfaceRef.current?.execute(request);
    if (shareTimeout.current) clearTimeout(shareTimeout.current);
    shareTimeout.current = setTimeout(() => {
      pendingShareId.current = null;
      setLastError("Timed out while encoding the current molecular view.");
    }, 5_000);
  };

  const openAr = () => {
    if (!bridgeReady || !moleculeLoaded) {
      setLastError(
        "Wait for the molecule to finish loading before opening room view.",
      );
      return;
    }
    if (!canEnterNativeArRoute(Constants.executionEnvironment)) {
      setLastError(
        "Native room view needs the Lupi development build. Expo Go cannot load the ARKit renderer.",
      );
      return;
    }
    if (!arAvailable) {
      setLastError(
        "This viewer version cannot prepare native AR yet. Reload after the Lupi viewer is updated.",
      );
      return;
    }
    const expectedAtomCount = atomCount ?? molecule.atomCount;
    if (
      expectedAtomCount !== undefined &&
      expectedAtomCount > NATIVE_AR_MAX_ATOMS
    ) {
      setLastError(
        `Native room view currently supports up to ${NATIVE_AR_MAX_ATOMS.toLocaleString()} atoms; this structure has ${expectedAtomCount.toLocaleString()}.`,
      );
      return;
    }

    const request = makeViewerRequest(VIEWER_AR_EXPORT_TOOL);
    pendingArExport.current = {
      id: request.id,
      metadata: {
        ...(bridgeVersion.current
          ? { bridgeVersion: bridgeVersion.current }
          : {}),
        ...(expectedAtomCount !== undefined ? { expectedAtomCount } : {}),
        ...(historySummary?.formula ? { formula: historySummary.formula } : {}),
        ...(historySummary?.id ? { id: historySummary.id } : {}),
        moleculeKey,
        name: productViewerName(displayName, molecule),
      },
      moleculeKey,
    };
    setLastError(null);
    setArPreparing(true);
    surfaceRef.current?.execute(request);
    if (arExportTimeout.current) clearTimeout(arExportTimeout.current);
    arExportTimeout.current = setTimeout(() => {
      if (pendingArExport.current?.id !== request.id) return;
      pendingArExport.current = null;
      arExportTimeout.current = null;
      setArPreparing(false);
      setLastError("Timed out while preparing this molecule for native AR.");
    }, VIEWER_AR_EXPORT_TIMEOUT_MS);
  };

  const shareUrl = async (url: string) => {
    try {
      await Share.share({
        message: `Explore this molecular view in Lupi: ${url}`,
        url,
      });
    } catch {
      setLastError("The iOS share sheet could not open. Please try again.");
    }
  };

  const viewerName = productViewerName(displayName, molecule);
  const displayedAtomCount = moleculeLoaded
    ? (atomCount ?? molecule.atomCount)
    : molecule.atomCount;
  const moleculeDetail =
    historySummary?.formula.trim() || moleculeKindLabel(molecule);
  const statusText = moleculeLoaded
    ? "Ready to explore"
    : bridgeReady
      ? "Opening structure"
      : "Preparing 3D view";
  const showBlockingState = Platform.OS !== "web" && !moleculeLoaded;
  const visualQaReady = visualQa
    ? isVisualQaViewerReady({
        atomCount,
        bridgeReady,
        commandsComplete: visualQaCommandsComplete,
        expectedAtomCount: visualQa.expectedAtomCount,
        hasError: Boolean(lastError),
        moleculeLoaded,
      })
    : false;
  return (
    <View
      testID="viewer-screen"
      style={{ backgroundColor: colors.background, flex: 1 }}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: 12,
          justifyContent: "space-between",
          minHeight: 48,
          paddingHorizontal: 14,
          paddingVertical: 4,
        }}
        testID="viewer-title"
      >
        <View
          style={{
            alignItems: "center",
            flex: 1,
            flexDirection: "row",
            gap: 7,
            minWidth: 0,
          }}
        >
          <View
            accessibilityElementsHidden
            style={{
              backgroundColor: moleculeLoaded ? colors.success : colors.warning,
              borderRadius: 4,
              height: 7,
              width: 7,
            }}
          />
          <Text
            accessibilityLiveRegion="polite"
            numberOfLines={1}
            selectable
            style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}
            testID="viewer-status"
          >
            {statusText}
          </Text>
          <Text
            numberOfLines={1}
            selectable
            style={{
              color: colors.textMuted,
              flex: 1,
              fontSize: 12,
              lineHeight: 17,
            }}
          >
            · {moleculeDetail}
          </Text>
        </View>
        <View
          accessibilityLabel={
            displayedAtomCount
              ? `${displayedAtomCount.toLocaleString()} atoms`
              : statusText
          }
          style={{
            alignItems: "flex-end",
            gap: 1,
            justifyContent: "center",
            minHeight: 44,
            minWidth: 62,
          }}
          testID="viewer-atom-count"
        >
          <Text
            numberOfLines={1}
            style={{
              color: moleculeLoaded ? colors.success : colors.textMuted,
              fontSize: 13,
              fontVariant: ["tabular-nums"],
              fontWeight: "700",
            }}
          >
            {displayedAtomCount
              ? displayedAtomCount.toLocaleString()
              : moleculeLoaded
                ? "Ready"
                : "Loading"}
          </Text>
          {displayedAtomCount ? (
            <Text
              style={{ color: colors.textMuted, fontSize: 9, lineHeight: 11 }}
            >
              atoms
            </Text>
          ) : null}
        </View>
      </View>

      {lastError && !showBlockingState ? (
        <ViewerNoticeBanner
          icon="exclamationmark.circle.fill"
          message={lastError}
          tone="danger"
          testID="viewer-error-banner"
        />
      ) : null}

      {historyWarning ? (
        <ViewerNoticeBanner
          icon="exclamationmark.triangle.fill"
          message={historyWarning}
          tone="warning"
        />
      ) : null}

      <View style={{ flex: 1, position: "relative" }}>
        <View
          accessibilityElementsHidden={showBlockingState}
          importantForAccessibility={
            showBlockingState ? "no-hide-descendants" : "auto"
          }
          style={{ flex: 1 }}
          testID="viewer-surface"
        >
          <ViewerSurface
            key={`${sourceUrl}:${moleculeKey}`}
            ref={surfaceRef}
            onMessage={handleMessage}
            sourceUrl={sourceUrl}
          />
        </View>
        {showBlockingState ? (
          <ViewerStateOverlay
            error={lastError}
            moleculeName={viewerName}
            notice={recoveryNotice}
            onRetry={() => reloadViewer()}
          />
        ) : null}
      </View>

      <ViewerControlBar
        arEnabled={bridgeReady && moleculeLoaded && arAvailable}
        arPreparing={arPreparing}
        enabled={bridgeReady && moleculeLoaded}
        onCommand={execute}
        onOpenAr={openAr}
        onReload={() => reloadViewer()}
        onShare={share}
      />
      {visualQa && visualQaReady ? (
        <View
          accessibilityLabel={`Visual QA ready: ${visualQa.scenarioId}`}
          accessible
          collapsable={false}
          importantForAccessibility="yes"
          pointerEvents="none"
          style={{ height: 2, left: 0, position: "absolute", top: 0, width: 2 }}
          testID={visualQa.readyTestID}
        />
      ) : null}
    </View>
  );
}

function ViewerNoticeBanner({
  icon,
  message,
  testID,
  tone,
}: {
  icon: SFSymbol;
  message: string;
  testID?: string;
  tone: "danger" | "warning";
}) {
  const danger = tone === "danger";
  return (
    <View
      style={{
        alignItems: "flex-start",
        backgroundColor: danger
          ? "rgba(255,141,156,0.12)"
          : "rgba(244,204,115,0.12)",
        flexDirection: "row",
        gap: 9,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
      testID={testID}
    >
      <SymbolView
        accessibilityElementsHidden
        name={icon}
        size={15}
        style={{ height: 18, width: 18 }}
        tintColor={danger ? colors.danger : colors.warning}
      />
      <Text
        accessibilityRole="alert"
        selectable
        style={{
          color: danger ? "#FFD3DA" : "#FFE7A8",
          flex: 1,
          fontSize: 13,
          lineHeight: 18,
        }}
      >
        {message}
      </Text>
    </View>
  );
}

function ViewerStateOverlay({
  error,
  moleculeName,
  notice,
  onRetry,
}: {
  error: string | null;
  moleculeName: string;
  notice: string | null;
  onRetry: () => void;
}) {
  return (
    <ScrollView
      accessibilityViewIsModal
      contentContainerStyle={{
        alignItems: "center",
        flexGrow: 1,
        justifyContent: "center",
        padding: 28,
      }}
      contentInsetAdjustmentBehavior="never"
      importantForAccessibility="yes"
      style={{
        backgroundColor: colors.background,
        bottom: 0,
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
      }}
      testID={error ? "viewer-error-overlay" : "viewer-loading-overlay"}
    >
      <View
        style={{ alignItems: "center", gap: 13, maxWidth: 360, width: "100%" }}
      >
        {error ? (
          <>
            <View
              style={{
                alignItems: "center",
                backgroundColor: "rgba(255,141,156,0.12)",
                borderCurve: "continuous",
                borderRadius: 18,
                height: 54,
                justifyContent: "center",
                width: 54,
              }}
            >
              <SymbolView
                name="exclamationmark.triangle.fill"
                size={25}
                tintColor={colors.danger}
              />
            </View>
            <Text
              accessibilityRole="alert"
              selectable
              style={{
                color: colors.text,
                fontSize: 22,
                fontWeight: "800",
                letterSpacing: -0.3,
                textAlign: "center",
              }}
            >
              Couldn’t open this structure
            </Text>
            <Text
              selectable
              style={{
                color: colors.textMuted,
                fontSize: 14,
                lineHeight: 20,
                textAlign: "center",
              }}
            >
              {error}
            </Text>
            <Pressable
              accessibilityHint="Reloads the secure molecular viewer and opens this structure again"
              accessibilityLabel={`Try opening ${moleculeName} again`}
              accessibilityRole="button"
              onPress={onRetry}
              style={({ pressed }) => ({
                alignItems: "center",
                backgroundColor: pressed ? colors.accentStrong : colors.accent,
                borderCurve: "continuous",
                borderRadius: 15,
                justifyContent: "center",
                minHeight: 50,
                minWidth: 144,
                paddingHorizontal: 22,
              })}
            >
              <Text
                style={{
                  color: colors.background,
                  fontSize: 15,
                  fontWeight: "700",
                }}
              >
                Try Again
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator
              accessibilityLabel="Loading molecular viewer"
              color={colors.accent}
              size="large"
            />
            <Text
              selectable
              style={{
                color: colors.text,
                fontSize: 21,
                fontWeight: "800",
                letterSpacing: -0.3,
                textAlign: "center",
              }}
            >
              Opening {moleculeName}
            </Text>
            <Text
              accessibilityLiveRegion="polite"
              selectable
              style={{
                color: colors.textMuted,
                fontSize: 14,
                lineHeight: 20,
                textAlign: "center",
              }}
            >
              {notice ?? "Preparing the interactive 3D structure…"}
            </Text>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function productViewerName(
  displayName: string | undefined,
  molecule: MoleculeLoadInput,
): string {
  const requested = displayName?.trim().slice(0, 160);
  if (requested) return requested;
  if (molecule.inputType === "xyz") return "Imported structure";
  if (molecule.inputType === "procedural") return "Generated structure";
  return molecule.input.trim().slice(0, 160) || "Molecule";
}

function moleculeKindLabel(molecule: MoleculeLoadInput): string {
  if (molecule.inputType === "gallery") return "Gallery structure";
  if (molecule.inputType === "procedural") return "Generated structure";
  if (molecule.inputType === "xyz") return "Imported XYZ structure";
  return "Molecular model";
}

function moleculeIdentity(molecule: MoleculeLoadInput): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < molecule.input.length; index += 1) {
    hash ^= molecule.input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return [
    molecule.inputType,
    molecule.input.length,
    (hash >>> 0).toString(16),
    molecule.atomCount ?? "",
    molecule.element ?? "",
    molecule.lattice ?? "",
  ].join(":");
}

function sameMoleculeLoad(
  left: MoleculeLoadInput,
  right: MoleculeLoadInput,
): boolean {
  return (
    left.inputType === right.inputType &&
    left.input === right.input &&
    left.atomCount === right.atomCount &&
    left.element === right.element &&
    left.lattice === right.lattice
  );
}
