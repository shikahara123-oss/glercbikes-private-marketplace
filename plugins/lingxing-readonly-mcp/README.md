# 领星 ERP 库存与成本 Skill

给公司同事的只读查询包。包含可独立安装的 `skills/lingxing-readonly` 和完整 MCP 插件入口。读取海外仓库存、库龄、接口可见成本字段与官方 MCP 利润报表；不写入领星或 Shopify。

## 同事最快安装

先让同事的 GitHub 账号获得本私有仓库读取权限，再把下面这句话发给同事粘到 Codex：

> 请从 https://github.com/shikahara123-oss/glercbikes-private-marketplace 安装 plugins/lingxing-readonly-mcp/skills/lingxing-readonly 这个 Skill，然后按其中 setup.md 帮我配置领星，只查询库存和成本。

如果公司已使用本仓库的 Codex 私有插件市场，直接同步市场并安装“领星 ERP 库存与成本”。

详细步骤：[同事安装说明](skills/lingxing-readonly/references/setup.md)。需要 Node.js 20+。每人单独配置领星读取凭据，海外仓 OpenAPI 仍需实际出口 IP 在白名单中。纯 Skill 也附带运行脚本，无需额外安装 MCP 服务。

## 包的内容

- `skills/lingxing-readonly/SKILL.md`：查询工作流与数据口径。
- `scripts/query.mjs`（在 Skill 内）：独立 Node 查询入口。
- `scripts/server.mjs`（在 Skill 内）：官方 MCP 只读代理和 OpenAPI 仓库工具。
- `scripts/setup*.ps1`（在 Skill 内）：仅在本机交互配置凭据，不回显。
- `tests/connector.test.mjs`：无真实凭据、无网络的只读边界测试。

代码来自现有本机连接器，增加可携带路径、独立调用入口、OpenAPI-only 模式与敏感错误信息遮盖。未分发业务查询结果、库存快照、真实 API key、AppSecret 或 access_token。

## 开发验证

在本目录执行 `node --test tests/connector.test.mjs`。真实连接需在同事自己的授权环境完成验证；单纯通过本地测试不能证明该同事的领星权限或 IP 白名单有效。
