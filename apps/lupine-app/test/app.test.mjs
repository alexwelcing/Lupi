import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { buildApp } from "../src/app.mjs";
import { subscriptionToEntitlement, entitlementIsActive } from "../src/model.mjs";
import { fakeFirestore } from "./fakes.mjs";

const WEBHOOK_SECRET = "whsec_testsecret";
const PLANS = [{ name: "Researcher", blurb: "b", priceId: "price_123", amount: 49, interval: "month" }];

const stripe = new Stripe("sk_test_placeholder");

function makeDeps(overrides = {}) {
  return {
    verifyIdToken: async (token) => (token === "good" ? "uid-abc" : Promise.reject(new Error("bad token"))),
    firestore: fakeFirestore(),
    stripe,
    config: { stripeWebhookSecret: WEBHOOK_SECRET, plans: PLANS, baseUrl: "http://localhost:8080" },
    ...overrides,
  };
}

test("health and config are public", async () => {
  const app = buildApp(makeDeps({ stripe: null }));
  const h = await app.request("/health");
  assert.equal(h.status, 200);
  const cfg = await app.request("/api/config");
  const body = await cfg.json();
  assert.equal(body.plans[0].priceId, "price_123");
  assert.equal(body.firebase.projectId, "shed-489901");
});

test("checkout requires auth and a known priceId", async () => {
  const app = buildApp(makeDeps());
  assert.equal((await app.request("/api/create-checkout-session", { method: "POST" })).status, 401);
  const bad = await app.request("/api/create-checkout-session", {
    method: "POST",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    body: JSON.stringify({ priceId: "price_nope" }),
  });
  assert.equal(bad.status, 400);
});

test("entitlement endpoint returns null for new user", async () => {
  const app = buildApp(makeDeps());
  const res = await app.request("/api/entitlement", { headers: { authorization: "Bearer good" } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).entitlement, null);
});

test("webhook rejects bad signatures", async () => {
  const app = buildApp(makeDeps());
  const res = await app.request("/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=bogus" },
    body: "{}",
  });
  assert.equal(res.status, 400);
});

test("unauthenticated webhook stops streaming as soon as its raw body cap is exceeded", async () => {
  const app = buildApp(makeDeps());
  let pulls = 0;
  let cancelled = false;
  const request = new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "irrelevant" },
    body: new ReadableStream({
      pull(controller) {
        pulls += 1;
        if (pulls > 100) return controller.close();
        controller.enqueue(new Uint8Array(64 * 1024).fill(120));
      },
      cancel() { cancelled = true; },
    }),
    duplex: "half",
  });
  assert.equal((await app.request(request)).status, 413);
  assert.equal(cancelled, true);
  assert.ok(pulls < 25, `read ${pulls} chunks before stopping`);
});

test("webhook maps subscription to entitlement, idempotently", async () => {
  const deps = makeDeps();
  const app = buildApp(deps);
  const subscription = {
    id: "sub_1",
    object: "subscription",
    status: "active",
    metadata: { uid: "uid-abc" },
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_123" }, current_period_end: 1893456000 }] },
  };
  const payload = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated", data: { object: subscription } });
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const req = () => app.request("/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": sig, "content-type": "application/json" },
    body: payload,
  });
  assert.equal((await req()).status, 200);
  const dup = await req();
  assert.equal((await dup.json()).duplicate, true);

  const ent = await app.request("/api/entitlement", { headers: { authorization: "Bearer good" } });
  const body = await ent.json();
  assert.equal(body.entitlement.status, "active");
  assert.equal(body.entitlement.priceId, "price_123");
  assert.equal(body.entitlement.currentPeriodEnd, "2030-01-01T00:00:00.000Z");
});

test("checkout.session.completed links customer to uid", async () => {
  const deps = makeDeps();
  const app = buildApp(deps);
  const session = {
    id: "cs_1", object: "checkout.session", mode: "subscription",
    client_reference_id: "uid-abc", customer: "cus_1",
    customer_details: { email: "a@b.c" }, metadata: {},
  };
  const payload = JSON.stringify({ id: "evt_2", type: "checkout.session.completed", data: { object: session } });
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await app.request("/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": sig, "content-type": "application/json" },
    body: payload,
  });
  assert.equal(res.status, 200);
  const customer = await deps.firestore.collection("customers").doc("uid-abc").get();
  assert.equal(customer.data().stripeCustomerId, "cus_1");
});

test("model: entitlement mapping and active gate", () => {
  const ent = subscriptionToEntitlement({
    status: "trialing",
    cancel_at_period_end: true,
    items: { data: [{ price: { id: "price_9" }, current_period_end: 1893456000 }] },
  });
  assert.equal(ent.priceId, "price_9");
  assert.equal(ent.cancelAtPeriodEnd, true);
  assert.ok(entitlementIsActive(ent));
  assert.ok(!entitlementIsActive({ status: "canceled" }));
  assert.ok(!entitlementIsActive(null));
});

test("webhook marker and entitlement write retry atomically after transaction failure", async () => {
  const deps = makeDeps();
  deps.firestore._failNextTransaction = true;
  const app = buildApp(deps);
  const subscription = { id: "sub_retry", status: "active", metadata: { uid: "uid-abc" }, items: { data: [{ price: { id: "price_123" }, current_period_end: 1893456000 }] } };
  const payload = JSON.stringify({ id: "evt_retry", type: "customer.subscription.updated", data: { object: subscription } });
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const req = () => app.request("/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sig }, body: payload });
  assert.equal((await req()).status, 500);
  assert.equal((await deps.firestore.collection("stripeEvents").doc("evt_retry").get()).exists, false);
  assert.equal((await req()).status, 200);
  assert.equal((await deps.firestore.collection("entitlements").doc("uid-abc").get()).data().status, "active");
});
