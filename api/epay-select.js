import { convertToJpgBase64 } from "../lib/convert-image.js";


let epay_id;
let request_URL;
function formatPrice(amount) {
  const value = Number(amount);

  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`Invalid epay amount: ${amount}`);
  }

  return (value / 100).toFixed(2);
}


/* ============================================================
   HELPERS
============================================================ */

/**
 * 🔒 STRICT product lookup by epay_id metafield
 * Prevents accidental reuse of Gift Card
 */
async function findProductByEpayId({ shop, token, version, epay_id }) {
  const query = `
  {
    products(first: 50) {
      edges {
        node {
          id
          handle
          variants(first: 1) {
            edges {
              node { id }
            }
          }
          metafields(namespace: "epay", first: 10) {
            edges {
              node {
                key
                value
              }
            }
          }
        }
      }
    }
  }`;

  const res = await fetch(
    `https://${shop}/admin/api/${version}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query }),
    }
  );

  const data = await res.json();

  const products = data?.data?.products?.edges || [];

  for (const { node } of products) {
    const epayMeta = node.metafields.edges.find(
      (m) => m.node.key === "epay_id" && m.node.value === epay_id
    );

    if (epayMeta) {
      return {
        product_id: node.id,
        variant_id: node.variants.edges[0].node.id,
        product_handle: node.handle,
      };
    }
  }

  return null;
}



/* ============================================================
   API HANDLER
============================================================ */

export default async function handler(req, res) {
   console.log("request00", req);
  //    console.log("re_header--00", req.headers.origin);
  //  request_URL = req.headers.origin.split("https://")[1];
  // ================== CORS ==================

res.setHeader(
  "Access-Control-Allow-Origin",
  "https://epay-teststore-1.myshopify.com"
);

res.setHeader(
  "Access-Control-Allow-Methods",
  "GET, POST, OPTIONS"
);

res.setHeader(
  "Access-Control-Allow-Headers",
  "Content-Type, Authorization"
);

if (req.method === "OPTIONS") {
  return res.status(200).end();
}

if (req.method !== "POST") {
  return res.status(405).json({
    error: "Method not allowed",
  });
}


   
  try {
    /* ================== INPUT ================== */
    const {
      name,
      ean,
      provider,
      amount,
      shortDesc,
      longDesc,
      image,
      currencyIso,
      currencySymbol
    } = req.body;

    if (!ean) {
      return res.status(400).json({ error: "Missing epay_id" });
    }

        // 🔒 epay_id is ALWAYS EAN (never product name)
     epay_id = ean.toString().trim();

    /* ================== ENV ================== */
    const {
      SHOPIFY_SHOP,
      SHOPIFY_ADMIN_TOKEN,
      SHOPIFY_API_VERSION,
    } = process.env;

    /* ============================================================
       1️⃣ CHECK EXISTING PRODUCT (NO DUPLICATES)
    ============================================================ */
    const existing = await findProductByEpayId({
      shop: SHOPIFY_SHOP,
      // shop:request_URL,
      token: SHOPIFY_ADMIN_TOKEN,
      version: SHOPIFY_API_VERSION,
      epay_id,
    });

    if (existing) {
      return res.json({
        success: true,
        reused: true,
        ...existing,
      });
    }

    /* ============================================================
       2️⃣ CREATE PRODUCT
    ============================================================ */

    function buildProductHandle(epay_id, provider) {
  return `${epay_id}-${provider}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
 console.log("re_header--1", request_URL);
     console.log("product create call"); 
    const createRes = await fetch(
      `https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/products.json`,
    // `https://${request_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json`,
      
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        },
        body: JSON.stringify({
          product: {
            title: `${name} - ${provider}`,
             handle:buildProductHandle(epay_id, provider),
            status: "active",
            vendor: provider,
            product_type: "Digital Code",
            published:true,
            body_html: longDesc || shortDesc || "",
            variants: [
              {
                price: formatPrice(amount),
                sku: epay_id, 
                inventory_management: null,
                requires_shipping: false,
                taxable:true,
              },
            ],
            metafields: [
              {
                namespace: "epay",
                key: "epay_id",
                type: "single_line_text_field",
                value: epay_id,
              },
              {
                  namespace: "epay",
                  key: "currency_iso",
                  type: "single_line_text_field",
                  value: currencyIso, // e.g. AED, SAR, ZAR
                },
                {
                  namespace: "epay",
                  key: "currency_symbol",
                  type: "single_line_text_field",
                  value: currencySymbol, // e.g. د.إ , ر.س , R
                }
            ],
          },
        }),
      }
    );

    const created = await createRes.json();
     
    if (!createRes.ok) throw created;
 console.log("created data:",created); 
    const productId = created.product.id;
    const variantId = created.product.variants[0].id;
    const handle = created.product.handle;
  console.log("🟣handleID-2:",handle); 
const base64Image = await convertToJpgBase64(image);
console.log("🟣 base64Image:", base64Image);
console.log("🟣 base64Image length:", base64Image?.length);

    /* ============================================================
       3️⃣ ADD IMAGE (SAFE)
    ============================================================ */
if (image && provider) {
  try{
  await fetch(
    `https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/images.json`,
    // `https://${request_URL}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/images.json`,
    
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({
        image: {
          attachment: base64Image,
        },
      }),
    }
  );
  } catch (err) {
    console.error("❌ epay-select failed:", err);
    return res.status(422).json({
      success: false,
      error: "Could not download image",
    });
  }


}


    /* ============================================================
       4️⃣ PUBLISH TO ONLINE STORE
    ============================================================ */
    const pubsRes = await fetch(
      `https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/publications.json`,
//  `https://${request_URL}/admin/api/${SHOPIFY_API_VERSION}/publications.json`,
      
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        },
      }
    );

    const pubs = await pubsRes.json();
    const onlineStore = pubs.publications.find(
      (p) => p.name === "Online Store"
    );

    await fetch(
      `https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/publications/${onlineStore.id}/publishable_resources.json`,
      // `https://${request_URL}/admin/api/${SHOPIFY_API_VERSION}/publications/${onlineStore.id}/publishable_resources.json`,
      
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        },
        body: JSON.stringify({
          publishable_resource: {
            resource_id: productId,
            resource_type: "Product",
          },
        }),
      }
    );

    /* ============================================================
       5️⃣ FINAL RESPONSE
    ============================================================ */
    return res.json({
      success: true,
      created: true,
      product_id: productId,
      variant_id: variantId,
      product_handle: handle,
      processImg : base64Image,
    });

  } catch (err) {
    console.error("❌ epay-select failed:", err);
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
    });
  }
}
