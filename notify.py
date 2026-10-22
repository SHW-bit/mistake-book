#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""邮件提醒：只用标准库 smtplib / email，不引第三方依赖。

配置默认读 data/notify.json（可用 --config 或 MISTAKE_NOTIFY_CONFIG 覆盖）：

    {
      "smtp_host": "smtp.qq.com",
      "smtp_port": 465,
      "use_ssl": true,
      "username": "you@qq.com",
      "password": "授权码不是登录密码",
      "from": "you@qq.com",
      "to": ["you@qq.com"]
    }

QQ/163 用「授权码」；Gmail 需要应用专用密码。不配就只用网页横幅提醒。
"""
from __future__ import annotations

import json
import os
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

import app

DEFAULT_PATH = os.path.join(app.BASE_DIR, "data", "notify.json")
ENV_PATH = "MISTAKE_NOTIFY_CONFIG"

REQUIRED = ("smtp_host", "username", "password", "from", "to")


def config_path(path: str = "") -> str:
    return path or os.environ.get(ENV_PATH) or DEFAULT_PATH


def load_config(path: str = "") -> dict:
    """读配置；文件不存在时给出可直接照做的提示，而不是一句 FileNotFoundError。"""
    target = config_path(path)
    if not os.path.exists(target):
        raise app.ValidationError(
            "找不到通知配置 %s。复制下面这段到该文件即可启用邮件提醒：\n%s"
            % (target, json.dumps({
                "smtp_host": "smtp.qq.com", "smtp_port": 465, "use_ssl": True,
                "username": "you@qq.com", "password": "邮箱授权码",
                "from": "you@qq.com", "to": ["you@qq.com"]},
                ensure_ascii=False, indent=2)))
    try:
        with open(target, "r", encoding="utf-8") as fh:
            config = json.load(fh)
    except json.JSONDecodeError as exc:
        raise app.ValidationError("通知配置不是合法 JSON：%s（第 %d 行）"
                                  % (target, exc.lineno))
    if not isinstance(config, dict):
        raise app.ValidationError("通知配置必须是 JSON 对象")
    missing = [key for key in REQUIRED if not config.get(key)]
    if missing:
        raise app.ValidationError("通知配置缺少字段: " + ", ".join(missing))
    config.setdefault("smtp_port", 465)
    config.setdefault("use_ssl", True)
    config.setdefault("use_starttls", False)
    recipients = config["to"]
    if isinstance(recipients, str):
        recipients = [recipients]
    config["to"] = [r.strip() for r in recipients if r and r.strip()]
    if not config["to"]:
        raise app.ValidationError("通知配置的 to 不能为空")
    return config


def digest(rem: dict) -> str:
    """把 /api/reminders 的结果排成人读的邮件正文。"""
    lines = [rem.get("message") or "", ""]
    if rem.get("next_at"):
        lines.append("最近一次待复习：%s" % rem["next_at"])
    top = rem.get("top") or []
    if top:
        lines.append("")
        lines.append("最紧急的 %d 道：" % len(top))
        for item in top:
            lines.append("  #%s [%s] %s  （到期 %s）" % (
                item.get("id"), item.get("subject") or "-",
                (item.get("question") or "").replace("\n", " ")[:60],
                item.get("next_review_at") or "-"))
    lines.append("")
    lines.append("打开错题本：python app.py 然后访问 http://127.0.0.1:8765")
    return "\n".join(lines)


def build_message(config: dict, subject: str, body: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr(("错题本", config["from"]))
    msg["To"] = ", ".join(config["to"])
    msg.set_content(body)
    return msg


def send(config: dict, subject: str, body: str) -> None:
    """同步发送。失败时抛 ValidationError，把 SMTP 的原始报错带上，便于排查。"""
    msg = build_message(config, subject, body)
    host, port = config["smtp_host"], int(config["smtp_port"])
    try:
        if config.get("use_ssl"):
            server = smtplib.SMTP_SSL(host, port, timeout=20)
        else:
            server = smtplib.SMTP(host, port, timeout=20)
        with server:
            if config.get("use_starttls") and not config.get("use_ssl"):
                server.starttls()
            server.login(config["username"], config["password"])
            server.send_message(msg)
    except (smtplib.SMTPException, OSError) as exc:
        raise app.ValidationError("邮件发送失败（%s:%s）：%s" % (host, port, exc))
