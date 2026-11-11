#!/usr/bin/env python3
"""
批量把源码里「用户可见」的中文字符串翻成英文并一键替换。

用法（在仓库根目录）:
  python scripts/i18n-replace-zh.py scan          # 列出仍含中文的字面量
  python scripts/i18n-replace-zh.py apply         # 按词表替换（有备份 .bak）
  python scripts/i18n-replace-zh.py apply --dry   # 只报告将改什么
  python scripts/i18n-replace-zh.py seed-locales  # 从 zh-CN/en-US 反填词表

规则:
  - 只动双引号 / 单引号字符串；注释里的中文不动
  - 跳过 locale 词典、流水表头同义词、fixture 测试表头等保护区
  - 未进词表的中文只在 scan 报告，不瞎翻
  - 前端后端同一套 glossary（scripts/i18n-glossary.json）
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GLOSSARY_PATH = ROOT / "scripts" / "i18n-glossary.json"
ZH_LOCALE = ROOT / "frontend" / "src" / "shared" / "i18n" / "locales" / "zh-CN.js"
EN_LOCALE = ROOT / "frontend" / "src" / "shared" / "i18n" / "locales" / "en-US.js"

CJK_RE = re.compile(r"[\u4e00-\u9fff]")
# 单行过长的「假字符串」多半是引号配对失败，直接丢掉
MAX_STRING_CHARS = 500

# 相对仓库根的路径（posix）→ 整文件跳过
SKIP_FILES = {
    "frontend/src/shared/i18n/locales/zh-CN.js",
    "frontend/src/shared/i18n/locales/en-US.js",
    "frontend/src/features/case/lib/map-standard.js",  # 表头 aliases / 方向词
    "server/i18n.go",  # 已有中英词典 + legacy 映射
    "server/domain.go",  # 表头 aliases / 方向词（翻了就解析不了中文流水）
    "server/parser.go",  # PDF/CSV 表头与方向匹配
    "server/ocr_writeback.go",  # 视觉转写字段名 / 方向词
}

# 路径片段包含即跳过
SKIP_PATH_PARTS = (
    "/node_modules/",
    "/dist/",
    "/docs/",
    "/samples/",
    "/.gocache/",
    "/.gotmp/",
    "/.gopath/",
    "/frontend/dist/",
)

# 这些目录里的中文多半是 CSV/表头 fixture，整目录跳过
SKIP_DIR_PARTS = (
    "/__tests__/",
    "/ocr-probe/",
)

# 测试里的中文多为 fixture / 断言原文，apply 时跳过
SKIP_SUFFIXES = (
    "_test.go",
    ".test.js",
    ".test.jsx",
)

# 内置高频 UI 词表（zh → en）；glossary.json 可覆盖/追加
BUILTIN: dict[str, str] = {
    # UploadStep
    "上传客户资料": "Upload customer files",
    "PDF、CSV、XLSX 或 Word；每批最多10份，单份30MB，整批60MB。表格类优先本机解析，标准 PDF 走加强解析文字层。":
        "PDF, CSV, XLSX or Word. Up to 10 files per batch, 30MB each, 60MB total. Tables parse locally first; standard PDFs use boosted text-layer parsing.",
    "正在准备解析…": "Preparing parse…",
    "已提交解析，请稍候查看进度": "Parse submitted. Watch progress below.",
    "解析完成": "Parse complete",
    "解析失败，请稍后重试": "Parse failed. Please try again later.",
    "资料来源": "Source",
    "扫描征信尝试本地识别（候选文字仍须人工核对）":
        "Try local OCR for scanned credit reports (candidates still need manual check)",
    "下一步：确认归属 →": "Next: confirm ownership →",
    "上传并开始识别": "Upload and start recognition",
    # sources / labels / roles / docs / jobs（constants.js）
    "银行卡流水": "Bank statement",
    "微信钱包": "WeChat wallet",
    "支付宝钱包": "Alipay wallet",
    "个人征信": "Credit report",
    "自动识别 / 其他": "Auto-detect / other",
    "暂计经营（未核实）": "Tentative business (unverified)",
    "明确剔除": "Excluded",
    "待复核": "Needs review",
    "支出台账": "Expense ledger",
    "解析失败": "Parse failed",
    "不计收支": "Neutral (no P/L)",
    "疑似重复待确认": "Possible duplicate",
    "管理员": "Admin",
    "业务员": "Sales",
    "复核员": "Reviewer",
    "只读成员": "Read-only member",
    "识别完成": "Recognized",
    "部分可用 / 待核对": "Partial / needs check",
    "未完整识别": "Incomplete recognition",
    "排队中": "Queued",
    "处理中": "Running",
    "已完成": "Done",
    "待核对": "Needs check",
    "失败": "Failed",
    # common UI
    "加载中…": "Loading…",
    "加载中": "Loading",
    "暂无数据": "No data",
    "复制": "Copy",
    "导出": "Export",
    "取消": "Cancel",
    "确认": "Confirm",
    "重试": "Retry",
    "关闭": "Close",
    "返回": "Back",
    "刷新": "Refresh",
    "刷新中…": "Refreshing…",
    "保存": "Save",
    "删除": "Delete",
    "编辑": "Edit",
    "搜索": "Search",
    "提交": "Submit",
    "下一步": "Next",
    "上一步": "Back",
    "请先登录": "Please sign in first",
    "网络连接中断，请检查网络后重试": "Network interrupted. Check your connection and retry.",
    "网络连接中断，文件可能尚未提交完整，请重试":
        "Network interrupted; the file may not have uploaded fully. Please retry.",
    "文件过大，已超过服务器允许的上传大小": "File is too large for the server upload limit.",
    "服务器暂时不可用，请稍后重试": "Server temporarily unavailable. Please try again later.",
    "服务器处理超时，请稍后重试": "Server timed out. Please try again later.",
    "积分不足：AI 解析与文档解析按积分计费，请先充值再试":
        "Not enough points: AI and document parsing are billed by points. Top up and retry.",
    "当前客户有后台任务，请等待完成": "This customer has a background job. Wait for it to finish.",
    "只有排队中或执行中的任务可以终止": "Only queued or running jobs can be cancelled",
    "当前浏览器不支持资料解析所需能力，请换用最新版 Chrome / Edge，或改用电脑操作":
        "This browser cannot run local parsing. Use the latest Chrome/Edge, or a desktop computer.",
    # map-standard 错误文案（aliases 整文件跳过；若放开时用）
    "金额格式无效": "Invalid amount format",
    "金额无效": "Invalid amount",
    "金额超出范围": "Amount out of range",
    "日期无效": "Invalid date",
    # Go bad() 高频
    "请求格式无效": "Invalid request",
    "当前服务器繁忙，请稍后重试": "Server is busy. Please try again later.",
    "请求来源不允许": "Request origin not allowed",
    "页面已过期，请刷新": "Page expired. Please refresh.",
    "仅管理员可操作": "Admin only",
    "个人空间不支持团队成员管理，请开通或切换到团队空间后再操作":
        "Personal space does not support team members. Open or switch to a team space.",
    "客户不存在或没有访问权限": "Customer not found or no access",
    "数据库不可用": "Database unavailable",
    "请稍后重试": "Please try again later",
    "尝试次数过多，请15分钟后重试": "Too many attempts. Try again in 15 minutes.",
    "邮箱验证码登录需要接入工作台": "Email OTP login requires the workbench connection",
    "尚未接入工作台，请联系管理员": "Workbench is not connected. Contact an administrator.",
    "账号或密码不正确": "Incorrect account or password",
    "尚未接入工作台": "Workbench is not connected",
    "验证码加载失败": "Failed to load captcha",
    "验证码格式异常": "Invalid captcha payload",
    "验证码发送失败": "Failed to send verification code",
    "重置密码失败": "Failed to reset password",
    "套餐加载失败": "Failed to load packages",
    "下单失败": "Failed to create order",
    "订单加载失败": "Failed to load orders",
    "订单不存在": "Order not found",
    "余额加载失败": "Failed to load balance",
    "流水加载失败": "Failed to load ledger",
    "当前密码不正确": "Current password is incorrect",
    "上传失败；整批不能超过64MB": "Upload failed; batch must be under 64MB",
    "交易不存在": "Transaction not found",
    "原PDF不存在": "Original PDF not found",
    "页码无效": "Invalid page number",
    "仅复核员或管理员可签发": "Only reviewers or admins can issue",
    "报告不存在": "Report not found",
    "文件不存在": "File not found",
    "任务不存在": "Job not found",
    "处理失败，请联系管理员": "Something went wrong. Contact an administrator.",
    "已进入队列，等待解析": "Queued for parsing",
    "正在准备处理": "Preparing to process",
    "识别完成，请确认资料归属": "Recognition complete. Confirm document ownership.",
    "等待生成报告": "Waiting to generate report",
    "正在生成PDF、Excel与报告快照": "Generating PDF, Excel, and report snapshot",
    "等待重试": "Waiting to retry",
    "已手动终止": "Cancelled by user",
    "正在上传原件到分析服务": "Uploading original to analysis service",
    "正在创建分析任务": "Creating analysis task",
    "分析任务排队中": "Analysis task queued",
    "AI 正在阅读并整理流水": "AI is reading and organizing transactions",
    "正在汇总分析结果": "Summarizing analysis results",
    "分析完成": "Analysis complete",
    "分析失败": "Analysis failed",
    "准备分析": "Preparing analysis",
    "AI 分析超时，请稍后重试": "AI analysis timed out. Please try again later.",
    "分析已取消": "Analysis cancelled",
}


def rel(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def should_skip(path: Path) -> bool:
    r = "/" + rel(path)
    name = path.name
    if rel(path) in SKIP_FILES:
        return True
    for part in SKIP_PATH_PARTS:
        if part in r:
            return True
    for part in SKIP_DIR_PARTS:
        if part in r:
            return True
    for suf in SKIP_SUFFIXES:
        if name.endswith(suf):
            return True
    return False


def load_glossary() -> dict[str, str]:
    data = dict(BUILTIN)
    if GLOSSARY_PATH.exists():
        raw = json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            # 支持 {"zh":"en"} 或 {"items":[{"zh":..,"en":..}]}
            if "items" in raw and isinstance(raw["items"], list):
                for item in raw["items"]:
                    zh = str(item.get("zh") or "").strip()
                    en = str(item.get("en") or "").strip()
                    if zh and en:
                        data[zh] = en
            else:
                for zh, en in raw.items():
                    if isinstance(en, str) and zh and en:
                        data[zh] = en
    return data


def save_glossary(mapping: dict[str, str]) -> None:
    # 稳定排序，便于 diff
    ordered = {k: mapping[k] for k in sorted(mapping.keys(), key=lambda s: (len(s), s))}
    GLOSSARY_PATH.write_text(
        json.dumps(ordered, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def strip_line_comment_regions(text: str, path: Path) -> str:
    """把 // 与 # 行注释、/* */ 块注释里的内容换成空格，避免误匹配字符串。
    返回等长遮罩文本用于定位；真正替换仍在原文上按 span 做。
    """
    out = list(text)
    i = 0
    n = len(text)
    ext = path.suffix.lower()
    while i < n:
        ch = text[i]
        # 已在字符串中的跳过由调用方用 STR_RE 处理；这里只遮罩注释
        if ch in "\"'":
            q = ch
            i += 1
            while i < n:
                if text[i] == "\\" and i + 1 < n:
                    i += 2
                    continue
                if text[i] == q:
                    i += 1
                    break
                i += 1
            continue
        if ext in {".js", ".jsx", ".ts", ".tsx", ".go"} and text.startswith("//", i):
            while i < n and text[i] != "\n":
                out[i] = " "
                i += 1
            continue
        if ext == ".py" and ch == "#":
            while i < n and text[i] != "\n":
                out[i] = " "
                i += 1
            continue
        if text.startswith("/*", i):
            out[i] = out[i + 1] = " "
            i += 2
            while i < n - 1 and not text.startswith("*/", i):
                out[i] = " " if text[i] != "\n" else "\n"
                i += 1
            if i < n - 1:
                out[i] = out[i + 1] = " "
                i += 2
            continue
        i += 1
    return "".join(out)


_ESCAPE_MAP = {
    "\\": "\\",
    '"': '"',
    "'": "'",
    "n": "\n",
    "r": "\r",
    "t": "\t",
    "/": "/",
}


def unescape_js_string(body: str) -> str:
    """只解常见 JS 转义；勿用 unicode_escape（会弄坏 UTF-8 中文）。"""
    out: list[str] = []
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt in _ESCAPE_MAP:
                out.append(_ESCAPE_MAP[nxt])
                i += 2
                continue
            if nxt == "u" and i + 5 < len(body):
                hexpart = body[i + 2 : i + 6]
                if re.fullmatch(r"[0-9a-fA-F]{4}", hexpart):
                    out.append(chr(int(hexpart, 16)))
                    i += 6
                    continue
            out.append(nxt)
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def escape_like_original(en: str, quote: str, body: str) -> str:
    """按原引号风格转义英文。"""
    if quote == '"':
        return en.replace("\\", "\\\\").replace('"', '\\"')
    return en.replace("\\", "\\\\").replace("'", "\\'")


def iter_source_files() -> list[Path]:
    files: list[Path] = []
    for base, patterns in (
        (ROOT / "frontend" / "src", ("*.js", "*.jsx")),
        (ROOT / "server", ("*.go",)),
    ):
        if not base.exists():
            continue
        for pat in patterns:
            files.extend(base.rglob(pat))
    return sorted({p.resolve() for p in files if p.is_file() and not should_skip(p)})


def iter_quoted_spans(text: str, path: Path) -> list[tuple[int, int, str, str]]:
    """状态机扫 "..." / '...'；跳过注释与反引号模板（避免 JSX/空串配对翻车）。"""
    ext = path.suffix.lower()
    n = len(text)
    i = 0
    hits: list[tuple[int, int, str, str]] = []
    while i < n:
        ch = text[i]
        # line comment
        if ext in {".js", ".jsx", ".ts", ".tsx", ".go"} and text.startswith("//", i):
            while i < n and text[i] != "\n":
                i += 1
            continue
        if ext == ".py" and ch == "#":
            while i < n and text[i] != "\n":
                i += 1
            continue
        # block comment
        if text.startswith("/*", i):
            i += 2
            while i < n - 1 and not text.startswith("*/", i):
                i += 1
            i = min(i + 2, n)
            continue
        # template literal — skip whole thing (may contain nested ${})
        if ch == "`":
            i += 1
            depth = 0
            while i < n:
                c = text[i]
                if c == "\\" and i + 1 < n:
                    i += 2
                    continue
                if c == "`" and depth == 0:
                    i += 1
                    break
                if c == "$" and i + 1 < n and text[i + 1] == "{":
                    depth += 1
                    i += 2
                    continue
                if c == "{" and depth > 0:
                    depth += 1
                    i += 1
                    continue
                if c == "}" and depth > 0:
                    depth -= 1
                    i += 1
                    continue
                i += 1
            continue
        # quoted string
        if ch in "\"'":
            q = ch
            start = i
            i += 1
            body_chars: list[str] = []
            while i < n:
                c = text[i]
                if c == "\\" and i + 1 < n:
                    body_chars.append(c)
                    body_chars.append(text[i + 1])
                    i += 2
                    continue
                if c == q:
                    i += 1
                    raw_body = text[start + 1 : i - 1]
                    if len(raw_body) <= MAX_STRING_CHARS and CJK_RE.search(
                        unescape_js_string(raw_body)
                    ):
                        hits.append((start, i, q, unescape_js_string(raw_body)))
                    break
                # 裸换行通常不是 JS/Go 普通字符串（模板除外）；中断以免跨行吃代码
                if c == "\n" and ext in {".js", ".jsx", ".ts", ".tsx"}:
                    break
                body_chars.append(c)
                i += 1
            continue
        i += 1
    return hits


def extract_cjk_strings(path: Path) -> list[tuple[int, int, str, str]]:
    """返回 (start, end, quote, decoded_body) 含中文的字符串 span（在原文上）。"""
    text = path.read_text(encoding="utf-8")
    return iter_quoted_spans(text, path)


def extract_jsx_text_nodes(path: Path) -> list[tuple[int, int, str]]:
    """JSX 标签间的裸中文文本：>中文</ 或 >中文{ 。返回 (start, end, text)。"""
    if path.suffix.lower() not in {".jsx", ".tsx"}:
        return []
    text = path.read_text(encoding="utf-8")
    # 粗匹配：> 与 < 之间、不含 { 的纯文本（允许空白）
    pattern = re.compile(r">([^<>{}]*[\u4e00-\u9fff][^<>{}]*)<")
    hits: list[tuple[int, int, str]] = []
    for m in pattern.finditer(text):
        raw = m.group(1)
        stripped = raw.strip()
        if not stripped or not CJK_RE.search(stripped):
            continue
        # 定位 strip 后的真实 span
        lead = len(raw) - len(raw.lstrip())
        trail = len(raw) - len(raw.rstrip())
        start = m.start(1) + lead
        end = m.end(1) - trail
        hits.append((start, end, text[start:end]))
    return hits


def collect_ui_hits(path: Path) -> list[tuple[int, int, str, str | None]]:
    """统一收集可替换命中：(start, end, text, quote|None)。quote 为 None 表示 JSX 裸文本。"""
    hits: list[tuple[int, int, str, str | None]] = []
    for start, end, quote, decoded in extract_cjk_strings(path):
        hits.append((start, end, decoded, quote))
    for start, end, raw in extract_jsx_text_nodes(path):
        hits.append((start, end, raw, None))
    # 去重重叠：同 start 保留更长
    hits.sort(key=lambda h: (h[0], -(h[1] - h[0])))
    out: list[tuple[int, int, str, str | None]] = []
    last_end = -1
    for start, end, text, quote in hits:
        if start < last_end:
            continue
        out.append((start, end, text, quote))
        last_end = end
    return out


def cmd_scan(glossary: dict[str, str]) -> int:
    mapped = 0
    unmapped = 0
    by_file: dict[str, list[str]] = {}
    unknown: dict[str, int] = {}
    for path in iter_source_files():
        try:
            hits = collect_ui_hits(path)
        except Exception as exc:
            print(f"! read fail {rel(path)}: {exc}", file=sys.stderr)
            continue
        if not hits:
            continue
        rows = []
        for _s, _e, decoded, quote in hits:
            tag = "jsx" if quote is None else "str"
            if decoded in glossary:
                mapped += 1
                rows.append(f"  [ok:{tag}] {decoded[:80]}")
            else:
                unmapped += 1
                unknown[decoded] = unknown.get(decoded, 0) + 1
                rows.append(f"  [??:{tag}] {decoded[:120]}")
        by_file[rel(path)] = rows

    print(f"files_with_cjk={len(by_file)} mapped={mapped} unmapped={unmapped}")
    print("--- by file ---")
    for f, rows in sorted(by_file.items()):
        print(f"\n{f}")
        for row in rows:
            print(row)
    if unknown:
        print("\n--- unmapped unique (freq) ---")
        for zh, n in sorted(unknown.items(), key=lambda kv: (-kv[1], -len(kv[0]), kv[0])):
            print(f"{n:4d}  {zh}")
    return 0 if unmapped == 0 else 1


def cmd_apply(glossary: dict[str, str], dry: bool) -> int:
    changed_files = 0
    replacements = 0
    for path in iter_source_files():
        text = path.read_text(encoding="utf-8")
        hits = collect_ui_hits(path)
        if not hits:
            continue
        new_text = text
        file_hits = 0
        for start, end, decoded, quote in sorted(hits, key=lambda h: h[0], reverse=True):
            en = glossary.get(decoded)
            if not en or en == decoded:
                continue
            if quote is None:
                replacement = en
            else:
                replacement = f"{quote}{escape_like_original(en, quote, decoded)}{quote}"
            new_text = new_text[:start] + replacement + new_text[end:]
            file_hits += 1
        if file_hits == 0:
            continue
        changed_files += 1
        replacements += file_hits
        print(f"{'[dry] ' if dry else ''}{rel(path)}: {file_hits} replacement(s)")
        if not dry:
            bak = path.with_suffix(path.suffix + ".bak")
            if not bak.exists():
                bak.write_text(text, encoding="utf-8")
            path.write_text(new_text, encoding="utf-8")
    print(f"done files={changed_files} replacements={replacements} dry={dry}")
    return 0


def parse_locale_object(path: Path) -> dict[str, str]:
    """粗解析 export default { "k": "v", ... }"""
    text = path.read_text(encoding="utf-8")
    pairs = re.findall(
        r"""["']([^"']+)["']\s*:\s*["']((?:\\.|[^\\])*?)["']""",
        text,
    )
    out: dict[str, str] = {}
    for key, raw in pairs:
        out[key] = unescape_js_string(raw)
    return out


def cmd_seed_locales(glossary: dict[str, str]) -> int:
    zh = parse_locale_object(ZH_LOCALE)
    en = parse_locale_object(EN_LOCALE)
    added = 0
    for key, zh_text in zh.items():
        en_text = en.get(key)
        if not en_text or not CJK_RE.search(zh_text):
            continue
        if zh_text not in glossary:
            glossary[zh_text] = en_text
            added += 1
        elif glossary[zh_text] != en_text:
            # 以 locale 为准覆盖
            glossary[zh_text] = en_text
    save_glossary(glossary)
    print(f"seeded glossary → {rel(GLOSSARY_PATH)} (+{added} new, total {len(glossary)})")
    return 0


def cmd_write_builtin() -> int:
    """把内置词表落到 glossary.json，方便人工改。"""
    current = load_glossary()
    save_glossary(current)
    print(f"wrote {rel(GLOSSARY_PATH)} ({len(current)} entries)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Replace user-facing Chinese strings with English")
    parser.add_argument(
        "command",
        choices=("scan", "apply", "seed-locales", "write-glossary"),
        help="scan | apply | seed-locales | write-glossary",
    )
    parser.add_argument("--dry", action="store_true", help="apply 时只打印不写盘")
    args = parser.parse_args(argv)

    glossary = load_glossary()
    if args.command == "scan":
        return cmd_scan(glossary)
    if args.command == "apply":
        return cmd_apply(glossary, dry=args.dry)
    if args.command == "seed-locales":
        return cmd_seed_locales(glossary)
    if args.command == "write-glossary":
        return cmd_write_builtin()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
