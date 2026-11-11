#!/usr/bin/env python3
"""生成有文字层的银行流水素材 PDF，供本机 /upload 加强解析真机验收。"""
from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "samples" / "bank_statement_text.pdf"
FONT = Path(r"C:\Windows\Fonts\simhei.ttf")

ROWS = [
    ("交易日期", "收支方向", "金额", "交易对方", "摘要", "本方账号"),
    ("2026-01-05", "收入", "1280.50", "华丰商贸", "货款", "6222"),
    ("2026-01-08", "收入", "0.36", "结息账户", "利息", "6222"),
    ("2026-01-12", "支出", "86.00", "超市", "消费", "6222"),
    ("2026-01-18", "收入", "500.00", "微信零钱提现", "提现", "6222"),
    ("2026-01-22", "收入", "3200.00", "李客户", "货款", "6222"),
]


def main() -> None:
    if not FONT.is_file():
        raise SystemExit(f"missing font: {FONT}")
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()
    pdf.add_font("cn", "", str(FONT))
    pdf.set_font("cn", size=14)
    pdf.cell(0, 10, "个人账户交易明细（合成有字 PDF）", ln=1)
    pdf.set_font("cn", size=10)
    pdf.cell(0, 8, "兹证明：合成持有人  账号：6222  期间：2026-01-01 至 2026-01-31", ln=1)
    pdf.ln(4)
    col_w = [28, 22, 24, 40, 30, 28]
    for r, row in enumerate(ROWS):
        pdf.set_font("cn", size=10)
        for i, cell in enumerate(row):
            pdf.cell(col_w[i], 8, str(cell), border=1)
        pdf.ln()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    print(f"OK {OUT} bytes={OUT.stat().st_size}")


if __name__ == "__main__":
    main()
