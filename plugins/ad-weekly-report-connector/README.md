# 广告数据周报连接器

只读读取 Meta Ads 与 Google Ads 数据，支持每个国家使用完全独立的 Meta Business Portfolio、Google Ads/MCC 和 OAuth 凭据。

## 功能

- `connection_status`：检查授权和账户映射，不泄露密钥。
- `list_configured_accounts`：列出本地业务名称映射。
- `discover_ad_accounts`：通过 API 发现当前身份可访问的广告账户。
- `weekly_ad_summary`：按业务名称汇总 Meta 与 Google 指标。
- `campaign_performance`：按平台和广告系列读取表现。

## 快速配置

在 PowerShell 中运行：

```powershell
& "$HOME\Documents\Codex\plugins\ad-weekly-report-connector\scripts\setup.ps1"
```

向导会把密钥写入当前 Windows 用户环境变量，把不敏感的账户 ID 写入 `accounts.json`。配置后完全退出并重启 Codex。

## 多账户映射

`accounts.json` 格式：

```json
{
  "accounts": {
    "Glercbikes-UK": {
      "credentialProfile": "UK",
      "metaAccountId": "act_111111111111111",
      "googleCustomerId": "2222222222",
      "googleLoginCustomerId": "9999999999"
    }
  }
}
```

`credentialProfile: "UK"` 会选择 `AD_UK_*` 环境变量；`DE` 会选择 `AD_DE_*`。`googleLoginCustomerId` 仅在通过 MCC 访问客户账户时需要。Google ID 中的连字符会被自动移除。

每个档案使用以下变量：

```text
AD_<PROFILE>_META_ACCESS_TOKEN
AD_<PROFILE>_GOOGLE_ADS_DEVELOPER_TOKEN
AD_<PROFILE>_GOOGLE_OAUTH_CLIENT_ID
AD_<PROFILE>_GOOGLE_OAUTH_CLIENT_SECRET
AD_<PROFILE>_GOOGLE_ADS_REFRESH_TOKEN
```

未设置 `credentialProfile` 的旧映射仍会读取旧版全局变量，以便兼容已有安装。

## 安全

不要把访问令牌写入插件、`accounts.json`、Git 或聊天。插件仅执行报表读取请求，不创建、修改、暂停或删除广告。
