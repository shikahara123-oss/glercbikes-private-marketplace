---
name: shopify-multi-store
description: Read Shopify reporting data and safely update SKU inventory across independently authenticated stores. Use for country-store comparisons, operating reports, SKU inventory lookup, and EU/UK/US inventory updates.
---

# Shopify multi-store reporting and inventory

This plugin is read-only except for the narrowly scoped `set_inventory_by_sku` tool. Never create, update, cancel, fulfill, refund, or delete other Shopify resources.

Start with `connection_status`. If a store is missing its domain or token, identify the missing profile variables and do not invent sales values.

New stores use per-store OAuth authorization. The local OAuth helper requests read access for reporting resources plus `write_inventory`; validates the callback state and HMAC; and saves a separate offline Admin API access token for each credential profile. Billing addresses and customer fields are protected customer data and can still be returned as null unless Shopify has approved that data access for the app.

Use the exact configured business name, such as `GlercBikes-UK`, `GlercBikes-EU`, or `GlercBikes-US`. Each store uses a separate credential profile so credentials cannot cross countries.

For inventory changes, first call `inventory_by_sku` for the exact store and use `match: prefix` only to discover a product family. Match spreadsheet rows to exact SKUs before writing. Then call `set_inventory_by_sku` with the exact location and the freshly read `available` value as `compareQuantity`. Never guess a location, SKU, or current quantity. Treat spreadsheet quantities as absolute target inventory only when the user identifies the sheet as the inventory source of truth. Report missing, duplicate, untracked, stale, and failed SKUs separately. Inventory writes are limited to available quantity; the tool rejects negative values, ambiguous matches, stale compare quantities, and duplicate SKU/location entries.

When an exact spreadsheet SKU is absent, apply only these business-approved normalization rules before retrying: a `BGGW` prefix may map to `BGG`, a color suffix `blu` or `BLu` maps to `bl`, and a color suffix `ple` maps to `pl`. Rules can be combined, for example `BGGW1021XJ12BLu` maps to `BGG1021XJ12bl`. Accept a normalized SKU only when it matches exactly one Shopify variant and its product family, size, and color agree with the spreadsheet row. Report every normalized mapping in the update summary; do not infer any other abbreviation.

For a single store, use `sales_summary`. For the same period across several stores, use `multi_store_sales_summary`. Sales, refunds, orders, and average order value use Shopify Analytics' `total_sales`, `sales_reversals`, `orders`, and `average_order_value` metrics. The tools return raw signed `salesReversals` plus a positive `refundAmount` equal to its absolute value; use `refundAmount` when filling a report's Refund field. These tools return a validated daily breakdown using each store's reporting timezone; the daily totals are checked against the period summary before results are returned. Report each store in its own currency and timezone. Do not add values across currencies unless the user supplies an exchange-rate method.

Use `order_payment_billing_details` only when the user explicitly asks for payment methods or billing addresses. Treat its output as sensitive customer data: return only fields needed for the request, avoid repeating full street addresses unnecessarily, and never expose card numbers or authentication credentials.

Use `list_themes`, `list_theme_files`, and `read_theme_file` for read-only storefront performance reviews. Prefer the live theme unless the user names another theme. Read only the files needed for the analysis, and never claim that this connector can edit or publish theme code.

Use `product_family_sales` for product-level rankings. It deliberately groups the same named product across sizes, colors, and SKUs, then returns the product's size, color, and SKU mix. Use `conversion_funnel` for human-session traffic, add-to-cart, reached-checkout, and completed-checkout analysis.

The sales summary reports Shopify Analytics `total_sales`, which includes the platform's sales adjustments such as discounts, returns, taxes, and shipping according to Shopify's reporting definition. Refund reporting uses Shopify Analytics `sales_reversals`; do not substitute cancelled orders or infer zero from missing order-level refunds. Cancelled order records are reported separately from the order API. State the metric interpretation when presenting financial totals.
