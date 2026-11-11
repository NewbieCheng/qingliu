#!/usr/bin/env python3
"""真实探测工作台 page-ocr：合成图 → 登录 → /v1/chat/completions model=page-ocr。

账号/口令只从环境变量读；验证码走本机暴露的 captcha.code。
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get("WB_BASE", "http://127.0.0.1:8080").rstrip("/")
EMAIL = os.environ.get("WB_EMAIL", "admin@example.com")
OUT = Path(os.environ.get("OCR_PROBE_DIR", r"F:\Dev\Desktop-Projects\qingliu-workspace\samples\ocr-probe"))
PNG = OUT / "ocr-probe-page.png"
PDF = OUT / "ocr-probe-page.pdf"


def http_json(method: str, path: str, body: dict | None = None, token: str | None = None, timeout: int = 120):
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return e.code, payload


def http_multipart(path: str, file_path: Path, token: str, field: str = "file"):
    boundary = "----ocrprobe" + str(int(time.time()))
    filename = file_path.name
    content = file_path.read_bytes()
    mime = "application/pdf" if filename.lower().endswith(".pdf") else "image/png"
    parts = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n".encode()
    )
    parts.append(content)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Accept": "application/json",
    }
    req = urllib.request.Request(BASE + path, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return e.code, payload


def ensure_fixture():
    if PNG.exists() and PDF.exists():
        return
    from PIL import Image, ImageDraw, ImageFont

    OUT.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (1240, 1754), "white")
    d = ImageDraw.Draw(img)
    font_path = r"C:\Windows\Fonts\msyh.ttc"
    title = ImageFont.truetype(font_path, 40)
    body = ImageFont.truetype(font_path, 28)
    small = ImageFont.truetype(font_path, 22)
    lines = [
        ("微信支付交易明细证明（合成探测页）", title),
        ("兹证明：合成持有人", body),
        ("账号：6222000011112222", body),
        ("期间：2026-01-01 至 2026-01-31", body),
        ("", body),
        ("交易时间          收/支    金额(元)    交易对方      交易类型", small),
        ("2026-01-05 10:11  收入     1280.50     华丰商贸      转账", body),
        ("2026-01-08 09:00  收入        0.36     结息账户      利息", body),
        ("2026-01-12 18:20  支出       86.00     超市          消费", body),
        ("2026-01-18 12:00  收入      500.00     微信零钱提现  提现", body),
        ("2026-01-22 15:30  收入     3200.00     李客户        货款", body),
        ("", body),
        ("探测标记：NO996-OCR-PROBE-20261111", body),
    ]
    y = 80
    for text, font in lines:
        if text:
            d.text((60, y), text, fill=(20, 20, 20), font=font)
        y += 70 if font is title else 54
    img.save(PNG, "PNG")
    img.save(PDF, "PDF", resolution=150.0)


def login() -> str:
    code_status, cap = http_json("GET", "/api/v1/auth/captcha")
    if code_status != 200:
        raise SystemExit(f"captcha failed: {cap}")
    captcha_id = cap["data"]["id"]
    captcha_code = cap["data"].get("code")
    if not captcha_code:
        raise SystemExit("captcha.code missing; need AUTH_DEV expose captcha")
    status, otp = http_json(
        "POST",
        "/api/v1/auth/verification-codes",
        {
            "email": EMAIL,
            "purpose": "login",
            "captcha_id": captcha_id,
            "captcha_code": captcha_code,
        },
    )
    if status not in (200, 202):
        raise SystemExit(f"otp failed: {otp}")
    otp_code = otp.get("data", {}).get("code")
    if not otp_code:
        raise SystemExit(f"otp.code missing: {otp}")
    status, login = http_json("POST", "/api/v1/auth/login", {"email": EMAIL, "code": otp_code})
    (OUT / "login-resp.json").write_text(json.dumps(login, ensure_ascii=False, indent=2), encoding="utf-8")
    token = login.get("data", {}).get("access_token")
    if status != 200 or not token:
        raise SystemExit(f"login failed: {login}")
    return token


def probe_chat_page_ocr(token: str) -> dict:
    b64 = base64.b64encode(PNG.read_bytes()).decode("ascii")
    payload = {
        "model": "page-ocr",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "这是文档第 1 页的图像。请逐行原样转写全部文字，"
                            "保留日期、金额、收支方向、对手方、摘要与表头；"
                            "表格按行输出；不要解释、不要总结、不要补全看不清的内容。"
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{b64}"},
                    },
                ],
            }
        ],
    }
    status, result = http_json("POST", "/v1/chat/completions", payload, token=token, timeout=180)
    (OUT / "chat-page-ocr-resp.json").write_text(
        json.dumps({"http_status": status, "body": result}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {"http_status": status, "body": result}


def probe_aidoc_page_ocr(token: str) -> dict:
    status, upload = http_multipart("/api/v1/ai/documents", PDF, token)
    (OUT / "upload-resp.json").write_text(
        json.dumps({"http_status": status, "body": upload}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    doc_id = (upload.get("data") or {}).get("document_id")
    out = {"upload_status": status, "upload": upload}
    if not doc_id:
        out["note"] = "上传未得到 document_id（常见：纯图片 PDF 文字层为空被拒）；以 /v1 chat page-ocr 为准"
        return out
    status, created = http_json(
        "POST",
        "/api/v1/ai/analyses",
        {"document_id": doc_id, "task": "page_ocr"},
        token=token,
    )
    (OUT / "analysis-create.json").write_text(
        json.dumps({"http_status": status, "body": created}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    out["create_status"] = status
    out["create"] = created
    aid = (created.get("data") or {}).get("analysis_id")
    if not aid:
        return out
    final = None
    for i in range(40):
        time.sleep(3)
        st, body = http_json("GET", f"/api/v1/ai/analyses/{aid}", token=token)
        status_name = str((body.get("data") or {}).get("status") or "")
        print(f"poll {i}: http={st} status={status_name} progress={(body.get('data') or {}).get('progress')}", flush=True)
        if status_name in {"done", "failed", "success", "completed"}:
            final = body
            break
    if final is not None:
        (OUT / "analysis-final.json").write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
        out["final"] = final
    return out


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ensure_fixture()
    print(f"fixture png={PNG.exists()} pdf={PDF.exists()}", flush=True)
    token = login()
    print("login ok", flush=True)

    print("== A) /v1/chat/completions model=page-ocr (真实视觉链路) ==", flush=True)
    chat = probe_chat_page_ocr(token)
    print(f"chat http={chat['http_status']}", flush=True)
    body = chat["body"]
    content = None
    try:
        content = body["choices"][0]["message"]["content"]
    except Exception:
        err = body.get("error") or body
        print("chat error:", json.dumps(err, ensure_ascii=False)[:800], flush=True)
    if content:
        preview = content if len(content) < 1200 else content[:1200] + "..."
        print("chat content:\n" + preview, flush=True)
        marker_ok = "NO996-OCR-PROBE-20261111" in content
        print(f"marker_found={marker_ok}", flush=True)
        (OUT / "chat-page-ocr-content.txt").write_text(content, encoding="utf-8")

    print("== B) /api/v1/ai/documents + analyses task=page_ocr ==", flush=True)
    aidoc = probe_aidoc_page_ocr(token)
    print(json.dumps({k: aidoc[k] for k in aidoc if k not in {"upload", "create", "final"}}, ensure_ascii=False), flush=True)
    if "upload" in aidoc:
        print("upload detail:", json.dumps(aidoc["upload"], ensure_ascii=False)[:500], flush=True)
    summary = {
        "chat_http": chat["http_status"],
        "chat_has_content": bool(content),
        "chat_marker": bool(content and "NO996-OCR-PROBE-20261111" in content),
        "aidoc_upload_http": aidoc.get("upload_status"),
        "aidoc_note": aidoc.get("note"),
    }
    (OUT / "probe-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("SUMMARY", json.dumps(summary, ensure_ascii=False), flush=True)
    return 0 if summary["chat_has_content"] else 2


if __name__ == "__main__":
    sys.exit(main())
