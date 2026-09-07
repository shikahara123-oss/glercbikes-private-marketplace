# GlercBikes Private Codex Plugins

Private repository-backed marketplace containing:

- Advertising Weekly Report Connector
- Shopify Multi-Store Connector

## Repository layout

The marketplace catalog is stored at `.agents/plugins/marketplace.json`.
Plugin packages are stored under `plugins/`.

## Security

This repository contains configuration schemas and account/store mappings, but it must never contain access tokens, API keys, client secrets, passwords, or OAuth caches.

The plugins read credentials from environment variables declared in their `.mcp.json` files. Configure those credentials separately on every computer or account that installs the plugins.

## Installation

Add or sync this repository as a private marketplace in the Codex/ChatGPT Plugins management screen, install the required plugin, and start a new task so its skills and tools are loaded.
