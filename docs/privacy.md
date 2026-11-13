# lupi.live: privacy, from the code

Moved from the root [README](../README.md) on 2026-11-13, when the README was cut
to one screen. The text is unchanged; only link paths are adjusted for this folder.

## Privacy

The public page is [`apps/web/public/privacy/index.html`](../apps/web/public/privacy/index.html)
(`https://lupi.live/privacy/`, linked from the landing footer). In short, from
the code:

- **Visit counts**: built pages load the first-party, cookieless
  `/audience.js` tracker (`apps/web/vite.config.ts`,
  `apps/mcp-worker/src/audience-tracker.ts`). Its IDs live in page memory only.
  It sends page views with IDs stripped from the path, the referrer host, a
  device class and allowlisted action names. It sends nothing under Global
  Privacy Control or Do Not Track. The Worker (`apps/mcp-worker/src/audience.ts`)
  forwards a reduced event, a coarse browser class and Cloudflare's request
  metadata (the whole `request.cf` object, which can include country, region,
  city, postal code, coordinates and ASN) to the `audience-events` service
  binding, which is not in this repo.
- **No Google Analytics**: `packages/ui/src/analytics/firebaseSink.ts` is not
  imported anywhere, and the deploy sets `VITE_FIREBASE_ANALYTICS_ENABLED=false`.
- **Sign-in is optional** (Google or GitHub through Firebase Authentication)
  and is needed only to save views. Saved views live in Firestore
  (`lupiViews`). A small structure opened from a local file is stored inline
  in the view.
- **One first-party cookie**: `lupi_viewer_auth=1` (30 days, a signed-in hint).
  Preferences and Lupi Daily results stay in local/session storage.
- **Input sent to other services**: molecule-name lookups go from the browser
  to PubChem. Command-palette and switcher text go through the Worker to
  TypeSafe's Jev (`TYPESAFE_API_KEY`). Photo scan goes through the Worker to
  Hugging Face (`HF_TOKEN`) and Jev. Without those keys the routes answer
  `{ configured: false }`.

What the collector service stores, and how long Cloudflare and Firebase keep
logs, is set outside this repo.

## More

- [Overview](overview.md)
- [Development](development.md)
- [Repository map](repository-map.md)
