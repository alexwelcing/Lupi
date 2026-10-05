# Lupi AR: the native Apple game

Docs for `apps/apple`, the native SwiftUI + RealityKit app for iPhone Pro and iPad Pro: a physics sandbox whose building blocks are molecules, played against the real room.

When two documents disagree, the one higher in this list wins.

| Document | What it is |
|---|---|
| [decisions.md](decisions.md) | The owner's binding decisions, D1–D14 (2026-10-04), with the amendment to D2 (builds on the owner's Mac). |
| [scale-spec.md](scale-spec.md) | The normative scale spec that Swift (`apps/apple/LupiScale`) and TypeScript (`packages/core/src/scale`) build to byte for byte: node records, the frozen generator registry v1, paths, Magnitude, LupiPack v1, `lupi.scale-ref.v1`, frames, the cut, physics proxies and test vectors. On scale it outranks the documents below it. |
| [scale.md](scale.md) | The scale architecture of record (D14): principles as tests, walkthroughs from 10³ atoms to a googolplex, rendering, physics and persistence at every scale, validation, risks, and the adjudication of the three proposals. |
| [plan.md](plan.md) | The plan of record: game pillars, architecture, physics design, the juice spec, persistence, scale, the M0–M4 roadmap, the build lane, risks and the owner's open asks. |
| [status.md](status.md) | Where the build stands for the owner: what is built per milestone, how to build and run it on the Mac, the on-device checklist for every spike and exit, and where the first compile is most likely to fail. |
| [contracts.md](contracts.md) | The data contracts: `lupi.trophy.v1`, `lupi.shelf.v1`, `lupi.personality.v1`, the lupi.live endpoints the app reads, and a pointer to the Firestore layout. |
| [account-and-sync.md](account-and-sync.md) | The trophy case on the Lupi account: Firebase Auth and Firestore over REST from pure Swift (`apps/apple/LupiCloud`), the envelope and `firestore.rules`, the sync algorithm, account deletion, and the owner's setup checklist. |
| [research/00-groundwork-brief.md](research/00-groundwork-brief.md) | The groundwork brief that led to the decisions. Superseded where the decisions disagree. |
| [research/apple-ar-platform.md](research/apple-ar-platform.md) | Apple platform research: ARKit persistence, RealityKit physics and gestures, tooling, with an API capability table. |
| [research/chemistry-play-physics.md](research/chemistry-play-physics.md) | Molecule physics research: bond strengths, mass and inertia, honest claims. |
| [research/million-atom-ar.md](research/million-atom-ar.md) | Rendering a million atoms in AR: culling, LOD, the hybrid Metal renderer, frame budget. |
| [research/repo-mobile-ar.md](research/repo-mobile-ar.md) | What the repo already has for mobile and AR, and what can be ported. |
| [research/retention-collection.md](research/retention-collection.md) | What keeps people coming back to a persistent AR collection; privacy of room data. |

On the web, `/scale` on lupi.live (`packages/ui/src/scale`) draws the same records with the TypeScript reference: the salt ladder from one ion to a googolplex with exact counts, flight and wraps along the scale axis (scale-spec §8.8), the cut of §9 with the viewer's impostors, smashing the bar into its ten cubes, and `lsr1:` share links (§7).

Related amendments: the viewer brainstorm's "Immersive XR: defer" decision ([decisions.md](../brainstorm/2026-09-viewer-play/decisions.md#amendment-2026-10-04-native-apple-ar)) and its "no native renderer fork" line ([pocket-native-play.md](../brainstorm/2026-09-viewer-play/round2/pocket-native-play.md)) were amended on 2026-10-04 to point here.
