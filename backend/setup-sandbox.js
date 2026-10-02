// One-time sandbox setup: creates an API user and key, prints the values for your .env
// Usage: MOMO_SUBSCRIPTION_KEY=xxxx npm run setup
import { randomUUID } from "node:crypto";
const base = process.env.MOMO_BASE_URL || "https://sandbox.momodeveloper.mtn.com";
const key = process.env.MOMO_SUBSCRIPTION_KEY;
if (!key) { console.error("Set MOMO_SUBSCRIPTION_KEY first (Collections product subscription key)."); process.exit(1); }

const user = randomUUID();
let r = await fetch(`${base}/v1_0/apiuser`, {
  method: "POST",
  headers: { "X-Reference-Id": user, "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json" },
  body: JSON.stringify({ providerCallbackHost: "example.com" })
});
if (r.status !== 201) { console.error("Create user failed:", r.status, await r.text()); process.exit(1); }

r = await fetch(`${base}/v1_0/apiuser/${user}/apikey`, {
  method: "POST", headers: { "Ocp-Apim-Subscription-Key": key }
});
const { apiKey } = await r.json();
console.log(`MOMO_API_USER=${user}\nMOMO_API_KEY=${apiKey}`);
