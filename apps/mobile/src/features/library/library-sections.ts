import type { MoleculeSummary } from "@/src/domain/molecules";

export type LibraryHistoryState =
  | { status: "loading" }
  | { status: "ready"; molecules: MoleculeSummary[] }
  | { status: "error"; message: string };

export type LibraryItem =
  | { kind: "recent"; id: string; molecule: MoleculeSummary }
  | { kind: "empty"; id: "recent-empty" }
  | { kind: "loading"; id: "recent-loading" }
  | { kind: "history-error"; id: "history-error"; message: string };

export interface LibrarySection {
  id: "recents";
  title: "Recent Structures";
  data: LibraryItem[];
}

export function buildLibrarySections(
  state: LibraryHistoryState,
): LibrarySection[] {
  let recentItems: LibraryItem[];

  if (state.status === "loading") {
    recentItems = [{ kind: "loading", id: "recent-loading" }];
  } else if (state.status === "error") {
    recentItems = [
      { kind: "history-error", id: "history-error", message: state.message },
    ];
  } else if (state.molecules.length > 0) {
    recentItems = state.molecules.map((molecule) => ({
      kind: "recent",
      id: `recent:${molecule.id}`,
      molecule,
    }));
  } else {
    recentItems = [{ kind: "empty", id: "recent-empty" }];
  }

  return [{ id: "recents", title: "Recent Structures", data: recentItems }];
}
