const response = http.get(viewerHealthUrl);

if (!response.ok) {
  throw new Error(`Lupi viewer health returned HTTP ${response.status}`);
}

const health = json(response.body);

if (
  health.ready !== true ||
  typeof health.name !== "string" ||
  typeof health.version !== "string"
) {
  throw new Error(
    "Lupi viewer health did not return a ready, identifiable release",
  );
}

const release =
  health.release && typeof health.release === "object" ? health.release : {};

const manifestResponse = http.get(viewerBrowserManifestUrl);

if (!manifestResponse.ok) {
  throw new Error(
    `Lupi browser manifest returned HTTP ${manifestResponse.status}`,
  );
}

const manifest = json(manifestResponse.body);
const manifestTools =
  manifest && typeof manifest === "object" && Array.isArray(manifest.tools)
    ? manifest.tools
    : [];
const toolNames = manifestTools.map((tool) =>
  tool && typeof tool.name === "string" ? tool.name : "",
);
const uniqueToolNames = toolNames.filter(
  (name, index) => name && toolNames.indexOf(name) === index,
);
const expectedToolCount = 30;
const requiredTools = ["lupi.open_gallery_example", "lupi.assess_asset"];
const missingTools = requiredTools.filter(
  (toolName) => !uniqueToolNames.includes(toolName),
);

if (
  toolNames.length !== expectedToolCount ||
  uniqueToolNames.length !== expectedToolCount ||
  missingTools.length > 0
) {
  throw new Error(
    `Lupi browser manifest contract mismatch: expected ${expectedToolCount} unique tools including ${requiredTools.join(", ")}; received ${toolNames.length} entries, ${uniqueToolNames.length} unique names, missing ${missingTools.join(", ") || "none"}`,
  );
}

output.lupiViewerHealth = {
  url: viewerHealthUrl,
  name: health.name,
  version: health.version,
  toolCount: health.toolCount,
  releaseId: release.id,
  releaseTag: release.tag,
  releaseTimestamp: release.timestamp,
};

output.lupiBrowserManifest = {
  url: viewerBrowserManifestUrl,
  schemaVersion: manifest.schemaVersion,
  generatedAt: manifest.generatedAt,
  toolCount: uniqueToolNames.length,
  toolNames: uniqueToolNames,
  requiredTools,
};

console.log(
  `LUPI_VISUAL_VIEWER_IDENTITY ${JSON.stringify(output.lupiViewerHealth)}`,
);

console.log(
  `LUPI_VISUAL_BROWSER_MANIFEST ${JSON.stringify(output.lupiBrowserManifest)}`,
);
