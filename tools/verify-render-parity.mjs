#!/usr/bin/env node
/**
 * Pinned browser render conformance and candidate-golden derivation.
 *
 * This verifier deliberately keeps three statements separate:
 *   1. browser artifact conformance against a candidate or owner-approved fixture;
 *   2. edge RenderRequestV1 schema/control-plane conformance;
 *   3. edge artifact parity, which remains NOT_CHECKED until an edge renderer
 *      actually returns identified bytes.
 *
 * Usage:
 *   pnpm verify:render-parity -- --derive-candidate
 *   pnpm verify:render-parity -- --refresh-approved-provenance
 *   pnpm verify:render-parity
 *   node tools/verify-render-parity.mjs --url=http://127.0.0.1:5173/ --repeat=10
 */

import { chromium } from 'playwright';
import { createCanvas, loadImage } from 'canvas';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const WEB_ROOT = resolve(REPO_ROOT, 'apps/web');
const FIXTURE_ROOT = resolve(REPO_ROOT, 'tests/fixtures/render-artifact-v1');
const SPEC_PATH = resolve(FIXTURE_ROOT, 'browser-synthetic-calibration.spec.json');
const EDGE_FIXTURE_PATH = resolve(FIXTURE_ROOT, 'edge-opaque-atoms.request.json');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACTS_DIR = resolve(REPO_ROOT, '.verify-artifacts', 'render-parity', RUN_ID);

/**
 * Curated dependency closure for the synthetic raster fixture. These are the
 * application sources which parse the XYZ, establish camera/lighting/store
 * state, draw the instanced atoms, capture the framebuffer, and identify the
 * artifact. The verifier and fixture files are intentionally absent: changing
 * test prose or committing a newly derived fixture must not invalidate the
 * renderer it is intended to describe.
 */
const RENDERER_SOURCE_FILES_V1 = Object.freeze([
  'apps/web/vite.config.ts',
  'packages/core/src/elements.ts',
  'packages/core/src/renderArtifact.ts',
  'packages/scene/src/AnomalyTracker.tsx',
  'packages/scene/src/AtomClusters.tsx',
  'packages/scene/src/AtomPicker.tsx',
  'packages/scene/src/AtomsOptimized.tsx',
  'packages/scene/src/Bonds.tsx',
  'packages/scene/src/ClusterBuilder.ts',
  'packages/scene/src/SimulationCell.tsx',
  'packages/scene/src/SpatialHash.ts',
  'packages/scene/src/VectorGlyphs.tsx',
  'packages/scene/src/bondDetectCpu.ts',
  'packages/scene/src/bondReference.ts',
  'packages/scene/src/bondTopology.ts',
  'packages/scene/src/bondWorker.ts',
  'packages/scene/src/constants.ts',
  'packages/scene/src/index.ts',
  'packages/scene/src/interpolation.ts',
  'packages/scene/src/materials/ElementProfile.ts',
  'packages/scene/src/materials/categoryProfiles.ts',
  'packages/scene/src/materials/elementProfiles.ts',
  'packages/scene/src/materials/index.ts',
  'packages/scene/src/materials/scenes.ts',
  'packages/scene/src/useTimer.ts',
  'packages/scene/src/useBondGpuPipeline.ts',
  'packages/ui/src/ExportManager.tsx',
  'packages/ui/src/AnnotationsLayer.tsx',
  'packages/ui/src/AtomInfoHUD.tsx',
  'packages/ui/src/AtomTrails.tsx',
  'packages/ui/src/CameraFocus.tsx',
  'packages/ui/src/GhostAtoms.tsx',
  'packages/ui/src/KnowledgeLabelsLayer.tsx',
  'packages/ui/src/MoleculeFilterShell.tsx',
  'packages/ui/src/MoleculeShadow.tsx',
  'packages/ui/src/SceneLighting.tsx',
  'packages/ui/src/SelectionMarkers.tsx',
  'packages/ui/src/SpatialAnchor.tsx',
  'packages/ui/src/ViewerApp.tsx',
  'packages/ui/src/app/AppBackground.tsx',
  'packages/ui/src/app/CameraManager.tsx',
  'packages/ui/src/app/ViewerScene.tsx',
  'packages/ui/src/backgroundPresets.ts',
  'packages/ui/src/coloring/colorSchemes.ts',
  'packages/ui/src/coloring/index.ts',
  'packages/ui/src/deviceCapabilities.ts',
  'packages/ui/src/equirectTexture.ts',
  'packages/ui/src/export/artifactByteValidation.ts',
  'packages/ui/src/export/exportSceneBuilder.ts',
  'packages/ui/src/export/instanceBake.ts',
  'packages/ui/src/export/renderCaptureState.ts',
  'packages/ui/src/export/USDZExportPipeline.ts',
  'packages/ui/src/hooks/useEquirectMediaTexture.ts',
  'packages/ui/src/hooks/useSmoothFramePlayback.ts',
  'packages/ui/src/mcp/protocol.ts',
  'packages/ui/src/mcp/renderArtifactAdapter.ts',
  'packages/ui/src/mcp/tools.ts',
  'packages/ui/src/mcpViewerBridge.tsx',
  'packages/ui/src/postprocess/ScenePostprocessing.tsx',
  'packages/ui/src/postprocess/presets.ts',
  'packages/ui/src/renderCapability.ts',
  'packages/ui/src/renderArtifactSource.ts',
  'packages/ui/src/sceneEnvironment.ts',
  'packages/ui/src/store.ts',
  'packages/ui/src/viewer/ViewerCanvas.tsx',
  'packages/ui/src/viewer/PresetLegacyBridge.tsx',
  'packages/ui/src/viewer/artifactFrameSelection.ts',
  'packages/ui/src/viewer/useViewerSceneModel.ts',
  'packages/ui/src/xr/XREnvironmentDome.tsx',
  'packages/ui/src/xr/XRLightEstimation.tsx',
  'packages/ui/src/xr/XRControlPanel.tsx',
  'packages/ui/src/xr/XRMoleculeInteraction.tsx',
].sort());

/**
 * Output-affecting renderer semantics from RendererFingerprintV1. Build
 * identity and runtime identity are deliberately excluded: the former creates
 * a commit/fixture self-reference, while the latter is checked independently
 * by the pinned Chromium + SwiftShader assertions below.
 */
const RENDERER_BEHAVIOR_PROFILE_V1 = Object.freeze({
  schemaVersion: 'lupi.renderer-behavior-profile.v1',
  renderer: 'lupi-browser-webgl.v1',
  rendererVersion: 'three-r184;bridge-0.3.0',
  executionClass: 'browser-webgl-main-thread',
  determinism: {
    pixelRatio: 1,
    alphaContext: true,
    preserveDrawingBuffer: true,
    outputColorSpace: 'srgb',
    rendererToneMapping: 'none',
    postprocessPipeline: 'raw-scene-bypassed',
    rasterEncoder: 'browser-canvas-native',
    modelEncoder: 'three-exporters-r184',
    axesOverlay: 'canvas-overlay-v1',
  },
  capability: {
    version: 'lupi.render-capability.v1',
    formats: {
      png: { enabled: true, alphaModes: ['opaque', 'transparent'], maxWidth: 4096, maxHeight: 4096 },
      jpeg: { enabled: true, alphaModes: ['opaque'], maxWidth: 4096, maxHeight: 4096 },
      webp: { enabled: true, alphaModes: ['opaque', 'transparent'], maxWidth: 4096, maxHeight: 4096 },
      glb: { enabled: true, alphaModes: ['not-applicable'] },
      usdz: { enabled: false, alphaModes: [] },
    },
    layers: {
      background: true,
      atoms: true,
      vectorGlyphs: true,
      atomClusters: false,
      bonds: true,
      simulationCell: true,
      filterShell: true,
      moleculeShadow: true,
      contactShadows: true,
      ghostAtoms: false,
      annotations: false,
      knowledgeLabels: false,
      selectionMarkers: false,
      atomTrails: false,
      axes: true,
      scaleBar: false,
    },
  },
});

const RENDERER_DEPENDENCIES_V1 = Object.freeze([
  '@react-three/drei',
  '@react-three/fiber',
  '@react-three/postprocessing',
  '@react-three/xr',
  '@vitejs/plugin-react',
  'postprocessing',
  'react',
  'react-dom',
  'three',
  'vite',
  'vite-plugin-top-level-await',
  'vite-plugin-wasm',
  'zustand',
]);

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  console.log(`verify-render-parity.mjs

Usage:
  VITE_LUPI_BUILD_SHA=<40-hex-sha> pnpm verify:render-parity -- --derive-candidate
  VITE_LUPI_BUILD_SHA=<40-hex-sha> pnpm verify:render-parity
  VITE_LUPI_BUILD_SHA=<40-hex-sha> node tools/verify-render-parity.mjs --url=http://127.0.0.1:5173/ --repeat=10

Options:
  --derive-candidate   Derive and write a candidate PNG and metrics from >=10 repeats.
  --refresh-approved-provenance
                       Refresh renderer/source provenance only when every new
                       capture is byte-identical to the owner-approved golden.
  --validity-only      Print the current renderer-validity digest without launching a browser.
  --repeat=N           Repeat count; values below 10 are rejected (default: 10).
  --url=URL            Use an existing viewer server instead of starting Vite.
  --keep-server        Leave the locally started browser/server open for inspection.
  --json               Print the final JSON report to stdout.
`);
  process.exit(0);
}

const repeatCount = readRepeatCount(args.repeat);
const deriveCandidate = args['derive-candidate'] === true || args['derive-candidate'] === 'true';
const refreshApprovedProvenance = args['refresh-approved-provenance'] === true
  || args['refresh-approved-provenance'] === 'true';
const validityOnly = args['validity-only'] === true || args['validity-only'] === 'true';
const jsonMode = args.json === true || args.json === 'true';
const keepServer = args['keep-server'] === true || args['keep-server'] === 'true';

mkdirSync(ARTIFACTS_DIR, { recursive: true });

const browserSpec = readJson(SPEC_PATH);
const declaredSpecApproval = validateApproval(browserSpec.approval, 'browser spec');
if (deriveCandidate && refreshApprovedProvenance) {
  throw new Error('--derive-candidate and --refresh-approved-provenance are mutually exclusive.');
}
if (deriveCandidate && declaredSpecApproval.humanApproved) {
  throw new Error(
    'Refusing to overwrite an owner-approved render golden. The owner must explicitly invalidate the golden before deriving a replacement candidate.',
  );
}
if (refreshApprovedProvenance && !declaredSpecApproval.humanApproved) {
  throw new Error('Approved-provenance refresh requires an owner-approved browser spec.');
}
if (repeatCount < browserSpec.repeatCountMinimum) {
  throw new Error(`--repeat must be at least fixture repeatCountMinimum=${browserSpec.repeatCountMinimum}.`);
}
const candidatePath = resolve(FIXTURE_ROOT, browserSpec.candidateFile);
const metricsPath = resolve(FIXTURE_ROOT, browserSpec.metricsFile);
if (!deriveCandidate && !validityOnly && (!existsSync(candidatePath) || !existsSync(metricsPath))) {
  throw new Error(
    'Candidate fixture is missing. Run `pnpm verify:render-parity -- --derive-candidate` first; derivation remains unapproved.',
  );
}

const requireFromWeb = createRequire(resolve(WEB_ROOT, 'package.json'));
const packageResolvers = [
  requireFromWeb,
  createRequire(resolve(REPO_ROOT, 'packages/ui/package.json')),
];
const currentRendererValidity = computeRendererValidityV1(browserSpec, packageResolvers);
const repositoryEvidence = inspectRepositoryEvidence();
if (validityOnly) {
  console.log(JSON.stringify({
    rendererValidity: currentRendererValidity,
    repositoryEvidence,
  }, null, 2));
  process.exit(0);
}
const { createServer: createViteServer } = await import(
  pathToFileURL(requireFromWeb.resolve('vite')).href
);

const failures = [];
const checks = [];
const report = {
  schemaVersion: 'lupi.render-parity-report.v1',
  runId: RUN_ID,
  generatedAt: new Date().toISOString(),
  mode: deriveCandidate
    ? 'derive-candidate'
    : refreshApprovedProvenance
      ? 'refresh-approved-provenance'
      : 'verify-candidate',
  repeatCount,
  artifactsDir: ARTIFACTS_DIR,
  browser: {
    conformance: 'NOT_RUN',
    humanApproval: 'NOT_PERFORMED',
    candidateStatus: 'candidate-unapproved',
    rendererValidity: {
      scheme: currentRendererValidity.scheme,
      digest: currentRendererValidity.digest,
      sourceFileCount: currentRendererValidity.input.sourceFiles.length,
    },
    buildEvidence: repositoryEvidence,
    cleanExactShaCiDerivation: deriveCandidate
      && repositoryEvidence.authority === 'clean-exact-sha-ci'
      ? 'PASS'
      : 'PENDING',
  },
  edge: {
    schemaConformance: 'NOT_RUN',
    artifactParity: 'NOT_CHECKED',
    artifactParityReason: 'No activated edge renderer returned artifact bytes in this verifier.',
  },
  checks,
};

let appServer = null;
let browser = null;
let pendingFixtureWrite = null;
let resolvedApproval = null;

function log(...values) {
  if (!jsonMode) console.log('[verify-render-parity]', ...values);
}

function check(name, ok, detail = '') {
  const entry = { name, ok, detail };
  checks.push(entry);
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  log(`${ok ? 'OK  ' : 'NO  '}${name}${detail ? ` - ${detail}` : ''}`);
  return ok;
}

try {
  check(
    'renderer validity covers a non-empty curated source set',
    currentRendererValidity.input.sourceFiles.length === RENDERER_SOURCE_FILES_V1.length
      && currentRendererValidity.input.sourceFiles.every((entry) => /^sha256:[0-9a-f]{64}$/.test(entry.sha256)),
    `${currentRendererValidity.input.sourceFiles.length} source files; ${currentRendererValidity.digest}`,
  );
  check(
    'renderer validity excludes fixture, verifier, documentation, and commit identity inputs',
    currentRendererValidity.input.sourceFiles.every((entry) => (
      !entry.path.startsWith('tests/fixtures/')
      && !entry.path.startsWith('tools/')
      && !entry.path.startsWith('docs/')
    ))
      && !Object.hasOwn(currentRendererValidity.input, 'buildId')
      && !Object.hasOwn(currentRendererValidity.input, 'gitSha')
      && !Object.hasOwn(currentRendererValidity.input.behavior.determinism, 'buildIdentity'),
    'fixture/doc-only commits do not change the gate; generation fingerprint keeps build provenance',
  );
  const mutatedValidityInput = structuredClone(currentRendererValidity.input);
  mutatedValidityInput.sourceFiles[0].sha256 = `sha256:${'0'.repeat(64)}`;
  check(
    'renderer validity digest is sensitive to renderer source changes',
    sha256Canonical(mutatedValidityInput) !== currentRendererValidity.digest,
    currentRendererValidity.input.sourceFiles[0].path,
  );
  check(
    'browser build identity received an exact SHA injection',
    /^[0-9a-f]{40}$/.test(repositoryEvidence.injectedBuildSha ?? ''),
    repositoryEvidence.injectedBuildSha ?? 'VITE_LUPI_BUILD_SHA is absent',
  );
  check(
    'clean exact-SHA CI derivation authority is reported without overclaim',
    repositoryEvidence.authority === 'clean-exact-sha-ci'
      || report.browser.cleanExactShaCiDerivation === 'PENDING',
    repositoryEvidence.authorityReason,
  );

  const externalUrl = process.env.VERIFY_URL || args.url;
  const baseUrl = withTrailingSlash(externalUrl || await startPortlessVite());
  const targetUrl = new URL(browserSpec.route.replace(/^\//, ''), baseUrl).href;
  report.browser.targetUrl = targetUrl;

  const launchArguments = [...browserSpec.renderer.launchArguments];
  browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
    args: launchArguments,
  });
  report.browser.runtime = {
    playwrightChromiumExecutable: chromium.executablePath(),
    browserVersion: browser.version(),
    launchArguments,
    requestedGraphics: browserSpec.renderer.graphics,
  };

  const context = await browser.newContext({
    viewport: {
      width: browserSpec.viewport.width,
      height: browserSpec.viewport.height,
    },
    deviceScaleFactor: browserSpec.viewport.deviceScaleFactor,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  log(`target: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => window.__lupiViewerMcp?.ready === true,
    null,
    { timeout: 60_000 },
  );
  // Do not call getContext until Fiber has initialized and sized its canvas:
  // getContext on the early 300x150 DOM placeholder would create a default
  // context and make the inspection itself mutate the state being measured.
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#lupi-viewer-canvas canvas');
    return canvas instanceof HTMLCanvasElement
      && canvas.clientWidth > 0
      && canvas.clientHeight > 0
      && canvas.width === Math.round(canvas.clientWidth * window.devicePixelRatio)
      && canvas.height === Math.round(canvas.clientHeight * window.devicePixelRatio);
  }, null, { timeout: 60_000 });

  const graphics = await page.evaluate(() => {
    // @react-three/fiber applies the Canvas `id` to its wrapper element; the
    // actual WebGL canvas is the descendant.
    const viewerCanvas = document.querySelector('#lupi-viewer-canvas canvas');
    const canvas = viewerCanvas instanceof HTMLCanvasElement
      ? viewerCanvas
      : document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return {
      available: false,
      viewerCanvasBound: false,
      renderer: null,
      vendor: null,
      version: null,
      contextAttributes: null,
    };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      available: true,
      viewerCanvasBound: canvas === viewerCanvas,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      version: gl.getParameter(gl.VERSION),
      drawingBufferWidth: gl.drawingBufferWidth,
      drawingBufferHeight: gl.drawingBufferHeight,
      canvasClientWidth: canvas.clientWidth,
      canvasClientHeight: canvas.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
      contextAttributes: gl.getContextAttributes(),
    };
  });
  report.browser.runtime.graphics = graphics;
  check('pinned WebGL context is available', graphics.available, JSON.stringify(graphics));
  check(
    'graphics evidence comes from the mounted viewer canvas',
    graphics.viewerCanvasBound === true,
    `viewerCanvasBound=${graphics.viewerCanvasBound}`,
  );
  check(
    'viewer context matches pinned alpha/capture/antialias semantics',
    graphics.contextAttributes?.alpha === true
      && graphics.contextAttributes?.preserveDrawingBuffer === true
      && graphics.contextAttributes?.antialias === false,
    JSON.stringify(graphics.contextAttributes),
  );
  check(
    'viewer drawing buffer uses the pinned device pixel ratio',
    graphics.devicePixelRatio === browserSpec.viewport.deviceScaleFactor
      && graphics.drawingBufferWidth === graphics.canvasClientWidth * graphics.devicePixelRatio
      && graphics.drawingBufferHeight === graphics.canvasClientHeight * graphics.devicePixelRatio,
    `buffer=${graphics.drawingBufferWidth}x${graphics.drawingBufferHeight}; `
      + `client=${graphics.canvasClientWidth}x${graphics.canvasClientHeight}; dpr=${graphics.devicePixelRatio}`,
  );
  check(
    'pinned WebGL renderer is SwiftShader',
    /swiftshader/i.test(`${graphics.renderer ?? ''} ${graphics.vendor ?? ''}`),
    `${graphics.vendor ?? 'unknown'} / ${graphics.renderer ?? 'unknown'}`,
  );

  const setupResults = [];
  for (let index = 0; index < browserSpec.setup.length; index += 1) {
    const command = browserSpec.setup[index];
    const response = await executeMcp(page, `parity-setup-${index + 1}`, command);
    setupResults.push({ tool: command.tool, ok: response.ok, error: response.error ?? null });
    if (!response.ok) {
      throw new Error(`${command.tool} failed: ${response.error?.message ?? 'unknown MCP error'}`);
    }
    await settleViewer(page);
  }
  report.browser.setup = setupResults;

  const driverStatus = await page.evaluate(() => window.__lupiViewerMcp.status());
  report.browser.driverStatus = driverStatus;
  check(
    'candidate source is loaded and paused',
    driverStatus.moleculeLoaded === true
      && driverStatus.atomCount === browserSpec.expectedAtomCount
      && driverStatus.playing === false,
    `atoms=${driverStatus.atomCount} playing=${driverStatus.playing}`,
  );

  const captures = [];
  for (let index = 0; index < repeatCount; index += 1) {
    await settleViewer(page);
    const response = await executeMcp(page, `parity-export-${index + 1}`, browserSpec.export);
    if (!response.ok || !response.result?.asset?.dataBase64) {
      throw new Error(
        `repeat ${index + 1} export failed: ${response.error?.message ?? 'asset payload missing'}`,
      );
    }
    const asset = response.result.asset;
    const buffer = Buffer.from(asset.dataBase64, 'base64');
    const decoded = await decodePng(buffer);
    const metrics = measureImage(decoded);
    const capturePath = resolve(ARTIFACTS_DIR, `repeat-${String(index + 1).padStart(2, '0')}.png`);
    writeFileSync(capturePath, buffer);
    captures.push({ asset, buffer, decoded, metrics, capturePath });
    log(`capture ${index + 1}/${repeatCount}: ${sha256(buffer).slice(0, 23)} ${buffer.length} bytes`);
  }

  const repeatIdentityFields = [
    'contractVersion',
    'sourceContentDigest',
    'specId',
    'rendererFingerprint',
    'artifactKey',
  ];
  const fixtureIdentityFields = [
    'contractVersion',
    'sourceContentDigest',
    'specId',
  ];
  for (const field of repeatIdentityFields) {
    const unique = new Set(captures.map((capture) => capture.asset[field]));
    check(`browser ${field} is stable across repeats`, unique.size === 1, [...unique].join(', '));
  }
  check(
    'browser PNG dimensions are exact across repeats',
    captures.every((capture) => (
      capture.decoded.width === browserSpec.export.arguments.width
      && capture.decoded.height === browserSpec.export.arguments.height
    )),
    `${browserSpec.export.arguments.width}x${browserSpec.export.arguments.height}`,
  );
  check(
    'browser artifactDigest matches exact PNG bytes across repeats',
    captures.every((capture) => capture.asset.artifactDigest === sha256(capture.buffer)),
    captures.map((capture) => capture.asset.artifactDigest).join(', '),
  );
  const repeatByteDigests = [...new Set(captures.map((capture) => sha256(capture.buffer)))];
  check(
    'browser PNG bytes are bit-identical across local repeats',
    repeatByteDigests.length === 1,
    `${repeatByteDigests.length} unique byte digest(s): ${repeatByteDigests.join(', ')}`,
  );
  check(
    'browser export remains genuinely transparent',
    captures.every((capture) => capture.metrics.transparentFraction > 0.4 && capture.metrics.coverage < 0.6),
    `coverage range ${rangeOf(captures.map((capture) => capture.metrics.coverage)).map(formatMetric).join('..')}`,
  );

  let fixture;
  if (deriveCandidate) {
    fixture = deriveFixture(
      captures,
      browserSpec,
      report.browser.runtime,
      currentRendererValidity,
      repositoryEvidence,
    );
    const candidate = captures[fixture.derivation.medoidRepeat - 1];
    pendingFixtureWrite = { fixture, candidateBuffer: candidate.buffer };
    check(
      'candidate derivation used at least ten local repeats',
      fixture.derivation.repeatCount >= 10,
      `${fixture.derivation.repeatCount} repeats`,
    );
    check(
      'candidate remains explicitly unapproved',
      fixture.approval.humanApproved === false && fixture.approval.status === 'candidate-unapproved',
      fixture.approval.status,
    );
    resolvedApproval = validateApproval(fixture.approval, 'derived fixture');
    report.browser.fixtureWrite = {
      candidatePath,
      metricsPath,
      medoidRepeat: fixture.derivation.medoidRepeat,
      committed: false,
    };
  } else if (refreshApprovedProvenance) {
    const committedFixture = readJson(metricsPath);
    const committedApproval = validateApproval(committedFixture.approval, 'committed fixture');
    check(
      'approved-provenance refresh starts from matching owner approval receipts',
      committedApproval.humanApproved
        && approvalReceiptsEqual(declaredSpecApproval, committedApproval),
      `spec=${formatApproval(declaredSpecApproval)} fixture=${formatApproval(committedApproval)}`,
    );

    const approvedCandidateBuffer = readFileSync(candidatePath);
    const approvedCandidateDigest = sha256(approvedCandidateBuffer);
    check(
      'approved-provenance refresh cannot change golden bytes',
      captures.every((capture) => sha256(capture.buffer) === approvedCandidateDigest)
        && approvedCandidateDigest === committedFixture.artifact?.sha256,
      `approved=${approvedCandidateDigest}; captures=${repeatByteDigests.join(', ')}`,
    );

    fixture = deriveFixture(
      captures,
      browserSpec,
      report.browser.runtime,
      currentRendererValidity,
      repositoryEvidence,
    );
    fixture.approval = committedFixture.approval;
    resolvedApproval = validateApproval(fixture.approval, 'refreshed fixture');
    pendingFixtureWrite = { fixture, candidateBuffer: approvedCandidateBuffer };
    report.browser.fixtureWrite = {
      candidatePath,
      metricsPath,
      medoidRepeat: fixture.derivation.medoidRepeat,
      committed: false,
      candidateBytesRewritten: false,
    };
  } else {
    fixture = readJson(metricsPath);
    resolvedApproval = validateApproval(fixture.approval, 'committed fixture');
    check(
      'committed fixture has an explicit valid approval state',
      resolvedApproval.status === 'candidate-unapproved' || resolvedApproval.status === 'owner-approved',
      resolvedApproval.status,
    );
    check(
      'browser spec and fixture approval receipts agree',
      approvalReceiptsEqual(declaredSpecApproval, resolvedApproval),
      `spec=${formatApproval(declaredSpecApproval)} fixture=${formatApproval(resolvedApproval)}`,
    );
  }
  report.browser.humanApproval = resolvedApproval.humanApproved ? 'OWNER_APPROVED' : 'NOT_PERFORMED';
  report.browser.candidateStatus = resolvedApproval.status;
  check(
    'current output-affecting renderer digest matches candidate fixture',
    fixture.rendererValidity?.scheme === currentRendererValidity.scheme
      && fixture.rendererValidity?.digest === currentRendererValidity.digest,
    `fixture=${fixture.rendererValidity?.digest ?? 'missing'} current=${currentRendererValidity.digest}`,
  );
  check(
    'generation renderer fingerprint and artifact key remain provenance, not current-build gates',
    /^renderer-sha256:[0-9a-f]{64}$/.test(fixture.artifact?.generationIdentities?.rendererFingerprint ?? '')
      && /^artifact-sha256:[0-9a-f]{64}$/.test(fixture.artifact?.generationIdentities?.artifactKey ?? ''),
    `generationFingerprint=${fixture.artifact?.generationIdentities?.rendererFingerprint ?? 'missing'}; `
      + `currentFingerprint=${captures[0].asset.rendererFingerprint}`,
  );
  const tolerancePolicy = validateTolerancePolicy(fixture.tolerances);
  check(
    'all tolerances are at most 2x observed spread and within hard caps',
    tolerancePolicy.failures.length === 0,
    tolerancePolicy.failures.join('; '),
  );

  const candidateBuffer = deriveCandidate
    ? pendingFixtureWrite.candidateBuffer
    : readFileSync(candidatePath);
  const candidateDecoded = await decodePng(candidateBuffer);
  const candidateMetrics = measureImage(candidateDecoded);
  writeFileSync(resolve(ARTIFACTS_DIR, 'candidate-reference.png'), candidateBuffer);

  check(
    'Playwright Chromium version matches candidate derivation',
    report.browser.runtime.browserVersion === fixture.derivation.environment.browserVersion,
    `expected=${fixture.derivation.environment.browserVersion} actual=${report.browser.runtime.browserVersion}`,
  );
  check(
    'SwiftShader launch arguments match candidate derivation',
    JSON.stringify(report.browser.runtime.launchArguments)
      === JSON.stringify(fixture.derivation.environment.launchArguments),
    report.browser.runtime.launchArguments.join(' '),
  );
  for (const field of ['vendor', 'renderer', 'version']) {
    check(
      `SwiftShader ${field} matches candidate derivation`,
      report.browser.runtime.graphics?.[field] === fixture.derivation.environment.graphics?.[field],
      `expected=${fixture.derivation.environment.graphics?.[field] ?? 'missing'} `
        + `actual=${report.browser.runtime.graphics?.[field] ?? 'missing'}`,
    );
  }
  check(
    'viewer WebGL context attributes match candidate derivation',
    JSON.stringify(report.browser.runtime.graphics?.contextAttributes)
      === JSON.stringify(fixture.derivation.environment.graphics?.contextAttributes),
    JSON.stringify(report.browser.runtime.graphics?.contextAttributes),
  );

  check(
    'candidate byte digest matches fixture metadata',
    sha256(candidateBuffer) === fixture.artifact.sha256
      && fixture.artifact.artifactDigest === fixture.artifact.sha256,
    sha256(candidateBuffer),
  );
  check(
    'candidate decoded dimensions match fixture metadata',
    candidateDecoded.width === fixture.artifact.width && candidateDecoded.height === fixture.artifact.height,
    `${candidateDecoded.width}x${candidateDecoded.height}`,
  );
  for (const field of fixtureIdentityFields) {
    const expected = fixture.artifact.stableIdentities[field];
    check(
      `browser ${field} matches candidate fixture stable identity`,
      captures.every((capture) => capture.asset[field] === expected),
      `expected=${expected} actual=${captures[0].asset[field]}`,
    );
  }
  report.browser.identityComparison = {
    stableIdentities: fixture.artifact.stableIdentities,
    generationProvenance: fixture.artifact.generationIdentities,
    currentRendererFingerprint: captures[0].asset.rendererFingerprint,
    currentArtifactKey: captures[0].asset.artifactKey,
    rendererFingerprintEqualityRequired: false,
    artifactKeyEqualityRequired: false,
    reason: 'Both identities include buildId; output validity is gated by rendererValidity.digest instead.',
  };

  const captureEvaluations = captures.map((capture, index) => {
    const evaluation = evaluateCapture(
      capture.decoded,
      capture.metrics,
      candidateDecoded,
      candidateMetrics,
      fixture.tolerances,
    );
    check(
      `repeat ${index + 1} stays within derived candidate tolerances`,
      evaluation.failures.length === 0,
      evaluation.failures.join('; '),
    );
    return {
      repeat: index + 1,
      artifactDigest: capture.asset.artifactDigest,
      byteSha256: sha256(capture.buffer),
      metrics: capture.metrics,
      comparison: evaluation.comparison,
      failures: evaluation.failures,
    };
  });
  report.browser.captures = captureEvaluations;

  const sensitivity = runSensitivityChecks(candidateDecoded, candidateMetrics, fixture.tolerances);
  for (const mutation of sensitivity) {
    const mutationPath = resolve(ARTIFACTS_DIR, `sensitivity-${mutation.id}.png`);
    writeFileSync(mutationPath, encodePng(mutation.decoded));
    check(
      `derived tolerances reject ${mutation.id}`,
      mutation.evaluation.failures.length > 0,
      mutation.evaluation.failures.join('; '),
    );
  }
  report.browser.sensitivity = sensitivity.map(({ id, evaluation }) => ({
    id,
    rejected: evaluation.failures.length > 0,
    failures: evaluation.failures,
    comparison: evaluation.comparison,
  }));

  const sourceDigest = captures[0].asset.sourceContentDigest;
  const edgeResult = await verifyEdgeSchemaConformance(sourceDigest);
  report.edge.schemaConformance = edgeResult.ok ? 'PASS' : 'FAIL';
  report.edge.detail = edgeResult.detail;
  check('edge RenderRequestV1 schema/control-plane conformance', edgeResult.ok, edgeResult.summary);
  check(
    'edge artifact parity remains explicitly unchecked',
    report.edge.artifactParity === 'NOT_CHECKED' && !edgeResult.detail?.artifactDigest,
    report.edge.artifactParityReason,
  );

  const finalRendererValidity = computeRendererValidityV1(browserSpec, packageResolvers);
  check(
    'output-affecting renderer sources stayed unchanged during verification',
    finalRendererValidity.digest === currentRendererValidity.digest,
    `start=${currentRendererValidity.digest} end=${finalRendererValidity.digest}`,
  );

  report.browser.pageErrors = pageErrors;
  check('browser emitted no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '));

  await page.screenshot({
    path: resolve(ARTIFACTS_DIR, 'viewer-inspection.png'),
    fullPage: false,
  });
  if ((deriveCandidate || refreshApprovedProvenance) && failures.length === 0 && pendingFixtureWrite) {
    if (deriveCandidate) writeFileSync(candidatePath, pendingFixtureWrite.candidateBuffer);
    writeFileSync(metricsPath, `${JSON.stringify(pendingFixtureWrite.fixture, null, 2)}\n`);
    report.browser.fixtureWrite.committed = true;
  }
  report.browser.conformance = failures.length === 0 ? 'PASS' : 'FAIL';
} catch (error) {
  report.exception = error instanceof Error ? error.stack ?? error.message : String(error);
  check('verifier completed without exception', false, error instanceof Error ? error.message : String(error));
} finally {
  if (browser && !keepServer) await browser.close().catch(() => {});
  if (appServer && !keepServer) await appServer.close().catch(() => {});
}

report.browser.conformance = failures.length === 0 ? 'PASS' : 'FAIL';
report.overall = failures.length === 0 ? 'PASS' : 'FAIL';
report.releaseGoldenStatus = resolvedApproval?.status ?? 'candidate-unapproved';
report.humanReviewRequired = !(resolvedApproval?.humanApproved ?? false);
const reportPath = resolve(ARTIFACTS_DIR, 'report.json');
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  log(`report: ${reportPath}`);
  log(`inspection artifacts: ${ARTIFACTS_DIR}`);
  log(
    `release golden: ${report.releaseGoldenStatus}; human visual approval ${report.humanReviewRequired ? 'is still required' : 'was recorded'}`,
  );
  log(`derivation authority: ${repositoryEvidence.authority}; clean/exact-SHA CI derivation: ${report.browser.cleanExactShaCiDerivation}`);
  log('edge artifact parity: NOT_CHECKED');
}

if (failures.length > 0) {
  if (!jsonMode) {
    log(`${failures.length} check(s) failed:`);
    for (const failure of failures) log(`  - ${failure}`);
  }
  process.exit(1);
}

async function executeMcp(page, id, command) {
  return page.evaluate(
    async ({ requestId, request }) => window.__lupiViewerMcp.execute({
      id: requestId,
      tool: request.tool,
      arguments: request.arguments,
    }),
    { requestId: id, request: command },
  );
}

async function settleViewer(page) {
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(
    () => requestAnimationFrame(resolveFrame),
  )));
}

async function decodePng(buffer) {
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(pixels),
  };
}

function encodePng(decoded) {
  const canvas = createCanvas(decoded.width, decoded.height);
  const context = canvas.getContext('2d');
  const imageData = context.createImageData(decoded.width, decoded.height);
  imageData.data.set(decoded.data);
  context.putImageData(imageData, 0, 0);
  return canvas.toBuffer('image/png');
}

function measureImage(decoded) {
  const { data, width, height } = decoded;
  const pixelCount = width * height;
  let occupied = 0;
  let transparent = 0;
  let opaque = 0;
  let alphaSum = 0;
  let weightSum = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let luminanceSum = 0;
  let centroidX = 0;
  let centroidY = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let redDominant = 0;
  let blueDominant = 0;
  let neutral = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const r = data[offset] / 255;
    const g = data[offset + 1] / 255;
    const b = data[offset + 2] / 255;
    const a = data[offset + 3] / 255;
    alphaSum += a;
    if (data[offset + 3] === 0) transparent += 1;
    if (data[offset + 3] >= 250) opaque += 1;
    if (data[offset + 3] <= 8) continue;

    occupied += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    weightSum += a;
    redSum += r * a;
    greenSum += g * a;
    blueSum += b * a;
    luminanceSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
    centroidX += (x / width) * a;
    centroidY += (y / height) * a;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread < 0.08) neutral += a;
    else if (r > g * 1.12 && r > b * 1.12) redDominant += a;
    else if (b > r * 1.12 && b > g * 1.12) blueDominant += a;
  }

  if (occupied === 0 || weightSum === 0) throw new Error('Decoded candidate has no visible pixels.');
  return mapNumbers({
    coverage: occupied / pixelCount,
    transparentFraction: transparent / pixelCount,
    opaqueFraction: opaque / pixelCount,
    alphaMean: alphaSum / pixelCount,
    bboxLeft: minX / width,
    bboxTop: minY / height,
    bboxWidth: (maxX - minX + 1) / width,
    bboxHeight: (maxY - minY + 1) / height,
    centroidX: centroidX / weightSum,
    centroidY: centroidY / weightSum,
    meanRed: redSum / weightSum,
    meanGreen: greenSum / weightSum,
    meanBlue: blueSum / weightSum,
    meanLuminance: luminanceSum / weightSum,
    paletteRed: redDominant / weightSum,
    paletteBlue: blueDominant / weightSum,
    paletteNeutral: neutral / weightSum,
  });
}

function compareImages(actual, candidate) {
  if (actual.width !== candidate.width || actual.height !== candidate.height) {
    return {
      pixelRmse: 1,
      changedPixelRatio: 1,
      alphaMae: 1,
      silhouetteError: 1,
    };
  }
  const pixelCount = actual.width * actual.height;
  let squared = 0;
  let changed = 0;
  let alphaAbsolute = 0;
  let intersection = 0;
  let union = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    let maxDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = (actual.data[offset + channel] - candidate.data[offset + channel]) / 255;
      squared += delta * delta;
      maxDelta = Math.max(maxDelta, Math.abs(delta));
    }
    if (maxDelta > (12 / 255)) changed += 1;
    alphaAbsolute += Math.abs(actual.data[offset + 3] - candidate.data[offset + 3]) / 255;
    const actualVisible = actual.data[offset + 3] > 16;
    const candidateVisible = candidate.data[offset + 3] > 16;
    if (actualVisible && candidateVisible) intersection += 1;
    if (actualVisible || candidateVisible) union += 1;
  }
  return mapNumbers({
    pixelRmse: Math.sqrt(squared / (pixelCount * 4)),
    changedPixelRatio: changed / pixelCount,
    alphaMae: alphaAbsolute / pixelCount,
    silhouetteError: union === 0 ? 0 : 1 - (intersection / union),
  });
}

function deriveFixture(captures, spec, runtime, rendererValidity, buildEvidence) {
  const medoidIndex = findMedoid(captures.map((capture) => capture.decoded));
  const candidate = captures[medoidIndex];
  const comparisonRows = captures.map((capture) => compareImages(capture.decoded, candidate.decoded));
  const metricCaps = {
    coverage: 0.025,
    transparentFraction: 0.025,
    opaqueFraction: 0.025,
    alphaMean: 0.02,
    bboxLeft: 0.015,
    bboxTop: 0.015,
    bboxWidth: 0.02,
    bboxHeight: 0.02,
    centroidX: 0.012,
    centroidY: 0.012,
    meanRed: 0.035,
    meanGreen: 0.035,
    meanBlue: 0.035,
    meanLuminance: 0.025,
    paletteRed: 0.035,
    paletteBlue: 0.035,
    paletteNeutral: 0.035,
  };
  const comparisonCaps = {
    pixelRmse: 0.025,
    changedPixelRatio: 0.06,
    alphaMae: 0.012,
    silhouetteError: 0.025,
  };
  const tolerances = {
    rule: 'Each tolerance is min(hard defect-detection cap, 2 * observed local repeat spread).',
    metrics: {},
    comparison: {},
  };
  for (const [name, cap] of Object.entries(metricCaps)) {
    const values = captures.map((capture) => capture.metrics[name]);
    tolerances.metrics[name] = deriveTolerance(values, candidate.metrics[name], cap);
  }
  for (const [name, cap] of Object.entries(comparisonCaps)) {
    const values = comparisonRows.map((row) => row[name]);
    tolerances.comparison[name] = deriveTolerance(values, 0, cap);
  }

  const fixture = {
    schemaVersion: 'lupi.render-parity-metrics.v1',
    fixtureId: spec.id,
    approval: {
      status: 'candidate-unapproved',
      humanApproved: false,
      approvedBy: null,
      approvedAt: null,
      note: 'Generated automatically from pinned local repeats. Human visual approval was not performed.',
    },
    artifact: {
      file: spec.candidateFile,
      sha256: sha256(candidate.buffer),
      artifactDigest: candidate.asset.artifactDigest,
      mimeType: candidate.asset.mimeType,
      width: candidate.decoded.width,
      height: candidate.decoded.height,
      byteLength: candidate.buffer.length,
      stableIdentities: Object.fromEntries([
        'contractVersion',
        'sourceContentDigest',
        'specId',
      ].map((field) => [field, candidate.asset[field]])),
      generationIdentities: Object.fromEntries([
        'rendererFingerprint',
        'artifactKey',
      ].map((field) => [field, candidate.asset[field]])),
    },
    rendererValidity: {
      scheme: rendererValidity.scheme,
      digest: rendererValidity.digest,
      input: rendererValidity.input,
      note: 'Build identity and runtime identity are excluded. Runtime is pinned independently; generation fingerprint remains provenance only.',
    },
    expectedMetrics: candidate.metrics,
    tolerances,
    derivation: {
      generatedAt: new Date().toISOString(),
      repeatCount: captures.length,
      medoidRepeat: medoidIndex + 1,
      uniqueByteDigests: [...new Set(captures.map((capture) => sha256(capture.buffer)))],
      observedMetricRanges: Object.fromEntries(
        Object.keys(metricCaps).map((name) => [
          name,
          rangeOf(captures.map((capture) => capture.metrics[name])).map(roundMetric),
        ]),
      ),
      observedComparisonRanges: Object.fromEntries(
        Object.keys(comparisonCaps).map((name) => [
          name,
          rangeOf(comparisonRows.map((row) => row[name])).map(roundMetric),
        ]),
      ),
      environment: {
        renderer: spec.renderer.graphics,
        browser: 'Playwright Chromium from the repository lockfile',
        browserVersion: runtime.browserVersion,
        graphics: runtime.graphics,
        launchArguments: runtime.launchArguments,
        deviceScaleFactor: spec.viewport.deviceScaleFactor,
      },
      authority: {
        status: buildEvidence.authority,
        reason: buildEvidence.authorityReason,
        injectedBuildSha: buildEvidence.injectedBuildSha,
        repositoryHeadSha: buildEvidence.repositoryHeadSha,
        worktreeClean: buildEvidence.worktreeClean,
        ci: buildEvidence.ci,
        cleanExactShaCiDerivation: buildEvidence.authority === 'clean-exact-sha-ci'
          ? 'PASS'
          : 'PENDING',
      },
    },
    sensitivityRequirements: {
      missingAtoms: 'must be rejected',
      wrongPalette: 'must be rejected',
      opaqueBackground: 'must be rejected',
    },
    edge: {
      schemaConformanceFixture: 'edge-opaque-atoms.request.json',
      artifactParity: 'NOT_CHECKED',
      note: 'The edge seam validates requests but has no activated artifact-producing renderer.',
    },
  };

  const sensitivity = runSensitivityChecks(candidate.decoded, candidate.metrics, tolerances);
  const missed = sensitivity.filter((entry) => entry.evaluation.failures.length === 0);
  if (missed.length > 0) {
    throw new Error(`Derived tolerances failed sensitivity checks: ${missed.map((entry) => entry.id).join(', ')}`);
  }
  return fixture;
}

function deriveTolerance(values, expected, cap) {
  const [minimum, maximum] = rangeOf(values);
  const observedSpread = maximum - minimum;
  const observedMaxDeviation = Math.max(...values.map((value) => Math.abs(value - expected)));
  const value = Math.min(cap, observedSpread * 2);
  if (observedMaxDeviation > value + 1e-12) {
    throw new Error(
      `Observed deviation ${observedMaxDeviation} exceeds capped tolerance ${value}; renderer is not stable enough for this fixture.`,
    );
  }
  return {
    value: roundMetric(value),
    observedSpread: roundMetric(observedSpread),
    observedMaxDeviation: roundMetric(observedMaxDeviation),
    hardCap: cap,
    multiplier: 2,
  };
}

function validateTolerancePolicy(tolerances) {
  const policyFailures = [];
  for (const group of ['metrics', 'comparison']) {
    for (const [name, tolerance] of Object.entries(tolerances[group] ?? {})) {
      if (tolerance.multiplier !== 2) {
        policyFailures.push(`${group}.${name} multiplier is not 2`);
      }
      if (tolerance.value > tolerance.observedSpread * 2 + 1e-12) {
        policyFailures.push(`${group}.${name} exceeds 2x observed spread`);
      }
      if (tolerance.value > tolerance.hardCap + 1e-12) {
        policyFailures.push(`${group}.${name} exceeds hard cap`);
      }
    }
  }
  return { failures: policyFailures };
}

function findMedoid(images) {
  let bestIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let left = 0; left < images.length; left += 1) {
    let score = 0;
    for (let right = 0; right < images.length; right += 1) {
      if (left === right) continue;
      score += compareImages(images[left], images[right]).pixelRmse;
    }
    if (score < bestScore) {
      bestIndex = left;
      bestScore = score;
    }
  }
  return bestIndex;
}

function evaluateCapture(actual, actualMetrics, candidate, candidateMetrics, tolerances) {
  const comparison = compareImages(actual, candidate);
  const evaluationFailures = [];
  for (const [name, expected] of Object.entries(candidateMetrics)) {
    const tolerance = tolerances.metrics[name]?.value;
    if (typeof tolerance !== 'number') {
      evaluationFailures.push(`missing tolerance for metric ${name}`);
      continue;
    }
    const delta = Math.abs(actualMetrics[name] - expected);
    if (delta > tolerance + 1e-12) {
      evaluationFailures.push(`${name} delta ${formatMetric(delta)} > ${formatMetric(tolerance)}`);
    }
  }
  for (const [name, actualValue] of Object.entries(comparison)) {
    const tolerance = tolerances.comparison[name]?.value;
    if (typeof tolerance !== 'number') {
      evaluationFailures.push(`missing tolerance for comparison ${name}`);
      continue;
    }
    if (actualValue > tolerance + 1e-12) {
      evaluationFailures.push(`${name} ${formatMetric(actualValue)} > ${formatMetric(tolerance)}`);
    }
  }
  return { comparison, failures: evaluationFailures };
}

function runSensitivityChecks(candidate, candidateMetrics, tolerances) {
  return [
    ['missing-atoms', mutateMissingAtoms(candidate)],
    ['wrong-palette', mutateWrongPalette(candidate)],
    ['opaque-background', mutateOpaqueBackground(candidate)],
  ].map(([id, decoded]) => ({
    id,
    decoded,
    evaluation: evaluateCapture(
      decoded,
      measureImage(decoded),
      candidate,
      candidateMetrics,
      tolerances,
    ),
  }));
}

function mutateMissingAtoms(candidate) {
  const decoded = cloneDecoded(candidate);
  const metrics = measureImage(candidate);
  const cut = Math.floor((metrics.bboxLeft + metrics.bboxWidth * 0.68) * candidate.width);
  for (let y = 0; y < candidate.height; y += 1) {
    for (let x = cut; x < candidate.width; x += 1) {
      const offset = (y * candidate.width + x) * 4;
      if (decoded.data[offset + 3] <= 8) continue;
      decoded.data[offset] = 0;
      decoded.data[offset + 1] = 0;
      decoded.data[offset + 2] = 0;
      decoded.data[offset + 3] = 0;
    }
  }
  return decoded;
}

function mutateWrongPalette(candidate) {
  const decoded = cloneDecoded(candidate);
  for (let offset = 0; offset < decoded.data.length; offset += 4) {
    if (decoded.data[offset + 3] <= 8) continue;
    const red = decoded.data[offset];
    decoded.data[offset] = decoded.data[offset + 2];
    decoded.data[offset + 2] = red;
  }
  return decoded;
}

function mutateOpaqueBackground(candidate) {
  const decoded = cloneDecoded(candidate);
  for (let offset = 0; offset < decoded.data.length; offset += 4) {
    if (decoded.data[offset + 3] === 0) {
      decoded.data[offset] = 0;
      decoded.data[offset + 1] = 0;
      decoded.data[offset + 2] = 0;
    }
    decoded.data[offset + 3] = 255;
  }
  return decoded;
}

function cloneDecoded(decoded) {
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
  };
}

async function verifyEdgeSchemaConformance(sourceDigest) {
  const edgeFixture = readJson(EDGE_FIXTURE_PATH);
  const renderRequest = structuredClone(edgeFixture.request);
  renderRequest.spec.source.contentDigest = sourceDigest;
  const transformServer = await createViteServer({
    root: REPO_ROOT,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const workerModulePath = resolve(REPO_ROOT, 'apps/mcp-worker/src/index.ts').replaceAll('\\', '/');
    const workerModule = await transformServer.ssrLoadModule(`/@fs/${workerModulePath}`);
    const request = new Request('https://render-parity.invalid/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'edge-render-schema-conformance',
        method: 'tools/call',
        params: {
          name: 'lupi.render_molecule_asset',
          arguments: renderRequest,
        },
      }),
    });
    const response = await workerModule.default.fetch(request, {}, {});
    const body = await response.json();
    const structured = body?.result?.structuredContent;
    const ok = response.status === 200
      && !body.error
      && structured?.status === edgeFixture.expected.status
      && structured?.renderer?.mode === edgeFixture.expected.rendererMode
      && typeof structured?.requestKey === 'string'
      && typeof structured?.specId === 'string'
      && !('artifactKey' in structured)
      && !('artifactDigest' in structured);
    return {
      ok,
      summary: ok
        ? `accepted as ${structured.status}; renderer=${structured.renderer.mode}; artifact bytes absent`
        : JSON.stringify(body),
      detail: {
        httpStatus: response.status,
        status: structured?.status ?? null,
        rendererMode: structured?.renderer?.mode ?? null,
        requestKey: structured?.requestKey ?? null,
        specId: structured?.specId ?? null,
        artifactKeyPresent: structured ? 'artifactKey' in structured : null,
        sourceContentDigest: sourceDigest,
        artifactParity: 'NOT_CHECKED',
      },
    };
  } finally {
    await transformServer.close();
  }
}

async function startPortlessVite() {
  const port = await getFreePort();
  appServer = await createViteServer({
    root: WEB_ROOT,
    configFile: resolve(WEB_ROOT, 'vite.config.ts'),
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      hmr: false,
    },
    logLevel: 'warn',
  });
  await appServer.listen();
  const address = appServer.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP address.');
  return `http://127.0.0.1:${address.port}/`;
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (!address || typeof address === 'string') reject(new Error('No TCP port allocated.'));
        else resolvePort(address.port);
      });
    });
  });
}

function computeRendererValidityV1(spec, packageRequires) {
  const sourceFiles = RENDERER_SOURCE_FILES_V1.map((path) => {
    const absolutePath = resolve(REPO_ROOT, path);
    if (!existsSync(absolutePath)) {
      throw new Error(`Renderer validity source is missing: ${path}`);
    }
    // Git may materialize CRLF on Windows and LF in CI. Hash normalized source
    // text so repository-equivalent checkouts produce the same validity gate.
    const normalizedSource = readFileSync(absolutePath, 'utf8').replace(/\r\n?/g, '\n');
    return { path, sha256: sha256(Buffer.from(normalizedSource, 'utf8')) };
  });
  const dependencyVersions = Object.fromEntries(
    RENDERER_DEPENDENCIES_V1.map((name) => [name, resolveInstalledPackageVersion(packageRequires, name)]),
  );
  const input = {
    schemaVersion: 'lupi.renderer-validity-input.v1',
    sourceNormalization: 'utf8-lf-v1',
    sourceFiles,
    dependencyVersions,
    behavior: RENDERER_BEHAVIOR_PROFILE_V1,
    fixtureRenderInput: {
      id: spec.id,
      route: spec.route,
      viewport: spec.viewport,
      renderer: spec.renderer,
      setup: spec.setup,
      export: spec.export,
      expectedAtomCount: spec.expectedAtomCount,
    },
  };
  return {
    scheme: 'lupi.renderer-validity-digest.v1',
    digest: sha256Canonical(input),
    input,
  };
}

function resolveInstalledPackageVersion(packageRequires, packageName) {
  let entryPath = null;
  for (const packageRequire of packageRequires) {
    try {
      entryPath = packageRequire.resolve(packageName);
      break;
    } catch {
      // Try the next workspace resolver.
    }
  }
  if (!entryPath) throw new Error(`Could not resolve installed package ${packageName}.`);
  let directory = dirname(entryPath);
  for (let depth = 0; depth < 16; depth += 1) {
    const manifestPath = resolve(directory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = readJson(manifestPath);
      if (manifest.name === packageName && typeof manifest.version === 'string') {
        return manifest.version;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Could not resolve installed package version for ${packageName}.`);
}

function inspectRepositoryEvidence() {
  let repositoryHeadSha = null;
  let worktreeClean = false;
  try {
    repositoryHeadSha = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().toLowerCase();
    worktreeClean = execFileSync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim().length === 0;
  } catch {
    // Evidence stays explicit and incomplete if Git is unavailable.
  }
  const injectedBuildSha = process.env.VITE_LUPI_BUILD_SHA?.trim().toLowerCase() || null;
  const ci = process.env.CI === 'true';
  const exactShaInjected = /^[0-9a-f]{40}$/.test(injectedBuildSha ?? '');
  const injectedShaMatchesHead = exactShaInjected
    && /^[0-9a-f]{40}$/.test(repositoryHeadSha ?? '')
    && injectedBuildSha === repositoryHeadSha;
  const cleanExactShaCi = ci && worktreeClean && injectedShaMatchesHead;
  const authorityReason = cleanExactShaCi
    ? 'CI ran from a clean worktree with the exact checked-out SHA injected into the browser bundle.'
    : [
      'mechanics evidence only',
      ci ? 'CI=true' : 'CI is not true',
      worktreeClean ? 'worktree clean' : 'worktree dirty',
      injectedShaMatchesHead ? 'injected SHA matches HEAD' : 'injected SHA does not prove current HEAD',
    ].join('; ');
  return {
    authority: cleanExactShaCi ? 'clean-exact-sha-ci' : 'dirty-worktree-mechanics-only',
    authorityReason,
    repositoryHeadSha,
    injectedBuildSha,
    worktreeClean,
    ci,
    exactShaInjected,
    injectedShaMatchesHead,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validateApproval(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} approval receipt is missing.`);
  }

  const approvedBy = value.approvedBy ?? null;
  const approvedAt = value.approvedAt ?? null;
  if (value.status === 'candidate-unapproved') {
    if (value.humanApproved !== false || approvedBy !== null || approvedAt !== null) {
      throw new Error(`${label} candidate-unapproved receipt must not claim an approver or approval time.`);
    }
  } else if (value.status === 'owner-approved') {
    if (value.humanApproved !== true) {
      throw new Error(`${label} owner-approved receipt must set humanApproved=true.`);
    }
    if (typeof approvedBy !== 'string' || approvedBy.trim().length === 0) {
      throw new Error(`${label} owner-approved receipt must identify the approver.`);
    }
    if (
      typeof approvedAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(approvedAt)
      || Number.isNaN(Date.parse(approvedAt))
    ) {
      throw new Error(`${label} owner-approved receipt must contain an ISO-8601 UTC approval time.`);
    }
  } else {
    throw new Error(`${label} approval status must be candidate-unapproved or owner-approved.`);
  }

  return {
    status: value.status,
    humanApproved: value.humanApproved,
    approvedBy,
    approvedAt,
  };
}

function approvalReceiptsEqual(left, right) {
  return left.status === right.status
    && left.humanApproved === right.humanApproved
    && left.approvedBy === right.approvedBy
    && left.approvedAt === right.approvedAt;
}

function formatApproval(value) {
  return [value.status, value.approvedBy ?? 'none', value.approvedAt ?? 'none'].join(':');
}

function sha256(buffer) {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

function sha256Canonical(value) {
  return sha256(Buffer.from(JSON.stringify(sortCanonical(value)), 'utf8'));
}

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortCanonical(value[key])]),
  );
}

function rangeOf(values) {
  return [Math.min(...values), Math.max(...values)];
}

function mapNumbers(value) {
  return Object.fromEntries(Object.entries(value).map(([key, number]) => [key, roundMetric(number)]));
}

function roundMetric(value) {
  return Number(value.toFixed(10));
}

function formatMetric(value) {
  return Number(value).toExponential(3);
}

function readRepeatCount(value) {
  const parsed = value === undefined ? 10 : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 10 || parsed > 100) {
    throw new Error('--repeat must be an integer from 10 through 100.');
  }
  return parsed;
}

function parseArgs(argv) {
  const parsed = {};
  for (const argument of argv) {
    if (!argument.startsWith('--')) continue;
    const separator = argument.indexOf('=');
    if (separator < 0) parsed[argument.slice(2)] = true;
    else parsed[argument.slice(2, separator)] = argument.slice(separator + 1);
  }
  return parsed;
}

function withTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}
