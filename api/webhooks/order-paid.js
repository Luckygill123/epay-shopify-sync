import crypto from "crypto";
import { XMLParser } from "fast-xml-parser";

/* ---------------------------------------------
   REQUIRED for Shopify webhook verification
--------------------------------------------- */
export const config = {
  api: {
    bodyParser: false,
  },
};

/* ---------------------------------------------
   Utils
--------------------------------------------- */
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function verifyWebhook(rawBody, hmacHeader) {
  if (!hmacHeader) return false;

  const digest = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(rawBody)
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(hmacHeader)
  );
}

function formatEpayAmount(amount) {
  const value = Number(amount);
  if (!value || value <= 0) throw new Error("Invalid amount");
  return Math.round(value * 100).toString();
}

/* ---------------------------------------------
   ePay API Call (with timeout)
--------------------------------------------- */
async function callEpaySale(orderId, amount, ean) {
  const xmlPayload = `<?xml version="1.0"?>
<REQUEST TYPE="SALE">
<AMOUNT>${formatEpayAmount(amount)}</AMOUNT>
<CARD><EAN>${ean}</EAN></CARD>
<TERMINALID>93889311</TERMINALID>
<TXID>${orderId}_${Date.now()}</TXID>
</REQUEST>`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(
      "https://precision.epayworldwide.com/up-interface/",
      {
        method: "POST",
        headers: { "Content-Type": "application/xml" },
        body: xmlPayload,
        signal: controller.signal,
      }
    );

    const text = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    return parser.parse(text);

  } finally {
    clearTimeout(timeout);
  }
}

/* ---------------------------------------------
   Save metafield
--------------------------------------------- */
async function saveEpayToOrder(orderId, epayData) {
  if (!process.env.SHOPIFY_ADMIN_TOKEN || !process.env.SHOPIFY_SHOP) {
    throw new Error("Missing Shopify ENV");
  }

  const response = await fetch(
    `https://${process.env.SHOPIFY_SHOP}/admin/api/2026-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({
        query: `
          mutation ($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors { message }
            }
          }
        `,
        variables: {
          metafields: [
            {
              ownerId: `gid://shopify/Order/${orderId}`,
              namespace: "epay",
              key: "result",
              type: "json",
              value: JSON.stringify(epayData),
            },
          ],
        },
      }),
    }
  );

  const json = await response.json();

  if (json.data?.metafieldsSet?.userErrors?.length) {
    throw new Error(JSON.stringify(json.data.metafieldsSet.userErrors));
  }

  console.log("✅ Metafield saved");
}

/* ---------------------------------------------
   MAIN HANDLER
--------------------------------------------- */
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  let rawBody;

  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    console.error("❌ Body read error:", err);
    return res.status(400).send("Invalid body");
  }

  const hmac = req.headers["x-shopify-hmac-sha256"];

  /* 🔐 Verify webhook */
  if (!verifyWebhook(rawBody, hmac)) {
    console.error("❌ Invalid webhook signature");
    return res.status(401).send("Unauthorized");
  }

  let order;
  try {
    order = JSON.parse(rawBody.toString());
  } catch (err) {
    console.error("❌ JSON parse error:", err);
    return res.status(400).send("Bad JSON");
  }

  const orderId = order?.id;
  const item = order?.line_items?.[0];

  if (!orderId || !item?.price || !item?.sku) {
    console.warn("⚠️ Missing required order data");
    return res.status(200).send("Skipped");
  }

  const amount = item.price;
  const ean = item.sku;

  console.log("🟢 Processing order:", orderId);

  try {
    /* 1️⃣ Call ePay */
    const epayResponse = await callEpaySale(orderId, amount, ean);

    /* 2️⃣ Save to Shopify */
    await saveEpayToOrder(orderId, epayResponse);

    return res.status(200).send("OK");

  } catch (err) {
    console.error("❌ Processing failed:", err);

    // IMPORTANT: still return 200 to stop Shopify retry storm
    return res.status(200).send("Handled with error");
  }
}