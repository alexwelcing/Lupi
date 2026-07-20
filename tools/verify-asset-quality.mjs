#!/usr/bin/env node
/**
 * verify-asset-quality.mjs
 *
 * Visual validation of the `lupi.export_asset` MCP tool. Spins up the Vite
 * dev server, drives the bridge through Playwright, and saves the actual
 * PNG/JPEG/WebP/GLB bytes the deterministic bridge returns. USDZ is exercised
 * as a required fail-closed capability until its exporter is byte-stable.
 * browser for dimensions, alpha, and appearance comparisons; model containers
 * are checked structurally. Exact returned bytes plus a viewer screenshot are
 * dropped under .verify-artifacts/asset-quality/<run>/ for human inspection.
 *
 * Usage:
 *   node tools/verify-asset-quality.mjs
 *   node tools/verify-asset-quality.mjs --url=http://127.0.0.1:5173/#/mcp
 *   node tools/verify-asset-quality.mjs --skip-glb
 *   node tools/verify-asset-quality.mjs --skip-usdz
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const WEB_ROOT = resolve(REPO_ROOT, 'apps/web');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACTS = resolve(REPO_ROOT, '.verify-artifacts', 'asset-quality', RUN_ID);

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  console.log(`verify-asset-quality.mjs

Usage:
  node tools/verify-asset-quality.mjs
  node tools/verify-asset-quality.mjs --url=http://127.0.0.1:5173/#/mcp
  node tools/verify-asset-quality.mjs --skip-glb
  node tools/verify-asset-quality.mjs --skip-usdz
  node tools/verify-asset-quality.mjs --keep-server
`);
  process.exit(0);
}

if (!existsSync(ARTIFACTS)) mkdirSync(ARTIFACTS, { recursive: true });

const requireFromWeb = createRequire(resolve(WEB_ROOT, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFromWeb.resolve('vite')).href);

const skipGlb = args['skip-glb'] === true || args['skip-glb'] === 'true';
const skipUsdz = args['skip-usdz'] === true || args['skip-usdz'] === 'true';

let server = null;
let browser = null;
const checks = [];
const report = { runId: RUN_ID, artifactsDir: ARTIFACTS, checks: [] };

function log(...values) {
  console.log('[verify-asset-quality]', ...values);
}

function check(name, ok, detail = '') {
  const entry = { name, ok, detail };
  checks.push(entry);
  report.checks.push(entry);
  log(`${ok ? 'OK  ' : 'NO  '}${name}${detail ? ` - ${detail}` : ''}`);
}

function decodeBase64(b64) {
  return Buffer.from(b64, 'base64');
}

function pngDimensions(buffer) {
  // PNG: 8-byte signature, then 4-byte length + 4-byte type ("IHDR"), then 4-byte width + 4-byte height (big-endian).
  if (buffer.length < 24 || buffer[0] !== 0x89 || buffer[1] !== 0x50) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function jpegDimensions(buffer) {
  // Walk JPEG markers looking for SOF0/SOF2.
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let i = 2;
  while (i < buffer.length) {
    if (buffer[i] !== 0xff) return null;
    while (i < buffer.length && buffer[i] === 0xff) i += 1;
    if (i >= buffer.length) return null;
    const marker = buffer[i];
    i += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (i + 1 >= buffer.length) return null;
    const segLen = buffer.readUInt16BE(i);
    if (marker === 0xc0 || marker === 0xc2) {
      if (i + 5 >= buffer.length) return null;
      const height = buffer.readUInt16BE(i + 3);
      const width = buffer.readUInt16BE(i + 5);
      return { width, height };
    }
    i += segLen;
  }
  return null;
}

function webpDimensions(buffer) {
  // RIFF container: "RIFF" + size(4) + "WEBP" + chunks.
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const tag = buffer.toString('ascii', 12, 16);
  if (tag === 'VP8 ') {
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }
  if (tag === 'VP8L') {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (tag === 'VP8X') {
    // Extended format: chunk size 10, then flags(4), then 24-bit LE width-1 and 24-bit LE height-1.
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height };
  }
  return null;
}

function pngSanity(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const signatureOk = buffer.length >= 24 && buffer.subarray(0, 8).equals(signature);
  const ihdrOk = signatureOk
    && buffer.readUInt32BE(8) === 13
    && buffer.toString('ascii', 12, 16) === 'IHDR';
  return { ok: signatureOk && ihdrOk, signatureOk, ihdrOk, dimensions: pngDimensions(buffer) };
}

function jpegSanity(buffer) {
  const soiOk = buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8;
  const eoiOk = buffer.length >= 4
    && buffer[buffer.length - 2] === 0xff
    && buffer[buffer.length - 1] === 0xd9;
  const dimensions = jpegDimensions(buffer);
  return { ok: soiOk && eoiOk && Boolean(dimensions), soiOk, eoiOk, dimensions };
}

function webpSanity(buffer) {
  const riffOk = buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF';
  const webpOk = riffOk && buffer.toString('ascii', 8, 12) === 'WEBP';
  const declaredLength = riffOk ? buffer.readUInt32LE(4) + 8 : 0;
  const lengthOk = declaredLength === buffer.length;
  const dimensions = webpDimensions(buffer);
  return {
    ok: riffOk && webpOk && lengthOk && Boolean(dimensions),
    riffOk,
    webpOk,
    lengthOk,
    declaredLength,
    dimensions,
  };
}

function glbSanity(buffer) {
  // glTF binary: magic "glTF" + version(uint32) + length(uint32) + chunks.
  if (buffer.length < 12) return { ok: false, reason: 'too short' };
  if (buffer.toString('ascii', 0, 4) !== 'glTF') return { ok: false, reason: 'missing glTF magic' };
  const version = buffer.readUInt32LE(4);
  const length = buffer.readUInt32LE(8);
  return { ok: version === 2 && length === buffer.length, version, length };
}

function parseStoredZipEntries(buffer) {
  const entries = [];
  let offset = 0;
  let centralDirectorySeen = false;

  while (offset + 4 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) {
      centralDirectorySeen = true;
      break;
    }
    if (signature !== 0x04034b50) {
      throw new Error(`unexpected ZIP signature 0x${signature.toString(16)} at byte ${offset}`);
    }
    if (offset + 30 > buffer.length) throw new Error('truncated ZIP local header');

    const flags = buffer.readUInt16LE(offset + 6);
    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const filenameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    if ((flags & 0x08) !== 0) throw new Error('ZIP data descriptors are unsupported by this structural verifier');

    const filenameStart = offset + 30;
    const extraStart = filenameStart + filenameLength;
    const dataStart = extraStart + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error('ZIP entry extends beyond archive bytes');

    entries.push({
      name: buffer.toString('utf8', filenameStart, extraStart),
      compression,
      compressedSize,
      uncompressedSize,
      dataStart,
      aligned64: dataStart % 64 === 0,
      data: buffer.subarray(dataStart, dataEnd),
    });
    offset = dataEnd;
  }

  if (!centralDirectorySeen) throw new Error('ZIP central directory is missing');
  return entries;
}

function usdzSanity(buffer) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
    return { ok: false, reason: 'missing ZIP local-file signature' };
  }

  try {
    const entries = parseStoredZipEntries(buffer);
    const names = entries.map((entry) => entry.name);
    const model = entries.find((entry) => entry.name === 'model.usda');
    const geometryEntries = entries.filter((entry) => /^geometries\/Geometry_.+\.usda$/.test(entry.name));
    const allStored = entries.every((entry) => entry.compression === 0 && entry.compressedSize === entry.uncompressedSize);
    const allAligned = entries.every((entry) => entry.aligned64);
    const modelText = model ? model.data.toString('utf8') : '';
    const geometryTexts = geometryEntries.map((entry) => entry.data.toString('utf8'));
    const referencedGeometry = [...modelText.matchAll(/@\.\/(geometries\/Geometry_[^@]+\.usda)@/g)]
      .map((match) => match[1]);
    const missingGeometry = referencedGeometry.filter((name) => !names.includes(name));
    const materialDefinitions = new Set(
      [...modelText.matchAll(/def Material "(Material_[^"]+)"/g)].map((match) => match[1]),
    );
    const materialBindings = [...modelText.matchAll(/rel material:binding = <\/Materials\/(Material_[^>]+)>/g)]
      .map((match) => match[1]);
    const missingMaterials = materialBindings.filter((name) => !materialDefinitions.has(name));
    const headerOk = modelText.startsWith('#usda 1.0')
      && /defaultPrim = "Root"/.test(modelText)
      && /metersPerUnit = 1/.test(modelText)
      && /upAxis = "Y"/.test(modelText);
    const geometryOk = geometryEntries.length > 0
      && geometryTexts.every((text) => text.startsWith('#usda 1.0') && /def Mesh "Geometry"/.test(text))
      && geometryTexts.some((text) => /point3f\[\] points/.test(text) && /int\[\] faceVertexIndices/.test(text));
    const materialOk = materialDefinitions.size > 0
      && materialBindings.length > 0
      && missingMaterials.length === 0
      && /uniform token info:id = "UsdPreviewSurface"/.test(modelText)
      && /inputs:diffuseColor/.test(modelText);
    const referencesOk = referencedGeometry.length > 0 && missingGeometry.length === 0;

    return {
      ok: entries[0]?.name === 'model.usda'
        && allStored
        && allAligned
        && headerOk
        && geometryOk
        && materialOk
        && referencesOk,
      entries,
      names,
      allStored,
      allAligned,
      headerOk,
      geometryOk,
      materialOk,
      referencesOk,
      materialCount: materialDefinitions.size,
      geometryCount: geometryEntries.length,
      missingGeometry,
      missingMaterials,
    };
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
}

function shortHash(buffer) {
  // FNV-1a 32-bit, hex. Stable per-run identifier.
  let hash = 0x811c9dc5;
  for (let i = 0; i < buffer.length; i += 1) {
    hash ^= buffer[i];
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function expectedMimeType(format) {
  if (format === 'png') return 'image/png';
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  if (format === 'glb') return 'model/gltf-binary';
  if (format === 'usdz') return 'model/vnd.usdz+zip';
  throw new Error(`No verifier MIME rule for ${format}`);
}

async function analyzeRaster(page, asset) {
  return page.evaluate(async ({ dataBase64, mimeType }) => {
    const binary = atob(dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

    const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create raster analysis canvas');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixelCount = canvas.width * canvas.height;
    let alphaMin = 255;
    let alphaMax = 0;
    let transparentPixels = 0;
    let nonTransparentPixels = 0;
    let partialAlphaPixels = 0;
    let contentRed = 0;
    let contentGreen = 0;
    let contentBlue = 0;
    let contentCount = 0;
    let centerContentPixels = 0;
    let hash = 0x811c9dc5;
    const centerLeft = Math.floor(canvas.width * 0.25);
    const centerRight = Math.ceil(canvas.width * 0.75);
    const centerTop = Math.floor(canvas.height * 0.25);
    const centerBottom = Math.ceil(canvas.height * 0.75);

    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const byte = pixel * 4;
      const alpha = pixels[byte + 3];
      alphaMin = Math.min(alphaMin, alpha);
      alphaMax = Math.max(alphaMax, alpha);
      if (alpha === 0) transparentPixels += 1;
      else nonTransparentPixels += 1;
      if (alpha > 0 && alpha < 255) partialAlphaPixels += 1;

      if (alpha > 16) {
        contentRed += pixels[byte];
        contentGreen += pixels[byte + 1];
        contentBlue += pixels[byte + 2];
        contentCount += 1;
        const x = pixel % canvas.width;
        const y = Math.floor(pixel / canvas.width);
        if (x >= centerLeft && x < centerRight && y >= centerTop && y < centerBottom) {
          centerContentPixels += 1;
        }
      }

      // Hash decoded pixels, not encoded bytes. This is diagnostic only, never a golden.
      for (let channel = 0; channel < 4; channel += 1) {
        hash ^= pixels[byte + channel];
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
    }

    const cornerAlphas = [
      pixels[3],
      pixels[(canvas.width - 1) * 4 + 3],
      pixels[((canvas.height - 1) * canvas.width) * 4 + 3],
      pixels[(pixelCount - 1) * 4 + 3],
    ];

    return {
      width: canvas.width,
      height: canvas.height,
      pixelCount,
      alphaMin,
      alphaMax,
      transparentPixels,
      nonTransparentPixels,
      partialAlphaPixels,
      transparentRatio: transparentPixels / pixelCount,
      nonTransparentRatio: nonTransparentPixels / pixelCount,
      centerContentPixels,
      cornerAlphas,
      meanContentRgb: contentCount > 0
        ? [contentRed / contentCount, contentGreen / contentCount, contentBlue / contentCount]
        : [0, 0, 0],
      decodedPixelHash: hash.toString(16).padStart(8, '0'),
    };
  }, { dataBase64: asset.dataBase64, mimeType: asset.mimeType });
}

function verifyAlphaPolicy(label, analysis, alphaPolicy) {
  if (alphaPolicy === 'opaque') {
    check(
      `${label}: decoded output is fully opaque`,
      analysis.alphaMin === 255 && analysis.alphaMax === 255,
      `alpha=${analysis.alphaMin}..${analysis.alphaMax}`,
    );
    return;
  }

  if (alphaPolicy === 'transparent') {
    const enoughBackground = analysis.transparentPixels >= Math.max(64, analysis.pixelCount * 0.01);
    const enoughContent = analysis.nonTransparentPixels >= Math.max(64, analysis.pixelCount * 0.001);
    check(
      `${label}: transparent background has meaningful zero-alpha area`,
      enoughBackground && analysis.cornerAlphas.some((alpha) => alpha === 0),
      `transparent=${(analysis.transparentRatio * 100).toFixed(1)}% corners=${analysis.cornerAlphas.join(',')}`,
    );
    check(
      `${label}: molecule contributes nontransparent pixels`,
      enoughContent && analysis.alphaMax > 0 && analysis.centerContentPixels > 0,
      `content=${(analysis.nonTransparentRatio * 100).toFixed(1)}% center=${analysis.centerContentPixels} alphaMax=${analysis.alphaMax}`,
    );
  }
}

async function compareRasterAppearance(page, label, first, second, thresholds = {}) {
  if (!first?.asset || !second?.asset) {
    check(label, false, 'one or both comparison assets are missing');
    return null;
  }

  const comparison = await page.evaluate(async ({ firstAsset, secondAsset }) => {
    async function decode(asset) {
      const binary = atob(asset.dataBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: asset.mimeType }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Could not create comparison canvas');
      context.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }

    const a = await decode(firstAsset);
    const b = await decode(secondAsset);
    if (a.width !== b.width || a.height !== b.height) {
      return { sameDimensions: false, first: `${a.width}x${a.height}`, second: `${b.width}x${b.height}` };
    }

    let comparedPixels = 0;
    let differingPixels = 0;
    let absoluteRgbDelta = 0;
    for (let byte = 0; byte < a.data.length; byte += 4) {
      if (Math.max(a.data[byte + 3], b.data[byte + 3]) <= 16) continue;
      const delta = (
        Math.abs(a.data[byte] - b.data[byte])
        + Math.abs(a.data[byte + 1] - b.data[byte + 1])
        + Math.abs(a.data[byte + 2] - b.data[byte + 2])
      ) / 3;
      absoluteRgbDelta += delta;
      comparedPixels += 1;
      if (delta >= 8) differingPixels += 1;
    }

    return {
      sameDimensions: true,
      comparedPixels,
      meanAbsoluteRgbDelta: comparedPixels > 0 ? absoluteRgbDelta / comparedPixels : 0,
      differingPixelRatio: comparedPixels > 0 ? differingPixels / comparedPixels : 0,
    };
  }, { firstAsset: first.asset, secondAsset: second.asset });

  const minimumMeanDelta = thresholds.minimumMeanDelta ?? 3;
  const minimumDifferingRatio = thresholds.minimumDifferingRatio ?? 0.05;
  const ok = comparison.sameDimensions
    && comparison.comparedPixels > 0
    && comparison.meanAbsoluteRgbDelta >= minimumMeanDelta
    && comparison.differingPixelRatio >= minimumDifferingRatio;
  check(
    label,
    ok,
    comparison.sameDimensions
      ? `meanRGBΔ=${comparison.meanAbsoluteRgbDelta.toFixed(2)} differing=${(comparison.differingPixelRatio * 100).toFixed(1)}%`
      : `${comparison.first} vs ${comparison.second}`,
  );
  return comparison;
}

async function executeToolAndSettle(page, label, tool, toolArguments) {
  const response = await page.evaluate(async ({ tool, toolArguments }) => {
    const driver = window.__lupiViewerMcp;
    if (!driver?.ready) throw new Error('MCP driver is not ready');
    const result = await driver.execute({
      id: `verify-${tool}-${Date.now()}`,
      tool,
      arguments: toolArguments,
    });
    await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    return result;
  }, { tool, toolArguments });
  check(label, response.ok, response.ok ? tool : response.error?.message ?? 'unknown error');
  return response;
}

async function expectAssetRejection(page, label, request, messagePattern) {
  const response = await page.evaluate(async (req) => {
    const driver = window.__lupiViewerMcp;
    if (!driver?.ready) throw new Error('MCP driver is not ready');
    return driver.execute(req);
  }, request);
  const message = response.error?.message ?? '';
  check(
    label,
    response.ok === false && messagePattern.test(message),
    response.ok ? 'unexpectedly returned an artifact' : message || 'missing rejection message',
  );
  return response;
}

async function runAssetFlow(page, label, request, options = {}) {
  const response = await page.evaluate(async (req) => {
    const driver = window.__lupiViewerMcp;
    if (!driver?.ready) throw new Error('MCP driver is not ready');
    return driver.execute(req);
  }, request);

  if (!response.ok) {
    if (request.arguments?.format === 'usdz') {
      report.usdzCapability = {
        supported: false,
        error: response.error?.message ?? 'unknown error',
        enableAfterProof: "Set BROWSER_RENDER_CAPABILITY_V1.formats.usdz to { enabled: true, alphaModes: ['not-applicable'] } in packages/ui/src/mcp/renderArtifactAdapter.ts.",
        otherwiseNarrowManifest: "Remove usdz from both format/type enums in packages/ui/src/mcp/schemas.ts and remove USDZ claims from packages/ui/src/mcp/toolManifest.ts and packages/ui/src/mcp/tools.ts descriptions.",
      };
    }
    check(`${label}: bridge returns ok=true`, false, response.error?.message ?? 'unknown error');
    return { error: response.error };
  }
  check(`${label}: bridge returns ok=true`, true, `tool=${response.tool}`);

  const asset = response.result?.asset;
  if (!asset) {
    check(`${label}: response carries result.asset`, false, 'no asset payload');
    return null;
  }

  const requestedFormat = request.arguments?.format === 'jpg' ? 'jpeg' : request.arguments?.format;
  const expectedFormat = options.expectedFormat ?? requestedFormat;
  check(
    `${label}: returned format matches request`,
    asset.format === expectedFormat,
    `requested=${expectedFormat} returned=${asset.format}`,
  );

  const buffer = decodeBase64(asset.dataBase64);
  const filePath = join(ARTIFACTS, `${label}.${asset.format === 'jpeg' ? 'jpg' : asset.format}`);
  writeFileSync(filePath, buffer);

  const stats = statSync(filePath);
  check(`${label}: ${asset.format.toUpperCase()} file written (${stats.size} bytes)`, stats.size > 0);
  check(
    `${label}: declared byteLength matches disk size`,
    stats.size === asset.byteLength,
    `declared=${asset.byteLength} disk=${stats.size}`,
  );
  check(
    `${label}: MIME matches ${asset.format} contract`,
    asset.mimeType === expectedMimeType(asset.format),
    asset.mimeType,
  );
  check(`${label}: filename is non-empty`, typeof asset.filename === 'string' && asset.filename.length > 0, asset.filename);
  check(
    `${label}: base64 round-trip preserves exact bytes`,
    Buffer.from(buffer.toString('base64'), 'base64').equals(buffer),
    `hash=${shortHash(buffer)}`,
  );

  const expectedWidth = options.targetWidth ?? request.arguments?.width;
  const expectedHeight = options.targetHeight ?? request.arguments?.height;
  let rasterAnalysis = null;

  if (asset.format === 'png') {
    const sanity = pngSanity(buffer);
    const dims = sanity.dimensions;
    check(
      `${label}: exact PNG signature and IHDR are valid`,
      sanity.ok,
      `signature=${sanity.signatureOk} ihdr=${sanity.ihdrOk}`,
    );
    check(
      `${label}: PNG header dimensions match exact request`,
      dims
        && dims.width === expectedWidth
        && dims.height === expectedHeight
        && asset.width === expectedWidth
        && asset.height === expectedHeight,
      dims ? `${dims.width}x${dims.height}` : 'no header',
    );
  } else if (asset.format === 'jpeg') {
    const sanity = jpegSanity(buffer);
    const dims = sanity.dimensions;
    check(
      `${label}: JPEG SOI, EOI, and SOF are valid`,
      sanity.ok,
      `soi=${sanity.soiOk} eoi=${sanity.eoiOk}`,
    );
    check(
      `${label}: JPEG decoded dimensions match exact request`,
      dims
        && dims.width === expectedWidth
        && dims.height === expectedHeight
        && asset.width === expectedWidth
        && asset.height === expectedHeight,
      dims ? `${dims.width}x${dims.height}` : 'no header',
    );
  } else if (asset.format === 'webp') {
    const sanity = webpSanity(buffer);
    const dims = sanity.dimensions;
    check(
      `${label}: WebP RIFF signature and declared length are valid`,
      sanity.ok,
      `declared=${sanity.declaredLength} disk=${buffer.length}`,
    );
    check(
      `${label}: WebP decoded dimensions match exact request`,
      dims
        && dims.width === expectedWidth
        && dims.height === expectedHeight
        && asset.width === expectedWidth
        && asset.height === expectedHeight,
      dims ? `${dims.width}x${dims.height}` : 'no header',
    );
  } else if (asset.format === 'glb') {
    const sanity = glbSanity(buffer);
    check(
      `${label}: GLB header is well-formed`,
      sanity.ok,
      sanity.ok ? `version=${sanity.version} length=${sanity.length}` : sanity.reason,
    );
  } else if (asset.format === 'usdz') {
    const sanity = usdzSanity(buffer);
    check(
      `${label}: USDZ is a stored, 64-byte-aligned ZIP with model.usda first`,
      Boolean(sanity.names) && sanity.allStored && sanity.allAligned && sanity.names?.[0] === 'model.usda',
      sanity.reason ?? `entries=${sanity.names?.length ?? 0} stored=${sanity.allStored} aligned=${sanity.allAligned}`,
    );
    check(
      `${label}: USDZ contains a valid root USDA and referenced mesh geometry`,
      sanity.headerOk && sanity.geometryOk && sanity.referencesOk,
      sanity.reason ?? `geometries=${sanity.geometryCount ?? 0} missing=${sanity.missingGeometry?.join(',') || 'none'}`,
    );
    check(
      `${label}: USDZ material bindings resolve to UsdPreviewSurface materials`,
      sanity.materialOk,
      sanity.reason ?? `materials=${sanity.materialCount ?? 0} missing=${sanity.missingMaterials?.join(',') || 'none'}`,
    );
    report.usdzCapability = {
      supported: sanity.ok,
      entryCount: sanity.names?.length ?? 0,
      geometryCount: sanity.geometryCount ?? 0,
      materialCount: sanity.materialCount ?? 0,
    };
  }

  if (asset.format === 'png' || asset.format === 'jpeg' || asset.format === 'webp') {
    rasterAnalysis = await analyzeRaster(page, asset);
    check(
      `${label}: browser decoder returns exact requested dimensions`,
      rasterAnalysis.width === expectedWidth && rasterAnalysis.height === expectedHeight,
      `${rasterAnalysis.width}x${rasterAnalysis.height}`,
    );
    verifyAlphaPolicy(label, rasterAnalysis, options.alphaPolicy);
  }

  if (asset.dataUrl) {
    const expectedPrefix = `data:${asset.mimeType};base64,`;
    check(
      `${label}: dataUrl prefix matches mimeType`,
      asset.dataUrl.startsWith(expectedPrefix),
      asset.dataUrl.slice(0, 32) + '…',
    );
    const encodedPayload = asset.dataUrl.slice(expectedPrefix.length);
    check(
      `${label}: dataUrl payload is byte-identical to dataBase64`,
      encodedPayload === asset.dataBase64 && decodeBase64(encodedPayload).equals(buffer),
    );
  }

  return { asset, filePath, buffer, hash: shortHash(buffer), rasterAnalysis };
}

function assertSameArtifactIdentity(label, first, second) {
  if (!first?.asset || !second?.asset) {
    check(`${label}: both exports returned artifacts`, false, 'one or both artifacts are missing');
    return;
  }

  const identityFields = [
    'contractVersion',
    'sourceContentDigest',
    'specId',
    'rendererFingerprint',
    'artifactKey',
  ];
  const differingIdentityFields = identityFields.filter(
    (field) => first.asset[field] !== second.asset[field],
  );
  check(
    `${label}: equivalent requests resolve to one artifact identity`,
    differingIdentityFields.length === 0,
    differingIdentityFields.length === 0
      ? `artifactKey=${first.asset.artifactKey}`
      : `differing=${differingIdentityFields.join(',')}`,
  );

  const exactBytesMatch = first.buffer.equals(second.buffer);
  check(
    `${label}: one artifact identity produces byte-identical output`,
    exactBytesMatch && first.asset.artifactDigest === second.asset.artifactDigest,
    `first=${first.asset.artifactDigest}/${first.buffer.length}B second=${second.asset.artifactDigest}/${second.buffer.length}B`,
  );

  report.repeatArtifactIdentity = {
    identityFields: Object.fromEntries(identityFields.map((field) => [field, first.asset[field]])),
    first: {
      artifactDigest: first.asset.artifactDigest,
      byteLength: first.buffer.length,
      decodedPixelHash: first.rasterAnalysis?.decodedPixelHash ?? null,
    },
    second: {
      artifactDigest: second.asset.artifactDigest,
      byteLength: second.buffer.length,
      decodedPixelHash: second.rasterAnalysis?.decodedPixelHash ?? null,
    },
    exactBytesMatch,
  };
}

async function loadTemplate(page, template) {
  return page.evaluate(async (tpl) => {
    const driver = window.__lupiViewerMcp;
    return driver.execute({
      id: `load-${tpl.toLowerCase()}`,
      tool: 'lupi.generate_molecule',
      arguments: {
        inputType: 'template',
        input: tpl,
        viewer: { showBonds: true, atomScale: 1.0, cameraPreset: 'iso' },
      },
    });
  }, template);
}

async function buildProceduralLattice(page, atomCount, element, lattice) {
  return page.evaluate(
    async ({ atomCount, element, lattice }) => {
      const driver = window.__lupiViewerMcp;
      return driver.execute({
        id: `load-${element}-${lattice}-${atomCount}`,
        tool: 'lupi.generate_molecule',
        arguments: {
          inputType: 'procedural',
          input: 'validation lattice',
          atomCount,
          element,
          lattice,
          viewer: { showBonds: false, atomScale: 0.32, showCell: true, showAxes: true, cameraPreset: 'iso' },
        },
      });
    },
    { atomCount, element, lattice },
  );
}

try {
  const externalUrl = process.env.VERIFY_URL || args.url;
  const baseUrl = withTrailingSlash(externalUrl || await startPortlessVite());
  report.url = `${baseUrl}#/mcp`;
  log(`target: ${report.url}`);

  browser = await chromium.launch({
    headless: !process.stdout.isTTY ? true : args.headless !== 'false',
    args: ['--disable-webgpu', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  page.on('pageerror', (err) => {
    report.pageErrors ??= [];
    report.pageErrors.push(err.message);
    log(`[PAGE ERROR] ${err.message}`);
  });

  await page.goto(report.url, { waitUntil: 'domcontentloaded' });
  log('DOM loaded; waiting for MCP driver...');
  await page.waitForFunction(() => window.__lupiViewerMcp?.ready === true, null, { timeout: 60_000 });
  check('MCP driver ready', true);

  const status = await page.evaluate(() => window.__lupiViewerMcp.status());
  report.driverStatus = status;
  log(`driver status: toolCount=${status.toolCount} version=${status.version}`);

  // Caffeine ----------------------------------------------------
  const caffeine = await loadTemplate(page, 'Caffeine');
  if (caffeine.ok) {
    check('Caffeine template loads', true, `atoms=${caffeine.result?.molecule?.atomCount}`);

    await executeToolAndSettle(page, 'Caffeine uses deterministic slate background', 'lupi.set_background', {
      preset: 'slate',
    });
    await executeToolAndSettle(page, 'Caffeine uses element color scheme', 'lupi.set_viewer', {
      colorScheme: 'element',
      showBonds: false,
    });
    await executeToolAndSettle(page, 'Caffeine baseline material is matte', 'lupi.set_material', {
      preset: 'matte',
      intensity: 0.7,
      texture: 'none',
    });
    await executeToolAndSettle(page, 'Caffeine baseline lighting applied', 'lupi.set_lighting', {
      ambient: 0.7,
      dir: 1.0,
      rim: 0.25,
      keyAzimuth: 35,
      keyElevation: 45,
    });

    const opaqueElement = await runAssetFlow(page, 'caffeine-png-opaque-256', {
      id: 'caffeine-png-opaque-256',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 256, height: 256, transparent: false },
    }, { targetWidth: 256, targetHeight: 256, alphaPolicy: 'opaque' });
    const elementTransparent = await runAssetFlow(page, 'caffeine-png-transparent-element', {
      id: 'caffeine-png-transparent-element',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 256, height: 256, transparent: true },
    }, { targetWidth: 256, targetHeight: 256, alphaPolicy: 'transparent' });
    const opaqueElementRepeat = await runAssetFlow(page, 'caffeine-png-opaque-256-repeat', {
      id: 'caffeine-png-opaque-256-repeat',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 256, height: 256, transparent: false },
    }, { targetWidth: 256, targetHeight: 256, alphaPolicy: 'opaque' });
    assertSameArtifactIdentity(
      'caffeine opaque PNG determinism',
      opaqueElement,
      opaqueElementRepeat,
    );
    await runAssetFlow(page, 'caffeine-png-1024', {
      id: 'caffeine-png-1024',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 1024, height: 1024, transparent: false },
    }, { targetWidth: 1024, targetHeight: 1024, alphaPolicy: 'opaque' });
    await runAssetFlow(page, 'caffeine-jpeg-opaque', {
      id: 'caffeine-jpeg-opaque',
      tool: 'lupi.export_asset',
      arguments: { format: 'jpeg', width: 800, height: 600, transparent: false },
    }, { targetWidth: 800, targetHeight: 600, alphaPolicy: 'opaque' });
    await expectAssetRejection(page, 'caffeine: transparent JPEG is rejected before capture', {
      id: 'caffeine-jpeg-transparent-rejected',
      tool: 'lupi.export_asset',
      arguments: { format: 'jpeg', width: 256, height: 256, transparent: true, timeoutMs: 1000 },
    }, /JPEG export does not support transparent output/i);
    await runAssetFlow(page, 'caffeine-webp-opaque', {
      id: 'caffeine-webp-opaque',
      tool: 'lupi.export_asset',
      arguments: { format: 'webp', width: 600, height: 600, transparent: false },
    }, { targetWidth: 600, targetHeight: 600, alphaPolicy: 'opaque' });
    await runAssetFlow(page, 'caffeine-webp-transparent', {
      id: 'caffeine-webp-transparent',
      tool: 'lupi.export_asset',
      arguments: { format: 'webp', width: 600, height: 600, transparent: true },
    }, { targetWidth: 600, targetHeight: 600, alphaPolicy: 'transparent' });

    if (!skipGlb) {
      await runAssetFlow(page, 'caffeine-glb', {
        id: 'caffeine-glb',
        tool: 'lupi.export_asset',
        arguments: { format: 'glb' },
      });
    }
    if (!skipUsdz) {
      const rejection = await expectAssetRejection(page, 'caffeine-usdz: immutable lane fails closed', {
        id: 'caffeine-usdz',
        tool: 'lupi.export_asset',
        arguments: { format: 'usdz' },
      }, /USDZ remains available only as a non-addressed interactive export|unsupported/i);
      report.usdzCapability = {
        supported: false,
        deterministicArtifactLane: false,
        error: rejection.error?.message ?? 'USDZ rejected as required',
        reason: 'Three r184 USDZExporter embeds process-global allocation identifiers',
      };
    }

    await executeToolAndSettle(page, 'Caffeine switches to uniform color scheme', 'lupi.set_viewer', {
      colorScheme: 'uniform',
    });
    const uniformTransparent = await runAssetFlow(page, 'caffeine-png-transparent-uniform', {
      id: 'caffeine-png-transparent-uniform',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 256, height: 256, transparent: true },
    }, { targetWidth: 256, targetHeight: 256, alphaPolicy: 'transparent' });
    await compareRasterAppearance(
      page,
      'element and uniform color schemes produce materially different pixels',
      elementTransparent,
      uniformTransparent,
      { minimumMeanDelta: 5, minimumDifferingRatio: 0.1 },
    );

    await executeToolAndSettle(page, 'Caffeine switches to metallic material', 'lupi.set_material', {
      preset: 'metallic',
      intensity: 1.8,
      texture: 'none',
    });
    await executeToolAndSettle(page, 'Caffeine switches to dramatic lighting', 'lupi.set_lighting', {
      ambient: 0.05,
      dir: 2.0,
      rim: 1.5,
      keyAzimuth: 120,
      keyElevation: 18,
      rimAzimuth: -70,
      rimElevation: 35,
    });
    const metallicTransparent = await runAssetFlow(page, 'caffeine-png-transparent-metallic-lit', {
      id: 'caffeine-png-transparent-metallic-lit',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 256, height: 256, transparent: true },
    }, { targetWidth: 256, targetHeight: 256, alphaPolicy: 'transparent' });
    await compareRasterAppearance(
      page,
      'material and lighting change produces materially different pixels',
      uniformTransparent,
      metallicTransparent,
      { minimumMeanDelta: 2, minimumDifferingRatio: 0.05 },
    );
  } else {
    check('Caffeine template loads', false, caffeine.error?.message ?? 'unknown error');
  }

  // Aspirin ------------------------------------------------------
  const aspirin = await loadTemplate(page, 'Aspirin');
  if (aspirin.ok) {
    check('Aspirin template loads', true, `atoms=${aspirin.result?.molecule?.atomCount}`);
    await executeToolAndSettle(page, 'Aspirin hides unsnapshotted live bonds', 'lupi.set_viewer', {
      showBonds: false,
    });
    await runAssetFlow(page, 'aspirin-png', {
      id: 'aspirin-png',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 800, height: 800, transparent: false },
    }, { targetWidth: 800, targetHeight: 800, alphaPolicy: 'opaque' });
  } else {
    // Aspirin isn't in the local TEMPLATE_MOLECULES list; that is a known
    // limitation, but we want to know. Surface the error rather than mask it.
    log(`Aspirin template unavailable: ${aspirin.error?.message ?? 'unknown error'}`);
  }

  // Procedural FCC copper lattice --------------------------------
  const lattice = await buildProceduralLattice(page, 5000, 'Cu', 'fcc');
  if (lattice.ok) {
    check('FCC Cu lattice loads', true, `atoms=${lattice.result?.molecule?.atomCount}`);
    await executeToolAndSettle(page, 'FCC Cu hides unsnapshotted live bonds', 'lupi.set_viewer', {
      showBonds: false,
    });
    await runAssetFlow(page, 'cu-fcc-png', {
      id: 'cu-fcc-png',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 768, height: 768, transparent: false },
    }, { targetWidth: 768, targetHeight: 768, alphaPolicy: 'opaque' });
    if (!skipGlb) {
      await runAssetFlow(page, 'cu-fcc-glb', {
        id: 'cu-fcc-glb',
        tool: 'lupi.export_asset',
        arguments: { format: 'glb' },
      });
    }
  } else {
    check('FCC Cu lattice loads', false, lattice.error?.message ?? 'unknown error');
  }

  // Viewer screenshot (raw DOM) so a human can sanity-check the live frame
  // the assets are taken from.
  const screenshotPath = join(ARTIFACTS, 'viewer-screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  check('viewer screenshot captured', existsSync(screenshotPath));
} catch (err) {
  log(`EXCEPTION ${err?.message ?? String(err)}`);
  report.exception = err?.message ?? String(err);
  check('verifier completes without an exception', false, report.exception);
} finally {
  if (browser && !args['keep-server']) await browser.close().catch(() => {});
  if (server && !args['keep-server']) await server.close().catch(() => {});
}

const reportPath = join(ARTIFACTS, 'report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
log(`report: ${reportPath}`);
log(`artifacts: ${ARTIFACTS}`);

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  log(`${failed.length} check(s) failed`);
  for (const f of failed) log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
log('all checks passed');

async function startPortlessVite() {
  const port = await getFreePort();
  server = await createServer({
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
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP address');
  return `http://127.0.0.1:${address.port}/`;
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (!address || typeof address === 'string') reject(new Error('No TCP port allocated'));
        else resolvePort(address.port);
      });
    });
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, raw] = arg.slice(2).split('=');
    parsed[key] = raw === undefined ? true : raw;
  }
  return parsed;
}

function withTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}
