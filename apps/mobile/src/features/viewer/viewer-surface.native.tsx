import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { colors } from "@/src/theme/colors";

import {
  makeBridgeBootstrapScript,
  makeBridgeExecutionScript,
  makeBridgeProbeScript,
  parseViewerSurfaceMessage,
} from "./viewer-bridge";
import {
  decideViewerNavigation,
  makeViewerOriginWhitelist,
} from "./viewer-navigation";
import { contentProcessTerminationMessages } from "./viewer-recovery";
import {
  isViewerMessageFromActiveDocument,
  makeViewerDocumentUrl,
} from "./viewer-runtime";
import type {
  ViewerSurfaceHandle,
  ViewerSurfaceProps,
} from "./viewer-surface.types";

const releaseMetadata = Constants.expoConfig?.extra?.release as
  | { gitCommit?: string }
  | undefined;
const VIEWER_CLIENT_REVISION =
  releaseMetadata?.gitCommit ??
  Constants.nativeBuildVersion ??
  Constants.nativeAppVersion ??
  "development";

export const ViewerSurface = forwardRef<
  ViewerSurfaceHandle,
  ViewerSurfaceProps
>(function ViewerSurface({ sourceUrl, onMessage }, forwardedRef) {
  const webViewRef = useRef<WebView>(null);
  const recoveryAttempts = useRef(0);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeDocumentEpoch = useRef(0);
  const [reloadRevision, setReloadRevision] = useState(0);
  const trustedOrigin = useMemo(() => {
    try {
      return new URL(sourceUrl).origin;
    } catch {
      return "https://lupi.live";
    }
  }, [sourceUrl]);
  const documentUrl = useMemo(
    () =>
      makeViewerDocumentUrl(sourceUrl, VIEWER_CLIENT_REVISION, reloadRevision),
    [reloadRevision, sourceUrl],
  );
  const bootstrapScript = useMemo(
    () => makeBridgeBootstrapScript(reloadRevision),
    [reloadRevision],
  );

  const advanceDocumentEpoch = useCallback((resetProcessRecovery: boolean) => {
    if (resetProcessRecovery) recoveryAttempts.current = 0;
    const nextEpoch = activeDocumentEpoch.current + 1;
    activeDocumentEpoch.current = nextEpoch;
    setReloadRevision(nextEpoch);
  }, []);

  const reloadDocument = useCallback(() => {
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    recoveryTimer.current = null;
    advanceDocumentEpoch(true);
  }, [advanceDocumentEpoch]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      execute(request) {
        webViewRef.current?.injectJavaScript(
          makeBridgeExecutionScript(request, activeDocumentEpoch.current),
        );
      },
      probe(id) {
        webViewRef.current?.injectJavaScript(
          makeBridgeProbeScript(id, activeDocumentEpoch.current),
        );
      },
      reload() {
        reloadDocument();
      },
    }),
    [reloadDocument],
  );

  useEffect(
    () => () => {
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    },
    [],
  );

  const handleMessage = (event: WebViewMessageEvent) => {
    const message = parseViewerSurfaceMessage(event.nativeEvent.data);
    if (
      message &&
      isViewerMessageFromActiveDocument(
        message.documentEpoch,
        activeDocumentEpoch.current,
      )
    )
      onMessage(message);
  };

  const reportLoadError = (message: string) => {
    const documentEpoch = activeDocumentEpoch.current;
    onMessage({
      documentEpoch,
      type: "status",
      status: { ready: false, moleculeLoaded: false },
    });
    onMessage({
      documentEpoch,
      type: "error",
      message,
      source: "native-surface",
    });
  };

  const recoverContentProcess = () => {
    const documentEpoch = activeDocumentEpoch.current;
    for (const message of contentProcessTerminationMessages()) {
      onMessage({ ...message, documentEpoch });
    }
    if (recoveryAttempts.current >= 1) {
      onMessage({
        documentEpoch,
        type: "error",
        message:
          "The viewer could not recover automatically. Use Reload to try again.",
        source: "native-surface",
      });
      return;
    }
    recoveryAttempts.current += 1;
    recoveryTimer.current = setTimeout(() => {
      recoveryTimer.current = null;
      advanceDocumentEpoch(false);
    }, 80);
  };

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <WebView
        ref={webViewRef}
        accessibilityLabel="Interactive Lupi molecular viewer"
        allowsBackForwardNavigationGestures={false}
        allowsInlineMediaPlayback
        allowsLinkPreview={false}
        applicationNameForUserAgent={`Lupi-iPhone/${Constants.nativeAppVersion ?? "development"}`}
        bounces={false}
        cacheEnabled={!__DEV__}
        domStorageEnabled
        injectedJavaScript={bootstrapScript}
        injectedJavaScriptBeforeContentLoaded={bootstrapScript}
        javaScriptCanOpenWindowsAutomatically={false}
        javaScriptEnabled
        onContentProcessDidTerminate={recoverContentProcess}
        onError={(event) => reportLoadError(event.nativeEvent.description)}
        onHttpError={(event) =>
          reportLoadError(
            `The viewer returned HTTP ${event.nativeEvent.statusCode}.`,
          )
        }
        onLoadStart={() =>
          onMessage({
            documentEpoch: activeDocumentEpoch.current,
            type: "status",
            status: { ready: false },
          })
        }
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={(request) => {
          const decision = decideViewerNavigation({
            isTopFrame: request.isTopFrame,
            navigationType: request.navigationType,
            trustedOrigin,
            url: request.url,
          });
          if (decision === "allow") return true;
          if (decision === "open-external") {
            void WebBrowser.openBrowserAsync(request.url).catch(() => {
              onMessage({
                documentEpoch: activeDocumentEpoch.current,
                type: "error",
                message: "Lupi could not open this external link.",
                source: "native-surface",
              });
            });
          }
          return false;
        }}
        originWhitelist={makeViewerOriginWhitelist()}
        renderLoading={() => (
          <View
            style={{
              alignItems: "center",
              backgroundColor: colors.background,
              flex: 1,
              justifyContent: "center",
            }}
          >
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        )}
        setSupportMultipleWindows={false}
        sharedCookiesEnabled={false}
        source={{ uri: documentUrl }}
        startInLoadingState
        style={{ backgroundColor: colors.background, flex: 1 }}
      />
    </View>
  );
});
