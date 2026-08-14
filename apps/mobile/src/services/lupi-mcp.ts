import { getLupiMcpUrl } from "@/src/config/lupi";
import {
  normalizeMoleculeSummary,
  STARTER_MOLECULES,
  type MoleculeSummary,
} from "@/src/domain/molecules";

interface McpTextContent {
  type: "text";
  text: string;
}

interface McpSearchPayload {
  query: string;
  returned: number;
  molecules: MoleculeSummary[];
}

interface McpResponse {
  result?: {
    content?: McpTextContent[];
    structuredContent?: unknown;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

export async function searchMolecules(
  query: string,
  limit = 20,
): Promise<MoleculeSummary[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(getLupiMcpUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `mobile-search-${Date.now()}`,
        method: "tools/call",
        params: {
          name: "lupi.search_molecules",
          arguments: { query, limit },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok)
      throw new Error(`Lupi search returned HTTP ${response.status}.`);
    const body = (await response.json()) as McpResponse;
    if (body.error)
      throw new Error(body.error.message || "Lupi search failed.");

    const payload =
      parseMoleculeSearchPayload(body.result?.structuredContent) ??
      readSearchPayloadFromText(body.result?.content);
    if (!payload)
      throw new Error("Lupi search returned an unexpected response.");
    return payload.molecules;
  } finally {
    clearTimeout(timeout);
  }
}

export function localMoleculeSearch(query: string): MoleculeSummary[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return STARTER_MOLECULES;
  return STARTER_MOLECULES.filter((molecule) =>
    [molecule.name, molecule.formula, ...molecule.tags].some((value) =>
      value.toLowerCase().includes(normalized),
    ),
  );
}

export function parseMoleculeSearchPayload(
  value: unknown,
): McpSearchPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<McpSearchPayload>;
  if (!Array.isArray(candidate.molecules)) return null;
  const molecules = candidate.molecules
    .map(normalizeMoleculeSummary)
    .filter((molecule): molecule is MoleculeSummary => molecule !== null);
  return {
    query: typeof candidate.query === "string" ? candidate.query : "",
    returned:
      typeof candidate.returned === "number"
        ? candidate.returned
        : candidate.molecules.length,
    molecules,
  };
}

function readSearchPayloadFromText(
  content: McpTextContent[] | undefined,
): McpSearchPayload | null {
  const text = content?.find((item) => item.type === "text")?.text;
  if (!text) return null;
  try {
    return parseMoleculeSearchPayload(JSON.parse(text));
  } catch {
    return null;
  }
}
