# 合成夹具（samples）

仅放**合成**流水，用于本机接口冒烟与解析回归。  
真实客户 PDF/CSV **禁止**放进本目录；放到仓库根 `.local/fixtures/`（已 gitignore）。

| 文件 | 说明 |
| --- | --- |
| `synthetic.csv` | 最早最小银行样例 |
| `bank_statement.csv` | 银行中文表头，含货款/结息/提现/经营混排 |
| `bank_statement.xlsx` | 同口径银行表（`scripts/make-samples-office.mjs` 生成） |
| `bank_statement_table.docx` | 瘦 Word 标准表 5 行（S5 `upload-parsed`） |
| `bank_statement_text.pdf` | 有文字层银行表（`scripts/make-samples-text-pdf.py`；走 `/upload` 加强解析） |
| `wechat_statement.csv` | 微信风格列名 |
| `alipay_statement.csv` | 支付宝风格列名 |
| `bank_split_amount.csv` | 收入金额/支出金额分列 |
| `bad_empty.csv` | 只有表头，用于失败路径 |
| `ai-result-shape.json` | **仅**导出/字段形状单测；**不是** AI 分析结果，不能代替真实模型调用 |
| `ocr-probe/` | 视觉 OCR 真实探测夹具与结论（见该目录 README） |

## AI 怎么测

上传上面的 CSV（或 `.local` 里的 PDF）后，走真实接口：

`POST /api/clients/{cid}/ai-analysis` → 工作台 aidoc → **真实模型** → `GET .../ai-analysis` 看 `result`。

配套：[docs/计划-清流减负与AI赋能总册.md](../docs/计划-清流减负与AI赋能总册.md) §4
