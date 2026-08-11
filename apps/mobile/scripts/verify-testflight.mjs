import { spawnSync } from "node:child_process";

const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const steps = [
  ["Source configuration and assets", ["check:testflight"]],
  ["Resolved production Expo config", ["check:resolved-expo-config"]],
  ["Resolved Expo config policy tests", ["test:resolved-expo-config"]],
  ["Focused unit tests", ["test"]],
  ["TypeScript", ["typecheck"]],
  ["ESLint", ["lint"]],
  ["Expo dependency compatibility", ["check:expo"]],
  ["Expo visual workflow contract", ["check:visual-workflow:local"]],
  ["Expo web fallback export", ["export:web"]],
  ["Unsigned iOS bundle export", ["export:ios"]],
];

for (const [label, args] of steps) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(
  "\nLocal TestFlight verification passed. This does not prove EAS, Apple signing, upload, or iPhone behavior.",
);
