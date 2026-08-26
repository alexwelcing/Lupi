import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.mjs";
import { savingsPreview, validatePanel } from "../src/data.mjs";
import { canonicalHash, canonicalJson, escapeHtml, ownerKey, safeNextPath } from "../src/security.mjs";
import { fakeFirestore } from "./fakes.mjs";

function makeDeps(overrides = {}) {
  return {
    verifyIdToken: async (token) => (token === "good" ? "uid-abc" : Promise.reject(new Error("bad token"))),
    firestore: fakeFirestore(),
    stripe: null,
    glimFetch: async () => { throw new Error("unreachable"); },
    config: { plans: [], baseUrl: "http://localhost:8080" },
    ...overrides,
  };
}

function oversizedStreamingRequest(url, chunkSize, totalChunks, headers = {}) {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls > totalChunks) return controller.close();
      controller.enqueue(new Uint8Array(chunkSize).fill(120));
    },
    cancel() { cancelled = true; },
  });
  return {
    request: new Request(url, { method: "POST", headers, body, duplex: "half" }),
    stats: () => ({ pulls, cancelled }),
  };
}

const reviewedPanel = {
  panel_id: "z1-nebdft2k-chemistry-held-out-v1",
  content_hash: "sha256:192fe54a5579cc421f6644d5d76fb442c6dfb985f014dc4741549e29052efb68",
};

test("panel template and models are public and honest", async () => {
  const app = buildApp(makeDeps());
  const t = await (await app.request("/api/panel-template")).json();
  assert.equal(t.panel_id, "z1-nebdft2k-chemistry-held-out-v1");
  assert.equal(t.paths.length, 30);
  const m = await (await app.request("/api/models")).json();
  assert.ok(m.models.length >= 6);
  assert.ok(m.models.some((x) => x.gated)); // UMA is honestly gated
  assert.deepEqual(
    m.models.filter((x) => x.dispatchable).map((x) => x.mlip_id).sort(),
    ["chgnet", "mace-mp-medium", "mace-mp-small", "mace-mpa-0-medium"],
  );
});

test("campaigns list returns the recorded seed even when fleet is down", async () => {
  const deps = makeDeps();
  await deps.firestore.collection("entitlements").doc("uid-abc").set({ status: "active" });
  const app = buildApp(deps);
  const res = await app.request("/api/campaigns", { headers: { authorization: "Bearer good" } });
  const body = await res.json();
  assert.equal(body.live, false);
  assert.equal(body.campaigns[0].campaign_id, "z1-union-pilot");
  assert.equal(body.campaigns[0].recorded, true);
});

test("recorded campaign detail serves per-path results", async () => {
  const app = buildApp(makeDeps());
  const body = await (await app.request("/api/campaigns/z1-union-pilot")).json();
  assert.equal(body.recorded, true);
  assert.ok(body.per_path.length > 20);
  assert.ok(body.per_path[0].path_id);
});

test("panel validation catches malformed panels and hashes good ones", async () => {
  const app = buildApp(makeDeps());
  const bad = await app.request("/api/panels/validate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ schema: "wrong" }),
  });
  assert.equal((await bad.json()).ok, false);

  const img = { symbols: ["Li", "S"], positions_angstrom: [[0, 0, 0], [1, 1, 1]] };
  const panel = {
    schema: "lupine.z1.neb_barrier_panel.v1",
    panel_id: "test-panel",
    paths: [{ path_id: "p1", chemical_system: "Li-S", input_images: [img, img, img] }],
  };
  const good = await app.request("/api/panels/validate", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(panel),
  });
  const body = await good.json();
  assert.equal(body.ok, true);
  assert.ok(body.content_hash.startsWith("sha256:"));
  assert.equal(body.dispatchable, false);
  assert.equal(body.status, "needs-verification");

  const errs = validatePanel({ schema: "lupine.z1.neb_barrier_panel.v1", panel_id: "x", paths: [] });
  assert.ok(errs.length > 0);
});

test("savings preview publishes only the frozen reviewed economics", async () => {
  const app = buildApp(makeDeps());
  const body = await (await app.request("/api/savings-preview?models=4")).json();
  assert.deepEqual(body, {
    evaluation_reduction: "72.4% fewer DFT evaluations",
    anchor_cost: "$14.65 per 129 anchors",
    status: "reviewed-public-economics",
  });
  const direct = savingsPreview(10, [5, 7, 5], 4);
  assert.deepEqual(direct, body);
});

test("campaign launch requires auth, entitlement, known models", async () => {
  const deps = makeDeps();
  const app = buildApp(deps);
  const post = (headers = {}, body = {}) => app.request("/api/campaigns", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });

  assert.equal((await post()).status, 401);

  // Signed in but no entitlement → 402
  assert.equal((await post({ authorization: "Bearer good" }, {
    panel: reviewedPanel, models: ["chgnet"], anchor_policy: "union-sparse",
  })).status, 402);

  // Grant entitlement, then unknown model → 400
  await deps.firestore.collection("entitlements").doc("uid-abc").set({ status: "active" });
  const badModel = await post({ authorization: "Bearer good" }, {
    panel: reviewedPanel, models: ["not-a-model"], anchor_policy: "union-sparse",
  });
  assert.equal(badModel.status, 400);

  const unreviewedPanel = await post({ authorization: "Bearer good" }, {
    panel: { panel_id: "custom", content_hash: "sha256:" + "1".repeat(64) },
    models: ["chgnet"], anchor_policy: "union-sparse",
  });
  assert.equal(unreviewedPanel.status, 400);
  assert.match(JSON.stringify(await unreviewedPanel.json()), /reviewed Z1 panel/);

  const smuggledPanel = await post({ authorization: "Bearer good" }, {
    panel: { ...reviewedPanel, inline: { paths: [{ path_id: "unreviewed" }] } },
    models: ["chgnet"], anchor_policy: "union-sparse",
  });
  assert.equal(smuggledPanel.status, 400);

  const duplicateModels = await post({ authorization: "Bearer good" }, {
    panel: reviewedPanel, models: ["chgnet", "chgnet"], anchor_policy: "union-sparse",
  });
  assert.equal(duplicateModels.status, 400);

  // Valid request but dispatch unreachable → 502 with the locked manifest preserved
  const res = await post({ authorization: "Bearer good" }, {
    panel: reviewedPanel, models: ["chgnet"], anchor_policy: "union-sparse",
  });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error, /dispatch is not reachable/);
  assert.ok(body.manifest.content_hash.startsWith("sha256:"));
});

test("campaign launch succeeds when glim-think accepts", async () => {
  let dispatched;
  const deps = makeDeps({
    glimFetch: async (path, init) => {
      assert.equal(path, "/research/workflows/mlip-5x5x3/campaigns");
      dispatched = JSON.parse(init.body);
      return { accepted: true, dispatched: [{ job_id: "job-1", status: "enqueued" }] };
    },
  });
  await deps.firestore.collection("entitlements").doc("uid-abc").set({ status: "trialing" });
  const app = buildApp(deps);
  const res = await app.request("/api/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer good" },
    body: JSON.stringify({ panel: reviewedPanel, models: ["chgnet"], anchor_policy: "union-sparse" }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  assert.equal(dispatched.schema, "lupine.campaign_dispatch.v1");
  assert.deepEqual(dispatched.panel, reviewedPanel);
  assert.match(dispatched.content_hash, /^sha256:[a-f0-9]{64}$/);
});

test("campaign launch fails closed when glim-think does not enqueue a cell", async () => {
  const deps = makeDeps({ glimFetch: async () => ({ accepted: true, dispatched: [] }) });
  await deps.firestore.collection("entitlements").doc("uid-abc").set({ status: "active" });
  const app = buildApp(deps);
  const res = await app.request("/api/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer good" },
    body: JSON.stringify({ panel: reviewedPanel, models: ["chgnet"], anchor_policy: "union-sparse" }),
  });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /did not enqueue/);
});

test("beats proxy degrades honestly", async () => {
  const deps = makeDeps();
  await deps.firestore.collection("entitlements").doc("uid-abc").set({ status: "active" });
  const app = buildApp(deps);
  const auth = { authorization: "Bearer good" };
  const res = await app.request("/api/beats", { headers: auth });
  assert.equal(res.status, 502);
  const okDeps = makeDeps({ glimFetch: async () => ({ beats: [{ summary: "x" }] }) });
  await okDeps.firestore.collection("entitlements").doc("uid-abc").set({ status: "active" });
  const ok = buildApp(okDeps);
  assert.equal((await ok.request("/api/beats", { headers: auth })).status, 200);
});

test("owner key and sign-in next validation are deterministic and safe", () => {
  assert.equal(ownerKey("uid-abc"), "dcafaef77757232c");
  assert.equal(safeNextPath("/campaigns/new"), "/campaigns/new");
  for (const unsafe of ["//evil.example", "https://evil.example", "account", "\\evil"]) assert.equal(safeNextPath(unsafe), "/account");
});

test("canonical JSON matches the worker contract fixed vector", () => {
  const vector = { z: [true, null, "x"], a: { y: 2, x: 1 } };
  assert.equal(canonicalJson(vector), '{"a":{"x":1,"y":2},"z":[true,null,"x"]}');
  assert.equal(canonicalHash(vector), "sha256:cc7474ca416c3be5a5a2b7158e795c1f69b0037c35b7141fbf4a1e2ace5fd22c");
});

test("HTML escaping neutralizes untrusted text and attributes", () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">&\''), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;");
});

test("live campaigns and beats require active entitlement and owner scope", async () => {
  const deps = makeDeps({ glimFetch: async (path) => {
    if (path.includes("/feed/")) return { beats: [
      { campaign_id: "screening.user.dcafaef77757232c.1.v1", summary: "owned" },
      { campaign_id: "screening.user.aaaaaaaaaaaaaaaa.2.v1", summary: "other" },
      { summary: "unscoped" },
    ] };
    if (path.endsWith("screening.user.dcafaef77757232c.1.v1")) return { campaign: { campaign_id: "screening.user.aaaaaaaaaaaaaaaa.2.v1" } };
    return { campaigns: [{ campaign_id: "screening.user.dcafaef77757232c.1.v1" }, { campaign_id: "screening.user.aaaaaaaaaaaaaaaa.2.v1" }] };
  } });
  const app = buildApp(deps);
  assert.equal((await app.request("/api/campaigns")).status, 401);
  await deps.firestore.collection("entitlements").doc("uid-abc").set({ status: "active" });
  const headers = { authorization: "Bearer good" };
  const list = await (await app.request("/api/campaigns", { headers })).json();
  assert.deepEqual(list.campaigns.map((x) => x.campaign_id), ["z1-union-pilot", "screening.user.dcafaef77757232c.1.v1"]);
  assert.equal((await app.request("/api/campaigns/screening.user.aaaaaaaaaaaaaaaa.2.v1", { headers })).status, 404);
  assert.equal((await app.request("/api/campaigns/screening.user.dcafaef77757232c.1.v1", { headers })).status, 404);
  const beats = await app.request("/api/beats", { headers });
  assert.equal(beats.status, 200);
  assert.deepEqual((await beats.json()).beats.map((beat) => beat.summary), ["owned"]);
});

test("panel validation bounds request and structural complexity", async () => {
  const app = buildApp(makeDeps());
  assert.equal((await app.request("/api/panels/validate", { method: "POST", body: "x".repeat(1_100_000) })).status, 413);
  const img = { symbols: ["H"], positions_angstrom: [[0,0,0]] };
  const panel = { schema: "lupine.z1.neb_barrier_panel.v1", panel_id: "x", paths: Array.from({ length: 101 }, (_, i) => ({ path_id: `p${i}`, chemical_system: "H", input_images: [img,img,img] })) };
  const body = await (await app.request("/api/panels/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(panel) })).json();
  assert.equal(body.ok, false);
  assert.match(body.errors.join(" "), /at most 100 paths/);
});

test("panel validation stops streaming as soon as the body cap is exceeded", async () => {
  const app = buildApp(makeDeps());
  const streamed = oversizedStreamingRequest("http://localhost/api/panels/validate", 64 * 1024, 100);
  assert.equal((await app.request(streamed.request)).status, 413);
  assert.equal(streamed.stats().cancelled, true);
  assert.ok(streamed.stats().pulls < 25, `read ${streamed.stats().pulls} chunks before stopping`);
});

test("campaign launch requires an explicitly enqueued dispatched record", async () => {
  const deps = makeDeps({ glimFetch: async () => ({ accepted: true, dispatched: [{ status: "rejected" }] }) });
  await deps.firestore.collection("entitlements").doc("uid-abc").set({ status: "active" });
  const res = await buildApp(deps).request("/api/campaigns", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer good" }, body: JSON.stringify({ panel: reviewedPanel, models: ["chgnet"] }) });
  assert.equal(res.status, 502);
});

test("campaign launch bounds JSON request size", async () => {
  const deps = makeDeps();
  await deps.firestore.collection("entitlements").doc("uid-abc").set({ status: "active" });
  const res = await buildApp(deps).request("/api/campaigns", { method: "POST", headers: { authorization: "Bearer good", "content-type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(1_100_000) }) });
  assert.equal(res.status, 413);
});
