# 数据口径

## 仓库库存

通过 `lingxing_overseas_warehouses`（CLI `warehouses`）读取当前账号仓库，按 `wid` 关联 `lingxing_inventory_details`（CLI `inventory`）。不要携带他人账号的固定仓库 ID。

已在原连接器工作流中使用的字段：

| 字段 | 含义 |
| --- | --- |
| sku | 领星本地 SKU（以当前结果实际键名为准） |
| wid | 领星仓库 ID |
| product_valid_num | 可用数量 |
| product_lock_num | 锁定数量 |
| product_total | 总库存 |
| product_bad_num | 次品数量 |
| product_qc_num | 待质检数量 |
| product_onway | 在途数量 |
| stock_age_list | 库龄分桶，保留每桶 name 与 qty |

上述字段应先核对当前接口结果。缺字段不能自动当成 0。分仓合计必须避免重复页；整页已返回不代表全部库存已返回。UK 快捷工具最多读取单页（默认 800 行）。`inventory` 支持 offset/length，需明确检查 total 或末页。

## SKU 与成本

不把模糊搜索命中的多个车型合成一车。同一 SKU 在多个仓库的数量可以相加；金额先确认币种、含税/未税和单位/总额。颜色、尺寸、型号不能仅凭近似名称推断为相同。

库存明细中的成本字段随账号权限和接口版本变化；直接保留实际 key 和 value，再根据返回说明或官方字段文档建立口径。不要把采购价叫作英国落地总成本；不要把利润报表的期间采购/头程分摊直接当作当前一件车的成本。

若成本字段不可用，可用官方 MCP 的 product performance / MSKU profit 报表进一步核查，仍必须说明报表期间和分摊方式。若仍缺失，明确“未读取到”，不要填估算值冒充领星数据。
