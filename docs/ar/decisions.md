# Lupi AR: owner decisions (2026-10-04)

These are the owner's answers to the groundwork interview. They override any
recommendation in `research/00-groundwork-brief.md` that disagrees. D14 and the
amendment to D2 below came later the same day.

| # | Area | Decision |
|---|---|---|
| D1 | App | A new universal SwiftUI + RealityKit app at `apps/apple` replaces the Expo app as "Lupi" (bundle id `live.lupi.app`). `apps/mobile` is frozen as a reference. |
| D2 | Builds | A GitHub Actions macOS runner compiles every push and uploads to TestFlight when the App Store Connect secrets are present. *Amended 2026-10-04: the app builds on the owner's Mac ([below](#d2-amended-2026-10-04-builds-on-the-owners-mac)).* |
| D3 | Devices | iPhone Pro and iPad Pro with LiDAR, on the latest iOS. Deployment target iOS 26.0, newer APIs behind `#available`. The LiDAR scene mesh is the play arena. |
| D4 | Vision | **A banger physics game whose building blocks happen to be molecules.** Pure sandbox: grab, throw against your real walls, stack, smash, build. Thirty minutes of fun, not three. No scores or levels; hidden delights (a bank shot, a tall stack, a molecule you built) get a small celebration. |
| D5 | Look | Glossy toy with true CPK colours: candy-glossy atoms, chunky bonds, soft shadows on your real table. |
| D6 | Collecting | Spawn any molecule, no gating. A molecule you leave on a real shelf is a trophy, and it is still there tomorrow. |
| D7 | Persistence | The collection lives on the Lupi account (Firebase Auth, with Sign in with Apple). The app stays usable without signing in and syncs once you do. Room maps and placements stay on the device. App only, with no web shelf page. |
| D8 | Physics | Fun first, loosely inspired by chemistry: personalities (rigid, flexible, brittle, bouncy), mass ratios and tumble come from the molecule, but nothing claims to be a simulation. |
| D9 | Breaking and building | Breaking makes real fragments that become new molecules you can keep. Loose atoms snap into molecules by valence rules (the same caps as `lupi-bonds.molecular.v1`). |
| D10 | Scale | Seamless, user-controlled grow and shrink from tabletop to room scale, up to million-atom structures. |
| D11 | Feel | Haptics and spatial sound are on by default in AR, with one toggle. Motion comfort (Standard, Gentle, Still) is respected. |
| D12 | Multi-user | Never. |
| D13 | Audience | The owner, iterating as it grows. |
| D14 | Scale | **Scale is the first principle.** The owner: "Million atom needs to be first principle. Should scale from 1k to googleplex if we needed." From M0, every molecule, fragment, crystal and kept piece is a node in one content-addressed hierarchy (LupiScale), so a frame, a gesture, a break and a keep cost what is on screen or in the hand, never the atom count, and counts are exact up to a googolplex and beyond. Swift (`apps/apple/LupiScale`) and TypeScript (`packages/core/src/scale`) build to [scale-spec.md](scale-spec.md) and agree byte for byte; [scale.md](scale.md) is the architecture of record. It lifts D10's million-atom ceiling, and the colossus and the googolplex become content milestones on that spine. |

## D2, amended 2026-10-04: builds on the owner's Mac

The owner: "lets use my local box for the builds then, no worries. I have this mac with everything we need"

- The app is built, signed and run from the owner's Mac. The Xcode project is generated with XcodeGen: `brew install xcodegen; cd apps/apple && xcodegen generate && open Lupi.xcodeproj`, then select team `26Y4SLFJ4M` and run on the device.
- CI keeps only the Linux `swift test` of the pure-Swift packages under `apps/apple`. There is no macOS runner and no TestFlight lane for now.
- This supersedes D2's macOS runner and TestFlight upload. [plan.md §9](plan.md#9-build-and-distribution-lane) is the lane of record.
