# Lupi AR: the account and the trophy sync

Design of record for decision D7 (`docs/ar/decisions.md`): the collection lives on the Lupi account (Firebase Auth with Sign in with Apple), the app is fully usable signed out and syncs once you sign in, room maps stay on the device, and the account can be deleted in the app. Written 2026-10-04. External claims carry a URL; anything not confirmed is marked **UNCONFIRMED**.

What exists:

| Piece | Path |
|---|---|
| Firestore rules for `users/{uid}/trophies/{trophyId}` | `firestore.rules` |
| Rules tests (Firestore emulator, `@firebase/rules-unit-testing`) | `functions/src/trophyRules.test.ts` |
| Deletion backstop `deleteUserData` (Auth user deleted → `users/{uid}` recursively deleted) | `functions/src/accountCleanup.ts` |
| Swift package, Foundation only, builds and tests on Linux | `apps/apple/LupiCloud` |
| `LupiAuth`: Firebase Auth over REST, Sign in with Apple, sessions | `apps/apple/LupiCloud/Sources/LupiAuth` |
| `LupiSync`: Firestore over REST, Value codec, `TrophySync<Payload>` | `apps/apple/LupiCloud/Sources/LupiSync` |
| Emulator ports for local runs | `firebase.json` (`emulators`) |

The trophy record itself (`lupi.trophy.v1`) is defined by the app lane in LupiKit and `docs/ar/contracts.md`. The sync layer does not import it: `TrophySync` is generic over `SyncPayload`, a `Codable & Sendable` record that gives its document id (`syncID`) and says whether it marks itself deleted (`isSyncTombstone`), and stores it inside an envelope defined here. Where this layout and contracts.md §5 differ, this one holds (§3).

---

## 1. Why REST instead of the Firebase iOS SDK

**What it buys**

- **No SDK weight.** FirebaseAuth and FirebaseFirestore pull in gRPC, abseil, BoringSSL and leveldb. The game needs six Auth calls and four Firestore calls.
- **Linux-testable.** Owner rule: build-first and no device claims we cannot back. The whole account and sync layer builds and runs its tests with `swift test` on Linux. The tests use an in-memory Firebase that speaks the same REST shapes, and an optional suite runs the real Auth and Firestore emulators with this repo's rules.
- **Fewer moving parts.** There is no SDK-owned persistence, no hidden background threads and no swizzling. Every request goes through one `HTTPTransport` protocol.

**What it costs, and what replaces it**

| The SDK gives | Here instead |
|---|---|
| Firestore offline cache and pending-write queue | Our own local store (one JSON file, written atomically) and outbox. The collection is local-first anyway. |
| Real-time listeners | Pull on demand: on launch, on foreground, after edits. Nobody else writes the owner's trophies, so latency only matters between the owner's own devices. |
| Token refresh and error mapping | `SessionManager` (single-flight refresh 5 min before expiry) and `AuthError`. |
| `revokeToken(withAuthorizationCode:)` | The same endpoint and body, called directly (§4). |
| App Check, heartbeat headers | Not sent. App Check is a follow-up if abuse ever shows up (§6). |
| SDK upgrades track API changes for us | We track the REST reference. The calls used are stable v1/v2 endpoints. |

---

## 2. Identity

1. The app makes an `AppleNonce()`: 32 symbols from the system CSPRNG (`SystemRandomNumberGenerator`: `arc4random_buf` on Apple platforms, `getrandom` on Linux). The alphabet is base64url's 64 symbols, so mapping random bytes onto it has no modulo bias. It replaces Firebase's `SecRandomCopyBytes` sample ([Firebase](https://firebase.google.com/docs/auth/ios/apple)), which is Apple-only.
2. `ASAuthorizationAppleIDRequest.nonce = nonce.hashed`: lowercase hex SHA-256. `SHA256` is a small pure-Swift implementation (CryptoKit is Apple-only), checked against the NIST vectors.
3. `TrophySync.signIn(with: AppleCredential(idToken:rawNonce:…))` calls `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=…` with:
   `{"postBody":"providerId=apple.com&id_token=…&nonce=<raw>","requestUri":"http://localhost","returnIdpCredential":true,"returnSecureToken":true}`. On the first sign-in it adds `&user={"name":{"firstName":…,"lastName":…}}`, as the iOS SDK does.
4. `SessionManager` keeps `Session { uid, idToken, refreshToken, expiresAt }` in a `TokenStore`. The app supplies a Keychain store: a generic password, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not synchronizable. ID tokens refresh through `POST https://securetoken.googleapis.com/v1/token?key=…` (form-encoded `grant_type=refresh_token&refresh_token=…`) five minutes before expiry. Concurrent callers share one refresh.
5. Firestore calls send `Authorization: Bearer <idToken>`, so the security rules apply exactly as they would for the SDK ([Firestore REST](https://firebase.google.com/docs/firestore/use-rest-api)). No API key goes to Firestore.
6. Every Auth request sends `?key=` and `X-Ios-Bundle-Identifier: live.lupi.app`. A key restricted to iOS apps only accepts requests that carry an allowed bundle ID in that header ([Google Cloud](https://cloud.google.com/docs/authentication/api-keys)).

**Errors.** Google's error body carries the code in `error.message`, sometimes followed by `" : detail"`. It is read up to the first colon, as the iOS SDK's `AuthBackend` does. Mapped cases:

- Auth codes: `TOKEN_EXPIRED`, `INVALID_REFRESH_TOKEN`, `INVALID_ID_TOKEN`, `USER_DISABLED`, `USER_NOT_FOUND`, `CREDENTIAL_TOO_OLD_LOGIN_AGAIN`, `INVALID_IDP_RESPONSE`, `MISSING_OR_INVALID_NONCE`, `OPERATION_NOT_ALLOWED`, `EMAIL_EXISTS` / `FEDERATED_USER_ID_ALREADY_LINKED` (which may arrive in a 200 as `errorMessage`, or as `needConfirmation`), `PROJECT_NUMBER_MISMATCH`, `TOO_MANY_ATTEMPTS_TRY_LATER`.
- Key problems: `keyInvalid` / `API_KEY_INVALID`, and `API_KEY_IOS_APP_BLOCKED` / `ipRefererBlocked`.

An error that ends the session (expired, invalid refresh token, disabled, user gone) clears the stored session, so the app shows itself signed out instead of failing every call.

**Audience.** Apple puts the app's bundle ID in the identity token's `aud`. Firebase's guide says to register the bundle ID when adding the iOS app to the project ([Firebase](https://firebase.google.com/docs/auth/ios/apple)). The Identity Platform config behind the Apple provider has `appleSignInConfig.bundleIds`, "a list of Bundle ID's usable by this project" ([Identity Platform](https://cloud.google.com/identity-platform/docs/reference/rest/v2/projects.defaultSupportedIdpConfigs)). **UNCONFIRMED:** that adding the iOS app in the console fills `bundleIds`. The checklist (§7) verifies it directly.

**One account per email.** If the owner's Apple ID shares its email with an existing Google account on lupi.live, Firebase's default one-account-per-email setting answers `needConfirmation` / `EMAIL_EXISTS`. The app gets `.accountExistsWithDifferentCredential(email:)`. Apple's private relay emails never collide. Linking is a follow-up.

---

## 3. The envelope and the rules

Each trophy is one document at `users/{uid}/trophies/{trophyId}`:

| Key | Type | Rule |
|---|---|---|
| `schema` | string | `== 'lupi.trophy.v1'` |
| `id` | string | `== trophyId`; ids match `^[A-Za-z0-9_-]{1,128}$` |
| `payload` | map | the trophy record; at most 32 top-level keys; `{}` for a tombstone |
| `deleted` | bool | tombstone flag |
| `updatedAt` | timestamp | `== request.time`: only a `REQUEST_TIME` transform can write it |
| `clientUpdatedAt` | timestamp | when the owner made the change; `< request.time + 1 h` |

- The rules require exactly these keys (`hasOnly` and `hasAll`).
- Access is owner-only by path: `request.auth.uid == uid` for get, list, create, update and delete.
- Nothing else under `users/{uid}` is readable or writable. No index entry is needed: the pull query is one inequality on `updatedAt`, ordered by `updatedAt` then `__name__`, which the automatic single-field index serves (**UNCONFIRMED** in production; the emulator does not enforce indexes; a missing index would answer `FAILED_PRECONDITION` with a link to create it).

**The record inside, and contracts.md §5.** contracts.md §5 (on the app and docs branches) proposed a different layout: the raw `lupi.trophy.v1` record as the document, string dates, last-writer-wins on the record's `updatedAt` with ties to the larger id, and `deletedAt` tombstones. `firestore.rules` admits only the envelope, so both cannot hold. This is the layout of record, and contracts.md §5 should point here when the branches merge.

| | contracts.md §5 proposed | Layout of record |
|---|---|---|
| Document | the record | the envelope; the record is `payload` |
| Document id | the record's `id` | `syncID`. `Identifiable` records get it free: `id.uuidString` for a `UUID` (uppercase with hyphens, as contracts.md §0 writes ids), the id itself for a `String` |
| Dates in the record | ISO 8601 strings | Firestore timestamps (`FirestoreEncoder` writes a `Date` as `timestampValue`, truncated to microseconds), read back as `Date`. The JSON form stays LupiKit's |
| Pull order | the record's `updatedAt` | the envelope's `updatedAt`, the server's `REQUEST_TIME`. A device whose clock runs behind cannot hide its write from the others' pulls |
| Last writer wins | the record's `updatedAt`, ties to the larger id | the envelope's `clientUpdatedAt`, which `save()` stamps (§4). The record's own `updatedAt` travels in `payload` and is never compared. Both sides of a conflict share one id, so an id cannot break a tie; the pending local edit wins it |
| Tombstone | `deletedAt` set, `molecule.xyz` dropped, record kept | `deleted: true` and `payload: {}`: nothing of the trophy stays on the server. `save()` of a record with `isSyncTombstone` (for a trophy, `deletedAt != nil`) is `delete(id:)`, and a pulled record with `deletedAt` counts as deleted whatever its envelope says |
| Rules | check record fields (`name`, `molecule.source`, …) | check the envelope. The record's shape is LupiKit's validation, so adding an optional v1 field never needs a rules deploy |

**Size.** Rules cannot measure a map's serialized size: maps only offer `size()` (key count). So the rules cap the top-level keys, and LupiSync holds the 256 KiB bound on the record's JSON encoding at `save()`, refusing it with `.payloadTooLarge` before anything is queued. Firestore's 1 MiB document limit is the server's hard ceiling. A hostile owner with their own token could still store up to 1 MiB per document in their own subtree. That costs them, not other users. Budget alerts and App Check are the levers if it ever matters.

**Tests.** The rules suite (`functions/src/trophyRules.test.ts`, 6 tests) covers owner access, other users and signed-out callers, nothing else under `users/{uid}`, every schema violation, tombstones, and partial updates that keep a stale `updatedAt`.

A mutation run removed each clause in turn. Every clause made a test fail except two: `hasAll` and `deleted is bool`. With either one gone, the request still fails, because reading a missing key or `!` on a non-bool is an evaluation error, and an evaluation error denies. They stay for clarity.

The Swift emulator suite also drives the rules over REST: wrong schema, an extra key, a missing `REQUEST_TIME`, another user's path, and a path outside `trophies` all answer `PERMISSION_DENIED`.

---

## 4. The sync algorithm

**Local state** (`SyncState`, format `lupi.sync-state.v1`, one JSON file replaced atomically):

- `records[id]`: owner uid (nil if made signed out), payload (nil = tombstone), `clientUpdatedAt`, the server version it is based on (`updateTime`, `updatedAt`), and a local `revision`.
- `outbox`: ids with pending upserts or tombstones, oldest first.
- `cursors[uid]`: the newest `updatedAt` pulled.
- `activeOwner`: whose trophies are shown.
- `deletingAccount`: set while a deletion is unfinished.

**Edits** (`save`, `delete`) are local and immediate.

- They work signed out.
- `clientUpdatedAt` is the device clock at microsecond precision, kept strictly increasing per record.
- A delete becomes a tombstone, unless the trophy never left the device; then it simply disappears.

**`sync()`** runs pull then push. Concurrent calls share one run.

1. **Adopt.** If the signed-in uid is not `activeOwner`, or trophies were made signed out, those trophies take the uid as owner. They join the outbox and are never dropped. This is saved before any network call.
2. **Pull.**
   - `runQuery` on `users/{uid}`: `updatedAt > cursor − 60 s`, ordered by `(updatedAt, __name__)`, 300 per page.
   - Later pages resume with a `startAt {values: [updatedAt, name], before: false}` cursor.
   - Ordering by name as well matters because one commit stamps all its writes with the same `REQUEST_TIME`, and a page boundary inside that group would otherwise skip documents.
   - The 60 s overlap is there because `REQUEST_TIME` is the request's arrival time, in milliseconds, and it lands before the commit becomes visible. The emulator showed `transformResults` 340 ms before `updateTime`. A pull can therefore see a later write before an earlier one; re-reading the overlap catches it, and merging is idempotent. `sync(full: true)` re-reads everything, as a cheap daily safety net.
3. **Merge**, for each remote document:
   - Not in the local store: insert it (skip a tombstone).
   - Local copy with nothing pending: take the server version if its `updateTime` is newer. A remote tombstone removes the local copy.
   - Local edit pending: last writer wins on `clientUpdatedAt`. If the local edit wins, it is re-based on the server version and stays queued. If the remote wins, it replaces the local copy and leaves the outbox.
4. **Push.**
   - The outbox is committed in batches of 100.
   - Each write sets the whole envelope and adds the `updatedAt` `REQUEST_TIME` transform.
   - Each write is conditioned on `currentDocument.updateTime` of the version it was based on, or `exists: false` for a first write.
   - If a condition fails, another device wrote first. Statuses from the emulator: `ALREADY_EXISTS` 409, `FAILED_PRECONDITION` 400 (also for an `updateTime` precondition on a missing document), `NOT_FOUND` 404 for `exists: true`. The engine settles each record of the batch alone: it reads the current version, merges it (LWW), and retries. It makes at most 3 rounds.
   - A record the rules refuse is reported in `SyncReport.rejected`, stays queued, and does not block the others.
   - A record edited again while its write was in flight keeps its newer edit queued (`revision`).

**Why last-writer-wins on `clientUpdatedAt`**

`clientUpdatedAt` is when the owner acted. That is the order the owner expects. An edit made offline on the iPad at 10:00 and synced at 18:00 must not beat an iPhone edit made at 12:00. Ordering by server time alone would do exactly that.

- **Ties.** On equal `clientUpdatedAt` the later server commit wins. For a pending local edit, that means the local one, because it will commit later.
- **The clock check.** The server cannot judge client clocks, so the clients settle conflicts before writing. The `updateTime` preconditions ensure no write lands on a version its device never saw.
- **Version identity.** Versions are compared by `updateTime` (the commit time, in microseconds), never by `updatedAt`. Two devices' writes can share one `REQUEST_TIME` millisecond, and a regression test pins this.
- **Fast clocks.** A clock far in the future would win every later edit. So the engine pulls `clientUpdatedAt` back to the server's time (estimated from `readTime` and `commitTime`) when it leads by more than 5 minutes, and the rules refuse anything more than an hour ahead.

**Tombstones** are kept on the server indefinitely, at about 150 bytes each. If they were garbage-collected, a device that stayed offline longer than the retention period would never learn of the deletion. Deletions follow the same LWW rule as edits: an edit made after a deletion resurrects the trophy, and a deletion made after an edit wins.

**Signed out, other accounts**

- `signOut()` tries one last sync, then forgets the tokens. Local copies stay visible, because `activeOwner` is kept. New trophies queue for whoever signs in next.
- If a different Apple ID signs in on the same device, the first account's copies stay on the device, hidden and never uploaded to the second account, until the first account signs in again.
- The game has no multi-user features (D12). This rule just keeps one account's trophies from leaking into another.

**Room maps** never pass through this layer. `lupi.shelf.v1` placements and `ARWorldMap` data stay on the device (D7).

---

## 5. Deleting the account

App Store Review Guideline 5.1.1(v): "If your app supports account creation, you must also offer account deletion within the app" ([Apple](https://developer.apple.com/app-store/review/guidelines/#5.1.1v)). The app also stays fully usable signed out, as the same guideline asks of apps without significant account-based features. Apple's account-deletion guidance adds: "Apps that support Sign in with Apple should use the Sign in with Apple REST API to revoke user tokens" ([Apple](https://developer.apple.com/support/offering-account-deletion-in-your-app/)). Firebase does that through `revokeToken`. Firebase stores no Apple tokens, so the user must sign in with Apple again to provide a fresh authorization code ([Firebase](https://firebase.google.com/docs/auth/ios/apple)).

`TrophySync.deleteAccount(reauthentication:)` takes that fresh credential and runs, in order:

1. **Re-authenticate.** `signInWithIdp` again. Deleting a user needs a recent sign-in ([Firebase](https://firebase.google.com/docs/auth/ios/manage-users); `CREDENTIAL_TOO_OLD_LOGIN_AGAIN` otherwise), and revocation needs a valid ID token.
   - A different Apple ID is refused (`.reauthenticatedAsDifferentAccount`).
   - If that sign-in just created an empty account, it is deleted again.
2. **Mark `deletingAccount = uid`.** From here on, sync refuses to run for that account, so local copies cannot be pushed back up.
3. **Delete every trophy document.** It lists `users/{uid}/trophies` (field mask `deleted`) and commits deletes until the list is empty.
4. **Revoke Apple's tokens.** `POST https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=…` with `{"idToken":…,"providerId":"apple.com","token":<authorizationCode>,"tokenType":"CODE"}`. The endpoint and fields come from the firebase-ios-sdk source ([RevokeTokenRequest.swift](https://github.com/firebase/firebase-ios-sdk/blob/main/FirebaseAuth/Sources/Swift/Backend/RPC/RevokeTokenRequest.swift), `useIdentityPlatform: true` selects `/v2/` in [IdentityToolkitRequest.swift](https://github.com/firebase/firebase-ios-sdk/blob/main/FirebaseAuth/Sources/Swift/Backend/IdentityToolkitRequest.swift)) and from the [Identity Platform reference](https://cloud.google.com/identity-platform/docs/reference/rest/v2/accounts/revokeToken).
   - The SDK sends `tokenType` as the enum number in a string, `"3"`. We send the enum name `"CODE"`; proto3 JSON accepts both.
   - The reference says `redirectUri` is required for `CODE`. The SDK sends none for native codes, and neither do we.
5. **Delete the Firebase user.** `POST …/v1/accounts:delete`. A user that is already gone counts as deleted.
6. **Forget locally.** Every record owned by the uid, its cursor, the session and the deletion mark are removed. Trophies of other accounts on the device stay.

If any step fails, `deletingAccount` stays set. The app shows "Finish deleting your account", which needs a new Sign in with Apple, because authorization codes are single-use and short-lived.

**Backstop.** `deleteUserData` is a 1st-gen Auth `onDelete` trigger (`firebase-functions/v1`; firebase-functions 6 has no 2nd-gen user-deleted event, and `onUserDeleted` arrives in later majors, see [Firebase](https://firebase.google.com/docs/functions/auth-events)). It recursively deletes `users/{uid}` and retries on failure. That covers an interrupted client and a deletion from the console. Bulk `deleteUsers()` fires no event ([Firebase](https://firebase.google.com/docs/functions/auth-events)).

**Elsewhere.** If the account is deleted on the iPad, the iPhone learns at its next token refresh (`USER_NOT_FOUND`) and forgets everything tied to the uid.

**Residual risk.** An ID token stays valid for up to an hour after the user is deleted, and the rules cannot check revocation. A second device that is online and syncing in that hour could write a trophy back after the backstop ran. Two follow-ups would close this: a scheduled sweep of `users/*` for uids that no longer exist, or `request.auth.token.auth_time` checks. Neither is built.

---

## 6. Verified facts and how

| Fact | Source | Checked by |
|---|---|---|
| `accounts:signInWithIdp` request (`requestUri`, `postBody`, `returnSecureToken`, `returnIdpCredential`) and response (`localId`, `idToken`, `refreshToken`, `expiresIn` string, `needConfirmation`) | [Auth REST](https://firebase.google.com/docs/reference/rest/auth) | Auth emulator |
| Apple `postBody` keys `providerId`, `id_token`, `nonce`, `user`; `requestUri` "http://localhost" | [VerifyAssertionRequest.swift](https://github.com/firebase/firebase-ios-sdk/blob/main/FirebaseAuth/Sources/Swift/Backend/RPC/VerifyAssertionRequest.swift) | unit test |
| Refresh: form `grant_type`, `refresh_token`; response `id_token`, `refresh_token`, `expires_in`, `user_id` | [Auth REST](https://firebase.google.com/docs/reference/rest/auth) (the iOS SDK sends JSON `grantType`/`refreshToken`; both work) | Auth emulator |
| `accounts:lookup`, `accounts:delete` take `idToken` | [Auth REST](https://firebase.google.com/docs/reference/rest/auth) | Auth emulator |
| `v2/accounts:revokeToken` path and body | iOS SDK source, [Identity Platform](https://cloud.google.com/identity-platform/docs/reference/rest/v2/accounts/revokeToken) | the Auth emulator routes it as `identitytoolkit.accounts.revokeToken` and answers 501 "not implemented in the Auth Emulator"; production untested |
| Error body `{"error":{"code","message","errors":[{"reason"}],"status"}}`, code read up to the first colon | [Auth REST](https://firebase.google.com/docs/reference/rest/auth), [AuthBackend.swift](https://github.com/firebase/firebase-ios-sdk/blob/main/FirebaseAuth/Sources/Swift/Backend/AuthBackend.swift) | emulator, unit tests |
| `X-Ios-Bundle-Identifier` for iOS-restricted keys | [API keys](https://cloud.google.com/docs/authentication/api-keys) | docs only |
| Value JSON (`integerValue` string, `arrayValue.values`, `mapValue.fields`, `{}` for empty) | [Value](https://firebase.google.com/docs/firestore/reference/rest/v1/Value) | emulator, golden tests |
| `commit` with `updateTransforms` `setToServerValue: REQUEST_TIME` and `currentDocument` (`exists` / `updateTime`) | [Write](https://firebase.google.com/docs/firestore/reference/rest/v1/Write), [Precondition](https://firebase.google.com/docs/firestore/reference/rest/v1/Precondition) | emulator |
| `runQuery` streamed array; `startAt` cursor may not name more fields than `orderBy` | [runQuery](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/runQuery), [StructuredQuery](https://firebase.google.com/docs/firestore/reference/rest/v1/StructuredQuery) | emulator |
| `REQUEST_TIME` is the arrival time in ms, before `updateTime` | Firestore emulator v1.22.0 (observed 340 ms) | emulator; production gap **UNCONFIRMED** |
| Delete write result is `{}` | Firestore emulator | emulator |
| Deleted user's refresh token | docs: `USER_NOT_FOUND`; Auth emulator: `INVALID_REFRESH_TOKEN` | both handled; both end the session |

---

## 7. Owner checklist

Project `shed-489901`, team `26Y4SLFJ4M`, bundle ID `live.lupi.app`.

1. **Apple Developer → Identifiers → `live.lupi.app`.**
   - Enable *Sign in with Apple* (primary App ID).
   - In Xcode, add the *Sign in with Apple* capability. This adds the entitlement `com.apple.developer.applesignin = [Default]`.
2. **Apple Developer → Keys.** Create a key with *Sign in with Apple* enabled for the primary App ID. Keep the `.p8`, the Key ID and the Team ID.
3. **Apple Developer → Identifiers → Services IDs.** Create one, for example `live.lupi.signin`. Configure it with the domains `lupi.live` and `shed-489901.firebaseapp.com`, and the return URLs `https://lupi.live/__/auth/handler` and `https://shed-489901.firebaseapp.com/__/auth/handler`. Firebase asks for the Services ID before token revocation works ([Firebase](https://firebase.google.com/docs/auth/ios/apple)).
4. **Firebase console → Project settings → Your apps → Add app → iOS.**
   - Use bundle ID `live.lupi.app`; App Store ID can wait.
   - Do not add `GoogleService-Info.plist` to the app; LupiCloud needs only the API key and the project ID.
5. **Firebase console → Authentication → Sign-in method → Apple.**
   - Enable it.
   - Enter the Services ID, and under *OAuth code flow configuration*, Team ID `26Y4SLFJ4M`, the Key ID and the private key. Revocation (§5 step 4) fails without these.
6. **Verify the audience list.**
   - Run `GET https://identitytoolkit.googleapis.com/admin/v2/projects/shed-489901/defaultSupportedIdpConfigs/apple.com` ([method](https://cloud.google.com/identity-platform/docs/reference/rest/v2/projects.defaultSupportedIdpConfigs/get)), with a token from `gcloud auth print-access-token` and header `x-goog-user-project: shed-489901`.
   - `appleSignInConfig.bundleIds` must contain `live.lupi.app`. If it does not, PATCH it with `updateMask=appleSignInConfig.bundleIds`.
   - If this is missing, sign-in fails with `INVALID_IDP_RESPONSE` ("audience … does not match").
7. **Google Cloud console → APIs & Services → Credentials → Create API key.**
   - Application restriction *iOS apps*: `live.lupi.app`.
   - API restrictions: *Identity Toolkit API* and *Token Service API*.
   - Do not reuse the web key, which is referrer-restricted (`docs/deploy-cutover.md`). The key ships in the app; the restriction is what protects it.
8. **Deploy the rules and the function from your Mac.**
   - Nothing in CI deploys Firestore or Functions, and there is no `.firebaserc`, so name the project.
   - First compare the console's live rules with `firestore.rules`, because a deploy replaces them.
   - Then run, from the repo root:
     ```bash
     npm --prefix functions ci
     npx firebase-tools@15 deploy --only firestore:rules,functions:deleteUserData --project shed-489901
     ```
   - The functions `predeploy` builds with `tsc`. Deploying only `deleteUserData` leaves the existing functions untouched. A 1st-gen Auth trigger deploys to `us-central1` like the others.
   - **Runtime.** `functions/package.json` sets `engines.node` to `"22"`, so the deploy uses `nodejs22` (1st gen supports it until its decommission on 2027-10-31). Node.js 20 is decommissioned for Cloud Functions on **2026-10-30**: "After the decommission date, you can no longer create new workloads or update existing workloads using the runtime", and "Workloads that continue to use a decommissioned runtime may be disabled" ([Google Cloud](https://docs.cloud.google.com/functions/docs/runtime-support)). `firebase.json` sets no `runtime`, so `engines` decides ([Firebase](https://firebase.google.com/docs/functions/manage-functions)).
   - Functions deployed while `engines.node` was `"20"` keep Node.js 20 until they are redeployed. Check the runtime column in the console's Functions list, and redeploy any on Node.js 20 before 2026-10-30 (`--only functions` deploys every function in the codebase).
9. **Optional, local proof before shipping:**
   ```bash
   npm --prefix functions run test:emulator     # rules + recursive delete
   npx --yes firebase-tools@15 emulators:exec --only auth,firestore --project demo-lupi \
     "swift test --package-path apps/apple/LupiCloud --filter Emulator"
   ```
   `test:emulator` fetches the Firebase CLI through `npx` (`firebase-tools@15`), since the functions package depends only on the JS SDK. The emulators need Java 21.
10. **App wiring** (app lane):
    - Construct the clients:
      - `AuthConfiguration(apiKey: <iOS key>)` (bundle header defaults to `live.lupi.app`).
      - `FirestoreConfiguration(projectID: "shed-489901")`.
      - A Keychain `TokenStore`.
      - `JSONFileSyncStateStore` under Application Support.
    - Call `sync()` on launch, on foreground and a few seconds after edits, and `sync(full: true)` once a day.
    - The deletion screen starts a fresh Sign in with Apple and passes its `authorizationCode`.
    - Make the trophy conform to `SyncPayload`: `extension TrophyRecord: SyncPayload { public var isSyncTombstone: Bool { deletedAt != nil } }`. `syncID` comes from `Identifiable` (`UUID` or `String` ids); any other id type implements `syncID` itself.
    - Delete with `delete(id:)`, or `save()` the record with `deletedAt` set; both queue a tombstone. Deleted trophies leave `trophies()` at once.

---

## 8. Checks

- `swift build` and `swift test` in `apps/apple/LupiCloud` (Swift 6.4, Linux): 68 tests in 11 suites, run as two test processes (27 LupiAuth, 41 LupiSync). Without the emulators, 64 run and the 4 emulator tests skip. Under `emulators:exec`, all 68 pass. A clean build including tests takes about 17 s, with zero warnings.
- `functions`: `npm run build` (tsc) passes; `npm test` gives 29 passed and 7 skipped. `npm run test:emulator` gives 36 passed, including the 6 rules tests and the recursive-delete test against the emulator.
