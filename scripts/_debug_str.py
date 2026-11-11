import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("r", "scripts/i18n-replace-zh.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
p = Path("frontend/src/features/auth/components/CaptchaChallenge.jsx").resolve()
text = p.read_text(encoding="utf-8")
masked = m.strip_line_comment_regions(text, p)
for match in m.STR_RE.finditer(masked):
    body = text[match.start("body") : match.end("body")]
    decoded = m.unescape_js_string(body)
    if "if (!id) return" not in decoded:
        continue
    s, e = match.start(), match.end()
    print("span", s, e)
    print("BEFORE", repr(text[s - 80 : s]))
    print("MATCH", repr(text[s : min(e, s + 120)]))
    prev = masked[max(0, s - 200) : s]
    print("quotes in prev200 of masked:")
    for i, ch in enumerate(prev):
        if ch in "\"'`":
            print(i, repr(ch), repr(prev[max(0, i - 15) : i + 15]))
