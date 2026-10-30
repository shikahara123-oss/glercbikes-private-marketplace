---
name: lingxing-readonly
description: Query Lingxing ERP overseas/FBA inventory, SKU cost fields and profit reports using the bundled read-only connector. Use for warehouse stock, UK 金仓/谷仓 totals, product costs, warehouse ages or SKU/MSKU profit analysis; does not write ERP or Shopify data.
---

# 领星库存与成本

This skill is self-contained: its scripts run with Node.js 20+ and no npm dependencies. It can also use the same tools exposed by the bundled MCP plugin. Never call Lingxing APIs outside the bundled read-only allowlist.

## Start

Resolve script paths relative to this SKILL.md, never to another user's plugin cache. Run `node scripts/query.mjs status` first. It reports only whether credential names are configured. If credentials are missing, read [setup.md](references/setup.md). Do not request secrets in chat or print environment values.

If MCP tools are already exposed, use them. Otherwise run the bundled CLI with `node scripts/query.mjs` followed by a command:

| Command | Purpose |
| --- | --- |
| `status` | Credential presence only; not a live connection test |
| `tools` | List available tools; report upstream connection failures |
| `warehouses '{"type":3,"length":1000}'` | Active overseas warehouses; discover IDs rather than hardcoding |
| `inventory '{"wid":"WAREHOUSE_IDS","sku":"SKU","offset":0,"length":100}'` | A page of warehouse stock and source cost fields |
| `uk '{"sku":"SKU","warehouse_names":["金仓","谷仓"]}'` | Resolve UK/GB warehouse names and read a first stock page |
| `help '{"limit":100,"offset":0}'` | Official MCP read-only business tool catalog |
| `schema TOOL_ID` | Official `search` tool schema for an allowed business tool |
| `report TOOL_ID '{"PARAM":"VALUE"}'` | Official `action` for an allowed read-only business tool |

For complex JSON use `--args-file PATH` instead of inline JSON. Keep local output files outside the skill/repository. Failures, missing permissions and incomplete pagination are not zero inventory.

## Inventory

Read [data-semantics.md](references/data-semantics.md) before calculating stock/cost totals. Resolve active warehouse IDs by country and name, show the warehouses selected, and paginate `inventory` until returned rows cover `total`. If `total` is missing, continue until a page has fewer than `length` rows; stop on a repeated page and report incomplete data. The `uk` convenience command returns a first page only; use `inventory` with offsets for complete multi-page queries. Do not label a fuzzy SKU search as an exact SKU match: filter exact SKU rows after discovery.

Available, locked, defective, on-way and total quantities are different fields. State which quantity is requested. For UK two-warehouse stock, sum the requested quantity across distinct matching warehouse/SKU rows only. UK and GB refer to the same country here. Do not automatically import SKU aliases from another account or turn partial results into zeroes.

## Costs and profit

Read source cost keys and their documented unit/currency from actual inventory/report results. The connector preserves fields; it does not guarantee that each account exposes a full landed-cost breakdown. Report purchase cost, allocated first-mile cost and warehouse cost separately only when the fields exist. Missing components mean the landed cost is incomplete. Do not divide an unknown-cost field by stock, multiply a unit cost by units, or convert currency without establishing the field meaning first.

For MSKU profit, resolve the current schema for `get_profit_report_msku`. For order gross profit use `query_order_profit_list_gross_profit`; for product performance use `query_product_performance_asin_lists`. Use `schema` before `report` so current required dates, seller IDs, aggregation keys and currency parameters are known. Supply the user's requested period; do not reuse example dates. Profit is a period result, not automatically unit product cost.

## Handoff

Include query time, warehouses/sellers, exact SKU/MSKU matching key, source quantity/cost field names, currency, and any missing pages or permissions. This skill only reads Lingxing. A request to write another system needs that system's separate connector and the user's authorization.
