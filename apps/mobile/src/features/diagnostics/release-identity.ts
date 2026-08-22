export interface ReleaseMetadata {
  buildProfile?: string;
  easBuildId?: string;
  gitCommit?: string;
}

export interface RemoteHealthIdentity {
  name: string;
  version: string;
  toolCount?: number;
  releaseId?: string;
  releaseTag?: string;
  releaseTimestamp?: string;
}

export interface DiagnosticRow {
  label: string;
  value: string;
}

export interface RuntimeUpdateIdentity {
  channel: string | null;
  createdAt: Date | null;
  isEmbeddedLaunch: boolean;
  isEnabled: boolean;
  runtimeVersion: string | null;
  updateId: string | null;
}

export function readReleaseMetadata(extra: unknown): ReleaseMetadata {
  if (!isRecord(extra) || !isRecord(extra.release)) return {};
  const metadata: ReleaseMetadata = {};
  const buildProfile = optionalString(extra.release.buildProfile);
  const easBuildId = optionalString(extra.release.easBuildId);
  const gitCommit = optionalString(extra.release.gitCommit);
  if (buildProfile) metadata.buildProfile = buildProfile;
  if (easBuildId) metadata.easBuildId = easBuildId;
  if (gitCommit) metadata.gitCommit = gitCommit;
  return metadata;
}

export function readProjectId(extra: unknown): string | undefined {
  if (!isRecord(extra) || !isRecord(extra.eas)) return undefined;
  return optionalString(extra.eas.projectId);
}

export function parseRemoteHealthIdentity(
  value: unknown,
): RemoteHealthIdentity | null {
  if (!isRecord(value) || value.ready !== true) return null;
  const name = optionalString(value.name);
  const version = optionalString(value.version);
  if (!name || !version) return null;
  const release = isRecord(value.release) ? value.release : undefined;
  return {
    name,
    version,
    toolCount:
      typeof value.toolCount === "number" && Number.isFinite(value.toolCount)
        ? value.toolCount
        : undefined,
    releaseId: optionalString(release?.id),
    releaseTag: optionalString(release?.tag),
    releaseTimestamp: optionalString(release?.timestamp),
  };
}

export function diagnosticReport(rows: DiagnosticRow[]): string {
  return [
    "Lupi iPhone diagnostics",
    ...rows.map((row) => `${row.label}: ${row.value}`),
  ].join("\n");
}

export function runtimeUpdateDiagnosticRows(
  identity: RuntimeUpdateIdentity,
): DiagnosticRow[] {
  const channel = optionalString(identity.channel);
  const runtimeVersion = optionalString(identity.runtimeVersion);
  const updateId = optionalString(identity.updateId);
  const createdAt =
    identity.createdAt instanceof Date &&
    Number.isFinite(identity.createdAt.getTime())
      ? identity.createdAt.toISOString()
      : "unavailable";

  return [
    {
      label: "Update runtime",
      value: runtimeVersion ?? "unavailable",
    },
    {
      label: "Update source",
      value: !identity.isEnabled
        ? "disabled / local runtime"
        : updateId
          ? "downloaded update"
          : identity.isEmbeddedLaunch
            ? "embedded bundle"
            : "unavailable",
    },
    {
      label: "Update ID",
      value: updateId ?? "unavailable",
    },
    {
      label: "Update channel",
      value: channel ?? "unavailable (development or unbound)",
    },
    { label: "Update created", value: createdAt },
  ];
}

export function softWrapDiagnosticValue(value: string): string {
  return value.replace(/([^\s]{12})/g, "$1\u200B");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
