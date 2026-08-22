import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const lockfile = readFileSync(resolve("pnpm-lock.yaml"), "utf8").replaceAll(
  "\r\n",
  "\n",
);
const packages = section("packages", "snapshots");
const snapshots = section("snapshots");

const prebuildInstaller = entry(packages, "prebuild-install@7.1.3");
const canvasSnapshot = entry(snapshots, "canvas@3.2.3");

assert(
  prebuildInstaller.includes("\n    hasBin: true\n"),
  "prebuild-install@7.1.3 must retain hasBin: true in pnpm-lock.yaml",
);
assert(
  canvasSnapshot.includes("\n      prebuild-install: 7.1.3\n"),
  "canvas@3.2.3 must retain its prebuild-install@7.1.3 dependency",
);

console.log(
  "[ok] pnpm lock preserves canvas's prebuilt-binary installer executable",
);

function section(name, nextName) {
  const startMarker = `${name}:\n`;
  const start = lockfile.indexOf(startMarker);
  if (start < 0) fail(`pnpm-lock.yaml has no ${name} section`);
  const end = nextName
    ? lockfile.indexOf(`\n${nextName}:\n`, start + startMarker.length)
    : lockfile.length;
  if (end < 0) fail(`pnpm-lock.yaml has no ${nextName} section`);
  return lockfile.slice(start, end);
}

function entry(sectionText, key) {
  const marker = `\n  ${key}:\n`;
  const start = sectionText.indexOf(marker);
  if (start < 0) fail(`pnpm-lock.yaml has no ${key} entry`);
  const remainder = sectionText.slice(start + marker.length);
  const nextEntry = /\n  \S[^\n]*:\n/u.exec(remainder)?.index;
  return sectionText.slice(
    start,
    nextEntry === undefined
      ? sectionText.length
      : start + marker.length + nextEntry,
  );
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(`[fail] ${message}`);
  process.exit(1);
}
