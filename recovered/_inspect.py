import os
from pypdf import PdfReader

here = os.path.dirname(os.path.abspath(__file__))
for fn in ["增值税申报表_2026-10.pdf", "增值税申报表_2025-12.pdf", "增值税申报表_2024-12.pdf"]:
    path = os.path.join(here, fn)
    r = PdfReader(path)
    print("=" * 70)
    print(fn, "pages=", len(r.pages))
    txt = r.pages[0].extract_text() or ""
    print("chars=", len(txt))
    print(txt[:2600])
