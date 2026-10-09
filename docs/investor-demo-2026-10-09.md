# Investor demo handoff

The current chat lane is the `plugins/lupi-live` MCP plugin and its embedded molecular viewer. The current iPhone lane is `apps/apple`, the native SwiftUI/RealityKit app. Expo in `apps/mobile` is a frozen reference; its older OMol25 work is separate from the native AR build.

The demo progression is the same compound across two experiences:

The chat finder and native client/catalogue can land independently. The native Home screen is prepared in [PR #129](https://github.com/alexwelcing/Lupi/pull/129) and is held for the Mac SDK build required before app changes merge. The phone steps below describe the intended rehearsal after that build and screen merge, not accepted current device behavior.

1. In ChatGPT ask Lupi to find “the molecule in coffee”. Inspect the inferred Caffeine match, resolve its returned PubChem CID 2519, and show the pinned source structure. The live rehearsal on 2026-10-09 returned 24 atoms with 3D coordinates in angstroms. Pin an atom and ask a follow-up using that card's exact reference.
2. On the native Home screen tap **Find a molecule**, enter the same description, then choose **Play with Caffeine**. Map the room, place the bundled molecule, toss it, and keep it in the Collection. These gestures and physics are illustrative; the native and PubChem conformers need not be identical.
3. Optionally ask for “a hollow carbon cage” and open Buckminsterfullerene on the phone. PubChem CID 123591 returned a **2D depiction** in the live rehearsal, so its chat view must retain that label; do not describe it as retrieved 3D geometry or use its depiction distances as angstrom measurements.
4. Use the native scale receipt separately to show exact represented counts versus drawn atoms.

For an offline phone rehearsal, use `buckyball`, `caffeine`, `H2O` or another exact catalogue name/formula. Those searches and bundled structures require no network. A description timeout withholds the recommendation and leaves all existing starters available. Chat requires live PubChem retrieval; its geometry is never silently replaced by an offline fixture. Live OMol25 browsing can be unavailable or warming, and the catalogue recommendation is not a claim about the complete research dataset.

Before presenting, build and sign the native app from the final main revision on the Mac, regenerate the Xcode project, and rehearse on the actual demo phone: camera/trust, room mapping, spawn/throw/keep, sound/haptics and Return-to-Home. Record the installed revision and device. A prior Apple SDK compile or a Simulator launch does not accept the newly added screen or physical AR.

Install/refresh the plugin in the intended ChatGPT account and verify its six tools, molecule-v3 resource, source retrieval and pin follow-up in the actual host. Development package validation is not plugin publication; support/privacy/terms/category metadata and an installed-host recording remain publisher tasks for a public listing. A private investor demo and store publication have different acceptance evidence.

The work receipt records source/CI/deployment results separately. Do not mark the app demo-ready from Linux package tests, or the installed plugin ready from the SDK fixture host.
