import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const expoCli = fileURLToPath(
  new URL("../node_modules/expo/bin/cli", import.meta.url),
);
const child = spawn(
  process.execPath,
  [expoCli, "start", "--dev-client", ...process.argv.slice(2)],
  {
    env: {
      ...process.env,
      APP_VARIANT: "development",
      EXPO_PUBLIC_VISUAL_QA: "1",
      EXPO_UNSTABLE_MCP_SERVER: "1",
    },
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(`[expo-mcp] Could not start Expo CLI: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[expo-mcp] Expo CLI stopped after signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
