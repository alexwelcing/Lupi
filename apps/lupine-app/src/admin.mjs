// firebase-admin wiring. Lazy so tests and local dev without GCP creds can
// inject fakes instead (see app.mjs buildApp deps).
import admin from "firebase-admin";
import { config } from "./config.mjs";

let app = null;

export function getAdmin() {
  if (!app) {
    app = admin.initializeApp({ projectId: config.firebaseProjectId });
  }
  return admin;
}

export async function verifyIdToken(token) {
  const decoded = await getAdmin().auth().verifyIdToken(token);
  return decoded.uid;
}

export function getFirestore() {
  getAdmin();
  return admin.firestore();
}
