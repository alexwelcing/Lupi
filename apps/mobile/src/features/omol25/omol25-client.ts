import {
  isOmol25CollectionId,
  OMOL25_MAX_ATOMS,
  OMOL25_PAGE_SIZE,
  omol25StructureUrl,
  type Omol25Collection,
  type Omol25Coverage,
  type Omol25Page,
  type Omol25Row,
} from "./omol25";

export class Omol25RequestError extends Error {
  constructor(
    message: string,
    readonly kind: "warming" | "unavailable" = "unavailable",
  ) {
    super(message);
    this.name = "Omol25RequestError";
  }
}

type Fetcher = typeof fetch;

export async function fetchOmol25Collections(
  origin: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<Omol25Collection[]> {
  const payload = await fetchJson(
    `${origin}/v1/datasets/omol25`,
    signal,
    fetcher,
  );
  if (
    !isRecord(payload) ||
    payload.id !== "omol25" ||
    !Array.isArray(payload.collections)
  ) {
    throw new Omol25RequestError("The OMol25 catalog response was invalid.");
  }
  const collections = payload.collections.map(parseCollection);
  if (
    new Set(collections.map((collection) => collection.id)).size !==
    collections.length
  ) {
    throw new Omol25RequestError("The OMol25 catalog repeats a collection.");
  }
  if (!collections.some((collection) => collection.id === "neutral-train")) {
    throw new Omol25RequestError(
      "The complete neutral training collection is unavailable.",
    );
  }
  return collections;
}

export async function fetchOmol25Page(
  origin: string,
  collection: Omol25Collection,
  options: {
    offset: number;
    query: string;
    searchMode: "text" | "formula";
    signal?: AbortSignal;
  },
  fetcher: Fetcher = fetch,
): Promise<Omol25Page> {
  const { offset, query, searchMode, signal } = options;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset >= collection.indexedRows
  ) {
    throw new Omol25RequestError(
      "This OMol25 page is outside the indexed collection.",
    );
  }
  const search = query.trim();
  if (search.length > 120)
    throw new Omol25RequestError("Search text is too long.");
  const url = new URL(`${origin}/v1/datasets/omol25/${collection.id}/rows`);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(OMOL25_PAGE_SIZE));
  if (search)
    url.searchParams.set(
      searchMode === "formula" ? "formula" : "query",
      search,
    );
  const payload = await fetchJson(url.toString(), signal, fetcher);
  if (
    !isRecord(payload) ||
    payload.dataset !== collection.id ||
    payload.coverage !== collection.coverage ||
    payload.indexedRows !== collection.indexedRows ||
    payload.offset !== offset ||
    !Array.isArray(payload.rows)
  ) {
    throw new Omol25RequestError(
      "The OMol25 page response did not match the selected collection.",
    );
  }
  const rows = payload.rows.map((value) => parseRow(value, origin, collection));
  if (rows.length > OMOL25_PAGE_SIZE)
    throw new Omol25RequestError("The OMol25 page exceeded the mobile limit.");
  return {
    collection: collection.id,
    coverage: collection.coverage,
    indexedRows: collection.indexedRows,
    matchedRows: optionalCount(payload.matchedRows),
    offset,
    partial: payload.partial === true,
    rows,
  };
}

async function fetchJson(
  url: string,
  signal: AbortSignal | undefined,
  fetcher: Fetcher,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 20_000);
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (
      response.status === 202 &&
      isRecord(payload) &&
      payload.status === "warming"
    ) {
      throw new Omol25RequestError(
        "The OMol25 search index is warming. Retry shortly.",
        "warming",
      );
    }
    if (!response.ok)
      throw new Omol25RequestError(
        `OMol25 is unavailable (HTTP ${response.status}).`,
      );
    return payload;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof Omol25RequestError) throw error;
    throw new Omol25RequestError(
      "Could not reach the OMol25 collection. Check your connection and retry.",
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function parseCollection(value: unknown): Omol25Collection {
  if (
    !isRecord(value) ||
    !isOmol25CollectionId(value.id) ||
    !shortText(value.label, 80) ||
    !shortText(value.description, 300) ||
    !shortText(value.repository, 120) ||
    !positiveCount(value.indexedRows) ||
    !positiveCount(value.estimatedRows) ||
    !isCoverage(value.coverage) ||
    (value.indexedRows as number) > (value.estimatedRows as number) ||
    value.coverage !==
      (value.id.endsWith("-preview") ? "indexed-preview" : "complete")
  ) {
    throw new Omol25RequestError(
      "The OMol25 catalog contains an invalid collection.",
    );
  }
  return {
    id: value.id,
    label: value.label,
    description: value.description,
    repository: value.repository,
    indexedRows: value.indexedRows,
    estimatedRows: value.estimatedRows,
    coverage: value.coverage,
  };
}

function parseRow(
  value: unknown,
  origin: string,
  collection: Omol25Collection,
): Omol25Row {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.rowIndex) ||
    (value.rowIndex as number) < 0 ||
    (value.rowIndex as number) >= collection.indexedRows ||
    !shortText(value.formula, 96) ||
    !Number.isSafeInteger(value.atomCount) ||
    (value.atomCount as number) < 1 ||
    (value.atomCount as number) > OMOL25_MAX_ATOMS ||
    !Array.isArray(value.elements) ||
    value.elements.length > 118 ||
    !value.elements.every((element) => shortText(element, 3)) ||
    value.coordinateProvenance !== "source" ||
    value.bondTopology !== "not-provided"
  ) {
    throw new Omol25RequestError("The OMol25 row has invalid source metadata.");
  }
  const rowIndex = value.rowIndex as number;
  const expectedUrl = omol25StructureUrl(
    origin,
    `${collection.id}/${rowIndex}`,
  );
  if (
    typeof value.loadUrl !== "string" ||
    `${origin}${value.loadUrl}` !== expectedUrl
  ) {
    throw new Omol25RequestError(
      "The OMol25 row has an unexpected structure URL.",
    );
  }
  return {
    rowIndex,
    formula: value.formula as string,
    atomCount: value.atomCount as number,
    elements: value.elements as string[],
    method: shortText(value.method, 80) ? value.method : null,
    loadUrl: expectedUrl,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCoverage(value: unknown): value is Omol25Coverage {
  return value === "complete" || value === "indexed-preview";
}

function shortText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function positiveCount(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) > 0 &&
    (value as number) < 100_000_000
  );
}

function optionalCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}
