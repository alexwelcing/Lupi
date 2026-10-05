# Lupi AR: data contracts (v1)

*2026-10-04. The exact shapes the native app (`apps/apple`) and LupiKit read and write, for the [plan of record](plan.md). Three are new: `lupi.trophy.v1` (the collection record), `lupi.shelf.v1` (an on-device arrangement) and `lupi.personality.v1` (derived on device). Section 4 lists the existing lupi.live endpoints the app reads, each checked against the code that serves it.*

## 0. Conventions

- **JSON** keys are camelCase. Every top-level record carries `schema` with its exact id.
- **Dates** are ISO 8601 UTC strings with milliseconds, `2026-10-04T17:40:57.741Z` (the format `featured.v1.json` uses). Fixed width means they sort as strings, which the account sync relies on (§5). Readers accept them with or without fractional seconds.
- **Lengths:** molecular coordinates are in ångström; placements are in metres. A toy scale is metres per ångström (0.015 means 1 Å is drawn as 1.5 cm, a magnification of 1.5 × 10⁸).
- **Rotations** are unit quaternions `[x, y, z, w]`, the order `lupi.object-facts.v1` uses for `principalQuat`.
- **Ids** are UUID strings exactly as Swift's `UUID` encodes them (uppercase hex with hyphens). A Firestore document id is the same string.
- **Hashes** are SHA-256, 64 lowercase hex characters.
- **Formulas** are Hill formulas (C first, H second, then alphabetical; without carbon, all alphabetical), with no charge.
- **Compatibility:** inside v1, fields may only be added, and only as optional. Readers ignore fields they do not know, and writers write only the fields they know. Anything else is a v2 with a new schema id.
- **Swift:** each contract is a LupiKit `Codable, Sendable, Hashable` value type. Vectors use `SIMD3<Float>` and `SIMD4<Float>`, which are in the standard library and encode as JSON arrays, so the types build on Linux without `simd`. LupiKit owns one shared encoder and decoder for the date format; golden JSON fixtures in its tests pin every example below.

---

## 1. `lupi.trophy.v1`

One molecule in the user's collection. A record is created when a molecule is pinned on a shelf or kept with one tap (plan §6.3). It lives in the device store and, when signed in, on the Lupi account (§5). It never contains a room map, a placement or a camera image.

### 1.1 Swift

```swift
public struct TrophyRecord: Codable, Sendable, Hashable, Identifiable {
    public static let schemaID = "lupi.trophy.v1"
    public var schema: String              // == schemaID
    public var id: UUID
    public var name: String                // 1...80 characters, no control characters
    public var molecule: MoleculeRef
    public var origin: TrophyOrigin
    public var look: TrophyLook
    public var createdAt: Date
    public var updatedAt: Date             // >= createdAt; last-writer-wins key for sync
    public var deletedAt: Date?            // tombstone: set on delete, molecule.xyz dropped, record kept for sync
}

public enum MoleculeSource: String, Codable, Sendable, Hashable {
    case gallery, omol25, pubchem, built, fragment
}

public struct MoleculeRef: Codable, Sendable, Hashable {
    public var source: MoleculeSource
    public var id: String?                 // gallery page id, "<collection>:<row>", or "cid:<n>"
    public var url: URL?                   // where the coordinates came from (https)
    public var sha256: String              // over the exact coordinate bytes (§1.3)
    public var formula: String             // Hill formula of the atoms as played
    public var atoms: Int                  // atom count, >= 1
    public var xyz: String?                // embedded XYZ (§1.4)
}

public struct TrophyOrigin: Codable, Sendable, Hashable {
    public enum Kind: String, Codable, Sendable, Hashable { case spawned, broken, built }
    public var kind: Kind
    public var at: Date                    // when it was spawned, broken off or completed
    public var parent: ParentRef?          // required for .broken
    public var parts: [String]?            // .built: the pieces joined, in snap order (formulas), at most 64
}

public struct ParentRef: Codable, Sendable, Hashable {
    public var name: String
    public var formula: String
    public var source: MoleculeSource
    public var id: String?                 // the parent's MoleculeRef.id, when it had one
    public var trophyId: UUID?             // when the parent was itself a trophy
}

public struct TrophyLook: Codable, Sendable, Hashable {
    public var scale: Float                // toy scale when kept, metres per ångström (0.0005...0.5)
    public var finish: String?             // reserved: "holo" | "gold-leaf" | "pearl"; v1 writes none
}
```

### 1.2 JSON

A gallery molecule left on a shelf:

```json
{
  "schema": "lupi.trophy.v1",
  "id": "6F1C2D9E-3B7A-4E58-9C21-0A5D7B8E4F13",
  "name": "Caffeine",
  "molecule": {
    "source": "gallery",
    "id": "caffeine",
    "url": "https://lupi.live/gallery/curated/popular/caffeine.xyz",
    "sha256": "<64 hex: SHA-256 of the file as the molecule page prints it>",
    "formula": "C8H10N4O2",
    "atoms": 24
  },
  "origin": { "kind": "spawned", "at": "2026-10-04T18:02:11.204Z" },
  "look": { "scale": 0.0156 },
  "createdAt": "2026-10-04T18:02:41.877Z",
  "updatedAt": "2026-10-04T18:02:41.877Z"
}
```

A fragment broken off a hydrogen peroxide (PubChem CID 784) and kept:

```json
{
  "schema": "lupi.trophy.v1",
  "id": "B0E4A1C7-58D2-4F3B-A6E9-7C1D2F0A9B34",
  "name": "Hydroxyl (fragment)",
  "molecule": {
    "source": "fragment",
    "sha256": "<64 hex: SHA-256 of the xyz string's UTF-8 bytes>",
    "formula": "HO",
    "atoms": 2,
    "xyz": "2\nLupi fragment | formula=HO | charge_source=unavailable | parent=H2O2 | coordinates=lupi-play\nO 0.05749 0.00000 0.00000\nH -0.91251 0.00000 0.00000\n"
  },
  "origin": {
    "kind": "broken",
    "at": "2026-10-04T18:05:02.530Z",
    "parent": { "name": "Hydrogen peroxide", "formula": "H2O2", "source": "pubchem", "id": "cid:784" }
  },
  "look": { "scale": 0.031 },
  "createdAt": "2026-10-04T18:05:09.112Z",
  "updatedAt": "2026-10-04T18:05:09.112Z"
}
```

A molecule built from atoms:

```json
{
  "schema": "lupi.trophy.v1",
  "id": "2A7D4C10-9E3F-4B21-8D5A-6C0E1F7B2A98",
  "name": "Water",
  "molecule": {
    "source": "built",
    "sha256": "<64 hex>",
    "formula": "H2O",
    "atoms": 3,
    "xyz": "3\nLupi built | formula=H2O | charge_source=unavailable | coordinates=lupi-play\nO 0.00000 0.06558 0.00000\nH 0.75695 -0.52037 0.00000\nH -0.75695 -0.52037 0.00000\n"
  },
  "origin": { "kind": "built", "at": "2026-10-04T18:11:40.006Z", "parts": ["O", "H", "H"] },
  "look": { "scale": 0.025 },
  "createdAt": "2026-10-04T18:11:52.318Z",
  "updatedAt": "2026-10-04T18:11:52.318Z"
}
```

### 1.3 Rules per source

| `source` | `id` | `url` | `xyz` | `sha256` over | `origin.kind` |
|---|---|---|---|---|---|
| `gallery` | the `/m/manifest.json` page id (`[a-z0-9_]+`) | `https://lupi.live` + the page's `file` | absent | the file's text with CRLF normalized to LF, which equals the SHA-256 the molecule page prints (`scripts/molecule-pages/catalog.mts:334`) | `spawned` |
| `omol25` | `<collection>:<row>`, collection one of `neutral-train`, `neutral-validation`, `all-train-preview`, `train-4m-preview`, `validation-preview` (`packages/core/src/omol25/collections.ts`) | the edge structure URL, or for a featured pick its same-origin XYZ (§4) | absent | the response body; for a featured pick it must equal the pick's `sha256` in `featured.v1.json` | `spawned` |
| `pubchem` | `cid:<n>` | the PUG-REST record URL that was used (`…/record/JSON?record_type=3d`) | present: the app embeds the 3D coordinates so the trophy survives upstream changes | the embedded `xyz` | `spawned` |
| `built` | absent | absent | required | the embedded `xyz` | `built` |
| `fragment` | absent | absent | required | the embedded `xyz` | `broken` |

Further rules:

- `atoms` equals the atom count of the coordinates. A record may reference any size (a million-atom gallery structure is one record), but `xyz` is embedded only up to 2,000 atoms, the cap of `lupi-bonds.molecular.v1` (`MOLECULAR_RECIPE_MAX_ATOMS`, `packages/core/src/bonds/classes.ts`). That also keeps an account document far below Firestore's 1 MiB limit.
- A piece of a LupiScale structure, of any count up to a googolplex and beyond, is `source: scale` with the optional `molecule.scale` reference (`lupi.scale-ref.v1`). Both are additive to v1 and are specified in [scale-spec.md §7.4](scale-spec.md) (D14); they land before M1.
- `formula` is recomputed from the coordinates by LupiKit, never copied from a label.
- A fragment of a fragment is `kind: broken` with `parent.source: fragment`.
- An OMol25-derived fragment or built molecule keeps OMol25's CC BY 4.0 attribution: its XYZ comment carries `source=omol25:<collection>:<row>` and `license=CC-BY-4.0`, and the app shows the attribution with it.
- The origin story shown in the Cabinet is derived from `origin`, not stored: "Spawned 4 Oct 2026", "Broken from Hydrogen peroxide", "Built from atoms: O, H, H".

### 1.4 Embedded XYZ

- Standard XYZ: the atom count, one comment line, then `Symbol x y z` per atom in Å, five decimals, centred on the centre of mass, in the body frame the molecule had when kept.
- The comment line uses the edge's `key=value | key=value` style and always includes `charge_source=unavailable` unless a charge is genuinely known. Declared chemistry is what makes the web parser attach `Frame.chemistry` (`packages/parsers/src/xyzParser.ts`, `readChemistry`), so a single-frame file of at most 2,000 atoms gets `lupi-bonds.molecular.v1` on auto (`packages/core/src/bonds/select.ts`), the same recipe the app played it with. A built or broken molecule therefore reloads with the bonds it had, on the web and in the app.
- Keys: `formula=`, `charge_source=`, optionally `parent=<formula>`, `source=`, `license=`, and `coordinates=lupi-play`. Values contain no spaces.

---

## 2. `lupi.shelf.v1`

One room's arrangement. **On device only** (D7): never synced, never uploaded, excluded from backup. Files live under `Application Support/Lupi/Shelves/<shelf id>/`.

### 2.1 Swift

```swift
public struct ShelfRecord: Codable, Sendable, Hashable, Identifiable {
    public static let schemaID = "lupi.shelf.v1"
    public var schema: String              // == schemaID
    public var id: UUID
    public var name: String                // "Living room"; 1...40 characters
    public var worldMapFile: String        // "world.arworldmap": NSKeyedArchiver data of ARWorldMap
    public var rootAnchorId: UUID          // ARAnchor.identifier of the anchor named "lupi.shelf.root"
    public var snapshotFile: String?       // "snapshot.jpg": camera image at the last map save
    public var placements: [ShelfPlacement]
    public var createdAt: Date
    public var updatedAt: Date
    public var mapSavedAt: Date?           // last successful getCurrentWorldMap save
    public var mapStatusAtSave: String?    // "mapped" | "extending"
    public var lastRelocalizedAt: Date?
}

public struct ShelfPlacement: Codable, Sendable, Hashable {
    public var trophyId: UUID              // a lupi.trophy.v1 id
    public var transform: RootTransform    // relative to the shelf root anchor
    public var pinnedAt: Date
}

public struct RootTransform: Codable, Sendable, Hashable {
    public var translation: SIMD3<Float>   // metres, in the root anchor's frame
    public var rotation: SIMD4<Float>      // unit quaternion [x, y, z, w]
    public var scale: Float                // toy scale, metres per ångström
}
```

### 2.2 JSON

```json
{
  "schema": "lupi.shelf.v1",
  "id": "9D3E0B7A-1C42-4F6E-8A5B-3E7F0C2D1A64",
  "name": "Living room",
  "worldMapFile": "world.arworldmap",
  "rootAnchorId": "41C8E2F0-7B3D-4A9E-B615-D2E0F3A7C958",
  "snapshotFile": "snapshot.jpg",
  "placements": [
    {
      "trophyId": "6F1C2D9E-3B7A-4E58-9C21-0A5D7B8E4F13",
      "transform": { "translation": [0.18, 0.042, -0.05], "rotation": [0, 0.3827, 0, 0.9239], "scale": 0.0156 },
      "pinnedAt": "2026-10-04T18:02:41.877Z"
    }
  ],
  "createdAt": "2026-10-04T18:02:41.877Z",
  "updatedAt": "2026-10-04T18:02:47.020Z",
  "mapSavedAt": "2026-10-04T18:02:47.020Z",
  "mapStatusAtSave": "mapped"
}
```

### 2.3 Rules

- The root is an `ARAnchor` named `lupi.shelf.root`, added at the first pinned trophy's support point. Moving the root ("Put the shelf here") rewrites nothing in `placements`: they are relative to it.
- A map is saved only when `worldMappingStatus` is `.mapped` or `.extending` ([apple-ar-platform.md §2.1](research/apple-ar-platform.md)), and re-saved after each successful relocalization.
- A placement whose trophy no longer exists in the collection is dropped on load. A trophy may appear in at most one placement across all shelves; pinning it elsewhere moves it.
- Deleting a shelf deletes its directory: map, snapshot and record. Deleting the account does not touch shelves; "Erase this device's collection" does.
- At most 60 placements per shelf (plan §3.4).
- A placement of a `source: scale` trophy stores `scale = 0` and an optional `spanMetres`, because metres per ångström cannot express a googolplex at 20 cm ([scale-spec.md §7.5](scale-spec.md)).

---

## 3. `lupi.personality.v1`

How a molecule feels in play. **Derived on device** from the molecule's game graph by the fixed rule set `lupi.personality.rules.v1` (plan §4.3), cached locally by `molecule.sha256` plus the rules id, never synced. Changing any number in the rules means a new rules id, so cached personalities are recomputed.

### 3.1 Swift

```swift
public struct Personality: Codable, Sendable, Hashable {
    public static let schemaID = "lupi.personality.v1"
    public enum Kind: String, Codable, Sendable, Hashable { case rigid, flexible, brittle, bouncy }
    public enum SoundFamily: String, Codable, Sendable, Hashable { case clack, thwap, tink, boing }

    public var schema: String              // == schemaID
    public var rules: String               // "lupi.personality.rules.v1"
    public var kind: Kind
    public var restitution: Float          // 0...1
    public var friction: Friction
    public var linearDamping: Float
    public var angularDamping: Float
    public var massScale: Float            // the kind's multiplier
    public var massKg: Float               // felt mass, 0.06...0.6
    public var breakSpeed: Float?          // m/s velocity change that breaks it; nil = unbreakable
    public var breakImpulse: Float?        // N·s, massKg × breakSpeed; nil = unbreakable
    public var squash: Float               // maximum visual squash, 0...1
    public var soundFamily: SoundFamily
    public var hapticSharpness: Float      // 0...1, Core Haptics hapticSharpness
    public var weakestBond: WeakestBond?   // nil for a single atom
    public var reasons: [String]           // plain-language plaque lines
}

public struct Friction: Codable, Sendable, Hashable {
    public var `static`: Float
    public var dynamic: Float
}

public struct WeakestBond: Codable, Sendable, Hashable {
    public enum Kind: String, Codable, Sendable, Hashable { case covalent, coordination, ionicContact }
    public var atoms: [Int]                // two atom indices, 0-based, into the molecule's coordinates
    public var elements: [String]          // two symbols
    public var kind: Kind
    public var order: Int?                 // 1, 2 or 3 for covalent, estimated from length (§3.3)
    public var energyKJPerMol: Float
    public var energySource: String        // "table" (cited mean bond enthalpy) or "game" (a game default)
}
```

### 3.2 JSON

Hydrogen peroxide (M = 34.01 Da):

```json
{
  "schema": "lupi.personality.v1",
  "rules": "lupi.personality.rules.v1",
  "kind": "brittle",
  "restitution": 0.2,
  "friction": { "static": 0.6, "dynamic": 0.45 },
  "linearDamping": 0.05,
  "angularDamping": 0.1,
  "massScale": 0.85,
  "massKg": 0.0874,
  "breakSpeed": 0.769,
  "breakImpulse": 0.0672,
  "squash": 0.03,
  "soundFamily": "tink",
  "hapticSharpness": 1.0,
  "weakestBond": {
    "atoms": [0, 1], "elements": ["O", "O"], "kind": "covalent", "order": 1,
    "energyKJPerMol": 142, "energySource": "table"
  },
  "reasons": ["Brittle: its O–O bond is weak (142 kJ/mol)"]
}
```

C₆₀ (M = 720.66 Da):

```json
{
  "schema": "lupi.personality.v1",
  "rules": "lupi.personality.rules.v1",
  "kind": "bouncy",
  "restitution": 0.85,
  "friction": { "static": 0.5, "dynamic": 0.35 },
  "linearDamping": 0.02,
  "angularDamping": 0.03,
  "massScale": 0.8,
  "massKg": 0.279,
  "breakSpeed": 6.5,
  "breakImpulse": 1.81,
  "squash": 0.25,
  "soundFamily": "boing",
  "hapticSharpness": 0.5,
  "weakestBond": {
    "atoms": [0, 1], "elements": ["C", "C"], "kind": "covalent", "order": 1,
    "energyKJPerMol": 346, "energySource": "table"
  },
  "reasons": ["Bouncy: a round cage of 60 carbons"]
}
```

### 3.3 The rules (`lupi.personality.rules.v1`)

Inputs: the coordinates and elements, the game graph (LupiKit's port of `lupi-bonds.molecular.v1`, forced for non-periodic frames of at most 2,000 atoms), rings, and the rotor type from the inertia facts (`atom`, `linear`, `spherical`, `oblate`, `prolate`, `asymmetric`, as in `packages/core/src/objectFacts/types.ts`).

1. **Bond order (estimate):** for a covalent bond, `ratio = length / (r_cov,i + r_cov,j)` with the Cordero single-bond radii of the element table. `ratio ≤ 0.84` is order 3, `≤ 0.92` order 2, otherwise 1. This stands in until `lupi-bond-orders.v1` exists.
2. **Bond energy (kJ/mol):** from the cited table when the pair and order are in it (C–H 411, C–C 346, C=C 614, C≡C 839, C=O 745, O–H 459, O–O 142, N≡N 941, H–H 432, F–F 155, I–I 149, N–N 167, C≡O 1072; [chemistry-play-physics.md §4.1](research/chemistry-play-physics.md)), `energySource: "table"`. Otherwise the game defaults: order 1 → 350, 2 → 600, 3 → 850, coordination 150, ionic contact 80, `energySource: "game"`.
3. **Weakest bond:** the lowest-energy bond over the whole graph; ties go to the lower atom indices.
4. **Kind** (first match wins):
   1. `brittle`: weakest energy < 200, or any coordination bond or ionic contact, or any 3- or 4-membered ring.
   2. `bouncy`: rotor `atom` or `spherical`, or every heavy atom is in a ring and there are at least 20 heavy atoms.
   3. `flexible`: at least 3 rotatable bonds. A bond is rotatable when it is covalent, order 1, not in a ring, and both of its atoms have at least 2 heavy-atom neighbours.
   4. `rigid` otherwise.
5. **Parameters by kind:**

| | rigid | flexible | brittle | bouncy |
|---|---|---|---|---|
| `restitution` | 0.35 | 0.15 | 0.20 | 0.85 |
| `friction.static` / `.dynamic` | 0.7 / 0.5 | 0.9 / 0.7 | 0.6 / 0.45 | 0.5 / 0.35 |
| `linearDamping` | 0.05 | 0.12 | 0.05 | 0.02 |
| `angularDamping` | 0.08 | 0.45 | 0.10 | 0.03 |
| base break speed (m/s) | 3.0 | 4.5 | 1.2 | 6.5 |
| `massScale` | 1.0 | 0.9 | 0.85 | 0.8 |
| `squash` | 0.06 | 0.18 | 0.03 | 0.25 |
| `soundFamily` | clack | thwap | tink | boing |
| `hapticSharpness` | 0.8 | 0.3 | 1.0 | 0.5 |

6. **Mass:** `massKg = max(0.06, b(M × massScale^2.5))`, with M the molar mass in Da from the element table (`µDa` integers, [scale-spec.md §5.3](scale-spec.md)) and `b` the curve `lupi.feltmass.v1` ([scale-spec.md §10.2](scale-spec.md)): `0.2 × (M / 180)^0.4` up to about 1,018 Da, so below it this is exactly `0.2 × (M / 180)^0.4 × massScale`; above it, a slow tail that never reaches 0.6. Masses keep their order to a googolplex instead of clamping at 2.8 kDa, and no personality reaches the ceiling. LupiKit's `LupiPlay` owns it as `FeltMass`, replacing `GameUnits`.
7. **Breaking:** `breakSpeed = base × sqrt(weakest energy / 346)`, and `breakImpulse = massKg × breakSpeed`. Both are `null` when the weakest energy is 800 kJ/mol or more (N₂, CO), and for a single atom.
8. **Reasons:** one line naming the rule that matched, in plain words and with the number it used.

These values are the contract. LupiKit's `PersonalityTable.v1` (`apps/apple/LupiKit/Sources/LupiPlay/Personality.swift` on `ar/kit`) currently differs, for example brittle `massScale` 1.1 and base break speed 2.5, and must be brought to this table before M0 exits. A node that is not a molecule (a crystal box, a tower level, a group) takes the personality of one materialized leaf ([scale-spec.md §10.6](scale-spec.md)).

---

## 4. Molecule sources the app reads

Every path below was checked against the code that serves it at HEAD `8416852`. Paths are relative to `https://lupi.live`. A native `URLSession` client is not subject to CORS, so the Worker's CORS allow-list does not apply.

**How lupi.live serves them.** The `lupi-edge` Worker serves the built web app from Workers static assets (`apps/mcp-worker/wrangler.toml`: `[assets] directory = "../web/dist"`, `binding = "WEB_ASSETS"`). Paths in `run_worker_first` (`/v1/*`, `/health`, `/view/*`, `/gallery/curated/lupine_genesis.*`, `/gallery/research/hfc/*` and a few more) reach Worker code first; every other path below is a static file, served before the Worker runs.

### 4.1 Gallery

| Path | Served by | Shape | App use |
|---|---|---|---|
| `GET /m/manifest.json` | static, written by `scripts/molecule-pages/build.mts:190` (`moleculeManifest`, :113-131) | `{ schema: "lupi.molecule-pages.v1", origin, cards, pages: [{ id, name, formula, atoms, file, pose: [azimuth, elevation], inkRadius, fit }] }`; 69 pages in the built site ([repo-mobile-ar.md §2.2](research/repo-mobile-ar.md)) | the spawn tray's gallery list; `file` is the coordinate path |
| `GET <file>`, e.g. `/gallery/curated/popular/caffeine.xyz` | static, from `apps/web/public/gallery/curated/` (72 XYZ files under `popular/`, `organic/` and the top level) | plain XYZ; comment lines vary (`water \| source=3d-pubchem cid=962`, `Caffeine generated from PubChem 3D SDF`) and declare no chemistry | the coordinates; the app forces the molecular recipe itself |
| `GET /og/m/<id>-ink.svg`, `GET /og/m/<id>-ink.json` | static, written by `build.mts:162-163` | the ink drawing, and its `InkModel` (`packages/ui/src/moleculePage/ink.ts:41-60`: `p`, `k`, `kinds`, `b`, `bk`, `radius`, `detents`, `opening`) | the Cabinet's drawings only; its bond pairs come from the Object Facts distance rule (`scripts/molecule-pages/catalog.mts:358`), so play never uses them |
| `GET /gallery/trajectories/massive_1m.glimbin` | static, `apps/web/public/gallery/trajectories/` | glimbin v1, 953,312 atoms, 10,156,835 bytes (`packages/core/src/glimbin.ts`) | M3 colossus |

The manifest has no SHA-256 (the build's record has one, `catalog.mts:37`, but `moleculeManifest` omits it). The app hashes what it downloads (§1.3). Adding `sha256` to each manifest page would be an additive v1 change; it is proposed here, not shipped.

### 4.2 OMol25

| Path | Served by | Shape and limits | App use |
|---|---|---|---|
| `GET /datasets/omol25/featured.v1.json` | static, `apps/web/public/datasets/omol25/featured.v1.json`; validated by `packages/core/src/omol25/featured.ts` | `{ schema: "lupi.omol25-featured.v1", license: "CC-BY-4.0", citation, picks: [...] }`, 24 picks, each `{ id, collection, dataset, row, configurationId, propertyId, formula, atoms, elements, shelf, home, domain, domainLabel, charge, spinMultiplicity, chargeSource, energyEv, maxForceEvPerA, homoLumoGapEv, title, name, xyz, edge, ink, sha256, fetchedAt, bondRecipe }` | the OMol25 shelf of the spawn tray (also bundled in the app) |
| `GET /datasets/omol25/featured/omol25_nv_<row>.xyz` | static | XYZ in the edge comment format; its SHA-256 (over the UTF-8 text) is the pick's `sha256` (`tools/build-omol25-featured.mjs:258`) | coordinates of a pick |
| `GET /og/omol25/omol25_nv_<row>-ink.svg`, `-ink.json` | static, written by `scripts/omol25-picks/build.mts` (`AGENTS.md`) | ink drawing and model on the molecular recipe's graph | Cabinet drawings |
| `GET /v1/datasets/omol25` | Worker, `routeScienceData` (`apps/mcp-worker/src/scienceData.ts:133-138`, body `omolManifest`, :320) | collections, license, citation, `sourceTruth`, `browserContract.maxRowsPerRequest: 36`; `cache-control: public, max-age=3600, stale-while-revalidate=86400` | the collection list for search |
| `GET /v1/datasets/omol25/:collection/rows?offset=&limit=&query=` or `&formula=` | Worker, `scienceData.ts:140-146` (`browseOmolRows`, :355) | `limit` 1–36, default 24; `query` and `formula` together are a 400; rows are `compactOmolRow` (:589-628): `rowIndex, id, configurationId, propertyId, formula, reducedFormula, elements, atomCount, multiplicity, charge, spinMultiplicity, chargeSource, domain, homoLumoGapEv, method, software, energy, maxForceNorm, name, loadUrl, coordinateProvenance: "source", bondTopology: "not-provided"`; upstream budget 9 s, then an explicit 502 or 504 (`retry-after: 15` while the index warms) | OMol25 search |
| `GET /v1/datasets/omol25/:collection/structures/:row.xyz` | Worker, `scienceData.ts:148-158` (`omolXyzResponse`) | `content-type: chemical/x-xyz`; at most 1,000 atoms; `cache-control: public, max-age=86400, stale-while-revalidate=604800`; headers `x-lupi-coordinate-provenance: source`, `x-lupi-bond-topology: not-provided`, `x-lupi-charge-provenance: <chargeSource>`, `x-lupi-bond-inference: lupi-bonds.molecular.v1`; 404 for an unknown collection, 400 for a row out of range, 502/504 upstream (12 s budget) | coordinates of any row |

Collections: `neutral-train` (complete, 34,335,828 rows), `neutral-validation` (complete, 27,697 rows), and three indexed previews (`packages/core/src/omol25/collections.ts`). The XYZ comment, quoted from a featured file:

```
OMol25 neutral-validation row=1008 | collection=neutral-validation | formula=C4H14N4OS3 | configuration_id=… | property_id=… | method=ωB97M-V | charge=0 | multiplicity=1 | charge_source=record | data_id=ani2x | energy_eV=-44872.2498481 | max_force_eV_per_A=32.9885999072 | homo_lumo_gap_eV=5.62478397094 | coordinates=source | bonds=not-provided | license=CC-BY-4.0 | source=colabfit/OMol25_neutral_validation
```

Keys and order are a contract with the web parser (`omolCommentLine`, `scienceData.ts:518-550`). The app shows OMol25's attribution with every OMol25 molecule and trophy.

### 4.3 PubChem

There is **no REST PubChem route on the edge.** The only edge PubChem lookup is the ChatGPT plugin's MCP tool `resolve_molecule` at `POST /chatgpt/mcp` (`apps/mcp-worker/src/chatgpt.ts:25, 445-454`). It is an MCP session protocol with its own Origin gate and output schema, owned by the plugin, and the app must not depend on it.

The app therefore calls PubChem PUG-REST directly, with the same three requests and bounds as `packages/core/src/pubchem.ts` (`resolvePubChemMolecule`):

1. Name to CIDs: `GET https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/<name>/cids/JSON?name_type=complete`. More than one CID is "ambiguous": the app lists them and the user picks; it never auto-selects. More than 25 is too many.
2. Structure: `GET …/compound/cid/<cid>/record/JSON?record_type=3d`. A 404 means there is no 3D conformer; the web then falls back to 2D, but a 2D depiction is not a 3D shape, so the app says "PubChem has no 3D shape for this" and does not spawn it.
3. Name and formula: `GET …/compound/cid/<cid>/property/Title,MolecularFormula/JSON`.

Bounds (`PUBCHEM_DEFAULT_BOUNDS`): at most 5,000 atoms, 10,000 bonds, 2,000,000 response bytes, a 30 s total deadline. The app lowers the atom cap to 2,000, the toy tier (plan §3.6). PubChem bond orders are kept in the record but the game graph is still the molecular recipe, so every source plays the same way. A cached edge route (for example `GET /v1/pubchem?name=`) would be new Worker work, proposed only if PubChem's rate limits ever bite.

### 4.4 Scale packs (from M3b)

| Path | Served by | Shape | App use |
|---|---|---|---|
| `GET /scale/p/<contentId hex>.lpk` | Worker, from an append-only R2 bucket (new; the deploy uploads each new pack before the build goes live, and nothing ever deletes one) | LupiPack v1 ([scale-spec.md §6](scale-spec.md)); `Cache-Control: public, max-age=31536000, immutable`; HTTP range requests | the records of explicit colossi (`massive_1m`) that a trophy names by dependency |

Packs are not ordinary static assets, because Workers static assets hold only the current build's files, and a trophy may need a pack forever ([scale-spec.md §6.8](scale-spec.md)).

### 4.5 Parsing and the game graph

- XYZ element tokens are symbols (case-insensitive) or atomic numbers 1–118; an unknown token fails the file rather than becoming hydrogen (the web parser's rule, `packages/parsers/src/xyzParser.ts`).
- The game graph is LupiKit's port of `lupi-bonds.molecular.v1`, forced (the web's `bondProfile: 'molecular'`) for every non-periodic frame of at most 2,000 atoms, whatever its source. Larger structures get no bonds (colossi are space-filling).
- The bundled copies in the app are the gallery XYZ files, the 24 featured OMol25 XYZ files with `featured.v1.json`, and the manifest. Online, the app refreshes them when the manifest changes.

---

## 5. Account sync: Firestore layout

The layout of record is [account-and-sync.md §3](account-and-sync.md#3-the-envelope-and-the-rules), and `firestore.rules` admits only it. Each trophy is one document at `users/{uid}/trophies/{syncID}` holding an envelope: `schema`, `id`, `payload` (this record), `deleted`, `updatedAt` (the server's `REQUEST_TIME`) and `clientUpdatedAt`. Last writer wins on `clientUpdatedAt`; a tombstone is `deleted: true` with an empty payload, and a record with `deletedAt` set is saved as one. The rules check the envelope, not the record, so a new optional v1 field never needs a rules deploy; LupiKit validates the record and LupiSync caps its JSON at 256 KiB.

This replaces the earlier proposal here (the raw record as the document, string dates, last writer wins on the record's `updatedAt`), which account-and-sync.md §3 compares point by point.

---

## 6. What is deliberately not here

- **No room data anywhere off the device:** no world map, snapshot or placement in any synced or uploaded contract (D7; [retention-collection.md §3.6](research/retention-collection.md)).
- **No share format:** D12 rules out multi-user, and D7 rules out a web shelf page.
- **No physics card:** the brief's `lupi.physics-card.v1` (per-bond Morse parameters, modes) is not needed for D8's toy physics; the personality rules derive everything on device. It can return later as an optional input to `lupi.personality.rules.v2`.
- **No LupiPack here:** LupiPack v1, the node records and `lupi.scale-ref.v1` are specified in [scale-spec.md](scale-spec.md) (D14), from M0. They replace the colossus format sketched in [million-atom-ar.md §5](research/million-atom-ar.md).
