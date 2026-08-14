import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(mobileRoot, "src");
const testFiles = (await discoverTests(sourceRoot))
  .map((path) => relative(mobileRoot, path))
  .sort((left, right) => left.localeCompare(right, "en"));

if (testFiles.length === 0) {
  throw new Error("No mobile unit tests were discovered under src/.");
}

console.log(`[mobile tests] discovered ${testFiles.length} files`);
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "--test-concurrency=1", ...testFiles],
  { cwd: mobileRoot, stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

async function discoverTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return discoverTests(path);
      return entry.isFile() && /\.test\.tsx?$/.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}
