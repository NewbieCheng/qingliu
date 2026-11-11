"""用 deep_translator 把未映射中文填进 glossary（限速）。失败则跳过。"""
from __future__ import annotations

import importlib.util
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

spec = importlib.util.spec_from_file_location("r", ROOT / "scripts" / "i18n-replace-zh.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

glossary = m.load_glossary()
unknown: dict[str, int] = {}
for path in m.iter_source_files():
    for *_a, decoded, _q in m.collect_ui_hits(path):
        if decoded not in glossary:
            unknown[decoded] = unknown.get(decoded, 0) + 1

# 优先：出现多次或较长的 UI 句；跳过超长 SQL/代码噪声
candidates = [
    zh
    for zh, n in sorted(unknown.items(), key=lambda kv: (-kv[1], -len(kv[0])))
    if 1 <= len(zh) <= 180
    and "INSERT INTO" not in zh
    and "UPDATE " not in zh
    and "busy()" not in zh
    and "worker" not in zh
    and "useAuth" not in zh
    and "step()" not in zh
    and "VAULT_KEY" not in zh
    and "MYSQL_DSN" not in zh
    and "PUBLIC_ORIGIN" not in zh
    and "ADMIN_PASSWORD" not in zh
    and "date,direction" not in zh
]

print(f"candidates={len(candidates)} already={len(glossary)}")

try:
    from deep_translator import GoogleTranslator
except ImportError:
    raise SystemExit("pip install deep-translator")

translator = GoogleTranslator(source="zh-CN", target="en")
BATCH = 15
filled = 0
failed = 0
for i in range(0, len(candidates), BATCH):
    chunk = candidates[i : i + BATCH]
    try:
        # translate one-by-one with pause — batch endpoint flaky
        for zh in chunk:
            try:
                en = translator.translate(zh)
                time.sleep(0.35)
            except Exception as exc:
                print(f"  skip one: {zh[:40]!r} ({exc})")
                failed += 1
                time.sleep(1.2)
                continue
            if not en or en == zh:
                continue
            glossary[zh] = en
            filled += 1
            print(f"  + {zh[:50]} → {en[:60]}")
        m.save_glossary(glossary)
        print(f"checkpoint {i + len(chunk)}/{len(candidates)} filled={filled}")
        time.sleep(1.0)
    except Exception as exc:
        print(f"batch fail at {i}: {exc}")
        time.sleep(3)
        continue

print(f"done filled={filled} failed={failed} total_glossary={len(glossary)}")
m.save_glossary(glossary)
