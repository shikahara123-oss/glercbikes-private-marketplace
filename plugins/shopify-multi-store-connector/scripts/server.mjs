import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const env = process.env;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tokenCache = new Map();

function json(value) { return JSON.stringify(value); }
function textResult(value) { return { content: [{ type: "text", text: json(value) }] }; }
function cleanDomain(value = "") { return value.trim().replace(/^https?:\/\//i, "").replace(/\/$/, ""); }
function profileName(value = "") { return value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_"); }

function loadStores() {
  const file = env.SHOPIFY_STORES_FILE || path.join(root, "stores.json");
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw);
  const stores = parsed.stores || parsed;
  if (!stores || Array.isArray(stores) || typeof stores !== "object") throw new Error("Store mapping must be an object.");
  return { file, stores };
}

function resolveStore(name) {
  const { stores } = loadStores();
  const names = Object.keys(stores);
  if (!name && names.length !== 1) throw new Error(`Store is required. Available stores: ${names.join(", ")}.`);
  const match = names.find((item) => item.toLowerCase() === (name || names[0]).toLowerCase());
  if (!match) throw new Error(`Store '${name}' was not found. Available stores: ${names.join(", ")}.`);
  const profile = profileName(stores[match].credentialProfile || match);
  const domain = cleanDomain(env[`SHOPIFY_${profile}_SHOP_DOMAIN`] || stores[match].domain || "");
  const token = env[`SHOPIFY_${profile}_ADMIN_ACCESS_TOKEN`] || "";
  const clientId = env[`SHOPIFY_${profile}_CLIENT_ID`] || "";
  const clientSecret = env[`SHOPIFY_${profile}_CLIENT_SECRET`] || "";
  return { name: match, profile, domain, token, clientId, clientSecret };
}

async function accessToken(store) {
  if (store.token) return store.token;
  if (!store.clientId || !store.clientSecret) throw new Error(`${store.name} is missing Shopify client credentials.`);
  const cached = tokenCache.get(store.profile);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  let response;
  try {
    response = await fetch(`https://${store.domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: store.clientId, client_secret: store.clientSecret })
    });
  } catch (error) {
    throw new Error(`Shopify token request failed: ${error.cause?.message || error.message}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`Shopify token request failed (${response.status}): ${payload.error_description || payload.error || response.statusText}`);
  tokenCache.set(store.profile, { token: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 86399) * 1000 });
  return payload.access_token;
}

async function graphQL(store, query, variables = {}) {
  if (!store.domain) throw new Error(`${store.name} is missing SHOPIFY_${store.profile}_SHOP_DOMAIN.`);
  const version = env.SHOPIFY_API_VERSION || "2026-07";
  let response;
  try {
    response = await fetch(`https://${store.domain}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-access-token": await accessToken(store) },
      body: json({ query, variables })
    });
  } catch (error) {
    throw new Error(`Shopify network request failed: ${error.cause?.message || error.message}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Shopify request failed (${response.status}): ${payload.errors || response.statusText}`);
  if (payload.errors?.length) throw new Error(`Shopify GraphQL error: ${payload.errors.map((item) => item.message).join("; ")}`);
  return payload.data;
}

function nextDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) throw new Error(`Invalid date: ${date}`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function zonedMidnight(date, timeZone) {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  for (let i = 0; i < 2; i += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant += target - represented;
  }
  return new Date(instant).toISOString();
}

async function orderDateContext(store, startDate, endDate) {
  const data = await graphQL(store, "query { shop { ianaTimezone timezoneAbbreviation } }");
  const timeZone = data.shop.ianaTimezone;
  const start = zonedMidnight(startDate, timeZone);
  const end = zonedMidnight(nextDate(endDate), timeZone);
  return {
    timeZone,
    timezoneAbbreviation: data.shop.timezoneAbbreviation,
    search: `created_at:>='${start}' AND created_at:<'${end}'`
  };
}

function localDate(value, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(value));
}

function productFamily(value = "") { return String(value).replace(/\b(?:12|14|16|18|20|24|26|27\.5)(?:\s*(?:inch|inches|\"))?\b/gi, " ").replace(/\b(?:with\s+)?rear rack\b/gi, " ").replace(/\s+/g, " ").trim(); }
function productSize(value = "") { return String(value).match(/\b(12|14|16|18|20|24|26|27\.5)(?:\s*(?:inch|inches|\"))?\b/i)?.[1] || "Other"; }
function productColor(value = "") { const colors = ["Avocado Green", "Dawn Pink", "Persian Pink", "Mint Green", "Peach", "Purple", "Yellow", "Beige", "Black", "White", "Blue", "Pink", "Colorful", "Green"]; return colors.find((item) => String(value).toLowerCase().includes(item.toLowerCase())) || "Other"; }

function inventoryQuantity(level, name = "available") {
  return Number(level.quantities?.find((item) => item.name === name)?.quantity || 0);
}

function skuSearch(value, match = "exact") {
  const sku = String(value || "").trim();
  if (!sku || sku.length > 255 || /[\r\n\0]/.test(sku)) throw new Error("SKU must be a non-empty string no longer than 255 characters.");
  const escaped = sku.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return { sku, query: match === "prefix" ? "" : `sku:"${escaped}"` };
}

async function inventoryVariants(store, skuValue, match = "exact", limit = 100) {
  if (!["exact", "prefix"].includes(match)) throw new Error("match must be 'exact' or 'prefix'.");
  const { sku, query: search } = skuSearch(skuValue, match);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 250));
  const query = `query InventoryBySku($search: String!, $first: Int!, $after: String) {
    productVariants(first: $first, after: $after, query: $search, sortKey: SKU) {
      nodes {
        id title sku product { id title }
        inventoryItem {
          id tracked
          inventoryLevels(first: 50) {
            nodes { id location { id name } quantities(names: ["available"]) { name quantity } }
            pageInfo { hasNextPage }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const variants = [];
  let after = null;
  let pages = 0;
  do {
    const data = await graphQL(store, query, { search, first: Math.min(100, safeLimit - variants.length), after });
    for (const variant of data.productVariants.nodes) {
      const matches = match === "exact" ? variant.sku === sku : String(variant.sku || "").startsWith(sku);
      if (!matches) continue;
      if (variant.inventoryItem?.inventoryLevels.pageInfo.hasNextPage) throw new Error(`SKU '${variant.sku}' has more than 50 inventory locations; narrow the connector implementation before updating it.`);
      variants.push({
        productId: variant.product.id,
        productTitle: variant.product.title,
        variantId: variant.id,
        variantTitle: variant.title,
        sku: variant.sku,
        inventoryItemId: variant.inventoryItem?.id || null,
        tracked: Boolean(variant.inventoryItem?.tracked),
        locations: (variant.inventoryItem?.inventoryLevels.nodes || []).map((level) => ({
          inventoryLevelId: level.id,
          locationId: level.location.id,
          locationName: level.location.name,
          available: inventoryQuantity(level)
        }))
      });
      if (variants.length >= safeLimit) break;
    }
    after = variants.length < safeLimit && data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
    pages += 1;
    if (pages >= 100 && after) throw new Error("SKU prefix scan exceeded the 10,000-variant safety limit.");
  } while (after);
  return variants;
}

async function inventoryBySku(name, sku, match = "exact", limit = 100) {
  const store = resolveStore(name);
  const variants = await inventoryVariants(store, sku, match, limit);
  return { store: store.name, credentialProfile: store.profile, sku, match, count: variants.length, variants };
}

async function setInventoryBySku(name, updates, reason = "correction") {
  const store = resolveStore(name);
  if (!Array.isArray(updates) || updates.length < 1 || updates.length > 100) throw new Error("updates must contain between 1 and 100 entries.");
  const allowedReasons = new Set(["correction", "cycle_count_available", "damaged", "other", "received", "restock", "shrinkage"]);
  if (!allowedReasons.has(reason)) throw new Error(`Unsupported inventory reason '${reason}'.`);
  const prepared = [];
  const seen = new Set();
  for (const update of updates) {
    const sku = String(update.sku || "").trim();
    if (!Number.isInteger(update.quantity) || update.quantity < 0) throw new Error(`SKU '${sku}' quantity must be a non-negative integer.`);
    if (!Number.isInteger(update.compareQuantity)) throw new Error(`SKU '${sku}' compareQuantity must be the integer returned by inventory_by_sku.`);
    const variants = await inventoryVariants(store, sku, "exact", 2);
    if (variants.length !== 1) throw new Error(`SKU '${sku}' matched ${variants.length} variants; exactly one is required.`);
    const variant = variants[0];
    if (!variant.tracked || !variant.inventoryItemId) throw new Error(`SKU '${sku}' does not have tracked inventory.`);
    let locations = variant.locations;
    if (update.locationId) locations = locations.filter((item) => item.locationId === update.locationId);
    if (update.locationName) locations = locations.filter((item) => item.locationName.toLowerCase() === String(update.locationName).trim().toLowerCase());
    if (locations.length !== 1) throw new Error(`SKU '${sku}' resolved to ${locations.length} locations; provide one exact locationId or locationName.`);
    const location = locations[0];
    if (location.available !== update.compareQuantity) throw new Error(`SKU '${sku}' inventory changed before submission: expected ${update.compareQuantity}, now ${location.available}. Read inventory again.`);
    const key = `${variant.inventoryItemId}|${location.locationId}`;
    if (seen.has(key)) throw new Error(`Duplicate update for SKU '${sku}' at '${location.locationName}'.`);
    seen.add(key);
    prepared.push({ sku, variant, location, quantity: update.quantity, compareQuantity: update.compareQuantity });
  }
  const idempotencyKey = crypto.randomUUID();
  const mutation = `mutation SetInventory($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup { createdAt reason referenceDocumentUri changes { name delta quantityAfterChange } }
      userErrors { code field message }
    }
  }`;
  const input = {
    name: "available",
    reason,
    referenceDocumentUri: `codex://shopify-multi-store/inventory/${idempotencyKey}`,
    quantities: prepared.map((item) => ({ inventoryItemId: item.variant.inventoryItemId, locationId: item.location.locationId, quantity: item.quantity, changeFromQuantity: item.compareQuantity }))
  };
  const data = await graphQL(store, mutation, { input, idempotencyKey });
  const payload = data.inventorySetQuantities;
  if (payload.userErrors?.length) throw new Error(`Shopify inventory update rejected: ${payload.userErrors.map((item) => `${item.code || "ERROR"}: ${item.message}`).join("; ")}`);
  return {
    store: store.name,
    credentialProfile: store.profile,
    mode: "inventory-write",
    idempotencyKey,
    updated: prepared.map((item) => ({ sku: item.sku, productTitle: item.variant.productTitle, variantTitle: item.variant.variantTitle, inventoryItemId: item.variant.inventoryItemId, locationId: item.location.locationId, locationName: item.location.locationName, quantityBefore: item.compareQuantity, quantityAfter: item.quantity, delta: item.quantity - item.compareQuantity })),
    adjustment: payload.inventoryAdjustmentGroup
  };
}

async function shopInfo(name) {
  const store = resolveStore(name);
  const data = await graphQL(store, `query { shop { name myshopifyDomain currencyCode timezoneAbbreviation primaryDomain { url } billingAddress { country } } }`);
  return { store: store.name, credentialProfile: store.profile, ...data.shop };
}

async function salesSummary(name, startDate, endDate) {
  const store = resolveStore(name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("Dates must use YYYY-MM-DD.");
  const context = await orderDateContext(store, startDate, endDate);
  const search = context.search;
  const query = `query Orders($after: String, $search: String!) {
    shop { currencyCode timezoneAbbreviation }
    orders(first: 250, after: $after, query: $search, sortKey: CREATED_AT) {
      nodes { createdAt cancelledAt currentTotalPriceSet { shopMoney { amount currencyCode } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  let after = null;
  let orderCount = 0;
  let cancelledOrders = 0;
  let totalSales = 0;
  let currency = null;
  let timezone = null;
  let pages = 0;
  do {
    const data = await graphQL(store, query, { after, search });
    currency ||= data.shop.currencyCode;
    timezone ||= data.shop.timezoneAbbreviation;
    for (const order of data.orders.nodes) {
      if (order.cancelledAt) cancelledOrders += 1;
      else {
        orderCount += 1;
        totalSales += Number(order.currentTotalPriceSet.shopMoney.amount || 0);
      }
    }
    after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
    pages += 1;
    if (pages > 200) throw new Error("Order result exceeded the safety pagination limit.");
  } while (after);
  const shopifyqlQuery = `query ShopifyQL($query: String!) {
    shopifyqlQuery(query: $query) { parseErrors tableData { columns { name displayName dataType } rows } }
  }`;
  const dailySql = `FROM sales SHOW total_sales, sales_reversals, orders, average_order_value TIMESERIES day SINCE ${startDate} UNTIL ${endDate} ORDER BY day ASC`;
  const periodSql = `FROM sales SHOW total_sales, sales_reversals, orders, average_order_value SINCE ${startDate} UNTIL ${endDate}`;
  const [dailyData, periodData] = await Promise.all([
    graphQL(store, shopifyqlQuery, { query: dailySql }),
    graphQL(store, shopifyqlQuery, { query: periodSql })
  ]);
  const parseErrors = [...(dailyData.shopifyqlQuery.parseErrors || []), ...(periodData.shopifyqlQuery.parseErrors || [])];
  if (parseErrors.length) throw new Error(`ShopifyQL error: ${parseErrors.join("; ")}`);
  const dailyRows = (dailyData.shopifyqlQuery.tableData.rows || []).map((row) => ({
    day: row.day,
    orderCount: Number(row.orders || 0),
    totalSales: Number(row.total_sales || 0),
    salesReversals: Number(row.sales_reversals || 0),
    refundAmount: Math.abs(Number(row.sales_reversals || 0)),
    averageOrderValue: Number(row.average_order_value || 0)
  }));
  const periodRow = periodData.shopifyqlQuery.tableData.rows?.[0] || {};
  const analyticsOrderCount = Number(periodRow.orders || 0);
  const analyticsTotalSales = Number(periodRow.total_sales || 0);
  const analyticsSalesReversals = Number(periodRow.sales_reversals || 0);
  const analyticsAverageOrderValue = Number(periodRow.average_order_value || 0);
  const dailyOrderCount = dailyRows.reduce((sum, row) => sum + row.orderCount, 0);
  const dailySales = dailyRows.reduce((sum, row) => sum + row.totalSales, 0);
  const dailySalesReversals = dailyRows.reduce((sum, row) => sum + row.salesReversals, 0);
  if (dailyOrderCount !== analyticsOrderCount || Math.abs(dailySales - analyticsTotalSales) > 0.01 || Math.abs(dailySalesReversals - analyticsSalesReversals) > 0.01) throw new Error("Shopify Analytics validation failed: daily sales metrics do not match the period summary.");
  return {
    store: store.name,
    credentialProfile: store.profile,
    period: { startDate, endDate },
    timezone: context.timezoneAbbreviation || timezone,
    ianaTimezone: context.timeZone,
    currency,
    orderCount: analyticsOrderCount,
    cancelledOrders,
    totalSales: analyticsTotalSales,
    salesReversals: analyticsSalesReversals,
    refundAmount: Math.abs(analyticsSalesReversals),
    averageOrderValue: analyticsAverageOrderValue,
    salesMetric: "Shopify Analytics total_sales",
    refundMetric: "Shopify Analytics sales_reversals (refundAmount is the absolute value)",
    daily: dailyRows
  };
}

async function orderPaymentBillingDetails(name, startDate, endDate, limit = 50) {
  const store = resolveStore(name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("Dates must use YYYY-MM-DD.");
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const search = (await orderDateContext(store, startDate, endDate)).search;
  const query = `query OrderPaymentBilling($search: String!, $first: Int!) {
    shop { currencyCode timezoneAbbreviation }
    orders(first: $first, query: $search, sortKey: CREATED_AT, reverse: true) {
      nodes {
        name createdAt displayFinancialStatus paymentGatewayNames
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        billingAddress {
          firstName lastName company address1 address2 city province provinceCode
          zip country countryCodeV2 phone
        }
        transactions(first: 20) {
          gateway formattedGateway kind status processedAt
          amountSet { shopMoney { amount currencyCode } }
          paymentDetails { ... on CardPaymentDetails { paymentMethodName } }
        }
      }
    }
  }`;
  const data = await graphQL(store, query, { search, first: safeLimit });
  return {
    store: store.name,
    credentialProfile: store.profile,
    period: { startDate, endDate },
    timezone: data.shop.timezoneAbbreviation,
    currency: data.shop.currencyCode,
    returnedOrders: data.orders.nodes.length,
    limit: safeLimit,
    orders: data.orders.nodes
  };
}

async function listThemes(name) {
  const store = resolveStore(name);
  const data = await graphQL(store, `query Themes { themes(first: 50) { nodes { id name role themeStoreId createdAt updatedAt processing processingFailed } } }`);
  return { store: store.name, credentialProfile: store.profile, themes: data.themes.nodes };
}

async function listThemeFiles(name, themeId, pattern = "*") {
  const store = resolveStore(name);
  if (!String(themeId || "").startsWith("gid://shopify/OnlineStoreTheme/")) throw new Error("themeId must be a Shopify OnlineStoreTheme GID.");
  const query = `query ThemeFiles($themeId: ID!, $after: String, $filenames: [String!]) {
    theme(id: $themeId) {
      id name role
      files(first: 50, after: $after, filenames: $filenames) {
        nodes { filename contentType size checksumMd5 createdAt updatedAt }
        pageInfo { hasNextPage endCursor }
        userErrors { code filename }
      }
    }
  }`;
  const filenames = [String(pattern || "*")];
  let after = null;
  const files = [];
  const userErrors = [];
  do {
    const data = await graphQL(store, query, { themeId, after, filenames });
    if (!data.theme) throw new Error("Theme was not found.");
    files.push(...data.theme.files.nodes);
    userErrors.push(...data.theme.files.userErrors);
    after = data.theme.files.pageInfo.hasNextPage ? data.theme.files.pageInfo.endCursor : null;
    if (files.length >= 2000) throw new Error("Theme file listing exceeded the 2,000-file safety limit.");
  } while (after);
  return { store: store.name, credentialProfile: store.profile, themeId, pattern, fileCount: files.length, files, userErrors };
}

async function readThemeFile(name, themeId, filename) {
  const store = resolveStore(name);
  if (!String(themeId || "").startsWith("gid://shopify/OnlineStoreTheme/")) throw new Error("themeId must be a Shopify OnlineStoreTheme GID.");
  if (!filename || filename.includes("..")) throw new Error("A valid theme filename is required.");
  const query = `query ThemeFile($themeId: ID!, $filenames: [String!]!) {
    theme(id: $themeId) {
      id name role
      files(first: 1, filenames: $filenames) {
        nodes {
          filename contentType size checksumMd5 createdAt updatedAt
          body {
            ... on OnlineStoreThemeFileBodyText { content }
            ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
            ... on OnlineStoreThemeFileBodyUrl { url }
          }
        }
        userErrors { code filename }
      }
    }
  }`;
  const data = await graphQL(store, query, { themeId, filenames: [filename] });
  if (!data.theme) throw new Error("Theme was not found.");
  const file = data.theme.files.nodes[0] || null;
  if (!file) throw new Error(`Theme file '${filename}' was not found.`);
  if (file.body?.content && file.body.content.length > 1000000) throw new Error("Theme text file exceeds the 1 MB safety limit.");
  return { store: store.name, credentialProfile: store.profile, theme: { id: data.theme.id, name: data.theme.name, role: data.theme.role }, file, userErrors: data.theme.files.userErrors };
}

async function productFamilySales(name, startDate, endDate, top = 5) {
  const store = resolveStore(name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("Dates must use YYYY-MM-DD.");
  const search = (await orderDateContext(store, startDate, endDate)).search;
  const query = `query FamilySales($after: String, $search: String!) { orders(first: 100, after: $after, query: $search, sortKey: CREATED_AT) { nodes { cancelledAt lineItems(first: 250) { nodes { quantity sku name product { title } variant { title } } } } pageInfo { hasNextPage endCursor } } }`;
  const families = new Map(); let after = null;
  do {
    const data = await graphQL(store, query, { after, search });
    for (const order of data.orders.nodes) {
      if (order.cancelledAt) continue;
      for (const item of order.lineItems.nodes) {
        if (["Insure01", "PD-001"].includes(item.sku)) continue;
        const source = `${item.product?.title || item.name} ${item.variant?.title || ""}`, family = productFamily(item.product?.title || item.name);
        const entry = families.get(family) || { product: family, units: 0, sizes: {}, colors: {}, skus: {} };
        const units = Number(item.quantity || 0), size = productSize(source), color = productColor(source), sku = item.sku || "(no SKU)";
        entry.units += units; entry.sizes[size] = (entry.sizes[size] || 0) + units; entry.colors[color] = (entry.colors[color] || 0) + units;
        const skuEntry = entry.skus[sku] || { sku, name: item.name, variant: item.variant?.title || "", size, color, units: 0 }; skuEntry.units += units; entry.skus[sku] = skuEntry; families.set(family, entry);
      }
    }
    after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (after);
  const products = [...families.values()].map((entry) => ({ ...entry, skus: Object.values(entry.skus).sort((a, b) => b.units - a.units) })).sort((a, b) => b.units - a.units).slice(0, Math.max(1, Math.min(Number(top) || 5, 20)));
  return { store: store.name, credentialProfile: store.profile, period: { startDate, endDate }, products };
}

async function conversionFunnel(name, startDate, endDate) {
  const store = resolveStore(name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("Dates must use YYYY-MM-DD.");
  const shopifyql = `FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout, added_to_cart_rate, reached_checkout_rate, checkout_conversion_rate, conversion_rate WHERE human_or_bot_session = 'human' TIMESERIES day SINCE ${startDate} UNTIL ${endDate} ORDER BY day ASC`;
  const data = await graphQL(store, `query Funnel($query: String!) { shopifyqlQuery(query: $query) { parseErrors tableData { columns { name displayName dataType } rows } } }`, { query: shopifyql });
  if (data.shopifyqlQuery.parseErrors?.length) throw new Error(`ShopifyQL error: ${data.shopifyqlQuery.parseErrors.join("; ")}`);
  return { store: store.name, credentialProfile: store.profile, period: { startDate, endDate }, ...data.shopifyqlQuery.tableData };
}

const tools = [
  { name: "connection_status", description: "Check multi-store Shopify configuration and inventory-write mode without returning secrets.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_configured_stores", description: "List configured Shopify business names and credential profiles without calling Shopify.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "shop_info", description: "Read basic information for one configured Shopify store.", inputSchema: { type: "object", properties: { store: { type: "string" } }, required: ["store"], additionalProperties: false } },
  { name: "sales_summary", description: "Read order count, total sales, sales reversals/refund amount, cancellations, and average order value for one Shopify store and date range.", inputSchema: { type: "object", properties: { store: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" } }, required: ["store", "startDate", "endDate"], additionalProperties: false } },
  { name: "order_payment_billing_details", description: "Read recent order payment gateways, transaction status, and customer billing addresses for one store and date range. Returns sensitive customer data and remains strictly read-only.", inputSchema: { type: "object", properties: { store: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, required: ["store", "startDate", "endDate"], additionalProperties: false } },
  { name: "list_themes", description: "List Shopify themes for one configured store, including live and unpublished themes. Read-only.", inputSchema: { type: "object", properties: { store: { type: "string" } }, required: ["store"], additionalProperties: false } },
  { name: "list_theme_files", description: "List theme files and sizes for performance analysis. Supports a Shopify filename wildcard such as assets/*.js. Read-only.", inputSchema: { type: "object", properties: { store: { type: "string" }, themeId: { type: "string" }, pattern: { type: "string", default: "*" } }, required: ["store", "themeId"], additionalProperties: false } },
  { name: "read_theme_file", description: "Read one Shopify theme file by theme GID and filename for code or performance analysis. Read-only and limited to 1 MB of text.", inputSchema: { type: "object", properties: { store: { type: "string" }, themeId: { type: "string" }, filename: { type: "string" } }, required: ["store", "themeId", "filename"], additionalProperties: false } },
  { name: "product_family_sales", description: "Aggregate sold units into product families across sizes, colors, and SKUs for a store and date range. Excludes shipping insurance and price-difference service lines.", inputSchema: { type: "object", properties: { store: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" }, top: { type: "integer", minimum: 1, maximum: 20, default: 5 } }, required: ["store", "startDate", "endDate"], additionalProperties: false } },
  { name: "conversion_funnel", description: "Read the human-session storefront funnel from sessions to cart addition, checkout, and completed checkout using Shopify Analytics.", inputSchema: { type: "object", properties: { store: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" } }, required: ["store", "startDate", "endDate"], additionalProperties: false } },
  { name: "inventory_by_sku", description: "Read tracked available inventory and Shopify locations for an exact SKU or SKU prefix. Always use this immediately before set_inventory_by_sku.", inputSchema: { type: "object", properties: { store: { type: "string" }, sku: { type: "string" }, match: { type: "string", enum: ["exact", "prefix"], default: "exact" }, limit: { type: "integer", minimum: 1, maximum: 250, default: 100 } }, required: ["store", "sku"], additionalProperties: false } },
  { name: "set_inventory_by_sku", description: "Set available inventory for exact SKUs in one store. Requires location and compareQuantity values freshly returned by inventory_by_sku; rejects stale or ambiguous updates.", inputSchema: { type: "object", properties: { store: { type: "string" }, reason: { type: "string", enum: ["correction", "cycle_count_available", "damaged", "other", "received", "restock", "shrinkage"], default: "correction" }, updates: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", properties: { sku: { type: "string" }, locationId: { type: "string" }, locationName: { type: "string" }, quantity: { type: "integer", minimum: 0 }, compareQuantity: { type: "integer" } }, required: ["sku", "quantity", "compareQuantity"], additionalProperties: false } } }, required: ["store", "updates"], additionalProperties: false } },
  { name: "multi_store_sales_summary", description: "Read sales summaries for several configured Shopify stores using the same date range.", inputSchema: { type: "object", properties: { stores: { type: "array", items: { type: "string" } }, startDate: { type: "string" }, endDate: { type: "string" } }, required: ["startDate", "endDate"], additionalProperties: false } }
];

async function callTool(name, args) {
  if (name === "connection_status" || name === "list_configured_stores") {
    const { file, stores } = loadStores();
    const items = Object.keys(stores).map((storeName) => {
      const store = resolveStore(storeName);
      const authentication = store.token ? "legacy token configured" : (store.clientId && store.clientSecret ? "client credentials configured" : "missing");
      return { name: store.name, credentialProfile: store.profile, domain: store.domain ? "configured" : "missing", authentication };
    });
    return textResult({ mode: "inventory-write", source: file, stores: items });
  }
  if (name === "shop_info") return textResult(await shopInfo(args.store));
  if (name === "sales_summary") return textResult(await salesSummary(args.store, args.startDate, args.endDate));
  if (name === "order_payment_billing_details") return textResult(await orderPaymentBillingDetails(args.store, args.startDate, args.endDate, args.limit));
  if (name === "list_themes") return textResult(await listThemes(args.store));
  if (name === "list_theme_files") return textResult(await listThemeFiles(args.store, args.themeId, args.pattern));
  if (name === "read_theme_file") return textResult(await readThemeFile(args.store, args.themeId, args.filename));
  if (name === "product_family_sales") return textResult(await productFamilySales(args.store, args.startDate, args.endDate, args.top));
  if (name === "conversion_funnel") return textResult(await conversionFunnel(args.store, args.startDate, args.endDate));
  if (name === "inventory_by_sku") return textResult(await inventoryBySku(args.store, args.sku, args.match, args.limit));
  if (name === "set_inventory_by_sku") return textResult(await setInventoryBySku(args.store, args.updates, args.reason));
  if (name === "multi_store_sales_summary") {
    const names = args.stores?.length ? args.stores : Object.keys(loadStores().stores);
    const results = [];
    for (const store of names) {
      try { results.push(await salesSummary(store, args.startDate, args.endDate)); }
      catch (error) { results.push({ store, error: error.message }); }
    }
    return textResult({ period: { startDate: args.startDate, endDate: args.endDate }, stores: results });
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(request) {
  if (request.method === "initialize") return { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "shopify-multi-store", version: "0.1.0" } };
  if (request.method === "notifications/initialized") return null;
  if (request.method === "tools/list") return { tools };
  if (request.method === "tools/call") return await callTool(request.params?.name, request.params?.arguments || {});
  throw new Error(`Unsupported method: ${request.method}`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  let id = null;
  try {
    const request = JSON.parse(line);
    id = request.id ?? null;
    const result = await handle(request);
    if (request.id !== undefined && result !== null) process.stdout.write(json({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  } catch (error) {
    process.stdout.write(json({ jsonrpc: "2.0", id, error: { code: -32000, message: error.message } }) + "\n");
  }
});
