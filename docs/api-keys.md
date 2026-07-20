# Lupi API-key auth inventory

> **Status: planned—not yet shipped as a supported user flow.** The tracked
> repository contains backend implementation inventory, but it does not contain
> a tested `lupi:auth` package script and the active Account shell does not expose
> a verified API-key panel. Do not treat the steps below as currently available
> product instructions. The authenticated-agent golden-path gate (operator
> Plan 026) owns the scoped replacement, UI/client reconciliation,
> deployment, and live proof.

The existing backend design allows a signed-in user to mint long-lived **API
keys** so an agent can exchange a key for a Firebase custom token. That exchange
grants broad user identity and is implementation history, not the ratified
target agent-security model.

The target of that gate is a short-lived, render-scoped credential with explicit
ownership, limits, revocation bounds, and fail-closed paid execution.

## Intended user flow (unavailable until the authenticated-agent gate passes)

The intended UI lets a signed-in user create, metadata-list, and revoke a key,
showing the raw value exactly once. That panel is not present in the tracked
Account shell on the current release base.

## Implementation inventory: broad Firebase exchange

The raw HTTP sequence below documents the existing backend seam for migration
and testing. It is not an endorsed production login recipe and must not be
advertised as the final scoped agent flow.

```bash
KEY="lupi_pk_…"                       # the key the user gave you
WEB_API_KEY="<VITE_FIREBASE_API_KEY>" # public Firebase web key from .env.local or deploy env
EXCHANGE="https://us-central1-shed-489901.cloudfunctions.net/exchangeApiKey"

# 1) key -> Firebase custom token
CUSTOM=$(curl -s -X POST "$EXCHANGE" -H "Authorization: Bearer $KEY" | jq -r .customToken)

# 2) custom token -> Firebase ID token (standard Identity Toolkit REST call)
ID_TOKEN=$(curl -s -X POST \
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=$WEB_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Referer: https://lupi.live/' \
  -d "{\"token\":\"$CUSTOM\",\"returnSecureToken\":true}" | jq -r .idToken)

# 3) historical behavior: use $ID_TOKEN as broad Firebase identity
```

The resulting Firebase session can be renewable and broadly authorized. That is
the central reason this inventory cannot be called the shipped agent contract.
Treat any existing API key like a password and keep paid rendering disabled.

## Existing endpoints (migration inventory)

| Function | Type | Auth | Returns |
|---|---|---|---|
| `createApiKey` | callable | signed-in user | `{ keyId, rawKey, prefix, name }` (rawKey once) |
| `revokeApiKey` | callable | signed-in user | `{ keyId, revoked: true }` |
| `exchangeApiKey` | HTTPS POST | the key itself | `{ customToken }` |

## Historical operational requirements

- The Firebase web API key is public but must stay browser-restricted to
  production, preview, Cloud Run, and local development origins. REST smoke tests
  should send a matching `Referer` header when exchanging custom tokens through
  Identity Toolkit.
- The deployed `exchangeApiKey` runtime service account must be able to sign
  Firebase custom tokens. In `shed-489901`, grant
  `roles/iam.serviceAccountTokenCreator` to the runtime service account on
  itself; otherwise the Function returns HTTP 500 with `iam.serviceAccounts.signBlob`
  denied.

## Security model

- **Storage**: only `sha256(rawKey)` is persisted (`apiKeys/{id}` with `uid`,
  `prefix`, `name`, `createdAt`, `lastUsedAt`, `revokedAt`). The raw key is never
  stored or logged.
- **Writes**: only the Cloud Functions admin SDK writes `apiKeys`; clients can
  read only their own keys (`firestore.rules`). `allow write: if false`.
- **Scope limitation**: the current exchange grants the user's **full
  identity** (Firebase has no capability-scoped tokens). The custom token
  carries an informational
  `viaApiKey: true` claim for audit / future scoping — it is not yet an
  access-control gate.
- **Abuse / cost stopgap**: `exchangeApiKey` is public, capped at
  `maxInstances: 10`, and calls a Firestore fixed-window limiter configured for
  roughly 10 exchanges per reported client IP per minute. The limiter fails
  open on Firestore errors and trusts the left-most `X-Forwarded-For` value
  without live trusted-proxy evidence. It is tested implementation inventory,
  not an accepted production or paid-execution boundary.
- **Deferred hardening** (see the security review): move `keyHash` to a
  client-unreadable sub-doc, prove the platform client-address boundary, enforce
  a fail-closed edge limit or equivalent Cloud Armor/App Check control, and add
  dormant-key expiry/alerting.

These limitations are not accepted release exceptions. The
[product ownership contract](product-ownership-contract.md) treats auth as a
supporting capability, and the [release truth contract](release-truth-contract.md)
requires paid work to fail closed until per-user scope and limits are proven.
