# Lupi MCP Roadmap

## Product Goal

Make Lupi MCP a secure, agent-usable molecular viewer service that Codex, Claude Code, and local research tools can drive from a development browser without manual viewer setup.

## Current Baseline

- `apps/mcp-worker` is the browser-free Cloudflare MCP control plane. It exposes MCP JSON-RPC over `POST /mcp`, health/manifest endpoints, and two deliberately different render profiles: `RenderRequestV1` validation-only and an owner-approved authenticated `legacy-v0` synchronous opaque-PNG executor.
- The bounded legacy profile accepts template or procedural molecules only, has no viewer overrides, delegates through a separately authenticated `apps/render-backend`, validates the returned PNG independently, and stores job receipts, per-job provenance, and immutable artifacts in private `RENDER_ASSETS` production/preview buckets.
- The legacy implementation exists in source but is not production-active merely by being merged. It still requires private bucket provisioning, `RENDERER_ENDPOINT`, distinct caller and renderer secrets, an authorized deployment, and candidate/custom-domain live proof. D1 and Queue remain reserved for a later asynchronous profile.
- The human viewer now has a source-aware distance/angle workflow with exact-frame provenance and save/reopen persistence. It explicitly labels unknown source units and discloses that minimum-image/PBC treatment is not applied. Dihedral, multiple-measurement history/export, and PBC-aware measurement remain future work.
- `/#/mcp` runs the real Atlas viewer bridge, not the old marketing/studio mock.
- Firebase Auth is wired into the viewer header and MCP harness.
- The `shed-489901` Firebase project has Google sign-in enabled and authorizes local dev return domains.
- The production Firebase auth domain is branded as `lupi.live`, with Cloud Run proxying Firebase's reserved auth helper paths.
- The local viewer uses Firebase SDK redirect persistence and can expose a Firebase ID token that the MCP server can require on protected requests.
- A server-issued HttpOnly session cookie is still pending; it should be created by exchanging the ID token with an MCP/auth backend, not by writing a token cookie from the browser.
- Firestore is now the canonical saved-view store for user-owned `/view/:slug` share links. The public path is served through the saved-view social-card function and redirects human browsers into the SPA view route; saved views store the molecule source plus camera, display, background, material, annotation, playback, and export-base state.

## Milestone 1: Authenticated Local Dogfood

- Keep Google redirect sign-in as the default browser flow.
- Pass Firebase ID tokens with every browser-to-MCP request.
- Add an auth session endpoint that exchanges a fresh Firebase ID token for a `Secure`, `HttpOnly`, `SameSite=Lax` session cookie on `lupi.live`.
- Add an MCP server auth middleware that verifies Firebase ID tokens with the Admin SDK.
- Return structured auth failures: `UNAUTHENTICATED`, `TOKEN_EXPIRED`, and `FORBIDDEN`.
- Add a dev-only auth status probe so Codex can verify whether the viewer and server agree on the user.

## Milestone 2: Stable Agent Contract

- Freeze the first supported tool set around viewer control, structure loading, style changes, camera control, screenshots, and export.
- Expose creative asset export through `lupi.export_asset`, returning inline PNG/JPEG/WebP and deterministic GLB artifacts for model consumption; restore USDZ only after byte-stable serialization is proven.
- Publish JSON schemas for every request and response.
- Add an MCP command for `lupi.save_view` that writes the same Firestore saved-view document as the browser button.
- Add deterministic request IDs, transcript entries, and replayable command logs.
- Provide setup snippets for Codex and Claude Code that target the local MCP endpoint.

## Milestone 3: Production-Grade Viewer Operations

- Add durable scene/session IDs so agents can reopen or share a generated view.
- Stream large molecule loads and return progress events instead of blocking.
- Activate the bounded owner-operated legacy PNG lane only after its private
  buckets, backend, distinct secrets, deployment, and authenticated live
  render/job/provenance/artifact readback are proven.
- Keep `RenderRequestV1` validation-only until source resolution, exact spec
  application, an activated renderer fingerprint, V1 sidecars, and immutable
  cache-conflict behavior are implemented and proven as one contract.
- Gate expensive operations by user/project quotas.

## Milestone 4: Security And Admin

- Add Firebase custom claims for admin, internal tester, and public user roles.
- Keep all MCP mutating tools behind auth.
- Add audit logging for agent, user, tool name, latency, and artifact outputs.
- Add an admin settings surface for endpoint, auth state, token refresh, and server health.

## Milestone 5: Verification

- At the end of the current development slice, verify the distance/angle
  inspect-save-reopen loop and the authenticated legacy render/retrieve loop;
  report Local, CI, Deploy, Live API, and Public site independently.
- Add unit coverage for auth state, request token attachment, and schema validation.
- Add browser smoke tests for `/#/mcp`: signed-out state, redirect sign-in launch, token-present state, and authenticated command execution.
- Add server tests with valid, expired, malformed, and missing Firebase tokens.
- Add a release checklist that separates local build, deployed Firebase/Auth config, MCP server health, and live viewer behavior.
