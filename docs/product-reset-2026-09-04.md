# Focused student product reset — 2026-09-04

Owner request: make main smaller, improve performance and polish, curate for
students, and separate research execution from lupi.live.

## Integration boundary

Implemented on `codex/focused-student-product`, based on main
`f4de294a490bd01b4e440f6c20855cc0fc2ddd9a`, in an isolated worktree.
The original dirty checkout was not staged, reset, or overwritten.
Deleted UI modules remain recoverable from Git. This candidate removes 28 legacy
UI modules and approximately 13,000 net lines, including new tests and documentation.
The separate
`apps/lupine-app`, original coordinate assets, native embedding, the
canonical agent catalog, renderer contracts, and release controls remain.

## Product decisions

| Surface | Problem addressed | New contract |
|---|---|---|
| Home | Competing entry points, GPU decoration, research/scale-first cards | One learning collection, first Water model, short guide, local file opening |
| Collection | Catalog growth silently became product curation | Positive list of 12 source-bound examples, 3 topics, one observation prompt each |
| Account | Agent/operator controls mixed with sign-in and saved content | Sign-in/out and saved views only; honest unavailable/loading/error states |
| Save | Draft links looked published and snapshot state looked current | Save owns interactive links; drafts and saved snapshots explicitly distinguished |
| Learn | Extensive course/research material competed with the structure | Composition, one prompt, three steps, collapsed source/inference notes |
| Style | Duplicate structure/scene preset decks overwhelmed basic inspection | Bond guides, axes, bounds, atom size, element colors, 3 backgrounds |
| Data | Analysis label was disconnected from the supplied data | Existing coordinate/measurement tools under Data; no research execution |
| Camera | Quick views competed with path-authoring controls | Quick views first; animation behind a disclosure |
| Export | A state-only URL claimed to restore an exact view | Pictures first; Save owns sharing; 3D/video behind a disclosure |
| Elements | Selection disabled other choices; filtered results could be off-screen | Direct replacement selection and reachable search results; no run configurator |
| Research/Comparison URLs | Synthetic research UI looked like viewer-owned results | Lightweight retirement explanation, no renderer, explicit external handoff, noindex |
| Public metadata | Viewer pages published organization-wide science claims | Lupi-owned metadata and a two-page sitemap |

The typography pass established a scoped editorial reading system, visible
focus, a bounded line measure, touch-sized primary actions, and narrow-screen
reflow. Chemistry curation uses actual shipped coordinates and limits prompts
to observations; inferred guide lines are not presented as bond topology,
experimental properties, or mechanistic evidence. The functional-group guide
identifies its [OpenStax source basis](https://openstax.org/books/organic-chemistry/pages/3-1-functional-groups).

## Curation gate

Edit `packages/ui/src/gallery/studentCollection.ts` deliberately. Publication
requires a working coordinate file, accurate atom count, a student observation
prompt, and a matching source preview. Run
`node tools/build-student-previews.mjs` explicitly; previews record the
SHA256 of LF-normalized source text so the gate is portable across checkouts.
The unit gate checks every published source and preview. Adding an item to the
full agent/research catalog alone never publishes it in this collection.

## Local verification receipts

- Frozen dependency install: passed.
- Product contract verifier: passed.
- UI TypeScript and production web build: final source passed.
- Real repository lint: passed across all 14 workspaces plus tooling, scripts,
  Playwright/config, and Cloud Functions; existing warnings remain.
- Initial full UI suite: 73 files/530 tests passed, with a preview newline
  mismatch and local periodic-table/worker timeouts. Repaired source normalization;
  rerun of the affected files plus Style passed 4 files/47 tests.
  The final full rerun passed all 78 files / 573 tests with two workers and a
  15-second per-test budget (8m59s); no unhandled runner errors remained.
- Production-browser acceptance: 9 tests passed in 4.1 minutes. Covers discovery,
  real molecule canvas, Style, Camera, Learn, Save/Account hit-testing, phone
  controls, all 12 preview loads, filters/empty-state recovery, 320px text-spacing
  reflow, six retired entry points, and a real PNG download.
- Downloaded Water PNG inspected: valid PNG, 2160 by 2160, three-atom structure
  visible. Artifact retained under `test-results/playwright/`.
- Final-source student-surface browser rerun: 4 tests passed in 1.8 minutes,
  including actual Elements search/switch behavior followed by PNG download.
- Final changed-source lint: passed, with two pre-existing Save hook-dependency
  warnings. No lint gate was disabled or weakened.

At the same 1280px in-app browser width, the observed live baseline homepage
was 16,551px tall with 2 canvases; this local homepage was 3,466px tall with
0 canvases. These are bounded DOM observations, not Lighthouse, network,
device FPS, or production-performance claims. Viewer/export/auth and developer
pages are deferred. The remaining 3D viewer is still a large bundle and is not
being relabeled as a complete performance rewrite.

## Release truth

| Lane | Status at this candidate receipt |
|---|---|
| Local | NOT CHECKED in full: scoped checks above; complete release/audit/controller/Worker/native gates are not all locally attested |
| CI | NOT CHECKED until the exact candidate PR workflow completes |
| Deploy | NOT CHECKED; no deployment or traffic change authorized or performed |
| Live API | NOT CHECKED for this candidate |
| Public site | NOT CHECKED for this candidate; live baseline inspection is not new-version proof |

Source remediation does not mark the production nonconformities resolved.
Signed-in save/reopen success still needs a configured identity environment
and the identity/data operator; local unavailable-state evidence is not that
success. Alex Welcing owns the merge/release decision and any required
identity/release credentials. Merge remains gated by exact-candidate CI and
the normative release-truth contract; deploy requires its separate owner
dispatch and rollback chain.
