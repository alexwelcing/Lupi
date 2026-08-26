// Centralized env config. Secrets come from Secret Manager in production
// (wired via --set-secrets in cloudbuild.yaml); locally use a .env-ish shell.
export const config = {
  port: Number(process.env.PORT || 8080),
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "shed-489901",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  // Public Firebase web config handed to the browser via /api/config.
  // These values are not secrets (same as lupi's client-side config; the
  // apiKey is the public web key already served to every lupi.live visitor).
  firebaseWebConfig: {
    apiKey: process.env.FIREBASE_WEB_API_KEY || "AIzaSyAPESEK0sgMh6NOq_3zQ83ndWQk4SxU954",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "shed-489901.firebaseapp.com",
    projectId: process.env.FIREBASE_PROJECT_ID || "shed-489901",
    appId: process.env.FIREBASE_APP_ID || "1:350452481649:web:c12dea9ce6f6ae045065d0",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "shed-489901.firebasestorage.app",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "350452481649",
  },
  // Plans shown on /pricing: JSON array of { name, blurb, priceId, amount, interval }.
  plans: JSON.parse(process.env.PLANS_JSON || "[]"),
  baseUrl: (process.env.BASE_URL || "http://localhost:8080").replace(/\/$/, ""),
  glimThinkBase: (process.env.GLIM_THINK_BASE || "https://glim-think-v1.aw-ab5.workers.dev").replace(/\/$/, ""),
  glimThinkToken: process.env.GLIM_THINK_TOKEN || "",
};
