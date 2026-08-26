// Shared frontend module: Firebase auth (shared shed-489901 user base) +
// billing API calls. Loaded as an ES module by every page.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, GithubAuthProvider,
  signInWithPopup, signInWithRedirect, signOut as fbSignOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
export { escapeHtml, safeNextPath } from "/security.js";

let auth = null;
let cfgPromise = null;

export function getConfig() {
  cfgPromise ||= fetch("/api/config").then((r) => r.json());
  return cfgPromise;
}

export async function getFirebaseAuth() {
  if (auth) return auth;
  const { firebase } = await getConfig();
  const app = initializeApp(firebase);
  auth = getAuth(app);
  return auth;
}

export async function signIn(provider) {
  const a = await getFirebaseAuth();
  const p = provider === "github" ? new GithubAuthProvider() : new GoogleAuthProvider();
  try {
    await signInWithPopup(a, p);
  } catch (e) {
    if (e?.code === "auth/popup-blocked" || e?.code === "auth/popup-closed-by-user") {
      await signInWithRedirect(a, p);
      return;
    }
    throw e;
  }
}

export async function signOut() {
  await fbSignOut(await getFirebaseAuth());
}

export function onUser(cb) {
  return getFirebaseAuth().then((a) => onAuthStateChanged(a, cb));
}

export async function authedFetch(path, options = {}) {
  const a = await getFirebaseAuth();
  const user = a.currentUser;
  if (!user) throw new Error("not signed in");
  const token = await user.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export async function startCheckout(priceId) {
  const { url } = await authedFetch("/api/create-checkout-session", {
    method: "POST",
    body: JSON.stringify({ priceId }),
  });
  window.location.href = url;
}

export async function openBillingPortal() {
  const { url } = await authedFetch("/api/billing-portal", { method: "POST" });
  window.location.href = url;
}

export function loadEntitlement() {
  return authedFetch("/api/entitlement");
}
