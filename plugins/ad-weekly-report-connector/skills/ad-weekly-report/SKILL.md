---
name: ad-weekly-report
description: Read multi-account Meta Ads and Google Ads performance data for store operating weekly reports. Use for advertising spend, campaign performance, CPA, ROAS, impressions, clicks, conversions, country-account reporting, or paid-channel comparisons.
---

# Advertising weekly report

Use this plugin only for read-only advertising analysis. Never create, edit, pause, or delete campaigns.

Start with `connection_status`. If either platform is not configured, state exactly which credential fields are missing and do not fabricate spend, conversion, or ROAS values.

Use `list_configured_accounts` when the user asks which stores or countries are available. Each mapped account may specify `credentialProfile`; this selects environment variables with the matching `AD_<PROFILE>_` prefix. Use `discover_ad_accounts` only during setup or troubleshooting because it calls the advertising platforms, and always pass the exact business `account` so credentials cannot cross countries. When multiple business accounts are configured, pass the exact `account` business name (for example `Glercbikes-UK`) to reporting tools; never guess between accounts.

For weekly reporting, use the same calendar dates, currency, and timezone as the Shopify report. Retrieve the account summary first, then retrieve campaign details only when a campaign-level diagnosis is needed.

Use `country_performance` when the user asks how much was spent by delivery country. Meta rows use the platform's delivery-country breakdown; Google rows use `user_location_view` (the user's physical country). Do not infer country spend from campaign names, targeting settings, Shopify sales share, or billing-address share.

Report Meta and Google separately. Do not add their attributed revenue together or to Shopify revenue because attribution models differ. Flag that ROAS is platform-attributed unless the user asks for a blended Shopify calculation.

When comparing periods, call the summary tool once per period. State whether the end date includes a partial current day.
