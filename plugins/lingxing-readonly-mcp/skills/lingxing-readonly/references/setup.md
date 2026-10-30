# 同事安装与配置

## 选择安装方式

公司使用私有仓库 `shikahara123-oss/glercbikes-private-marketplace`。同事的 GitHub 账号必须先有该仓库读取权限；私有仓库地址本身不会授予权限。

**只装 Skill：** 在同事 Codex 里发送：

> 请从 https://github.com/shikahara123-oss/glercbikes-private-marketplace 安装 plugins/lingxing-readonly-mcp/skills/lingxing-readonly 这个 Skill。

安装器会把整个 Skill 目录（包括 scripts）放到该同事的技能目录。也可从已克隆的仓库运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\lingxing-readonly-mcp\skills\lingxing-readonly\scripts\install-skill.ps1`。脚本不覆盖已有安装，也不修改 Codex MCP 配置。

**装完整插件：** 在 Codex 插件管理里添加/同步上述私有 marketplace，再安装“领星 ERP 库存与成本”。这会一并提供 Skill 和 MCP 工具。

## 配置凭据（本机输入）

电脑需要 Node.js 20 或更新版本，且运行 Codex 的环境能找到 `node`。本项目不需要 OpenAI API key，也不需要 npm install。

仓库不包含任何真实凭据。先由公司领星管理员授权同事读取所需仓库/报表，再通过安全渠道交付相应凭据。不要粘贴到聊天、GitHub 或工单。

在可见的 PowerShell 中，从已安装 Skill 目录运行：

```powershell
# 官方 MCP 报表：交互输入 URL 和 Key，可选配置 OpenAPI。
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1

# 只使用仓库明细：只需配置 OpenAPI AppID 和 AppSecret。
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-openapi.ps1
```

两个脚本把凭据保存为该 Windows 用户的环境变量；密钥输入不回显。Windows 用户环境变量不是加密保险库，本机同一用户进程仍可读取。无需管理员权限。完全退出并重启 Codex，才能让新进程继承变量。

| 变量名 | 用途 |
| --- | --- |
| LINGXING_MCP_URL / LINGXING_MCP_KEY | 官方 MCP 服务地址和 X-Mcp-Key；读取利润、Listing、广告等报表 |
| LINGXING_OPENAPI_APP_ID / LINGXING_OPENAPI_APP_SECRET | 读取海外仓/本地仓明细和其中可见的成本字段 |
| LINGXING_OPENAPI_BASE_URL | 可选，默认 https://openapi.lingxing.com；只在公司明确提供可信 HTTPS 中继时修改 |
| LINGXING_OPENAPI_RELAY_TOKEN | 可选，公司可信中继的认证 token |

OpenAPI 仓库明细仍受领星 IP 白名单限制。每位同事的请求实际出口 IP 需要在公司领星白名单内。安装 Skill 不会绕过此要求；VPN 分流变化也可能改变实际出口。官方 MCP 报表与 OpenAPI 是不同通道，官方 MCP 可用不等于海外仓接口已授权。

macOS/Linux 可通过本机安全的环境注入方式提供同名变量，然后使用 Node 查询脚本。PowerShell 配置/安装脚本仅面向 Windows。

## 验证

1. `node scripts/query.mjs status`：只显示凭据是否存在。
2. `node scripts/query.mjs tools`：验证工具发现。
3. `node scripts/query.mjs warehouses`：真正访问 OpenAPI，确认仓库权限和白名单。
4. 在 Codex 中说“使用领星 Skill 查询某个 SKU 的英国金仓和谷仓库存，分别列可用、锁定、总库存及成本字段”。

权限错误应交给领星管理员调整。白名单错误只报告接口实际返回的出口 IP；不能用普通查 IP 网站的结果代替接口出口。不要打印完整认证请求或返回的 access_token。
