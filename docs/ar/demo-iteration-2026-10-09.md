# Native demo iteration, 2026-10-09

Alex authorized this iteration and a signed development build for tonight. Expo
publishing is on hold. The native Swift app is the current iPhone lane.

The accepted baseline is main `1520adad0b6754e4f07594d51e16699c7787d0ef`:
the shared bounded Jev discovery endpoint, native Find, and the installed ChatGPT
discovery/pinned-atom flow. Its unsigned device and Simulator SDK builds, signed
device build, and strict signature verification passed on the owner's Mac. It has
not been installed or exercised on a physical iPhone. The local Mac partner has
the exact-revision receipts; Linux checks do not substitute for those receipts.

## Today, in order

1. **Durable Keep and isolated room saves.** Persist collection edits before
   publishing them. Prepare Keep without changing play; attach its trophy ID and
   celebrate after the local save succeeds. A failed write offers Retry and keeps
   the same prepared UUID. Shelf placement follows the durable collection save;
   if placement fails, the trophy remains in Collection, the body stays unpinned,
   and the player sees a retry instead of a shelf success/chime. Delayed edits
   cannot overwrite a changed/deleted trophy or cross an account change.
   Room/root/request tokens reject late map results after new room, root movement,
   deletion, or an AR transition. A save keeps newer placements and queued pin
   requests; a map must contain its requested shelf root before replacing the
   saved map. Root placement keeps the old state until its new anchor is durable.
2. **Clear and visible AR recovery.** Clear removes queued molecules, atoms,
   receipt requests, and current bodies. The AR screen offers Return Home and
   Retry tracking when startup is unavailable. Foreground/background/exit requests
   serialize framework operations; stale startup results cannot restart play
   after exit. A keep that finishes in the background keeps its durable identity
   without celebrating or pinning a moving body.
3. **A camera-free molecule preview.** Use the integrity-checked bundled structure
   with real formula/count, CPK materials, orbit, Recenter, and provenance. Play
   remains explicit. Discovery, preview, and AR dismiss sequentially so the camera
   explanation is not presented beneath another sheet.
4. **Build identity and a bounded diagnostic export.** Embed revision, source
   cleanliness and build time; expose a copy action in Settings. Record stage,
   sampled performance/count/tracking/thermal values, and save outcomes. Preserve
   the HUD's approximate-count marker. Export excludes room maps/photos and user
   content. This iteration uses marketing version 0.1.0, build 2.

Core reliability is owned by `codex/native-demo-reliability`. The local Mac team
owns preview, Settings/build identity, diagnostics values, discovery transport
tests, stand-ins and build stamping on `codex/native-tonight-demo`. They will wire
the recorder after the core commit is available. Each source slice is integrated
before the combined exact-revision Mac build; app edits merge only after real
device and Simulator SDK acceptance. Signing is then checked on the same source.

## Acceptance gates

- Inject a real local write failure: collection/outbox and play remain unchanged,
  no kept chime, retry persists one UUID, and reopening reads that trophy.
- Keep/delete, failed writes, FIFO edits and account changes exercise the local
  transaction conditions. Deletion invalidates even an unattached pending keep.
- Delayed room A → new room B/pin → A completion leaves B's snapshot, placement
  metadata, probe and due request intact. Include pins during saves, failed saves,
  root changes and deletion. A failed root write preserves the old recovery state.
- Queue all spawn types before tracking → Clear → readiness creates no body;
  intentional later requests work. Background/exit supersedes a delayed AR start.
- Run the package tests, required Release timing checks, app parsing, stand-in
  type check, generated-source checks and CI. Real Mac SDK builds and Simulator
  observation are separate gates. Package/stand-in success proves no AR physics.
- On Mac, exercise preview orbit/Recenter/identity/provenance, sequential explicit
  Play, persistent Simulator AR recovery, Home/Collection, build identity copy and
  diagnostic export. Retain logs/screenshots and source revision.

## Tonight and tomorrow

Connect/unlock/pair the eligible iPhone and install the signed development app
through the Mac. Downloading an IPA into Files alone does not install it. Check:
first camera/tracking/spawn/throw; wall impacts, stacking and peroxide breaks;
audio/haptics; background/foreground/Home; manual/automatic Keep and force-quit
reopen; shelf placement, A1 relocalization and failure recovery; salt 1k/1m/1b
counts and cost. Keep the overnight shelf-recovery check for tomorrow.

The installed ChatGPT rehearsal still needs a fresh successful card with account
CSP enforcement enabled. Keep that protection on. Physical iPhone behaviour,
installed-host drag/hover and the overnight shelf check remain evidence gaps until
observed. M3b waits for S1/S2 and the physical baseline. A pre-existing account
deletion edge—remote deletion succeeds but final local cleanup fails—needs a
separate durable cleanup-retry phase; this iteration does not claim that recovery.
