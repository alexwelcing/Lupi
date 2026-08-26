// buildApp wires HTTP behavior. External effects (Firebase token verify,
// Firestore, Stripe) are injectable so tests run fully offline.
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { subscriptionToEntitlement, entitlementIsActive } from "./model.mjs";
import { config } from "./config.mjs";
import { verifyIdToken, getFirestore } from "./admin.mjs";
import { canonicalJson, campaignPrefix } from "./security.mjs";
import {
  listModels, panelSummary, unionCampaign, savingsPreview, validatePanel,
} from "./data.mjs";

const REVIEWED_PANEL = {
  panel_id: "z1-nebdft2k-chemistry-held-out-v1",
  content_hash: "sha256:192fe54a5579cc421f6644d5d76fb442c6dfb985f014dc4741549e29052efb68",
};


export function buildApp(deps = {}) {
  const verify = deps.verifyIdToken || verifyIdToken;
  const db = deps.firestore || getFirestore();
  const stripe = deps.stripe;
  const cfg = { ...config, ...(deps.config || {}) };

  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "lupine-app" }));
  app.get("/api/config", (c) => c.json({ firebase: cfg.firebaseWebConfig, plans: cfg.plans }));

  // --- auth helper -------------------------------------------------------
  async function requireUid(c) {
    const header = c.req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return null;
    try {
      return await verify(token);
    } catch {
      return null;
    }
  }

  async function boundedText(c, limit = 1_000_000) {
    if (Number(c.req.header("content-length") || 0) > limit) return { tooLarge: true };
    const reader = c.req.raw.body?.getReader();
    if (!reader) return { value: "" };
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel("request body too large");
        return { tooLarge: true };
      }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks, size).toString("utf8");
    return { value: raw };
  }

  async function boundedJson(c, limit = 1_000_000) {
    const parsed = await boundedText(c, limit);
    if (parsed.tooLarge) return parsed;
    try { return { value: JSON.parse(parsed.value) }; } catch { return { value: null }; }
  }

  // --- billing API ---------------------------------------------------------
  app.post("/api/create-checkout-session", async (c) => {
    const uid = await requireUid(c);
    if (!uid) return c.json({ error: "auth required" }, 401);
    if (!stripe) return c.json({ error: "billing not configured" }, 503);
    const parsed = await boundedJson(c, 16_384);
    if (parsed.tooLarge) return c.json({ error: "request body too large" }, 413);
    const { priceId } = parsed.value || {};
    if (!priceId || !cfg.plans.some((p) => p.priceId === priceId)) {
      return c.json({ error: "unknown priceId" }, 400);
    }

    const customerDoc = await db.collection("customers").doc(uid).get();
    let customerId = customerDoc.exists ? customerDoc.data().stripeCustomerId : null;
    if (!customerId) {
      const customer = await stripe.customers.create({ metadata: { uid } });
      customerId = customer.id;
      await db.collection("customers").doc(uid).set(
        { stripeCustomerId: customerId, updatedAt: new Date().toISOString() },
        { merge: true },
      );
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        client_reference_id: uid,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { metadata: { uid } },
        success_url: `${cfg.baseUrl}/account?checkout=success`,
        cancel_url: `${cfg.baseUrl}/pricing?checkout=cancelled`,
      },
      { idempotencyKey: `checkout-${uid}-${priceId}` },
    );
    return c.json({ url: session.url });
  });

  app.post("/api/billing-portal", async (c) => {
    const uid = await requireUid(c);
    if (!uid) return c.json({ error: "auth required" }, 401);
    if (!stripe) return c.json({ error: "billing not configured" }, 503);
    const customerDoc = await db.collection("customers").doc(uid).get();
    if (!customerDoc.exists) return c.json({ error: "no customer" }, 404);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerDoc.data().stripeCustomerId,
      return_url: `${cfg.baseUrl}/account`,
    });
    return c.json({ url: session.url });
  });

  app.get("/api/entitlement", async (c) => {
    const uid = await requireUid(c);
    if (!uid) return c.json({ error: "auth required" }, 401);
    const doc = await db.collection("entitlements").doc(uid).get();
    return c.json({ entitlement: doc.exists ? doc.data() : null });
  });

  // --- Stripe webhook (raw body; no JSON parsing before this route) --------
  app.post("/api/stripe/webhook", async (c) => {
    if (!stripe || !cfg.stripeWebhookSecret) {
      return c.json({ error: "webhook not configured" }, 503);
    }
    const parsed = await boundedText(c);
    if (parsed.tooLarge) return c.json({ error: "request body too large" }, 413);
    const rawBody = parsed.value;
    const sig = c.req.header("stripe-signature") || "";
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, cfg.stripeWebhookSecret);
    } catch {
      return c.json({ error: "invalid signature" }, 400);
    }

    const markerRef = db.collection("stripeEvents").doc(event.id);
    const obj = event.data.object;
    const seen = await db.runTransaction(async (tx) => {
      const marker = await tx.get(markerRef);
      if (marker.exists) return true;
      if (event.type === "checkout.session.completed" && obj.mode === "subscription") {
        const uid = obj.client_reference_id || obj.metadata?.uid;
        if (uid && obj.customer) tx.set(db.collection("customers").doc(uid),
          { stripeCustomerId: obj.customer, email: obj.customer_details?.email || "", updatedAt: new Date().toISOString() }, { merge: true });
      }
      if (event.type.startsWith("customer.subscription.")) {
        const uid = obj.metadata?.uid;
        if (uid) tx.set(db.collection("entitlements").doc(uid),
          { ...subscriptionToEntitlement(obj), updatedAt: new Date().toISOString() }, { merge: true });
      }
      tx.set(markerRef, { type: event.type, receivedAt: new Date().toISOString() });
      return false;
    });
    if (seen) return c.json({ received: true, duplicate: true });
    return c.json({ received: true });
  });

  // --- operator surface: campaigns -----------------------------------------
  // Status proxy target is glim-think's workflow projection; all browser
  // calls come here first so Firebase auth + entitlement are enforced
  // server-side and no internal token ever reaches the client.
  const glimFetch = deps.glimFetch || (async (path, init = {}) => {
    const headers = { "content-type": "application/json", ...(init.headers || {}) };
    if (cfg.glimThinkToken) headers.authorization = `Bearer ${cfg.glimThinkToken}`;
    const res = await fetch(`${cfg.glimThinkBase}${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`glim-think ${res.status}`);
    return res.json();
  });

  async function getEntitlement(uid) {
    const doc = await db.collection("entitlements").doc(uid).get();
    return doc.exists ? doc.data() : null;
  }
  async function requireActive(c) {
    const uid = await requireUid(c);
    if (!uid) return { error: c.json({ error: "auth required" }, 401) };
    if (!entitlementIsActive(await getEntitlement(uid))) return { error: c.json({ error: "active subscription required" }, 402) };
    return { uid, prefix: campaignPrefix(uid) };
  }

  app.get("/api/panel-template", (c) => c.json(panelSummary));
  app.get("/api/models", (c) => c.json({ models: listModels() }));

  app.get("/api/savings-preview", (c) => {
    const models = Math.max(1, Number(c.req.query("models") || 4));
    // Default: the Z1 panel's real image counts; a custom panel posts its own.
    const counts = panelSummary.paths.map((p) => p.image_count);
    return c.json(savingsPreview(counts.length, counts, models));
  });

  app.post("/api/panels/validate", async (c) => {
    const parsed = await boundedJson(c);
    if (parsed.tooLarge) return c.json({ error: "request body too large", status: "needs-verification" }, 413);
    const panel = parsed.value;
    if (!panel) return c.json({ errors: ["body must be JSON"] }, 400);
    const errors = validatePanel(panel);
    if (errors.length) return c.json({ ok: false, errors });
    const hash = createHash("sha256").update(JSON.stringify(panel)).digest("hex");
    return c.json({
      ok: true,
      content_hash: `sha256:${hash}`,
      path_count: panel.paths.length,
      dispatchable: false,
      status: "needs-verification",
    });
  });

  // Seeded recorded campaign — the Z1 union pilot, labeled as recorded.
  const seedCampaign = {
    campaign_id: unionCampaign.schema === "lupine.z1.union_pilot.campaign.v1"
      ? "z1-union-pilot" : "z1-union-pilot",
    title: "Z1 union sparse-DFT pilot (recorded 2026-07-24)",
    status: "completed",
    recorded: true,
    preregistration: unionCampaign.preregistration,
    campaign_sha256: unionCampaign.campaign_sha256,
    path_count: unionCampaign.per_path.length,
    deferred_path_count: unionCampaign.deferred_path_indices.length,
    models: Object.keys(unionCampaign.per_model_summary),
    thresholds: unionCampaign.thresholds,
  };

  app.get("/api/campaigns", async (c) => {
    const access = await requireActive(c);
    if (access.error) return access.error;
    let live = [];
    let liveError = null;
    try {
      const res = await glimFetch("/research/workflows/mlip-5x5x3/campaigns");
      live = (Array.isArray(res) ? res : (res.campaigns || [])).filter((item) => item?.campaign_id?.startsWith(access.prefix));
    } catch (e) {
      liveError = String(e.message || e);
    }
    return c.json({ campaigns: [seedCampaign, ...live], live: !liveError, live_error: liveError });
  });

  app.get("/api/campaigns/z1-union-pilot", (c) =>
    c.json({ campaign: seedCampaign, per_path: unionCampaign.per_path, recorded: true }));

  app.get("/api/campaigns/:id", async (c) => {
    const id = c.req.param("id");
    if (id === "z1-union-pilot") {
      return c.json({ campaign: seedCampaign, per_path: unionCampaign.per_path, recorded: true });
    }
    const access = await requireActive(c);
    if (access.error) return access.error;
    if (!id.startsWith(access.prefix)) return c.json({ error: "campaign not found" }, 404);
    try {
      const res = await glimFetch(`/research/workflows/mlip-5x5x3/campaigns/${id}`);
      const returnedId = res?.campaign?.campaign_id || res?.campaign_id;
      if (!returnedId?.startsWith(access.prefix)) return c.json({ error: "campaign not found" }, 404);
      return c.json(res);
    } catch (e) {
      return c.json({ error: `campaign status unavailable: ${e.message}` }, 502);
    }
  });

  app.get("/api/beats", async (c) => {
    const access = await requireActive(c);
    if (access.error) return access.error;
    try {
      const since = c.req.query("since") || "";
      const res = await glimFetch(`/feed/beats?since=${encodeURIComponent(since)}&limit=50`);
      return c.json({
        ...res,
        beats: (res.beats || []).filter((beat) => beat.campaign_id?.startsWith(access.prefix)),
      });
    } catch (e) {
      return c.json({ error: `beats unavailable: ${e.message}` }, 502);
    }
  });

  // Campaign launch: active subscription required. The manifest is hashed
  // here; execution dispatch goes through glim-think, never direct to GCP.
  app.post("/api/campaigns", async (c) => {
    const uid = await requireUid(c);
    if (!uid) return c.json({ error: "auth required" }, 401);
    const ent = await getEntitlement(uid);
    if (!entitlementIsActive(ent)) {
      return c.json({ error: "an active subscription is required to launch campaigns" }, 402);
    }
    const parsed = await boundedJson(c);
    if (parsed.tooLarge) return c.json({ error: "request body too large" }, 413);
    const body = parsed.value || {};
    const errors = [];
    if (
      body.panel?.panel_id !== REVIEWED_PANEL.panel_id ||
      body.panel?.content_hash !== REVIEWED_PANEL.content_hash
    ) {
      errors.push("only the reviewed Z1 panel lock is dispatchable; custom panels remain needs-verification");
    }
    if (
      body.panel &&
      Object.keys(body.panel).some((key) => !["panel_id", "content_hash"].includes(key))
    ) {
      errors.push("panel must contain only the reviewed panel_id and content_hash lock");
    }
    if (!Array.isArray(body.models) || body.models.length === 0) errors.push("select at least one model");
    if (Array.isArray(body.models) && new Set(body.models).size !== body.models.length) {
      errors.push("models must not contain duplicates");
    }
    const known = new Set(listModels().filter((m) => m.dispatchable).map((m) => m.mlip_id));
    for (const m of body.models || []) {
      if (!known.has(m)) errors.push(`unknown model: ${m}`);
    }
    if (body.anchor_policy && body.anchor_policy !== "union-sparse") {
      errors.push("anchor_policy must be the frozen 'union-sparse' preset");
    }
    if (errors.length) return c.json({ errors }, 400);

    const manifest = {
      schema: "lupine.campaign_dispatch.v1",
      campaign_id: `${campaignPrefix(uid)}${Date.now()}.v1`,
      owner_uid: uid,
      panel: { ...REVIEWED_PANEL },
      models: body.models,
      anchor_policy: "union-sparse",
      acceptance_test: { metric: "barrier_mae", operator: "lte", threshold: 40, unit: "meV" },
      created_at: new Date().toISOString(),
    };
    manifest.content_hash = "sha256:" + createHash("sha256").update(canonicalJson(manifest)).digest("hex");

    try {
      const res = await glimFetch("/research/workflows/mlip-5x5x3/campaigns", {
        method: "POST",
        body: JSON.stringify(manifest),
      });
      if (res.accepted !== true || !Array.isArray(res.dispatched) || !res.dispatched.some((item) => item?.status === "enqueued")) {
        throw new Error("glim-think did not enqueue a campaign cell");
      }
      return c.json({ ok: true, manifest, glim: res });
    } catch (e) {
      const detail = String(e.message || e);
      return c.json({
        error: detail.includes("did not enqueue")
          ? "glim-think did not enqueue a campaign cell"
          : "manifest locked but dispatch is not reachable yet",
        detail,
        manifest,
      }, 502);
    }
  });

  // Clean URLs for the operator pages.
  app.get("/campaigns", serveStatic({ path: "./public/campaigns.html" }));
  app.get("/campaigns/new", serveStatic({ path: "./public/campaign-new.html" }));
  app.get("/campaigns/:id", serveStatic({ path: "./public/campaign-detail.html" }));
  app.get("/campaigns/:id/results", serveStatic({ path: "./public/campaign-results.html" }));

  // --- static frontend ------------------------------------------------------
  app.use("/*", serveStatic({ root: "./public" }));

  return app;
}
