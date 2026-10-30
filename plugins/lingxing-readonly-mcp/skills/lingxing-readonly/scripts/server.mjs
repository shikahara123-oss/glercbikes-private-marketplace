import crypto from "node:crypto";

const endpoint = process.env.LINGXING_MCP_URL?.trim();
const apiKey = process.env.LINGXING_MCP_KEY?.trim();
const openApiAppId = process.env.LINGXING_OPENAPI_APP_ID?.trim();
const openApiAppSecret = process.env.LINGXING_OPENAPI_APP_SECRET?.trim();
const openApiBaseUrl = (process.env.LINGXING_OPENAPI_BASE_URL?.trim() || "https://openapi.lingxing.com").replace(/\/$/, "");
const openApiRelayToken = process.env.LINGXING_OPENAPI_RELAY_TOKEN?.trim();

const hasMcp = Boolean(endpoint && apiKey);
const hasOpenApi = Boolean(openApiAppId && openApiAppSecret);
if (!hasMcp && !hasOpenApi) {
  process.stderr.write("Configure Lingxing MCP or OpenAPI credentials using the skill's setup scripts, then restart Codex.\n");
  process.exit(1);
}
for (const value of [endpoint, openApiBaseUrl].filter(Boolean)) {
  if (new URL(value).protocol !== 'https:') throw new Error('Lingxing endpoints must use HTTPS.');
}

function safeError(error) {
  let value = error instanceof Error ? error.message : String(error);
  for (const secret of [apiKey, openApiAppSecret, openApiRelayToken, openApiToken].filter(Boolean)) {
    value = value.split(secret).join('[REDACTED]').split(encodeURIComponent(secret)).join('[REDACTED]');
  }
  return value;
}

const READ_ONLY_TOOL_IDS = new Set([
  "get_my_sids",
  "get_fba_stock_list",
  "erp_listing",
  "query_product_performance_asin_lists",
  "get_profit_report_msku",
  "query_order_profit_list_gross_profit",
  "query_erp_keyword_ranking_keyword",
  "query_erp_keyword_ranking_asin",
  "query_erp_competitive_monitor",
  "query_erp_follow_sale_monitor",
  "query_erp_new_monitor",
  "ad_auth_shops",
  "ad_campaign_report",
  "ad_campaign_group_report",
  "ad_campaign_keyword_report",
  "ad_campaign_search_term_report",
  "ad_campaign_targeting_report",
  "ad_campaign_product_report",
  "ad_portfolio_report_shop",
  "get_custom_report_list",
  "get_custom_report_by_id",
  "get_custom_indicator_list",
  "get_custom_indicator_field"
]);

// Lingxing's current MCP endpoint exposes a three-step gateway rather than
// individual business tools. Keep the gateway visible, but allow search/action
// only for the known read-only business tool IDs above.
const GATEWAY_TOOLS = new Set(["help", "search", "action"]);

const LOCAL_OPENAPI_TOOLS = [
  {
    name: "lingxing_overseas_warehouses",
    description: "Read the Lingxing OpenAPI warehouse list. Defaults to active overseas warehouses (type=3).",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "integer", enum: [1, 3, 4, 6], description: "1 local, 3 overseas, 4 Amazon, 6 AWD. Default 3." },
        sub_type: { type: "integer", enum: [1, 2], description: "For overseas warehouses: 1 without third-party API, 2 with third-party API. Omit for both." },
        is_delete: { type: "string", enum: ["0", "1"], description: "0 active, 1 deleted. Default 0." },
        offset: { type: "integer", minimum: 0, default: 0 },
        length: { type: "integer", minimum: 1, maximum: 1000, default: 1000 }
      },
      additionalProperties: false
    }
  },
  {
    name: "lingxing_inventory_details",
    description: "Read Lingxing warehouse inventory details by warehouse ID and optional SKU. Returns available, locked, defective, pending-QC, and total quantities.",
    inputSchema: {
      type: "object",
      properties: {
        wid: { type: "string", description: "One or more Lingxing warehouse IDs separated by commas." },
        sku: { type: "string", description: "One SKU or a fuzzy SKU search." },
        offset: { type: "integer", minimum: 0, default: 0 },
        length: { type: "integer", minimum: 1, maximum: 800, default: 100 }
      },
      additionalProperties: false
    }
  },
  {
    name: "lingxing_uk_overseas_inventory",
    description: "Find active UK overseas warehouses, optionally restrict them by name (for example 金仓 and 谷仓), then read inventory for a SKU.",
    inputSchema: {
      type: "object",
      required: ["sku"],
      properties: {
        sku: { type: "string", minLength: 1 },
        warehouse_names: { type: "array", items: { type: "string", minLength: 1 }, description: "Warehouse-name fragments. Defaults to 金仓 and 谷仓." },
        country_code: { type: "string", default: "UK", description: "Country code filter. Defaults to UK." },
        length: { type: "integer", minimum: 1, maximum: 800, default: 800 }
      },
      additionalProperties: false
    }
  }
];

let sessionId;
let openApiToken;
let openApiTokenExpiresAt = 0;

function respond(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function parseResponse(text, contentType) {
  if (contentType?.includes("text/event-stream")) {
    const events = text.split(/\r?\n\r?\n/).map((part) => part.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim()).join("\n"))
      .filter(Boolean);
    return JSON.parse(events.at(-1));
  }
  return JSON.parse(text);
}

function filterHelpResult(result) {
  for (const content of result?.result?.content ?? []) {
    if (content?.type !== "text" || typeof content.text !== "string") continue;
    try {
      const payload = JSON.parse(content.text);
      const tools = payload?.data?.tools;
      if (!Array.isArray(tools)) continue;
      payload.data.tools = tools.filter((tool) =>
        tool?.toolType === "read" && READ_ONLY_TOOL_IDS.has(tool.toolId)
      );
      payload.data.total = payload.data.tools.length;
      content.text = JSON.stringify(payload);
    } catch {
      // Preserve an upstream response that does not use the expected help shape.
    }
  }
  return result;
}

function blocked(message, detail) {
  return {
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: detail }
  };
}

function localResult(message, payload) {
  return {
    jsonrpc: "2.0",
    id: message.id,
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] }
  };
}

function requireOpenApi() {
  if (!openApiAppId || !openApiAppSecret) {
    throw new Error("Lingxing OpenAPI is not configured. Set LINGXING_OPENAPI_APP_ID and LINGXING_OPENAPI_APP_SECRET, then restart Codex.");
  }
}

async function getOpenApiToken() {
  requireOpenApi();
  if (openApiToken && Date.now() < openApiTokenExpiresAt - 60_000) return openApiToken;

  const form = new FormData();
  form.set("appId", openApiAppId);
  form.set("appSecret", openApiAppSecret);
  const response = await fetch(`${openApiBaseUrl}/api/auth-server/oauth/access-token`, {
    method: "POST",
    headers: openApiRelayToken ? { authorization: `Bearer ${openApiRelayToken}` } : undefined,
    body: form
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Lingxing OpenAPI token request returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text);
  if (Number(payload?.code) !== 200 || !payload?.data?.access_token) {
    throw new Error(`Lingxing OpenAPI token request failed: ${text.slice(0, 500)}`);
  }
  openApiToken = payload.data.access_token;
  const expiresInSeconds = Number(payload.data.expires_in) || 3600;
  openApiTokenExpiresAt = Date.now() + expiresInSeconds * 1000;
  return openApiToken;
}

function normalizeSignValue(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) return JSON.stringify(value);
  return String(value);
}

function createOpenApiSign(parameters) {
  const canonical = Object.keys(parameters)
    .sort()
    .filter((key) => parameters[key] !== "" && parameters[key] !== undefined)
    .map((key) => `${key}=${normalizeSignValue(parameters[key])}`)
    .join("&");
  const digest = crypto.createHash("md5").update(canonical, "utf8").digest("hex").toUpperCase();
  const key = Buffer.from(openApiAppId, "utf8");
  const algorithm = { 16: "aes-128-ecb", 24: "aes-192-ecb", 32: "aes-256-ecb" }[key.length];
  if (!algorithm) throw new Error(`Unsupported Lingxing AppID byte length ${key.length}; expected 16, 24, or 32 for AES signing.`);
  const cipher = crypto.createCipheriv(algorithm, key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(digest, "utf8"), cipher.final()]).toString("base64");
}

async function openApiPost(path, body) {
  const accessToken = await getOpenApiToken();
  const timestamp = Math.floor(Date.now() / 1000);
  const signInput = { ...body, access_token: accessToken, app_key: openApiAppId, timestamp };
  const query = new URLSearchParams({
    access_token: accessToken,
    app_key: openApiAppId,
    timestamp: String(timestamp),
    sign: createOpenApiSign(signInput)
  });
  const response = await fetch(`${openApiBaseUrl}${path}?${query}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(openApiRelayToken ? { authorization: `Bearer ${openApiRelayToken}` } : {})
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Lingxing OpenAPI returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text);
  if (payload?.code !== 0) throw new Error(`Lingxing OpenAPI request failed: ${text.slice(0, 500)}`);
  return payload;
}

async function listWarehouses(arguments_) {
  const body = {
    type: arguments_.type ?? 3,
    is_delete: arguments_.is_delete ?? "0",
    offset: arguments_.offset ?? 0,
    length: arguments_.length ?? 1000
  };
  if (arguments_.sub_type !== undefined) body.sub_type = arguments_.sub_type;
  return openApiPost("/erp/sc/data/local_inventory/warehouse", body);
}

async function inventoryDetails(arguments_) {
  const body = {
    offset: arguments_.offset ?? 0,
    length: arguments_.length ?? 100
  };
  if (arguments_.wid) body.wid = arguments_.wid;
  if (arguments_.sku) body.sku = arguments_.sku;
  return openApiPost("/erp/sc/routing/data/local_inventory/inventoryDetails", body);
}

async function ukOverseasInventory(arguments_) {
  const warehouseNames = arguments_.warehouse_names?.length ? arguments_.warehouse_names : ["金仓", "谷仓"];
  const countryCode = (arguments_.country_code || "UK").toUpperCase();
  // Lingxing identifies the United Kingdom as GB, while operators commonly use UK.
  const countryCodes = countryCode === "UK" ? ["UK", "GB"] : [countryCode];
  const warehousesPayload = await listWarehouses({ type: 3, is_delete: "0", offset: 0, length: 1000 });
  const warehouses = (warehousesPayload.data || []).filter((warehouse) => {
    const names = [warehouse.name, warehouse.t_warehouse_name, warehouse.t_warehouse_code].filter(Boolean).join(" ");
    const countryMatches = !countryCode || countryCodes.includes(String(warehouse.country_code || "").toUpperCase());
    return countryMatches && warehouseNames.some((name) => names.includes(name));
  });
  if (!warehouses.length) {
    return {
      code: 0,
      message: "No matching active overseas warehouses found.",
      filters: { country_code: countryCode, warehouse_names: warehouseNames },
      available_warehouses: (warehousesPayload.data || []).map(({ wid, name, t_warehouse_name, t_warehouse_code, country_code }) => ({ wid, name, t_warehouse_name, t_warehouse_code, country_code })),
      data: []
    };
  }
  const inventory = await inventoryDetails({
    wid: warehouses.map((warehouse) => warehouse.wid).join(","),
    sku: arguments_.sku,
    offset: 0,
    length: arguments_.length ?? 800
  });
  const warehouseById = new Map(warehouses.map((warehouse) => [String(warehouse.wid), warehouse]));
  return {
    code: 0,
    message: "success",
    total: inventory.total ?? inventory.data?.length ?? 0,
    warehouses,
    data: (inventory.data || []).map((row) => ({
      ...row,
      warehouse: warehouseById.get(String(row.wid))
    }))
  };
}

async function callLocalTool(message) {
  const toolName = message.params?.name;
  const arguments_ = message.params?.arguments || {};
  if (toolName === "lingxing_overseas_warehouses") return localResult(message, await listWarehouses(arguments_));
  if (toolName === "lingxing_inventory_details") return localResult(message, await inventoryDetails(arguments_));
  if (toolName === "lingxing_uk_overseas_inventory") return localResult(message, await ukOverseasInventory(arguments_));
  return null;
}

async function forward(message) {
  if (!hasMcp) throw new Error('Official MCP reports require LINGXING_MCP_URL and LINGXING_MCP_KEY. OpenAPI warehouse tools remain available.');
  const headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "x-mcp-key": apiKey
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(message)
  });
  const receivedSessionId = response.headers.get("mcp-session-id");
  if (receivedSessionId) sessionId = receivedSessionId;
  const body = await response.text();
  if (!response.ok) throw new Error(`Lingxing MCP returned HTTP ${response.status}: ${body.slice(0, 400)}`);
  return body ? parseResponse(body, response.headers.get("content-type")) : null;
}

async function handle(message) {
  if (!hasMcp && message.method === 'initialize') {
    return { jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'lingxing-readonly', version: '0.2.0' } } };
  }
  if (!hasMcp && message.method === 'tools/list') return { jsonrpc: '2.0', id: message.id, result: { tools: LOCAL_OPENAPI_TOOLS } };
  if (message.method === 'ping') return { jsonrpc: '2.0', id: message.id, result: {} };
  if (message.method?.startsWith('notifications/')) return null;
  if (!['initialize', 'tools/list', 'tools/call', 'ping'].includes(message.method)) return blocked(message, 'Unsupported MCP method.');
  if (message.method === "tools/call") {
    const toolName = message.params?.name;
    if (LOCAL_OPENAPI_TOOLS.some((tool) => tool.name === toolName)) {
      return callLocalTool(message);
    }
    if (!GATEWAY_TOOLS.has(toolName)) {
      return blocked(message, `Tool '${toolName}' is blocked: this connector is read-only.`);
    }
    if (toolName === "search" || toolName === "action") {
      const toolId = message.params?.arguments?.toolId;
      if (!READ_ONLY_TOOL_IDS.has(toolId)) {
        return blocked(message, `Business tool '${toolId ?? "unknown"}' is blocked: this connector is read-only.`);
      }
    }
  }
  const result = await forward(message);
  if (message.method === "tools/list" && result?.result?.tools) {
    result.result.tools = result.result.tools.filter((tool) => GATEWAY_TOOLS.has(tool.name));
    result.result.tools.push(...LOCAL_OPENAPI_TOOLS);
  }
  if (message.method === "tools/call" && message.params?.name === "help") {
    return filterHelpResult(result);
  }
  return result;
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let lineEnd;
  while ((lineEnd = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
      const result = await handle(message);
      if (result) respond(result);
    } catch (error) {
      if (message?.id !== undefined) {
        respond({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: safeError(error) } });
      } else {
        process.stderr.write(`${safeError(error)}\n`);
      }
    }
  }
});
