import { serve } from "@hono/node-server";
import { buildApp } from "./app.mjs";
import { config } from "./config.mjs";
import Stripe from "stripe";

const deps = {};
if (config.stripeSecretKey) {
  deps.stripe = new Stripe(config.stripeSecretKey);
} else {
  console.warn("lupine-app: STRIPE_SECRET_KEY unset — billing endpoints return 503");
}

const app = buildApp(deps);
serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`lupine-app listening on :${info.port}`);
});
