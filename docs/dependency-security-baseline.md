# Dependency security baseline

Snapshot date: 2026-07-19

Git parent base: `baf445a0b99d59b5dc99cfd1f493cf997c8944b9`

Dependency-state identity: Git identifies the committed implementation snapshot;
the parent base and manifest/lockfile SHA-256 values below independently bind the
exact dependency state without a self-referential commit hash in this document.
Hashes use the repository's canonical LF bytes, so they are stable across
Windows and Linux checkouts.

| File | SHA-256 |
|---|---|
| `package.json` | `321031DADF890D6A2A0A327956C4E7C34836CEEE16B189D9E01B4E7A89FF41B1` |
| `pnpm-lock.yaml` | `A226B6969E014A5B512BDF130F37F0802C7D7DD4EA055794AA9CA97A256C9299` |
| `functions/package.json` | `8D7B95FD0EF680C989E46866265EE3D6B6CEDEFAE4496A88B2C4F42AC8560672` |
| `functions/package-lock.json` | `0730C78D3614B40288F26A139BCA33B5339D3167C84C74B22C0FF0B9E63DFB58` |

## Gate policy and result

- Repository production closure: `pnpm audit --prod --audit-level high`
  exits 0 with zero known vulnerabilities at all severities (488 production
  dependencies).
- Cloud Functions production closure:
  `npm audit --prefix functions --omit=dev --audit-level=high` exits 0 with no
  high or critical finding (159 production dependencies). Eight package-level
  moderate entries remain, all caused by one `uuid` advisory and recorded
  below.
- A high or critical exception is not permitted. Moderate findings require an
  explicit reachability and disposition record; `uncertain` is not treated as
  `unreachable`.
- The root `serve` dependency was removed because `pnpm start` uses the native
  Node server in `tools/serve-web.mjs`.

## Remediated repository advisories

| Advisory | Package | Before -> after | Severity | Runtime lane and dependency path | Reachability | Remediation and residual risk |
|---|---|---|---|---|---|---|
| npm `1117015` | `postcss` | `8.5.8` -> `8.5.20` | moderate | creative tooling: `@remotion/cli -> @remotion/bundler -> css-loader -> postcss` | Reachable when the trailer bundler processes CSS; not part of the deployed web or Worker runtime. | Upgraded every Remotion package in lockstep to `4.0.494`, then constrained only vulnerable `postcss@8.5.8` to an admitted fixed patch. No known advisory remains. |
| npm `1117870`, `1117884` | `fast-uri` | `3.1.0` -> `3.1.2` | high | local server (removed): `serve -> ajv -> fast-uri`; creative tooling: `@remotion/cli -> webpack -> schema-utils -> ajv -> fast-uri` | The removed server path was unused. The Remotion path is reachable by local creative builds. | Removed `serve`; upgraded Remotion; constrained only vulnerable `fast-uri@3.1.0` to the fixed patch admitted by `ajv`. No known advisory remains. |
| npm `1119108`, `1123259` | `ws` | `8.17.1` -> `8.21.0` | moderate, high | creative tooling: `@remotion/cli -> @remotion/renderer -> ws` | Reachable while running Remotion Studio or rendering trailers; not deployed by Lupi web/Worker builds. | The supported Remotion `4.0.494` lockstep upgrade supplies fixed `ws@8.21.0`. No override is used for `ws`; no known advisory remains. |
| npm `1123482`, `1123483` | `websocket-driver` | `0.7.4` -> `0.7.5` | moderate, critical | public web: `firebase -> @firebase/database -> faye-websocket -> websocket-driver` | Present in the aggregate Firebase browser runtime. It is not safe to call it unreachable merely because current first-party code primarily uses Firestore. | Upgraded Firebase to `12.16.0`; because the current parent still resolved the vulnerable patch, constrained only `websocket-driver@0.7.4` to `0.7.5`, admitted by `faye-websocket`'s `>=0.5.1` range. No known advisory remains. |
| npm `1123492` | `protobufjs` | `7.6.1` -> `7.6.3` | moderate | public web: `firebase -> @firebase/firestore -> @grpc/proto-loader -> protobufjs` | Reachable through saved-view and other Firestore behavior. | Upgraded Firebase to `12.16.0`; constrained only vulnerable `protobufjs@7.6.1` to the fixed patch admitted by the proto-loader range. No known advisory remains. |

The repository override keys include the vulnerable source version, rather than
globally replacing every version of a package. They are limited to versions
already admitted by the direct parent ranges and are covered by workspace,
Cloudflare Worker, and browser regressions.

## Remediated Cloud Functions advisories

| Advisory | Package | Before -> after | Severity | Runtime lane and dependency path | Reachability | Remediation and residual risk |
|---|---|---|---|---|---|---|
| npm `1120745` / `GHSA-hmw2-7cc7-3qxx` | `form-data` | `2.5.5` -> `2.5.6` | high | Cloud Functions: `firebase-admin -> @google-cloud/storage -> retry-request -> @types/request -> form-data` | The Storage lane is optional in `firebase-admin` and is not imported directly by first-party Functions, but remains in the production closure; reachability is uncertain. | Normal npm transitive update selected `2.5.6` within the parent's `^2.5.5` range. No override or Firebase major upgrade was used; no known advisory remains. |
| npm `1123482`, `1123483` | `websocket-driver` | `0.7.4` -> `0.7.5` | moderate, critical | Cloud Functions: `firebase-admin -> @firebase/database -> faye-websocket -> websocket-driver` | Realtime Database is not imported by first-party Functions, but the package is in the Firebase Admin production closure; reachability is uncertain. | Normal npm transitive update selected `0.7.5` within `faye-websocket`'s `>=0.5.1` range. No override or major upgrade was used; no known advisory remains. |
| npm `1123492` / `GHSA-f38q-mgvj-vph7` | `protobufjs` | `7.6.2` -> `7.6.5` | moderate | Cloud Functions: `firebase-admin -> @google-cloud/firestore -> google-gax/@grpc/proto-loader -> protobufjs`, plus `firebase-functions -> protobufjs` | Reachable: Functions import `firebase-admin/firestore` in `src/index.ts`, `src/rateLimit.ts`, and `src/socialView.ts`. | Normal npm transitive update selected `7.6.5` within all current parent ranges. No override or major upgrade was used; no known advisory remains. |

`firebase-admin@13.10.0` and `firebase-functions@6.6.0` are the newest releases
within their existing supported majors in this snapshot. The baseline does not
use `npm audit fix --force`, does not cross to Firebase Admin 14, and does not
move runtime dependencies to `devDependencies`.

## Retained moderate disposition

### npm `1119441` / `GHSA-w5hq-g745-h8pq`: `uuid` buffer bounds check

- Resolved packages: `uuid@8.3.2` at the Storage root and `uuid@9.0.1` beneath
  `gaxios`, `google-gax`, and `teeny-request`; the advisory range is `<11.1.1`.
- Runtime lane: Cloud Functions.
- Dependency paths include
  `firebase-admin@13.10.0 -> @google-cloud/firestore@7.11.6 -> google-gax@4.6.1 -> uuid@9.0.1`
  and
  `firebase-admin@13.10.0 -> @google-cloud/storage@7.19.0 -> uuid@8.3.2`.
- Reachability: Firestore itself is reachable because first-party Functions call
  `getFirestore()`. Storage is an optional transitive and is not directly
  imported. The vulnerable operation requires UUID v3/v5/v6 with a supplied
  output buffer; first-party source neither imports `uuid` nor supplies such a
  buffer. Whether an SDK-internal path can invoke that exact operation is
  **uncertain**, not proven unreachable.
- Disposition: retain temporarily under the moderate-only policy. The npm audit
  recommendation is `firebase-admin@14.2.0`, a direct major upgrade that needs a
  separately tested Functions migration. Re-evaluate on every lockfile update
  and schedule that migration rather than forcing it into this baseline.
- Residual risk: a reachable SDK-internal UUID buffer call could write outside
  the caller's intended buffer bounds. The high/critical gate does not suppress
  this record.
- Verification:
  `npm audit --prefix functions --omit=dev --json`,
  `npm explain uuid --prefix functions`, Functions build/tests, and the
  high/critical audit gate.

The other seven moderate package-level entries reported by npm
(`firebase-admin`, `@google-cloud/firestore`, `google-gax`,
`@google-cloud/storage`, `gaxios`, `retry-request`, and `teeny-request`) are
dependency-chain propagation of this same `uuid` advisory, not seven additional
advisory IDs.

## Reproduction commands

Run from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm audit --prod --json
pnpm audit --prod --audit-level high
pnpm -r why --prod websocket-driver protobufjs fast-uri ws postcss

npm ci --prefix functions
npm audit --prefix functions --omit=dev --json
npm audit --prefix functions --omit=dev --audit-level=high
npm explain websocket-driver --prefix functions
npm explain form-data --prefix functions
npm explain protobufjs --prefix functions
npm explain uuid --prefix functions
```

After dependency changes, also run `pnpm lint`, `pnpm build`, `pnpm test`,
`pnpm cloudflare:test`, `npm run build --prefix functions`,
`npm test --prefix functions`, and `pnpm test:ui`. Record those command results
separately; an audit result does not prove runtime behavior.
