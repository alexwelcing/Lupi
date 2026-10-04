# Lupi AR: owner decisions (2026-10-04)

These are the owner's answers to the groundwork interview. They override any
recommendation in `research/00-groundwork-brief.md` that disagrees.

| # | Area | Decision |
|---|---|---|
| D1 | App | A new universal SwiftUI + RealityKit app at `apps/apple` replaces the Expo app as "Lupi" (bundle id `live.lupi.app`). `apps/mobile` is frozen as a reference. |
| D2 | Builds | A GitHub Actions macOS runner compiles every push and uploads to TestFlight when the App Store Connect secrets are present. |
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
