import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const appDirectory = resolve(import.meta.dirname, "..");
const repositoryDirectory = resolve(appDirectory, "..", "..");
const archiveDirectory = resolve(
  appDirectory,
  process.argv[2] ?? ".verify-artifacts/mobile-eas-archive",
);
const maximumBytes = 10 * 1024 * 1024;
const maximumFiles = 250;
const requiredFiles = new Set([
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/mobile/app.config.ts",
  "apps/mobile/app.json",
  "apps/mobile/.gitignore",
  "apps/mobile/eas.json",
  "apps/mobile/package.json",
  "apps/mobile/.eas/workflows/mobile-visual-ar-diagnostic.yml",
  "apps/mobile/.eas/workflows/mobile-visual-capture.yml",
  "apps/mobile/.eas/workflows/mobile-visual.yml",
  "apps/mobile/.maestro/visual/ar-intro-simulator-diagnostic.yml",
  "apps/mobile/.maestro/visual/caffeine-ready.yml",
  "apps/mobile/.maestro/visual/scripts/capture-viewer-health.js",
  "apps/mobile/app/_layout.tsx",
  "apps/mobile/app/__visual.tsx",
  "apps/mobile/app/ar.tsx",
  "apps/mobile/app/(tabs)/_layout.tsx",
  "apps/mobile/app/(tabs)/_layout.web.tsx",
  "apps/mobile/app/(tabs)/(explore)/index.tsx",
  "apps/mobile/app/(tabs)/(library)/library.tsx",
  "apps/mobile/app/(tabs)/(settings)/_layout.tsx",
  "apps/mobile/app/(tabs)/(settings)/settings.tsx",
  "apps/mobile/app/viewer.tsx",
  "apps/mobile/assets/images/lupi-app-icon.png",
  "apps/mobile/assets/images/lupi-splash-mark-1024.png",
  "apps/mobile/plugins/with-viro-camera-only.js",
  "apps/mobile/src/features/ar/ar-build-policy.ts",
  "apps/mobile/src/features/ar/ar-entry-screen.tsx",
  "apps/mobile/src/features/ar/ar-runtime.native.ts",
  "apps/mobile/src/features/ar/ar-runtime.types.ts",
  "apps/mobile/src/features/ar/ar-scene.ts",
  "apps/mobile/src/features/ar/ar-screen.tsx",
  "apps/mobile/src/features/ar/ar-session-store.ts",
  "apps/mobile/src/features/ar/molecule-ar-surface.native.tsx",
  "apps/mobile/src/features/ar/molecule-ar-surface.types.ts",
  "apps/mobile/src/domain/mobile-gallery.ts",
  "apps/mobile/src/features/gallery/gallery-card.tsx",
  "apps/mobile/src/features/gallery/gallery-catalog.ts",
  "apps/mobile/src/features/gallery/gallery-screen.tsx",
  "apps/mobile/src/features/library/library-screen.tsx",
  "apps/mobile/src/features/library/library-sections.ts",
  "apps/mobile/src/features/settings/settings-screen.tsx",
  "apps/mobile/src/features/settings/settings-sections.ts",
  "apps/mobile/src/features/viewer/viewer-bridge.ts",
  "apps/mobile/src/features/viewer/viewer-ar-handoff.ts",
  "apps/mobile/src/features/viewer/viewer-compatibility.ts",
  "apps/mobile/src/features/viewer/viewer-control-bar.tsx",
  "apps/mobile/src/features/viewer/viewer-menu.ts",
  "apps/mobile/src/features/viewer/viewer-runtime.ts",
  "apps/mobile/src/features/viewer/viewer-screen.tsx",
  "apps/mobile/src/features/viewer/viewer-session.ts",
  "apps/mobile/src/features/viewer/viewer-surface.native.tsx",
  "apps/mobile/src/features/visual-qa/visual-qa-scenarios.ts",
  "apps/mobile/src/features/visual-qa/visual-qa-ar-scenarios.ts",
  "apps/mobile/src/features/visual-qa/visual-qa-screen.tsx",
  "apps/mobile/src/storage/recent-molecules-repository.ts",
  "apps/mobile/src/theme/colors.ts",
  "apps/mobile/src/theme/tokens.ts",
  "packages/core/package.json",
  "packages/core/src/elements.ts",
]);
const forbiddenSegments = new Set([
  ".expo",
  ".git",
  ".verify-artifacts",
  ".vscode",
  "dist",
  "dist-ios",
  "node_modules",
  "store",
]);

if (!statSync(archiveDirectory, { throwIfNoEntry: false })?.isDirectory()) {
  fail(`Archive directory does not exist: ${archiveDirectory}`);
}

const files = walk(archiveDirectory);
const paths = new Set(files.map(({ path }) => path));
const byteLength = files.reduce((total, file) => total + file.size, 0);
const violations = [];

for (const requiredFile of requiredFiles) {
  if (!paths.has(requiredFile))
    violations.push(`missing required file ${requiredFile}`);
}

for (const { path } of files) {
  const segments = path.split("/");
  const atAllowedRoot =
    requiredFiles.has(path) ||
    path.startsWith("apps/mobile/") ||
    path.startsWith("packages/core/");
  if (!atAllowedRoot) violations.push(`unexpected root path ${path}`);
  if (segments.some((segment) => forbiddenSegments.has(segment))) {
    violations.push(`forbidden generated path ${path}`);
  }
  if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) {
    violations.push(`test source uploaded ${path}`);
  }
  const sourcePath = resolve(repositoryDirectory, path);
  if (!statSync(sourcePath, { throwIfNoEntry: false })?.isFile()) {
    violations.push(`archive file has no matching source ${path}`);
  } else if (
    digest(sourcePath) !== digest(resolve(archiveDirectory, ...path.split("/")))
  ) {
    violations.push(`stale or transformed archive file ${path}`);
  }
}

if (files.length > maximumFiles)
  violations.push(`${files.length} files exceeds the ${maximumFiles}-file cap`);
if (byteLength > maximumBytes)
  violations.push(`${byteLength} bytes exceeds the ${maximumBytes}-byte cap`);

if (violations.length) {
  for (const violation of violations) console.error(`[fail] ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `[ok] EAS archive contains ${files.length} files and ${byteLength} bytes`,
  );
  console.log(
    "[ok] EAS archive contains only current mobile build inputs with byte-identical source",
  );
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return walk(absolutePath);
    if (!entry.isFile()) return [];
    return [
      {
        path: relative(archiveDirectory, absolutePath).split(sep).join("/"),
        size: statSync(absolutePath).size,
      },
    ];
  });
}

function fail(message) {
  console.error(`[fail] ${message}`);
  process.exit(1);
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
