import { createHash } from "node:crypto";
export { escapeHtml, safeNextPath } from "../public/security.js";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function ownerKey(uid) {
  return createHash("sha256").update(uid).digest("hex").slice(0, 16);
}

export function canonicalHash(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function campaignPrefix(uid) {
  return `screening.user.${ownerKey(uid)}.`;
}
