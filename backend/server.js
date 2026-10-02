import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";

const {
  MOMO_BASE_URL = "https://sandbox.momodeveloper.mtn.com",
  MOMO_ENV = "sandbox",
  MOMO_SUBSCRIPTION_KEY, MOMO_API_USER, MOMO_API_KEY,
  ALLOWED_ORIGIN = "*", PORT = 3000
} = process.env;

if (!MOMO_SUBSCRIPTION_KEY || !MOMO_API_USER || !MOMO_API_KEY) {
  console.error("Missing MOMO_* environment variables. See .env.example");
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(cors({ origin: ALLOWED_ORIGIN }));

// In-memory store: fine for testing. Replace with a database before going live,
// otherwise a server restart loses the link between orders and payments.
const payments = new Map(); // orderId -> referenceId

// --- Access token, cached until shortly before expiry ---
let token = null, tokenExp = 0;
async function getToken() {
  if (token && Date.now() < tokenExp) return token;
  const basic = Buffer.from(`${MOMO_API_USER}:${MOMO_API_KEY}`).toString("base64");
  const r = await fetch(`${MOMO_BASE_URL}/collection/token/`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY }
  });
  if (!r.ok) throw new Error(`Token request failed: ${r.status}`);
  const j = await r.json();
  token = j.access_token;
  tokenExp = Date.now() + (j.expires_in - 60) * 1000;
  return token;
}

// 0241234567 -> 233241234567 (MSISDN: country code, no + or leading 0)
const toMsisdn = p => { const d = String(p).replace(/\D/g, ""); return d.startsWith("0") ? "233" + d.slice(1) : d; };

// --- Start a payment: customer gets an approval prompt on their phone ---
app.post("/pay", async (req, res) => {
  try {
    const { amount, currency, phone, orderId } = req.body || {};
    if (!(amount > 0) || !currency || !phone || !orderId) return res.status(400).json({ error: "Missing or invalid fields" });

    // Idempotent: a retried request for the same order must not charge twice
    if (payments.has(orderId)) return res.json({ referenceId: payments.get(orderId) });

    const referenceId = randomUUID();
    const r = await fetch(`${MOMO_BASE_URL}/collection/v1_0/requesttopay`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        "X-Reference-Id": referenceId,
        "X-Target-Environment": MOMO_ENV,
        "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: String(amount),
        currency,
        externalId: orderId,
        payer: { partyIdType: "MSISDN", partyId: toMsisdn(phone) },
        payerMessage: `Fresh Cut order ${orderId}`,
        payeeNote: orderId
      })
    });
    if (r.status !== 202) { console.error("requesttopay", r.status, await r.text()); return res.status(502).json({ error: "Payment request rejected" }); }

    payments.set(orderId, referenceId);
    res.json({ referenceId });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

// --- Check status: PENDING | SUCCESSFUL | FAILED ---
app.get("/pay/:referenceId", async (req, res) => {
  try {
    const r = await fetch(`${MOMO_BASE_URL}/collection/v1_0/requesttopay/${req.params.referenceId}`, {
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        "X-Target-Environment": MOMO_ENV,
        "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY
      }
    });
    if (!r.ok) return res.status(502).json({ error: "Status check failed" });
    const j = await r.json();
    res.json({ status: j.status, reason: j.reason });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

app.get("/health", (_, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`MoMo backend on :${PORT} (${MOMO_ENV})`));
