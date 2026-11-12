# OCR 真实探测夹具

合成「微信明细」页图/PDF，用于验收工作台 **page-ocr / 视觉转写**（不是 mock）。

| 文件 | 说明 |
| --- | --- |
| `ocr-probe-page.png` | 合成探测图（含标记 `NO996-OCR-PROBE-20261111`） |
| `ocr-probe-page.pdf` | 同页导出的纯图片 PDF（无文字层） |
| `probe-summary.json` | 最近一次本机实测结论 |
| `chat-deepseek-flash-content.txt` | `deepseek-flash` 成功转写样例 |
| `vision-model-probe.json` | 候选模型带图探测明细 |

脚本（仓库根）：

```powershell
python scripts/ocr-probe-page-ocr.py
python scripts/ocr-probe-vision-models.py
```

配套：`docs/计划-清流减负与AI赋能总册.md`（S6 page_ocr 已验收）；实现见 `docs/02-后端开发.md`。
