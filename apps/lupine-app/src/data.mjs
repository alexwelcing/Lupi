// Vendored contract data (content notes: see sha256 in README / provenance fields).
// Loaded once at startup; all are small, immutable, repo-committed records.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", "data");

function load(name) {
  return JSON.parse(readFileSync(path.join(dataDir, name), "utf8"));
}

export const backendCatalog = load("backend_catalog.json");
export const panelSummary = load("z1-panel-summary.json");
export const unionCampaign = load("z1-union-campaign.json");
export const campaignManifestSchema = load("campaign-manifest.v1.schema.json");

const Z1_DISPATCHABLE_MODELS = new Set([
  "chgnet",
  "mace-mp-small",
  "mace-mp-medium",
  "mace-mpa-0-medium",
]);

// Fleet view for the picker: id, label, target job, and honest availability.
export function listModels() {
  return backendCatalog.backends.map((b) => ({
    mlip_id: b.mlip_id,
    label: b.label,
    target_job: b.target_job,
    notes: b.notes || "",
    gated: /uma/i.test(b.mlip_id), // HF repo access pending (see lupine-rhizo docs)
    dispatchable: Z1_DISPATCHABLE_MODELS.has(b.mlip_id),
  }));
}

// Public economics are frozen guardrails. Never derive, scale, or round them
// from a caller's panel/model inputs; a new reviewed source contract is needed
// before this response may change.
export function savingsPreview() {
  return {
    evaluation_reduction: "72.4% fewer DFT evaluations",
    anchor_cost: "$14.65 per 129 anchors",
    status: "reviewed-public-economics",
  };
}

// Structural validation of an uploaded panel (no .schema.json exists for the
// panel itself; this mirrors the v1 lock-file structure from lupine-rhizo).
export function validatePanel(panel) {
  const errors = [];
  if (panel.schema !== "lupine.z1.neb_barrier_panel.v1") {
    errors.push(`schema must be lupine.z1.neb_barrier_panel.v1 (got ${JSON.stringify(panel.schema)})`);
  }
  if (typeof panel.panel_id !== "string" || !panel.panel_id) errors.push("panel_id required");
  if (!Array.isArray(panel.paths) || panel.paths.length === 0) {
    errors.push("paths must be a non-empty array");
    return errors;
  }
  if (panel.paths.length > 100) {
    errors.push("paths must contain at most 100 paths");
    return errors;
  }
  panel.paths.forEach((p, i) => {
    const where = `paths[${i}]`;
    for (const k of ["path_id", "chemical_system", "input_images"]) {
      if (p[k] === undefined) errors.push(`${where}.${k} missing`);
    }
    if (Array.isArray(p.input_images)) {
      if (p.input_images.length > 256) errors.push(`${where}.input_images must contain at most 256 images`);
      if (p.input_images.length < 3) errors.push(`${where}.input_images needs >= 3 images`);
      p.input_images.forEach((img, j) => {
        if (!Array.isArray(img.symbols) || !Array.isArray(img.positions_angstrom)) {
          errors.push(`${where}.input_images[${j}] needs symbols + positions_angstrom`);
        } else if (img.symbols.length > 2000) {
          errors.push(`${where}.input_images[${j}] must contain at most 2000 atoms`);
        } else if (img.symbols.length !== img.positions_angstrom.length) {
          errors.push(`${where}.input_images[${j}] symbols/positions length mismatch`);
        }
      });
    }
    if (p.reference_barrier_ev !== undefined && typeof p.reference_barrier_ev !== "number") {
      errors.push(`${where}.reference_barrier_ev must be a number when present`);
    }
  });
  return errors;
}
