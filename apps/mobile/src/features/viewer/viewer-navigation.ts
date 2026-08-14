export type ViewerNavigationDecision = "allow" | "block" | "open-external";

export function makeViewerOriginWhitelist(): string[] {
  // react-native-webview opens URLs that miss this whitelist through the
  // operating system before onShouldStartLoadWithRequest can decide. Passing
  // every candidate to our callback keeps decideViewerNavigation authoritative.
  return ["*"];
}

export function decideViewerNavigation({
  isTopFrame,
  navigationType,
  trustedOrigin,
  url,
}: {
  isTopFrame?: boolean;
  navigationType?: string;
  trustedOrigin: string;
  url: string;
}): ViewerNavigationDecision {
  if (url === "about:blank") return "allow";

  try {
    const parsed = new URL(url);
    if (parsed.origin === trustedOrigin) return "allow";
    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      isTopFrame === true &&
      navigationType === "click"
    )
      return "open-external";
  } catch {
    return "block";
  }

  return "block";
}
