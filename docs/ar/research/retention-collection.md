# Lupi Trophy Case: what keeps people coming back to a persistent AR collection

Research report, 2026-10-04. Lupi-internal facts are cited by repo path; every external claim has a URL. Where I could not confirm something, it is marked **UNCONFIRMED**.

---

## 0. Bottom line

1. **AR by itself does not bring people back. Collecting, a daily habit and a sense of ownership do.**
   - Niantic's CTO said most people play Pokémon GO with AR mode off and use AR "to occasionally pose with and share photos" ([AR Insider](https://arinsider.co/2019/04/10/the-age-old-question-is-pokemon-go-ar/)).
   - John Hanke put the ideal AR interaction at two to three minutes ([AR Insider, GDC](https://arinsider.co/2019/04/29/data-point-of-the-week-ars-3-minute-sweet-spot-in-pokemon-go/)).
   - Pokémon GO still had more than 100 million unique players in 2024 ([Savvy/Scopely](https://savvygames.com/news/scopely-to-acquire-niantics-games-business)).
   - Peridot, an AR-first daily pet game, shuts down on 2026-08-31. Its makers said maintaining "an always-on AR experience" took "enormous investment" ([Peridot](https://playperidot.com/de/news/peridot-mobile-sunset)).
2. **Design implication.** The collection should live outside the camera: in a list, a widget, and ink drawings on the web. AR is a short visit, about three minutes, for placing, admiring and playing.
3. **Keep owning a molecule separate from where it sits in the room.** Apple's own docs warn that restoring a saved room map "strongly depends on the real-world environment": it is "less likely when lighting conditions or features of the local environment have changed over time" ([Apple](https://developer.apple.com/documentation/arkit/managing-session-life-cycle-and-tracking-quality)). A failed room match must never look like a lost trophy.
4. **On iPhone and iPad, Apple still does not manage persistence for you.**
   - The tool is still the saved room map, `ARWorldMap`, from iOS 12 ([doc](https://developer.apple.com/documentation/arkit/arworldmap)).
   - Apple's ARKit change log adds no iOS persistence API in June 2025 or June 2026 ([ARKit updates](https://developer.apple.com/documentation/updates/arkit)).
   - visionOS does manage it: `WorldAnchor` since visionOS 1.0, and in visionOS 26, windows, widgets and Quick Look content lock to rooms ([WWDC25-317](https://developer.apple.com/videos/play/wwdc2025/317/)). Apple's own devices have set the expectation that things stay put; on an iPhone you have to build that yourself.
5. **Lupi already has the hooks most collection apps lack:**
   - Daily, to earn a molecule.
   - Scan, to find one.
   - OMol25 picks, which are specimens with provenance.
   - Remix/Foil: cosmetic rarity with published odds that cannot be bought.
   - Instant Replay, ink drawings and USDZ/GLB desk models, for sharing and for durability.
6. **Lupi Daily already follows the ethical pattern.** Streaks are kept only on the device and a broken streak is simply not shown (`docs/daily.md`). That matches Wordle's no-notifications, three-minutes-a-day stance and the UK Children's Code. Keep it.
7. **Room maps are sensitive personal data.** Point clouds can be inverted back into images of the room ([Pittaluga et al., CVPR 2019](https://arxiv.org/abs/1904.03303)). Keep them on the device or in the user's private iCloud. Never put them on Lupi servers or third-party anchor clouds.
8. **Interest will dip on a predictable schedule.** A 14-week study of gamification (N=756) found the effect fell after about 4 weeks and recovered between weeks 6 and 10 ([Rodrigues et al. 2022](https://link.springer.com/article/10.1186/s41239-021-00314-6)). Plan content drops for weeks 4–6.

---

## 1. Case studies

### 1.1 Niantic: Pokémon GO, Peridot and the closures

- **Pokémon GO, AR as the photo moment**
  - Most players turn AR off because it makes play harder and drains the battery ([AR Insider](https://arinsider.co/2019/04/10/the-age-old-question-is-pokemon-go-ar/)).
  - Hanke: "AR in and of itself is not a magic bullet," and AR mode is best at two to three minutes ([AR Insider](https://arinsider.co/2019/04/29/data-point-of-the-week-ars-3-minute-sweet-spot-in-pokemon-go/)).
  - A survey of 1,190 players found that enjoyment, outdoor activity, ease of use, challenge and nostalgia predicted intent to keep playing. Privacy concerns did not ([Hamari et al., IJHCI 2019](https://researchportal.tuni.fi/en/publications/uses-and-gratifications-of-pok%C3%A9mon-go-why-do-people-play-mobile-l/)).
- **Buddy Adventure (2019-12-17): a care loop with AR as one input**
  - "Affection hearts" come from exploring, battling, playing with and feeding your buddy, and taking snapshots.
  - When the buddy's mood is "excited", hearts per action double ([pokemongo.com](https://pokemongo.com/news/buddyadventurelaunch)).
  - Lesson: AR care actions feed a progression that lives outside AR.
- **Pokémon Playgrounds (October 2024): persistent, shared AR at PokéStops**
  - Built on Niantic's Visual Positioning System (VPS). Niantic said anchors "have not been easy to persist across gameplay sessions" until now ([Niantic, now redirected](https://nianticlabs.com/news/pokemon-playgrounds)).
  - A placed buddy "stays there for 48 hours" ([Pocket Tactics](https://www.pockettactics.com/pokemon-go/playgrounds)).
  - A fan wiki gives up to 3 Pokémon per trainer and 7 per Playground ([fan wiki](https://pokemongo.fandom.com/wiki/Pok%C3%A9mon_Playground)).
  - Lesson: when persistent AR was shared and public, Niantic chose to make it expire and tie it to fixed places.
- **Peridot, an AR-first virtual pet**
  - Launched globally 2023-05-09. You raise a "Dot" by feeding, petting, playing fetch and breeding.
  - Critics praised the AR but criticised the monetisation ([Wikipedia](https://en.wikipedia.org/wiki/Peridot_(franchise))).
  - AppMagic estimates $2.9M in in-app purchase revenue and 1.9M downloads in its lifetime ([MobileGamer.biz](https://mobilegamer.biz/niantic-is-closing-its-virtual-pet-game-peridot/)).
  - Purchases stopped 2026-04-23, store removal 2026-05-14, servers close 2026-08-31. Players lose their Dots and are told to "save your Dot Cards, screenshots and videos" ([Peridot](https://playperidot.com/de/news/peridot-mobile-sunset)).
- **Other closures**
  - Harry Potter: Wizards Unite closed 2022-01-31 ([TechCrunch](https://techcrunch.com/2021/11/02/harry-potter-wizards-unite-shut-down-niantic/)).
  - Minecraft Earth closed 2021-06-30. Microsoft said the game depended on "free movement and collaborative play", which the pandemic made impossible ([GeekWire](https://www.geekwire.com/2021/microsoft-owned-mojang-studios-shutting-ar-powered-minecraft-earth-game-june/)).

### 1.2 Placement: IKEA and Apple

- **IKEA Place (2017-09-12)** was built on ARKit with true-to-scale products, and IKEA claimed 98% scaling accuracy ([IKEA](https://ikea.com/global/en/newsroom/innovation/ikea-launches-ikea-place-a-new-app-that-allows-people-to-virtually-place-furniture-in-their-home-170912/)). It grew into IKEA Kreativ, which scans the room and can erase existing furniture ([MIXED](https://mixed-news.com/en/ikea-app-now-deletes-your-furniture-and-replaces-it-with-your-own/)). It is a utility, so it has no return loop; its strength is that placement is believable.
- **Apple's own placement rules (HIG)** ([HIG AR](https://developer.apple.com/design/human-interface-guidelines/augmented-reality)):
  - Place the object immediately, then refine its position as surface detection improves.
  - Use the system coaching view.
  - Hide placed objects while the session relocalizes, and let people cancel relocalization.
  - Use friendly words ("Unable to find a surface", not "plane").
  - Avoid encouraging large or sudden movements.
- **visionOS 26 widgets are Apple's own trophy shelf**
  - Placed on a surface, a widget "locks it into its persistent position". On a desk or shelf it "gently tilts towards the person placing it" and "casts a shadow".
  - Copies snap into a grid on walls, and they persist "even when ... the device's turned off" ([WWDC25-255](https://developer.apple.com/videos/play/wwdc2025/255/)).
  - Windows, volumes and Quick Look 3D content can also lock to rooms ([WWDC25-290](https://developer.apple.com/videos/play/wwdc2025/290/), [WWDC25-317](https://developer.apple.com/videos/play/wwdc2025/317/)).
  - Copy these cues on the phone: the tilt toward the viewer, a grounding shadow, and grid snapping.

### 1.3 Collectible and physical-anchor AR

- **LEGO Hidden Side** sold physical sets with an AR ghost-hunting app. The theme ran from August 2019 to December 2020 and the app was discontinued on 2023-01-01, which removed its main functions ([Wikipedia](https://en.wikipedia.org/wiki/Lego_Hidden_Side), [Brick Fanatics](https://www.brickfanatics.com/lego-hidden-side-officially-discontinued)).
- Lesson from Hidden Side and Peridot: when the app dies, the collection dies. "Permanent remembrance" therefore needs a durability promise: export, and an open format.
- **Merge Cube** is a printed physical object that AR content snaps onto. Its school platform includes a teacher dashboard that manages "student virtual object collections" ([retail listing](https://stemfinity.com/collections/augmented-reality-ar/products/stemfinity-merge-cube); vendor claims). A physical anchor solves tracking and gives you something to hold.

### 1.4 Care and check-back loops (non-AR evidence)

- **Tamagotchi** had shipped 100 million units by 2025-07-31 ([Bandai Namco](https://www.bandainamco.co.jp/en/ir/library/newsletter82_special.html)).
- **Neko Atsume**
  - Cats visit while the app is closed, leave gifts, and are photographed into an album. There is no ending: "cats will continue to come as long as the player puts out food."
  - 10M downloads by 2015-12-04 ([Wikipedia](https://en.wikipedia.org/wiki/Neko_Atsume)).
  - Lesson: "what happened while I was away" is a gentle reason to look.
- **Duolingo**
  - Learners who reach a 7-day streak are 3.6 times more likely to finish their course.
  - Letting learners hold two Streak Freezes raised daily active learners by 0.38%, based on research that a little slack motivates more than rigid rules ([Duolingo](https://blog.duolingo.com/how-duolingo-streak-builds-habit/)).
  - CURR (the chance a user returns this week after using the app the previous two weeks) was their biggest lever. Leaderboards raised learning time 17%. Daily active users grew 4.5 times over four years.
  - They capped the number of notifications to avoid the opt-out collapse that hit Groupon ([Lenny's Newsletter](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth)).
- **Wordle**
  - One puzzle a day, no notifications, no endless play. In Wardle's words, it "encourages you to spend three minutes a day. And that's it." ([AP via Boston.com](https://www.boston.com/news/national-news/2022/01/04/he-made-wordle-for-his-partner-now-its-an-online-hit/), [NPR](https://www.npr.org/2022/01/12/1071840091)).
- **Pokémon TCG Pocket (launched 2024-10-30)**
  - 150M downloads by its first anniversary; daily social mechanics such as sending a card to each friend every day ([DeNA](https://dena.com/intl/news/4758/)).
  - About $1.3B in first-year revenue (AppMagic estimate, [Pocket Tactics](https://www.pockettactics.com/pokemon-tcg-pocket/first-year-profit)).
  - Reported "490 million+ showcases", i.e. card displays (press report of an official video, **UNCONFIRMED** against the video; [GoNintendo](https://gonintendo.com/comments/19252)).
  - Lesson: a daily opening ritual, rarity and a surface to show things off are powerful. Pocket monetises randomness; Lupi should not.

### 1.5 Museum and education AR

- **Smithsonian "Skin and Bones"**: visitors who saw the AR "stayed longer with the app, stayed longer at the exhibit, they stopped more often", went looking for more AR content, and rated their visit higher ([MooshMe evaluation](https://mooshme.org/2016/06/skin-in-the-game-evaluating-augmented-reality-in-the-smithsonian-bone-hall)). AR works when it shows something you cannot otherwise see.
- **Kinfolk**: curated AR monuments with primary sources, aimed at middle school ([Hechinger Report](https://hechingerreport.org/building-virtual-monuments-to-black-historical-figures/), [App Store story](https://apps.apple.com/us/iphone/story/id1720180384)).
- **moleculARweb** (EPFL, J. Chem. Educ. 2021): web AR on everyday devices; you print a marker and show it to the camera ([EPFL](https://actu.epfl.ch/news/augmented-reality-makes-chemistry-and-biology-acce)).
- **MolAR** (Stanford/Martínez): turns hand-drawn structures into AR molecules and lets you "hunt" chemicals in food and drink ([ChemRxiv](https://chemrxiv.org/engage/chemrxiv/article-details/613081028e38a3bd644709da), [App Store](https://apps.apple.com/us/app/-/id1559504847)). This is the closest precedent to Lupi Scan feeding a collection.
- **Meta-analysis**: across 64 studies (N=4,705), AR has a medium effect on learning gains, d=0.68 ([Garzón & Acevedo 2019](https://learntechlib.org/p//209849)).

### 1.6 Summary table

| Case | What kept people | What failed | Lesson for the trophy case |
|---|---|---|---|
| Pokémon GO | Collecting, outdoor play, events; AR for photos | AR as the main mode | AR is the short visit; the meta-game lives outside AR |
| Buddy Adventure | AR care feeds hearts and mood | — | Play in AR should feed a progression outside AR |
| Playgrounds | Shared persistent AR | — (experiment) | Public persistence was made to expire after 48 h |
| Peridot | Charming AR pet | Cost of always-on AR, monetisation, closure | Do not make the camera the daily requirement |
| Hidden Side, Peridot | — | Collections vanished with the app | Promise export and durability |
| IKEA | Believable scale | No reason to return | Placement quality is the minimum bar, not the hook |
| visionOS widgets | Persistence, tilt, shadow, grid | — | Copy the cues |
| Neko Atsume, Tamagotchi | Gentle check-back | — | Something new waits on the shelf |
| Duolingo, Wordle | Streaks with slack; three minutes a day | Notification fatigue risk | Protect the notification channel |
| Skin and Bones, MolAR | Revealing the invisible; hunting | Tied to a venue | AR should reveal chemical truth |

---

## 2. Collection mechanics that fit Lupi's existing hooks

### 2.1 Three layers: own it, place it, play with it

- **Collection (ownership).**
  - Durable, synced and exportable. Never lost because of tracking.
  - Remix r1 codes "resolve forever" (`AGENTS.md`), so a trophy's look is stable for life, which suits permanence.
- **Placement (pins).**
  - Best effort, tied to a room, recoverable.
  - Store transforms relative to a shelf root, not to the world, so re-placing one root restores the whole arrangement.
- **Play (state).**
  - Never changes the record.
  - This follows Lupi's existing rule that display motion "snaps back exactly at rest" and never reaches artifacts (`AGENTS.md`).
  - The IKEA-effect study supports this: labour leads to love only when creations are completed; when participants destroyed their creations, the attachment faded ([Norton, Mochon, Ariely 2012](https://dash.harvard.edu/handle/1/12136084)). Breaking must always re-form.

### 2.2 Ways to earn

| Source | What you get | Plaque line |
|---|---|---|
| Lupi Daily | That day's molecule, "minted" | "Daily No. 3 · solved on clue 3 · 3 Oct 2026" |
| Scan (photo to molecules) | A field find | "Found in: coffee mug" (private photo thumbnail) |
| OMol25 picks (24 rows) | A specimen with provenance | Row, charge, multiplicity, CC BY 4.0, "bonds inferred (lupi-bonds.molecular.v1)" |
| Library | A plain copy, free for any molecule | Name, formula, source |
| Remix roll | The trophy's finish (Foil 1 in 24) | "r1-K7QDM · Gold leaf" |
| Instant Replay | A moment attached to the trophy | "Thrown 3 Oct" |

- **Keep science free and make the story the prize.** Anyone can shelve any molecule. Earned editions carry provenance.
- **Bridging web and app.** Daily stats live only in browser localStorage on one device (`docs/daily.md`). A trophy earned on lupi.live needs an identity bridge to reach the app (see §3.5).

### 2.3 Rarity

- Foil already has the right shape (`AGENTS.md`):
  - About 1 in 24, each finish 1 in 72.
  - A pure function of the code text, with published odds.
  - Never in exports.
- Rules:
  - Earned by play, never sold.
  - If randomised items are ever sold, App Review 3.1.1 requires disclosing the odds before purchase ([guidelines](https://developer.apple.com/app-store/review/guidelines/)). For a kids audience, avoid paid randomness entirely.
- Decision needed: today "Show all finishes" unlocks every finish, and an unlocked finish is remembered only on that device. A trophy's Foil should probably be bound to the roll that earned it.

### 2.4 Sets

- **Why sets work.** Effort speeds up as people near a goal ([Kivetz, Urminsky, Zheng 2006](https://business.columbia.edu/faculty/research/goal-gradient-hypothesis-resurrected-purchase-acceleration-illusionary-goal)). Show "7 of 20".
- **Candidates:**
  - this month's Dailies;
  - the 20 amino acids;
  - the nucleobases A, C, G, T, U;
  - a "morning cup" of stimulants;
  - fullerenes;
  - the 24 OMol25 specimens;
  - "my kitchen" (Scan finds).
- **Coverage.** Whether Lupi's 69 molecule pages (`docs/daily.md`) cover these sets is **UNCONFIRMED** and needs an audit.
- **Fairness.** Sets should be completable without luck: no duplicate problems and no paywall.

### 2.5 Reactions and growth (truthful only)

- **Precedent.** Combination-discovery games such as Little Alchemy 2 ([site](https://littlealchemy2.com/)) show that combining things is fun.
- **Lupi's line.** Lupi's credibility depends on labelling what is inferred and what is illustrative. Prefer this order:
  1. **Aggregation ("Crystallize").** Many copies of one molecule become its real bulk structure: water to ice, NaCl to rock salt. Lupi already generates procedural lattices ("generate 100k copper fcc atoms", `AGENTS.md`). This path leads naturally to million-atom "monuments" earned over weeks.
  2. **Assembly.** Completing the amino-acid set unlocks a real protein from the PDB.
  3. **Reactions.** Only from a curated, chemist-reviewed table, labelled "illustrative" when animated. Lupi has no reaction data source today (**UNCONFIRMED**; none found in the docs).

### 2.6 Personalities grounded in Lupi's bond graph

Lupi already sorts every bond into covalent (solid stick), coordination (dashed) or ionic contact (dotted), and finds rings and symmetry (`AGENTS.md`, `docs/omol25-bonds-and-discovery.md`). Map those to personalities:

- **Rigid:** fused rings or cages (C60). Throwing it spins it into a symmetry detent.
- **Flexible:** chains of single bonds. Tug bends them.
- **Hinged:** coordination bonds wobble.
- **Breakable:** ionic contacts pop apart and re-form, like Burst.

The plaque says why ("Rigid: three fused rings"). Motion is labelled "Illustrative", as Lupi does today.

### 2.7 Cases and labels

- **Cases:** bell jar, specimen box, open plinth.
- **Plaque contents:** name, formula, magnification ("shown 10⁸×"), date and how it was earned, finish, source, bond rule.
- **Scale.** The HIG allows scaling objects in experiences that are not life-size, but warns against using scale to fake distance ([HIG AR](https://developer.apple.com/design/human-interface-guidelines/augmented-reality)). Stating the magnification turns that into a lesson.
- **Off-camera representation.** Use the existing ink drawings (`/og/m/<id>-ink.svg`) for the collection grid and widget.

### 2.8 Sharing a shelf

- **What a share contains.** A link holds the arrangement: trophy ids, Remix codes and positions relative to the shelf root. It never contains the room map.
- **What the recipient sees.** On the web, a zero-canvas ink page like `/m`. In the app, they place your shelf in their own room.
- **Visiting in the same room.**
  - Saved room maps can be sent to a nearby device over Multipeer (iOS 12, [sample](https://developer.apple.com/documentation/arkit/creating-a-multiuser-ar-experience)).
  - Live shared sessions use ARKit collaboration (iOS 13, [doc](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/iscollaborationenabled)).
- **No public pins.** Leave public places to link sharing, following the Playgrounds lesson about expiry and moderation.

---

## 3. Per-user persistence and privacy

### 3.1 What users expect

- When they reopen the app, the molecule is exactly where they left it. Vision Pro owners already get this from the system.
- If that fails: "my things are safe."
- **Today Lupi meets neither.** Room AR is a Viro scene limited to 512 atoms, with an "opaque in-memory session", and has no physical-device receipt (`docs/mobile-expo.md`).

### 3.2 Apple toolbox (versions checked against developer.apple.com)

| Capability | API | Introduced |
|---|---|---|
| Save and restore a map with its anchors | [`ARWorldMap`](https://developer.apple.com/documentation/arkit/arworldmap), [`initialWorldMap`](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/initialworldmap), [`worldMappingStatus`](https://developer.apple.com/documentation/arkit/arframe/worldmappingstatus-swift.property) | iOS 12.0 |
| Coaching, including relocalization and Start Over | [`ARCoachingOverlayView`](https://developer.apple.com/documentation/arkit/arcoachingoverlayview) | iOS 13.0 |
| LiDAR room mesh (iPhone 15 Pro has [LiDAR](https://support.apple.com/en-us/111829)) | [`sceneReconstruction`](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/scenereconstruction) | iOS 13.4 |
| Printed plinth card | [`ARImageAnchor`](https://developer.apple.com/documentation/arkit/arimageanchor) / [`ARImageTrackingConfiguration`](https://developer.apple.com/documentation/arkit/arimagetrackingconfiguration) | iOS 11.3 / 12.0 |
| App Clip Code anchor | [`ARAppClipCodeAnchor`](https://developer.apple.com/documentation/arkit/arappclipcodeanchor) | iOS 14.3 |
| Track physical objects at full frame rate | [`trackingObjects`](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/trackingobjects) (new `.referenceobject` format) | iOS 27.0 |
| GPU instancing, per-entity gestures | [`MeshInstancesComponent`](https://developer.apple.com/documentation/realitykit/meshinstancescomponent), [`GestureComponent`](https://developer.apple.com/documentation/realitykit/gesturecomponent) | iOS 26.0 |
| 6DOF manipulation | [`ManipulationComponent`](https://developer.apple.com/documentation/realitykit/manipulationcomponent) | visionOS 26 only |
| Anchors the system persists | [`WorldAnchor`](https://developer.apple.com/documentation/arkit/worldanchor); [shared with nearby participants](https://developer.apple.com/documentation/arkit/worldanchor/issharedwithnearbyparticipants) | visionOS 1.0; sharing visionOS 26 |

Whether iOS 27 has shipped to the public is assumed but **UNCONFIRMED** here; Apple's docs list these APIs as 27.0.

### 3.3 When relocalization fails: a recovery ladder

Relocalization is ARKit matching a saved map to the room it sees now. Apple: if the room has changed, the session can stay "relocalizing" indefinitely, so offer a reset ([doc](https://developer.apple.com/documentation/arkit/managing-session-life-cycle-and-tracking-quality)).

0. **Open on the collection, not the camera.** Trophies appear at once as ink or 3D.
1. **Camera on, trophies hidden** while it relocalizes (HIG). Show the snapshot saved with the map, the technique Apple's own sample uses ([sample](https://developer.apple.com/documentation/arkit/saving-and-loading-world-data)), plus a ghost outline.
2. **After a short wait** (the right length is **UNCONFIRMED**; test it), offer "Put the shelf here". This re-places the shelf root and the arrangement comes back with it.
3. **Plinth card or App Clip Code**, if present: re-anchor instantly, independent of the device.
4. **"Show it on the table instead"**: a non-AR cabinet.

Two more rules:

- Override `coachingOverlayViewDidRequestSessionReset`. By default, Start Over "removes any existing anchors" ([doc](https://developer.apple.com/documentation/arkit/arcoachingoverlayview)).
- Re-save the map after each successful match, because maps captured "only moments beforehand" relocalize easily. Keeping day and night maps per shelf might help further; that is **UNCONFIRMED**.

### 3.4 iPhone plus iPad

- **The collection** syncs through iCloud.
- **Pins.** Apple documents sending room maps between devices ([doc](https://developer.apple.com/documentation/arkit/arworldmap)), so a shelf's map can be stored as a CKAsset, which CloudKit encrypts by default ([doc](https://developer.apple.com/documentation/cloudkit/ckrecord/encryptedvalues)).
- **Open risk.** How reliably an iPad matches a map recorded on an iPhone, at a different height and with a different camera, is **UNCONFIRMED**. Fallbacks: re-place the shelf root, or use the plinth card. Map file sizes are also **UNCONFIRMED**.

### 3.5 Accounts or iCloud

**Recommendation: iCloud first.** No sign-up, private database, SwiftData sync ([doc](https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices)).

What App Review requires ([guidelines](https://developer.apple.com/app-store/review/guidelines/), updated 2026-06-08):
- 5.1.1(v): without significant account-based features, let people use the app without a login.
- 5.1.1(v): if the app supports creating an account, it must offer deleting it in the app.
- 4.8: a Google or GitHub login for the primary account needs an equivalent privacy-preserving login option, such as Sign in with Apple.

Use a Lupi (Firebase) account only for the web bridge and sharing. The pre-spend audit already flagged public owner emails in saved views (`docs/pre-spend-retention-audit.md`); do not repeat that pattern.

### 3.6 Privacy of room data

- `ARWorldMap` contains `rawFeaturePoints` that "loosely correlate to the contours of real-world objects" ([doc](https://developer.apple.com/documentation/arkit/arworldmap/rawfeaturepoints)). Point clouds can be inverted back into images ([Pittaluga et al.](https://arxiv.org/abs/1904.03303)). Snapshots are literally photos of the home.
- **Rules:**
  - Device or private iCloud only.
  - Deleting a shelf deletes its map.
  - Explain the camera use in context, before the system prompt ([HIG Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy)).
- **Avoid third-party anchor clouds.**
  - ARCore Cloud Anchors upload visual data to Google (persistence of 1–365 days) ([Google](https://developers.google.com/ar/develop/ios/cloud-anchors/quickstart)).
  - Azure Spatial Anchors was retired on 2024-11-20 ([Microsoft](https://azure.microsoft.com/updates/azure-spatial-anchors-retirement)), a reminder that these platforms can disappear.

### 3.7 Kids and education

- **COPPA.** The amended rule took effect 2025-06-23, with compliance due 2026-04-22 ([White & Case](https://www.whitecase.com/insight-alert/unpacking-ftcs-coppa-amendments-what-you-need-know)). Keeping maps and photos off Lupi servers shrinks the exposure. This is not legal advice.
- **Kids Category (1.3, 5.1.4).** No links out or purchases without a parental gate; no third-party analytics.
- **Age.** Declared Age Range (iOS 26) gives a privacy-preserving way to gate sharing and notifications by age ([doc](https://developer.apple.com/documentation/declaredagerange)).
- **UK Children's Code.** It names reward loops and notifications as "sticky" features and asks for "pause buttons ... without losing their progress" ([ICO Std 5](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/5-detrimental-use-of-data/)).
- **Schools.** Managed Apple Accounts' CloudKit app data can be accessed by the institution's inspectors ([Apple](https://support.apple.com/en-gb/guide/apple-school-manager/axm78b477c81/web)). A printed plinth card per desk would let 30 iPads find the same spot, on the Merge Cube model.

---

## 4. Session design

### 4.1 The first 60 seconds

| Time | What happens |
|---|---|
| 0–5 s | A molecule is already in hand (today's Daily or caffeine), drawn in ink and lighting up. No account, no camera yet. |
| 5–15 s | "Put it somewhere" is the moment the camera prompt appears, with an explanation first. Coaching overlay. LiDAR makes placement near-instant. |
| 15–30 s | Placed instantly, refined quietly. Shadow and plinth, a haptic thunk ([Core Haptics](https://developer.apple.com/documentation/corehaptics), iOS 13). |
| 30–50 s | One verb (Poke or Flick), taught by doing ([HIG Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding); [TipKit](https://developer.apple.com/documentation/tipkit), iOS 17). |
| 50–60 s | "Look around the shelf so I can remember it": save only once mapping is good enough (`.extending` or `.mapped`). Then promise: "It will be here tomorrow." |

### 4.2 The daily loop: about three minutes of AR

1. The widget shows today's silhouette ([WidgetKit](https://developer.apple.com/documentation/widgetkit), iOS 14; interactive widgets in iOS 17 per [WWDC23](https://developer.apple.com/videos/play/wwdc2023/10028/)).
2. Solve the Daily in 2D.
3. A "delivery" waits wrapped on the shelf, the Neko Atsume pattern.
4. Unwrap it, play, check set progress, leave.

### 4.3 Planning for novelty decay

- Ship a new verb or set at weeks 4–6 (the Rodrigues dip).
- Run seasons, for example a periodic-table season.
- Make crystals and monuments long arcs measured in weeks.

### 4.4 Notification ethics

- Opt-in only. Notifications must not be required for the app to work, and marketing pushes need explicit consent (App Review 4.5.4).
- At most one a day, at a time the user chooses, with a passive interruption level ([`UNNotificationInterruptionLevel`](https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel), iOS 15).
- Never send repeats for the same thing ([HIG](https://developer.apple.com/design/human-interface-guidelines/notifications)).
- No streak-loss threats. None at all for under-13s.
- Prefer the widget. Duolingo shows notifications work; Wordle shows you can win without them.

### 4.5 Accessibility in AR

| Lupi comfort level | AR behaviour |
|---|---|
| Standard | Throws coast and bounce inside "soft walls" near the shelf |
| Gentle | No coast, half-strength motion (matches the viewer) |
| Still | Nothing moves on its own; throws land instantly; the default when [Reduce Motion](https://developer.apple.com/documentation/uikit/uiaccessibility/isreducemotionenabled) is on |

- **Idle motion.** Avoid sustained oscillation near 0.2 Hz ([WWDC23 vision and motion](https://developer.apple.com/videos/play/wwdc2023/10078/); [HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)).
- **Foil sweeps.** Keep them under 3 flashes a second ([W3C XAUR REQ 16b](https://www.w3.org/TR/xaur/)).
- **Throws** are flicks on the screen, not arm swings (HIG safety guidance).
- **Seated or low-mobility use.** Offer a non-AR cabinet ("motion-agnostic" interaction, XAUR REQ 2a).
- **VoiceOver.** Describe each trophy with [`AccessibilityComponent`](https://developer.apple.com/documentation/realitykit/accessibilitycomponent) (iOS 17), e.g. "Caffeine, left of the shelf, Gold leaf."

---

## 5. Still unconfirmed

- How reliably an iPad matches a room map recorded on an iPhone.
- Typical map sizes.
- How long to wait before offering to re-place.
- Whether keeping several maps per shelf (day and night) helps.
- Whether iOS 27 has shipped to the public.
- Whether Lupi's library covers the proposed sets.
- Whether any reaction dataset exists for Lupi.
- TCG Pocket's showcase count.

---

## 6. Questions for the owner

1. Which iPad model is it? Does it have LiDAR?
2. One shelf, or several rooms?
3. Can people shelve anything for free, or only earned molecules?
4. iCloud only, or a Lupi account too? How should trophies earned on the web reach the app?
5. Who is the main audience: adults, families, or classrooms (which brings the Kids Category)?
6. Monetisation, if any, given that rarity should never be sold?
7. Must breakable molecules always re-form?
8. Is a printed plinth card acceptable?
9. Should Foil appear on exported trophies?
10. Is the million-atom piece an earned monument, or available on day one?
11. Can people visit each other's shelves remotely?
12. Can there be a minimum iOS version? `trackingObjects` needs iOS 27.

---

## 7. Three product concepts

**A. The Specimen Cabinet**
- One personal shelf.
- Trophies are earned from Daily, Scan and OMol25, with museum plaques, sets, personalities and Foil.
- An optional printed plinth card for instant re-anchoring.
- Trade-offs:
  - Fastest to ship, with the strongest daily habit and the lowest privacy risk.
  - Limited depth over the long term.
  - The "still there tomorrow" promise depends on the recovery ladder.

**B. The Crystal Garden**
- Collecting building blocks lets you crystallize or assemble real bulk structures and proteins, up to room-scale million-atom monuments that grow over weeks.
- Trade-offs:
  - The best answer to the dip at weeks 4–6, a natural home for the million-atom challenge, and strong teaching value.
  - Needs curated, truthful structure data and heavy rendering work.
  - A risk of chemistry that looks fake unless it is labelled carefully.

**C. Shelf Exchange (social and classroom)**
- Several named shelves.
- Shareable arrangement links with ink pages on the web.
- Visits in the same room, teacher-curated class cases, and time-limited "exhibits".
- Trade-offs:
  - Spreads through sharing and opens an education channel.
  - Brings moderation, kids compliance and network-effect cold-start problems, and is the most complex to build.

**Recommendation:** build A on the three-layer model of ownership, placement and play, so that B and C can be added later. Prototype B's "Crystallize" as the million-atom hook.