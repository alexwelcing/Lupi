import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const packageJson = JSON.parse(
  readFileSync(resolve(appDirectory, "package.json"), "utf8"),
);
const expoPackageJsonPath = require.resolve("expo/package.json");
const expoDirectory = dirname(expoPackageJsonPath);
const expoRequire = createRequire(expoPackageJsonPath);
const expoCliDirectory = dirname(expoRequire.resolve("@expo/cli/package.json"));
const bundledNativeModules = JSON.parse(
  readFileSync(resolve(expoDirectory, "bundledNativeModules.json"), "utf8"),
);
const { resolveAllPackageVersionsAsync } = require(
  resolve(
    expoCliDirectory,
    "build/src/start/doctor/dependencies/resolvePackages.js",
  ),
);
const { isDependencyVersionIncorrect } = require(
  resolve(
    expoCliDirectory,
    "build/src/start/doctor/dependencies/validateDependenciesVersions.js",
  ),
);

const declaredDependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};
const packagesToCheck = Object.keys(declaredDependencies).filter(
  (name) => name in bundledNativeModules,
);
const installedVersions = await resolveAllPackageVersionsAsync(
  appDirectory,
  packagesToCheck,
);
const testOverride = process.env.LUPI_EXPO_DEPENDENCY_TEST_OVERRIDE;
if (testOverride) {
  const separator = testOverride.lastIndexOf("@");
  const name = testOverride.slice(0, separator);
  const version = testOverride.slice(separator + 1);
  if (!name || !version || !(name in installedVersions)) {
    throw new Error("Invalid LUPI_EXPO_DEPENDENCY_TEST_OVERRIDE");
  }
  installedVersions[name] = version;
}
const incorrectDependencies = packagesToCheck.flatMap((name) => {
  const actualVersion = installedVersions[name];
  const expectedVersionOrRange = bundledNativeModules[name];

  return isDependencyVersionIncorrect(
    name,
    actualVersion,
    expectedVersionOrRange,
  )
    ? [{ name, actualVersion, expectedVersionOrRange }]
    : [];
});

if (incorrectDependencies.length > 0) {
  console.error(
    "Installed packages do not match expo/bundledNativeModules.json:",
  );
  for (const dependency of incorrectDependencies) {
    console.error(
      `  ${dependency.name}@${dependency.actualVersion} - expected ${dependency.expectedVersionOrRange}`,
    );
  }
  process.exit(1);
}

console.log(
  `Expo dependency compatibility passed (${packagesToCheck.length} installed SDK packages).`,
);
