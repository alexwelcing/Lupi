import type { ConfigContext, ExpoConfig } from "expo/config";

export const PRODUCTION_APP_ID = "live.lupi.app";
export const DEVELOPMENT_APP_ID = "live.lupi.app.dev";

export type LupiAppVariant = "development" | "production";

export interface LupiAppIdentity {
  androidPackage: string;
  iosBundleIdentifier: string;
  name: string;
  scheme: string;
  variant: LupiAppVariant;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const identity = resolveLupiAppIdentity(process.env.APP_VARIANT);
  const release = compact({
    appVariant: identity.variant,
    buildProfile: process.env.EAS_BUILD_PROFILE,
    easBuildId: process.env.EAS_BUILD_ID,
    gitCommit:
      process.env.EAS_BUILD_GIT_COMMIT_HASH ?? process.env.EXPO_PUBLIC_GIT_SHA,
  });

  return {
    ...config,
    name: identity.name,
    slug: config.slug ?? "lupi",
    scheme: identity.scheme,
    android: {
      ...config.android,
      package: identity.androidPackage,
    },
    ios: {
      ...config.ios,
      bundleIdentifier: identity.iosBundleIdentifier,
    },
    extra: {
      ...config.extra,
      release,
      visualQaEnabled: process.env.EXPO_PUBLIC_VISUAL_QA === "1",
    },
  };
};

export function resolveLupiAppIdentity(
  value: string | undefined,
): LupiAppIdentity {
  const variant = resolveVariant(value);
  if (variant === "development") {
    return {
      androidPackage: DEVELOPMENT_APP_ID,
      iosBundleIdentifier: DEVELOPMENT_APP_ID,
      name: "Lupi Dev",
      scheme: "lupi-dev",
      variant,
    };
  }

  return {
    androidPackage: PRODUCTION_APP_ID,
    iosBundleIdentifier: PRODUCTION_APP_ID,
    name: "Lupi",
    scheme: "lupi",
    variant,
  };
}

function resolveVariant(value: string | undefined): LupiAppVariant {
  const normalized = value?.trim();
  if (!normalized || normalized === "production") return "production";
  if (normalized === "development") return "development";
  throw new Error(
    `Unsupported APP_VARIANT "${normalized}". Expected development or production.`,
  );
}

function compact(
  values: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] =>
      Boolean(entry[1]?.trim()),
    ),
  );
}
