# Lupi mobile development on an Apple Silicon MacBook Air

Status snapshot: **2026-08-17**

This is the practical handoff for continuing Lupi iPhone development on an
Apple Silicon MacBook Air, including an M2 model with limited memory or disk.
The Mac is the preferred native-development host because it can run Xcode,
connect directly to an iPhone, inspect native logs, and build the iOS project.
Use EAS cloud builders for expensive or release-signing work so the laptop
remains a responsive edit, Metro, test, and device-debug machine.

## Authoritative handoff state

- Repository: <https://github.com/alexwelcing/Lupi>
- Mobile app: `apps/mobile`
- Verified runtime source: main commit
  `0e78b6b4a4493cae31019bbcb9aa5b01c6ae32a0`
- Expo project: `@alexwelcing/lupi`
- Expo project ID: `38c55c8d-b7dc-4bec-ab5e-1809eda6bf9d`
- Expo SDK: `57.0.12`
- React Native: `0.86.2`
- Node: `22.23.1`
- Repository package manager: pnpm `9.0.0`
- iOS deployment target: `17.6`
- Development identity: `Lupi Dev`, `live.lupi.app.dev`, scheme `lupi-dev`
- Active handoff update: iOS update
  `01a0101e-640a-7d5e-b248-6ae762f7a50f`, group
  `11ec17f2-4047-4e80-b688-a769fb892668`, channel `development`, runtime
  `1.0.1`, exact clean Git revision `0e78b6b4`
- Signed native development build:
  `2960e909-355d-46b0-8394-013786627180`, version/build `1.0.1 (1)`

The active update is compatible with that development build because both use
runtime `1.0.1` and the update contains no native dependency or config change.
The build is Ad Hoc signed for the registered iPhone used during the Windows
development pass. A different iPhone must be registered and included in a new
development build before that device can install the IPA.

Do not copy the Windows checkout, `node_modules`, Xcode output, ignored
verification artifacts, or credentials onto the Mac as the starting point.
Clone the clean GitHub `main` branch and authenticate each service normally.

## What the M2 MacBook Air is good at

An M2 MacBook Air is sufficient for this workflow when work is kept bounded:

- editing and Codex work in one clean checkout;
- Node, TypeScript, ESLint, and focused unit tests;
- Metro serving a custom development client on a physical iPhone;
- Xcode device logs, Instruments spot checks, and local debug builds when
  necessary;
- native shell and WebView work;
- initial Swift/Metal module development after the current hybrid app is
  accepted.

Prefer EAS for clean signed builds, simulator visual workflows, and release
archives. Avoid keeping multiple simulators, multiple Xcode versions, several
full pnpm worktrees, and a local release build active at the same time.

## One-time Mac setup

### 1. Update macOS and install full Xcode

Install the current stable Xcode that supports the SDK 57 toolchain. The
repository's EAS `sdk-57` image currently uses Xcode 26.6 and Node 22.23.1.
Install **full Xcode**, not only Command Line Tools: `xcodebuild`, device
support, simulators, signing, and native debugging require the full app.

After Xcode finishes installing, open it once and allow it to install required
components. Then run:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -version
xcrun simctl list devices available
```

Install only one simulator runtime initially. The simulator is useful for the
native shell, but it is not Room AR evidence.

### 2. Install the pinned Node and pnpm versions

Use `fnm`, `nvm`, or another version manager to install **Node 22.23.1**. Do
not substitute whichever Node happens to ship with another tool.

```bash
node --version
corepack enable
corepack prepare pnpm@9.0.0 --activate
pnpm --version
```

Expected output is Node `v22.23.1` and pnpm `9.0.0`. The repository also pins
pnpm in its root `package.json`; keep the local result aligned with that pin.

### 3. Clone a clean source tree

```bash
git clone https://github.com/alexwelcing/Lupi.git
cd Lupi
git switch main
git pull --ff-only
git status --short --branch
git rev-parse HEAD
```

The first handoff checkout should be clean. Do not restore the older mixed
Windows root worktree or its stashes onto this machine.

### 4. Install only the mobile dependency graph first

This is the lower-disk starting point:

```bash
corepack pnpm install --frozen-lockfile --filter @lupi/mobile...
cp apps/mobile/.env.example apps/mobile/.env.local
```

Use a full `corepack pnpm install --frozen-lockfile` only when work also needs
the web viewer, Worker, or other workspace packages. Never use
`--ignore-scripts` as a release setup; required package install steps must run.

### 5. Authenticate without copying secrets

```bash
gh auth login
npx --yes eas-cli@21.7.0 login
npx --yes eas-cli@21.7.0 whoami
npx --yes eas-cli@21.7.0 project:info
npx --yes eas-cli@21.7.0 channel:view development
```

The expected Expo owner is `alexwelcing`, and the development channel should
point at the active handoff update above. Apple, Expo, and GitHub credentials
belong in their normal macOS keychains or CLI stores, never in `.env`, Git, a
Codex prompt, or a handoff document.

## Daily development loop

Start with the inexpensive checks:

```bash
corepack pnpm --filter @lupi/mobile test
corepack pnpm --filter @lupi/mobile typecheck
corepack pnpm --filter @lupi/mobile lint
corepack pnpm --filter @lupi/mobile check:expo
```

Run them sequentially on a memory-constrained Air. The current baseline is 108
unit tests, 30 SDK compatibility checks, and zero TypeScript or lint failures.

For the custom development client on a physical iPhone:

```bash
corepack pnpm --filter @lupi/mobile start:dev-client
```

Keep the Mac and iPhone on the same non-guest Wi-Fi. Connect the iPhone by USB
for the first pairing, trust the Mac, and enable Developer Mode if requested.
If LAN discovery is blocked:

```bash
corepack pnpm --filter @lupi/mobile start:tunnel
```

Use the installed **Lupi Dev** client, not Expo Go, for Room. Expo Go cannot
load the custom Viro native runtime.

## Apple Silicon simulator boundary

The app's Viro config currently excludes `arm64` for iOS Simulator builds.
That is an important limitation on an M2 Mac:

- do not spend time trying to prove Room AR in an Apple Silicon simulator;
- do not treat a simulator screenshot as camera, plane, placement, gesture,
  occlusion, tracking, or thermal evidence;
- use a physical ARKit iPhone for Room work;
- use the existing EAS visual workflow for deterministic Viewer, Gallery,
  Library, and Settings screenshots when local simulator linking is blocked;
- use `export:web` for fast layout and route checks that do not need UIKit.

The destination renderer is a local Expo module backed by Swift, MetalKit, and
ARKit. The M2 is capable of developing that module, but performance acceptance
must be collected on target iPhones rather than inferred from the Mac GPU.

## When a new native build is required

A JavaScript-only change can use EAS Update when it remains compatible with
runtime `1.0.1`. A new native build is required after changing any of these:

- Expo, React Native, Viro, or another native dependency;
- app config plugins, permissions, entitlements, deployment target, or bundle
  identity;
- the future local Metal renderer module;
- the marketing version/runtime compatibility boundary;
- the set of registered Ad Hoc iPhones.

Because runtime policy is `appVersion`, bump the app version before distributing
an incompatible native generation. Do not publish incompatible native code
under the existing `1.0.1` runtime.

For a newly registered iPhone:

```bash
npx --yes eas-cli@21.7.0 device:create
npx --yes eas-cli@21.7.0 build --platform ios --profile development \
  --wait
```

Run the first build for a newly registered device interactively so EAS can
replace the Ad Hoc provisioning profile with one that contains the new UDID.
`--freeze-credentials` is appropriate only after that profile is already
correct; using it during first registration would deliberately block the
required profile change. This consumes EAS build resources, so use it only
after the source gate is green and the device is confirmed in the
registered-device list.

## Safe development-update publication

The Expo project's `development` environment now contains the non-secret
variable `APP_VARIANT=development`. SDK 57 uses only server-side EAS environment
variables when `--environment` is supplied, so this control-plane value is part
of the release contract.

Before publishing:

```bash
git status --porcelain
git rev-parse HEAD
corepack pnpm --filter @lupi/mobile verify:testflight
```

The status output must be empty. Then publish with the pinned CLI:

```bash
sha=$(git rev-parse --short HEAD)
npx --yes eas-cli@21.7.0 update \
  --channel development \
  --environment development \
  --platform ios \
  --message "Development handoff ($sha)" \
  --clear-cache \
  --json
```

Afterward, verify `channel:view development` reports:

- the new update ID and exact Git commit;
- `isGitWorkingTreeDirty: false`;
- runtime `1.0.1` unless a deliberate version migration occurred;
- `Lupi Dev`, `development`, `live.lupi.app.dev`, and `lupi-dev`;
- visual QA disabled.

Do not use `eas-cli@latest` for a release receipt; the repository currently
pins EAS CLI `21.7.0`.

## Resource-conscious habits

- Keep one primary checkout. Add a temporary worktree only for genuinely
  isolated work, then remove it after its branch and receipts are safe.
- Run mobile tests, typecheck, lint, and exports sequentially.
- Prefer EAS cloud builds over local release archives.
- Keep one Simulator device booted and close it when using a physical iPhone.
- Use Xcode's **Settings > Locations > Derived Data** control to inspect and
  clear obsolete derived data. Do not delete an unknown broad directory.
- Remove unavailable simulators with `xcrun simctl delete unavailable`.
- Reclaim unused pnpm package-store objects occasionally with
  `corepack pnpm store prune`, after active installs are healthy.
- Generated `apps/mobile/dist`, `apps/mobile/dist-ios`, and `.expo` outputs may
  be regenerated. Preserve `.verify-artifacts` receipts selectively; do not
  blanket-delete them or copy gigabytes of old receipts to the Mac.
- Maintain generous free disk space for Xcode, a simulator runtime, pnpm, and
  temporary native builds. If disk pressure appears, clean generated output
  before adding another Xcode/runtime installation.

## Codex startup on the Mac

Open Codex at the clean repository root and begin a new task with:

```text
Read AGENTS.md and docs/mobile-macbook-air-handoff.md completely. Confirm the
current branch, Git status, Node 22.23.1, pnpm 9.0.0, Expo account/project, and
development-channel identity before editing. Preserve source, CI, EAS build,
EAS Update, live web, simulator, and physical-iPhone evidence as separate
truth lanes. Use the physical iPhone for Room AR and keep work bounded for an
M2 MacBook Air.
```

Codex should work on a `codex/*` branch, stage only intended files, and use the
smallest verification ladder appropriate to the edit. A local export is not a
signed build; an update publication is not an install receipt; a simulator is
not physical AR proof.

## Handoff acceptance checklist

- [ ] Clean clone of GitHub `main` on the Mac.
- [ ] Node `22.23.1`, pnpm `9.0.0`, full Xcode, and selected Command Line Tools.
- [ ] Frozen filtered mobile install succeeds.
- [ ] Mobile tests, typecheck, lint, and `check:expo` pass.
- [ ] GitHub and Expo CLI accounts authenticated without copied credentials.
- [ ] `channel:view development` resolves the Lupi Dev identity.
- [ ] Existing registered iPhone launches the active update, or the new iPhone
      is registered and included in a fresh development build.
- [ ] Viewer horizontal drags rotate without navigation pop; explicit Back works.
- [ ] Physical Room placement, transforms, atom inspection, background/resume,
      and camera shutdown are recorded on the target iPhone.
- [ ] Apple seller/team and App Store Connect choices remain explicit before
      any TestFlight production submission.

Primary references:

- [Expo SDK compatibility table](https://docs.expo.dev/versions/latest/)
- [Expo SDK 57 EAS build infrastructure](https://docs.expo.dev/build-reference/infrastructure/)
- [Set up an iOS development build](https://docs.expo.dev/get-started/set-up-your-environment/?device=physical&mode=development-build&platform=ios)
- [Create and install an iOS device build](https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/)
- [Share a development build](https://docs.expo.dev/develop/development-builds/share-with-your-team/)
- [EAS environment variables for updates](https://docs.expo.dev/eas/environment-variables/faq/)
- [Apple command-line tools](https://developer.apple.com/documentation/xcode/installing-the-command-line-tools)
