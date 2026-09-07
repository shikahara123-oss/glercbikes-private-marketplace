#!/usr/bin/env node
/** Read-only multi-account Meta Ads and Google Ads MCP server. */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const env = process.env;
const json = (value) => JSON.stringify(value);
const text = (value) => ({ content: [{ type: "text", text: json(value) }] });
const normalizeGoogleId = (value) => String(value || "").replace(/-/g, "");
const normalizeMetaId = (value) => String(value || "").replace(/^act_/, "");

function assertDate(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new Error(`${field} 必须为 YYYY-MM-DD。`);
}

function loadAccountMap() {
  let raw;
  let source = null;
  if (env.AD_ACCOUNTS_JSON) {
    raw = env.AD_ACCOUNTS_JSON;
    source = "AD_ACCOUNTS_JSON";
  } else {
    const file = env.AD_ACCOUNTS_FILE || path.resolve(process.cwd(), "accounts.json");
    if (fs.existsSync(file)) {
      raw = fs.readFileSync(file, "utf8");
      source = file;
    }
  }
  if (!raw) return { accounts: {}, source: "legacy environment variables" };
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^\uFEFF/, "")); } catch (error) { throw new Error(`账户映射 JSON 无效：${error.message}`); }
  const accounts = parsed.accounts || parsed;
  if (!accounts || Array.isArray(accounts) || typeof accounts !== "object") throw new Error("账户映射必须是对象，或包含 accounts 对象。");
  return { accounts, source };
}

function legacyAccount() {
  if (!env.META_AD_ACCOUNT_ID && !env.GOOGLE_ADS_CUSTOMER_ID) return null;
  return { metaAccountId: env.META_AD_ACCOUNT_ID || undefined, googleCustomerId: env.GOOGLE_ADS_CUSTOMER_ID || undefined, googleLoginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || undefined };
}

function resolveAccount(account) {
  const { accounts, source } = loadAccountMap();
  const names = Object.keys(accounts);
  if (account) {
    const match = names.find((name) => name.toLowerCase() === account.toLowerCase());
    if (!match) throw new Error(`未找到账户“${account}”。可用账户：${names.join("、") || "无"}。`);
    return { name: match, config: accounts[match], source };
  }
  if (names.length === 1) return { name: names[0], config: accounts[names[0]], source };
  if (names.length > 1) throw new Error(`已配置多个账户，请指定 account。可用账户：${names.join("、")}。`);
  const legacy = legacyAccount();
  if (legacy) return { name: "default", config: legacy, source };
  throw new Error("尚未配置广告账户映射。请运行 scripts/setup.ps1。");
}

function profilePrefix(accountConfig) {
  if (!accountConfig.credentialProfile) return "";
  const normalized = String(accountConfig.credentialProfile).trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  if (!normalized) throw new Error("credentialProfile 不能为空。");
  return `AD_${normalized}_`;
}

function credentialsFor(accountConfig) {
  const prefix = profilePrefix(accountConfig);
  const get = (name) => env[`${prefix}${name}`] || (!prefix ? env[name] : undefined);
  return {
    profile: accountConfig.credentialProfile || "legacy-global",
    prefix: prefix || "",
    metaAccessToken: get("META_ACCESS_TOKEN"),
    googleDeveloperToken: get("GOOGLE_ADS_DEVELOPER_TOKEN"),
    googleAccessToken: get("GOOGLE_ADS_ACCESS_TOKEN"),
    googleRefreshToken: get("GOOGLE_ADS_REFRESH_TOKEN"),
    googleClientId: get("GOOGLE_OAUTH_CLIENT_ID"),
    googleClientSecret: get("GOOGLE_OAUTH_CLIENT_SECRET")
  };
}

function credentialStatus(accountConfig) {
  const credentials = credentialsFor(accountConfig);
  const label = (name) => `${credentials.prefix}${name}`;
  const metaMissing = credentials.metaAccessToken ? [] : [label("META_ACCESS_TOKEN")];
  const googleMissing = [];
  if (!credentials.googleDeveloperToken) googleMissing.push(label("GOOGLE_ADS_DEVELOPER_TOKEN"));
  if (!credentials.googleAccessToken) {
    if (!credentials.googleRefreshToken) googleMissing.push(label("GOOGLE_ADS_REFRESH_TOKEN"));
    if (!credentials.googleClientId) googleMissing.push(label("GOOGLE_OAUTH_CLIENT_ID"));
    if (!credentials.googleClientSecret) googleMissing.push(label("GOOGLE_OAUTH_CLIENT_SECRET"));
  }
  return { profile: credentials.profile, meta: metaMissing.length ? "missing credentials" : "configured", google: googleMissing.length ? "missing credentials" : "configured", missing: { meta: metaMissing, google: googleMissing } };
}

function actionValue(actions, patterns) {
  const item = (actions || []).find((action) => patterns.includes(action.action_type));
  return item ? Number(item.value || 0) : 0;
}

async function responseJson(response, platform) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    const message = body?.error?.message || body?.error?.error_description || response.statusText;
    throw new Error(`${platform} 请求失败：${message}`);
  }
  return body;
}

async function metaGet(credentials, endpoint, params = {}) {
  if (!credentials.metaAccessToken) throw new Error(`Meta 尚未授权：需要 ${credentials.prefix}META_ACCESS_TOKEN。`);
  const version = env.META_GRAPH_VERSION || "v23.0";
  const query = new URLSearchParams({ ...params, access_token: credentials.metaAccessToken });
  return responseJson(await fetch(`https://graph.facebook.com/${version}/${endpoint}?${query}`), "Meta Ads");
}

async function metaSummary(accountConfig, credentials, startDate, endDate, level = "account") {
  const accountId = accountConfig.metaAccountId;
  if (!accountId) throw new Error("此业务账户缺少 metaAccountId。");
  const payload = await metaGet(credentials, `act_${normalizeMetaId(accountId)}/insights`, { level, fields: "account_name,campaign_name,spend,impressions,clicks,actions,action_values,purchase_roas", time_range: json({ since: startDate, until: endDate }) });
  return (payload.data || []).map((row) => {
    const purchases = actionValue(row.actions, ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
    const purchaseValue = actionValue(row.action_values, ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
    const spend = Number(row.spend || 0);
    return { name: row.campaign_name || row.account_name || "Meta Ads", spend, impressions: Number(row.impressions || 0), clicks: Number(row.clicks || 0), purchases, conversionValue: purchaseValue, roas: spend ? purchaseValue / spend : null };
  });
}

async function googleAccessToken(credentials) {
  if (credentials.googleAccessToken) return credentials.googleAccessToken;
  if (!credentials.googleRefreshToken || !credentials.googleClientId || !credentials.googleClientSecret) throw new Error(`Google Ads 尚未授权：需要 ${credentials.prefix}GOOGLE_ADS_REFRESH_TOKEN、${credentials.prefix}GOOGLE_OAUTH_CLIENT_ID 和 ${credentials.prefix}GOOGLE_OAUTH_CLIENT_SECRET。`);
  const form = new URLSearchParams({ client_id: credentials.googleClientId, client_secret: credentials.googleClientSecret, refresh_token: credentials.googleRefreshToken, grant_type: "refresh_token" });
  const payload = await responseJson(await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form }), "Google OAuth");
  return payload.access_token;
}

async function googleRequest(credentials, url, options = {}) {
  if (!credentials.googleDeveloperToken) throw new Error(`Google Ads 尚未授权：需要 ${credentials.prefix}GOOGLE_ADS_DEVELOPER_TOKEN。`);
  const token = await googleAccessToken(credentials);
  const headers = { authorization: `Bearer ${token}`, "developer-token": credentials.googleDeveloperToken, "content-type": "application/json", ...(options.headers || {}) };
  return responseJson(await fetch(url, { ...options, headers }), "Google Ads");
}

async function googleQuery(accountConfig, credentials, query) {
  const customerId = normalizeGoogleId(accountConfig.googleCustomerId);
  if (!customerId) throw new Error("此业务账户缺少 googleCustomerId。");
  const version = env.GOOGLE_ADS_API_VERSION || "v22";
  const headers = {};
  if (accountConfig.googleLoginCustomerId) headers["login-customer-id"] = normalizeGoogleId(accountConfig.googleLoginCustomerId);
  const payload = await googleRequest(credentials, `https://googleads.googleapis.com/${version}/customers/${customerId}/googleAds:searchStream`, { method: "POST", headers, body: json({ query }) });
  return (Array.isArray(payload) ? payload : [payload]).flatMap((batch) => batch.results || []);
}

function googleMetrics(row) {
  const metrics = row.metrics || {};
  const spend = Number(metrics.costMicros || 0) / 1_000_000;
  const conversionValue = Number(metrics.conversionsValue || 0);
  return { spend, impressions: Number(metrics.impressions || 0), clicks: Number(metrics.clicks || 0), purchases: Number(metrics.conversions || 0), conversionValue, roas: spend ? conversionValue / spend : null };
}

function total(rows) {
  const fields = ["spend", "impressions", "clicks", "purchases", "conversionValue"];
  const result = Object.fromEntries(fields.map((field) => [field, rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)]));
  result.ctr = result.impressions ? result.clicks / result.impressions : null;
  result.cpa = result.purchases ? result.spend / result.purchases : null;
  result.roas = result.spend ? result.conversionValue / result.spend : null;
  return result;
}

async function weeklySummary({ account, startDate, endDate }) {
  assertDate(startDate, "startDate"); assertDate(endDate, "endDate");
  const selected = resolveAccount(account);
  const credentials = credentialsFor(selected.config);
  const [metaRows, googleRows] = await Promise.all([
    metaSummary(selected.config, credentials, startDate, endDate),
    googleQuery(selected.config, credentials, `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`).then((rows) => rows.map(googleMetrics))
  ]);
  return { account: selected.name, credentialProfile: credentials.profile, period: { startDate, endDate }, meta: total(metaRows), google: total(googleRows), attributionNote: "Meta 与 Google 的转化价值和 ROAS 均为各平台归因，未合并为 Shopify 营收。" };
}

async function campaignPerformance({ account, platform, startDate, endDate }) {
  assertDate(startDate, "startDate"); assertDate(endDate, "endDate");
  const selected = resolveAccount(account);
  const credentials = credentialsFor(selected.config);
  if (platform === "meta") return { account: selected.name, credentialProfile: credentials.profile, platform, period: { startDate, endDate }, campaigns: await metaSummary(selected.config, credentials, startDate, endDate, "campaign") };
  if (platform === "google") {
    const rows = await googleQuery(selected.config, credentials, `SELECT campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}' ORDER BY metrics.cost_micros DESC`);
    return { account: selected.name, credentialProfile: credentials.profile, platform, period: { startDate, endDate }, campaigns: rows.map((row) => ({ name: row.campaign?.name || "Google Ads", ...googleMetrics(row) })) };
  }
  throw new Error("platform 只能是 meta 或 google。");
}

async function countryPerformance({ account, startDate, endDate }) {
  assertDate(startDate, "startDate"); assertDate(endDate, "endDate");
  const selected = resolveAccount(account);
  const credentials = credentialsFor(selected.config);
  const accountId = selected.config.metaAccountId;
  if (!accountId) throw new Error("此业务账户缺少 metaAccountId。");

  const [metaPayload, googleLocationRows] = await Promise.all([
    metaGet(credentials, `act_${normalizeMetaId(accountId)}/insights`, {
      level: "account",
      breakdowns: "country",
      fields: "spend,impressions,clicks,actions,action_values",
      time_range: json({ since: startDate, until: endDate }),
      limit: "500"
    }),
    googleQuery(selected.config, credentials,
      `SELECT user_location_view.country_criterion_id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM user_location_view WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`)
  ]);

  const meta = (metaPayload.data || []).map((row) => {
    const purchases = actionValue(row.actions, ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
    const conversionValue = actionValue(row.action_values, ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
    const spend = Number(row.spend || 0);
    return { countryCode: row.country || "ZZ", spend, impressions: Number(row.impressions || 0), clicks: Number(row.clicks || 0), purchases, conversionValue, roas: spend ? conversionValue / spend : null };
  });

  const criterionIds = [...new Set(googleLocationRows.map((row) => String(row.userLocationView?.countryCriterionId || "")).filter(Boolean))];
  const countryNames = new Map();
  if (criterionIds.length) {
    const constants = await googleQuery(selected.config, credentials,
      `SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.id IN (${criterionIds.join(",")})`);
    for (const row of constants) {
      const item = row.geoTargetConstant || {};
      countryNames.set(String(item.id || ""), { countryCode: item.countryCode || "ZZ", countryName: item.name || item.countryCode || "Unknown" });
    }
  }
  const googleByCountry = new Map();
  for (const row of googleLocationRows) {
    const id = String(row.userLocationView?.countryCriterionId || "");
    const geo = countryNames.get(id) || { countryCode: id || "ZZ", countryName: id || "Unknown" };
    const metrics = googleMetrics(row);
    const existing = googleByCountry.get(geo.countryCode) || { countryCode: geo.countryCode, countryName: geo.countryName, spend: 0, impressions: 0, clicks: 0, purchases: 0, conversionValue: 0 };
    for (const field of ["spend", "impressions", "clicks", "purchases", "conversionValue"]) existing[field] += Number(metrics[field] || 0);
    googleByCountry.set(geo.countryCode, existing);
  }
  const google = [...googleByCountry.values()].map((row) => ({ ...row, roas: row.spend ? row.conversionValue / row.spend : null }));
  return { account: selected.name, credentialProfile: credentials.profile, period: { startDate, endDate }, dimension: "ad delivery/user physical country", meta, google, attributionNote: "Meta 使用 delivery country；Google 使用 user_location_view 的用户实际国家。两平台归因口径不同。" };
}

function configuredAccounts() {
  const { accounts, source } = loadAccountMap();
  const entries = Object.entries(accounts).map(([name, item]) => ({ name, credentialProfile: item.credentialProfile || "legacy-global", meta: item.metaAccountId ? "mapped" : "missing account ID", google: item.googleCustomerId ? "mapped" : "missing customer ID", googleManager: item.googleLoginCustomerId ? "MCC" : "direct", credentials: credentialStatus(item) }));
  const legacy = legacyAccount();
  if (!entries.length && legacy) entries.push({ name: "default", credentialProfile: "legacy-global", meta: legacy.metaAccountId ? "mapped" : "missing account ID", google: legacy.googleCustomerId ? "mapped" : "missing customer ID", googleManager: legacy.googleLoginCustomerId ? "MCC" : "direct", credentials: credentialStatus(legacy) });
  return { source, accounts: entries };
}

async function discoverAccounts({ account, platform = "both" }) {
  const selected = resolveAccount(account);
  const credentials = credentialsFor(selected.config);
  const result = {};
  if (["both", "meta"].includes(platform)) {
    const payload = await metaGet(credentials, "me/adaccounts", { fields: "id,name,account_status,currency,timezone_name", limit: "500" });
    result.meta = payload.data || [];
  }
  if (["both", "google"].includes(platform)) {
    const version = env.GOOGLE_ADS_API_VERSION || "v22";
    const payload = await googleRequest(credentials, `https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`);
    result.google = (payload.resourceNames || []).map((name) => ({ customerId: name.split("/").pop() }));
  }
  return { account: selected.name, credentialProfile: credentials.profile, ...result };
}

const accountProperty = { type: "string", description: "accounts.json 中的业务名称，例如 Glercbikes-UK。配置多个账户时必填。" };
const tools = [
  { name: "connection_status", description: "检查 Meta Ads、Google Ads 和多账户映射的只读配置状态，不返回任何密钥。", inputSchema: { type: "object", properties: {} } },
  { name: "list_configured_accounts", description: "列出本地已配置的业务名称和平台映射，不访问广告平台、不返回密钥。", inputSchema: { type: "object", properties: {} } },
  { name: "discover_ad_accounts", description: "按业务账户的独立凭据档案列出当前身份可直接访问的 Meta 或 Google 广告账户。", inputSchema: { type: "object", properties: { account: accountProperty, platform: { type: "string", enum: ["both", "meta", "google"], default: "both" } }, required: ["account"] } },
  { name: "weekly_ad_summary", description: "按业务账户和日期范围分别汇总 Meta Ads 与 Google Ads 的花费、展示、点击、转化、转化价值与 ROAS。", inputSchema: { type: "object", properties: { account: accountProperty, startDate: { type: "string" }, endDate: { type: "string" } }, required: ["startDate", "endDate"] } },
  { name: "campaign_performance", description: "按业务账户和广告系列读取 Meta Ads 或 Google Ads 的只读投放表现。", inputSchema: { type: "object", properties: { account: accountProperty, platform: { type: "string", enum: ["meta", "google"] }, startDate: { type: "string" }, endDate: { type: "string" } }, required: ["platform", "startDate", "endDate"] } },
  { name: "country_performance", description: "按广告实际投放国家拆分 Meta Ads 与 Google Ads 的花费、点击、转化和 ROAS。Meta 使用 delivery country，Google 使用用户实际国家。", inputSchema: { type: "object", properties: { account: accountProperty, startDate: { type: "string" }, endDate: { type: "string" } }, required: ["account", "startDate", "endDate"] } }
];

async function handle(message) {
  if (message.method === "initialize") return { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "ad-weekly-report", version: "0.3.0" } };
  if (message.method === "tools/list") return { tools };
  if (message.method === "tools/call") {
    const { name, arguments: args = {} } = message.params || {};
    if (name === "connection_status") return text({ mapping: configuredAccounts(), credentialMode: "per-profile with legacy-global fallback", mode: "read-only" });
    if (name === "list_configured_accounts") return text(configuredAccounts());
    if (name === "discover_ad_accounts") return text(await discoverAccounts(args));
    if (name === "weekly_ad_summary") return text(await weeklySummary(args));
    if (name === "campaign_performance") return text(await campaignPerformance(args));
    if (name === "country_performance") return text(await countryPerformance(args));
    throw new Error(`未知工具：${name}`);
  }
  return null;
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  try {
    const request = JSON.parse(line); const result = await handle(request);
    if (request.id !== undefined && result !== null) process.stdout.write(json({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  } catch (error) {
    const id = (() => { try { return JSON.parse(line).id; } catch { return null; } })();
    process.stdout.write(json({ jsonrpc: "2.0", id, error: { code: -32000, message: error.message } }) + "\n");
  }
});
