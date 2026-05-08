export default async function handler(req, res) {
  try {
        // ✅ Allow your shop domain
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  // ✅ Handle preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

    const { orderId } = req.query;

    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const query = `
      query ($id: ID!) {
        order(id: $id) {
          metafield(namespace: "epay", key: "result") {
            value
          }
        }
      }
    `;

    const response = await fetch(
      `https://${process.env.SHOPIFY_SHOP}/admin/api/2026-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
        },
        body: JSON.stringify({
          query,
          variables: {
            id: `gid://shopify/Order/${orderId}`,
          },
        }),
      }
    );

    const json = await response.json();
console.log("jsonData00", json)
    if (json.errors) {
      console.error(json.errors);
      return res.status(500).json({ error: json.errors });
    }

    const metafield = json.data?.order?.metafield;

    if (!metafield) {
      return res.status(200).json(null);
    }

    return res.status(200).json(JSON.parse(metafield.value));

  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
