#!/usr/bin/env python3
"""对 page-ocr 候选真实模型发带图请求，核对是否真能看图。"""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8080"
OUT = Path(r"F:\Dev\Desktop-Projects\qingliu-workspace\samples\ocr-probe")
PNG = OUT / "ocr-probe-page.png"
EMAIL = "admin@example.com"
MODELS = ["deepseek-flash", "mimo-v2.6-pro"]


def http_json(method, path, body=None, token=None, timeout=180):
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


def login() -> str:
    _, cap = http_json("GET", "/api/v1/auth/captcha")
    _, otp = http_json(
        "POST",
        "/api/v1/auth/verification-codes",
        {
            "email": EMAIL,
            "purpose": "login",
            "captcha_id": cap["data"]["id"],
            "captcha_code": cap["data"]["code"],
        },
    )
    _, login_body = http_json(
        "POST", "/api/v1/auth/login", {"email": EMAIL, "code": otp["data"]["code"]}
    )
    token = (login_body.get("data") or {}).get("access_token")
    if not token:
        raise SystemExit(f"login failed: {login_body}")
    return token


def main() -> None:
    token = login()
    b64 = base64.b64encode(PNG.read_bytes()).decode("ascii")
    prompt = "请原样转写图中全部中文与数字。必须包含探测标记行。"
    summary = []
    for model in MODELS:
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64}"},
                        },
                    ],
                }
            ],
        }
        status, body = http_json("POST", "/v1/chat/completions", payload, token=token)
        content = None
        try:
            content = body["choices"][0]["message"]["content"]
        except Exception:
            content = None
        err = body.get("error") or {}
        item = {
            "model": model,
            "http": status,
            "has_content": bool(content),
            "marker": bool(content and "NO996-OCR-PROBE-20261111" in content),
            "error": err.get("message")
            or err.get("code")
            or (None if content else json.dumps(body, ensure_ascii=False)[:400]),
        }
        if content:
            (OUT / f"chat-{model.replace('/', '_')}-content.txt").write_text(
                content, encoding="utf-8"
            )
            item["preview"] = content[:240]
        summary.append(item)
        print(json.dumps(item, ensure_ascii=False), flush=True)
    (OUT / "vision-model-probe.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
