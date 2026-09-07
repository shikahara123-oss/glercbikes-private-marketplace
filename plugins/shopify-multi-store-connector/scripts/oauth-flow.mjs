import crypto from "node:crypto";
import http from "node:http";
import { execFile } from "node:child_process";

const profile = String(process.argv[2] || "").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
if (!profile) throw new Error("Credential profile is required.");

const domain = String(process.env[`SHOPIFY_${profile}_SHOP_DOMAIN`] || "").replace(/^https?:\/\//i, "").replace(/\/$/, "");
const clientId = process.env[`SHOPIFY_${profile}_CLIENT_ID`] || "";
const clientSecret = process.env[`SHOPIFY_${profile}_CLIENT_SECRET`] || "";
if (!domain || !clientId || !clientSecret) throw new Error(`${profile} domain, Client ID, or Client Secret is missing.`);

const host = "127.0.0.1";
const port = 34567;
const redirectUri = `http://${host}:${port}/callback`;
const state = crypto.randomBytes(24).toString("hex");
const requestedScopes = [
  "read_orders",
  "read_reports",
  "read_analytics",
  "read_customers",
  "read_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "read_discounts",
  "read_marketing_events",
  "read_themes"
];

function validHmac(url) {
  const received = url.searchParams.get("hmac") || "";
  if (!/^[0-9a-f]{64}$/i.test(received)) return false;
  const pairs = [...url.searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const expected = crypto.createHmac("sha256", clientSecret).update(pairs).digest();
  return crypto.timingSafeEqual(Buffer.from(received, "hex"), expected);
}

function html(response, status, message) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(`<!doctype html><meta charset="utf-8"><title>Shopify OAuth</title><body style="font-family:system-ui;padding:40px"><h2>${message}</h2><p>You can close this tab and return to PowerShell.</p></body>`);
}

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    server.close();
    reject(new Error("OAuth authorization timed out after 5 minutes."));
  }, 300000);

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, redirectUri);
    if (url.pathname !== "/callback") {
      response.writeHead(404).end();
      return;
    }
    try {
      if (url.searchParams.get("state") !== state) throw new Error("OAuth state validation failed.");
      if (!validHmac(url)) throw new Error("Shopify callback HMAC validation failed.");
      const code = url.searchParams.get("code");
      if (!code) throw new Error(url.searchParams.get("error_description") || "Shopify did not return an authorization code.");
      const tokenResponse = await fetch(`https://${domain}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
      });
      const payload = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !payload.access_token) throw new Error(`Token exchange failed (${tokenResponse.status}): ${payload.error_description || payload.error || tokenResponse.statusText}`);
      html(response, 200, `${profile} Shopify authorization completed.`);
      clearTimeout(timer);
      server.close();
      resolve({ accessToken: payload.access_token, scope: payload.scope || "" });
    } catch (error) {
      html(response, 400, "Shopify authorization failed.");
      clearTimeout(timer);
      server.close();
      reject(error);
    }
  });

  server.listen(port, host, () => {
    const authUrl = new URL(`https://${domain}/admin/oauth/authorize`);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("scope", requestedScopes.join(","));
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    console.error(`Opening Shopify authorization for ${profile}: ${domain}`);
    console.error(`If the browser does not open, visit: ${authUrl}`);
    execFile("rundll32.exe", ["url.dll,FileProtocolHandler", authUrl.toString()], () => {});
  });
});

process.stdout.write(JSON.stringify(result));
