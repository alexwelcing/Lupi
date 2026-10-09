# Investor demo handoff

The current chat lane is the `plugins/lupi-live` MCP plugin and its embedded molecular viewer. The current iPhone lane is `apps/apple`, the native SwiftUI/RealityKit app. Expo in `apps/mobile` is a frozen reference; its older OMol25 work is separate from the native AR build.

The demo progression is the same compound across two experiences:

Build the native screen revision with `sh tools/apple/verify-app-sdk.sh` on the owner's Mac before merge. Steps 2–3 are the intended rehearsal after that SDK build, not accepted current device behavior.

1. In ChatGPT ask Lupi to find “a hollow carbon cage”. Inspect the inferred catalogue match, resolve its returned PubChem CID, and show the pinned source structure. Pin an atom and ask a follow-up using that card's exact reference.
2. On the native Home screen tap **Find a molecule**, enter the same description, then choose **Play with Buckminsterfullerene**. Map the room, place the bundled cage, toss it, and keep it in the Collection. These gestures and physics are illustrative.
3. Repeat with “the molecule in coffee”. Use the native scale receipt separately to show exact represented counts versus drawn atoms.

For an offline phone rehearsal, use `buckyball`, `caffeine`, `H2O` or another exact catalogue name/formula. Those searches and bundled structures require no network. A description timeout withholds the recommendation and leaves all existing starters available. Chat requires live PubChem retrieval; its geometry is never silently replaced by an offline fixture. Live OMol25 browsing can be unavailable or warming, and the catalogue recommendation is not a claim about the complete research dataset.

Before presenting, build and sign the native app from the final main revision on the Mac, regenerate the Xcode project, and rehearse on the actual demo phone: camera/trust, room mapping, spawn/throw/keep, sound/haptics and Return-to-Home. Record the installed revision and device. A prior Apple SDK compile or a Simulator launch does not accept the newly added screen or physical AR.

Install/refresh the plugin in the intended ChatGPT account and verify its six tools, molecule-v3 resource, source retrieval and pin follow-up in the actual host. Development package validation is not plugin publication; support/privacy/terms/category metadata and an installed-host recording remain publisher tasks for a public listing. A private investor demo and store publication have different acceptance evidence.

The work receipt records source/CI/deployment results separately. Do not mark the app demo-ready from Linux package tests, or the installed plugin ready from the SDK fixture host.
