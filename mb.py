#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mb — 错题本命令行入口，给 DSH 里的 AI agent 用。

设计目标：让 agent 能"读错题 -> 出变式题 -> 判分 -> 回写复习状态"，
不必先起 HTTP 服务。所有命令默认输出 JSON，便于 agent 解析。

权限模型（v0.4）：只给 agent「读 + 复习回写 + 存变式」，**不给删除**。
删除错题只保留在网页端人工操作。要更严格可加 --read-only。

    python mb.py due --limit 5
    python mb.py show 12
    python mb.py variant next 12
    python mb.py review 12 --rating good
    python mb.py profile
    python mb.py add --question "求 lim..." --answer "1/2" --subject 高数
    python mb.py stats --read-only
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import app

# 会写库的命令：--read-only 时一律拒绝
WRITE_COMMANDS = ("add", "review", "import", "suspend", "restore", "merge")

BRIEF_FIELDS = ("question", "answer", "my_answer", "error_reason")
BRIEF_CHARS = 160


def _dump(data, text: bool = False) -> None:
    if text:
        print(_render(data))
    else:
        print(json.dumps(data, ensure_ascii=False, indent=2))


def _render(data) -> str:
    """人读的简版输出。"""
    if isinstance(data, dict) and "items" in data:
        lines = ["共 %s 条" % data.get("total", len(data["items"]))]
        for it in data["items"]:
            due = it.get("next_review_at") or "-"
            lines.append("#%-4s [%s] %s | %s | 下次:%s" % (
                it.get("id"), it.get("subject", ""), (it.get("question") or "")[:40].replace("\n", " "),
                it.get("status", ""), due))
        return "\n".join(lines)
    return json.dumps(data, ensure_ascii=False, indent=2)


def _brief(item: dict) -> dict:
    """截断长文本，避免把整篇题目塞进 agent 上下文（参考 open-notebook 的上下文控制）。"""
    out = dict(item)
    for key in BRIEF_FIELDS:
        value = out.get(key)
        if isinstance(value, str) and len(value) > BRIEF_CHARS:
            out[key] = value[:BRIEF_CHARS] + "…"
            out[key + "_truncated"] = True
    return out


def _trim(data: dict, full: bool) -> dict:
    if full or not isinstance(data, dict) or "items" not in data:
        return data
    return {**data, "items": [_brief(it) for it in data["items"]],
            "note": "列表已截断到 %d 字，要看全文用 show <id> 或加 --full" % BRIEF_CHARS}


def cmd_due(args, conn) -> dict:
    data = app.query_mistakes(conn, {"due": "1", "page_size": str(args.limit)})
    data = _trim(data, args.full)
    data["hint"] = "这些是到期待复习的错题。挑一条，读题、出变式、让学生作答后判分，再 review 回写。"
    return data


def cmd_list(args, conn) -> dict:
    params = {"page_size": str(args.limit), "page": str(args.page)}
    for key in ("q", "subject", "status", "tag", "mistake_type", "range", "knowledge"):
        value = getattr(args, key, None)
        if value:
            params[key] = value
    if args.due:
        params["due"] = "1"
    # v0.34 知识点三档：--knowledge 默认含子类（后端默认 kdeep），--exact 退回只此节点，
    # --kq 是记不清全名时的模糊找，--nokp 捞没归类的漏网题
    if getattr(args, "kq", ""):
        params["kq"] = args.kq
    if getattr(args, "nokp", False):
        params["nokp"] = "1"
    if getattr(args, "exact", False):
        params["kdeep"] = "0"
    return _trim(app.query_mistakes(conn, params), args.full)


def cmd_show(args, conn) -> dict:
    item = app.get_mistake(conn, args.id)
    item.pop("image_data", None)  # 图片是 Data URL，别塞进上下文
    return {
        "mistake": item,
        "reviews": app.get_reviews(conn, args.id),
        "preview": app.preview_review(conn, args.id),
        "variants": app.list_variants(conn, args.id),
    }


def cmd_add(args, conn) -> dict:
    body = {
        "subject": args.subject, "question": args.question, "answer": args.answer,
        "analysis": args.analysis,
        "my_answer": args.my_answer, "error_reason": args.error_reason,
        "mistake_type": args.mistake_type, "source": args.source,
        "knowledge": args.knowledge, "tags": args.tags, "difficulty": args.difficulty,
    }
    if args.json:
        with open(args.json, "r", encoding="utf-8") as fh:
            body.update(json.load(fh))
    item = app.create_mistake(conn, body)
    item.pop("image_data", None)
    return item


def cmd_import(args, conn) -> dict:
    """从「--- 分块」的纯文本批量入库；--file 省略或为 - 时读 stdin。"""
    if args.file and args.file != "-":
        with open(args.file, "r", encoding="utf-8") as fh:
            text = fh.read()
    else:
        text = sys.stdin.read()
    items = app.parse_batch_text(text)
    return app.create_mistakes(conn, items)


def cmd_review(args, conn) -> dict:
    body = {"result": args.rating}
    if args.step:
        body["step"] = args.step
    if args.variant_question:
        body["variant_question"] = args.variant_question
        body["variant_answer"] = args.variant_answer
        body["variant_knowledge"] = args.variant_knowledge
    item = app.review_mistake(conn, args.id, body)
    item.pop("image_data", None)
    return item


def cmd_remind(args, conn) -> dict:
    data = app.reminders(conn)
    if args.email:
        import notify
        config = notify.load_config(args.config)
        notify.send(config, "[错题本] " + data["message"], notify.digest(data))
        data["emailed_to"] = config.get("to")
    return data


def cmd_merge(args, conn) -> dict:
    """把若干知识点并到一个规范名（脏值清理 + 同义归一）。"""
    return app.merge_knowledge(conn, args.sources, args.to)


def cmd_ktree(args, conn) -> dict:
    return app.knowledge_tree(conn, args.subject)


def cmd_alias(args, conn) -> dict:
    if args.asub == "add":
        return app.set_alias(conn, args.alias, args.canonical)
    if args.asub == "rm":
        app.delete_alias(conn, args.alias)
        return {"ok": True, "deleted": args.alias}
    return app.list_aliases(conn)


def cmd_profile(args, conn) -> dict:
    return app.profile(conn, args.subject, args.limit)


def cmd_mastery(args, conn) -> dict:
    return app.mastery(conn, args.subject)


def cmd_plan(args, conn) -> dict:
    return app.plan(conn, args.days, args.limit, args.subject)


def cmd_analytics(args, conn) -> dict:
    return app.analytics(conn, args.days)


def cmd_arena(args, conn) -> dict:
    return app.arena(conn, args.subject, args.limit, args.show)


def cmd_suspend(args, conn) -> dict:
    return app.set_suspended(conn, args.id, not args.resume)


def cmd_variant(args, conn) -> dict:
    if args.vsub == "gaps":
        return app.variant_gaps(conn, args.limit, args.subject)
    if args.vsub == "add":
        return app.create_variant(conn, args.id, {
            "question": args.question, "answer": args.answer,
            "knowledge": args.knowledge, "source": args.source})
    if args.vsub == "next":
        return app.pick_variant(conn, args.id)
    if args.vsub == "use":
        return app.use_variant(conn, args.vid)
    return app.list_variants(conn, args.id)


def cmd_stream(args, conn) -> dict:
    """回放事件流：这次学习里谁在什么时候做了什么。"""
    data = app.read_events(conn, args.limit, args.kind, args.id)
    if args.ndjson:
        # 原样吐 NDJSON，方便 agent 直接逐行消费
        for ev in data["items"]:
            print(json.dumps(ev, ensure_ascii=False))
        return None
    data["hint"] = "kind 可选 created/reviewed/mastered/suspended/resumed；加 --ndjson 逐行输出"
    return data


def cmd_stats(args, conn) -> dict:
    return app.stats(conn)


def cmd_export(args, conn) -> dict:
    if args.out:
        # 流式写文件：一次只拼一小批行，几十万题也不会把整库读进内存
        with open(args.out, "w", encoding="utf-8") as fh:
            for chunk in app.iter_export(conn):
                fh.write(chunk)
        return {"ok": True, "out": os.path.abspath(args.out),
                "note": "图片不在此文件里；要连图片一起备份请用 mb.py backup"}
    return app.export_all(conn)


def cmd_backup(args, conn) -> dict:
    return app.backup_db(args.db, backup_dir=args.dir or "", keep=args.keep)


def cmd_restore(args, conn=None) -> dict:
    """用备份文件覆盖当前库；覆盖前自动留一份 pre-restore 快照。"""
    return app.restore_from_backup(args.db, args.src, args.dir or "")


def cmd_settings(args, conn) -> dict:
    """不带参数 = 查看；带任一参数 = 保存并回显生效值。"""
    body = {}
    if getattr(args, "arena_min_wrong", None) is not None:
        body["arena_min_wrong"] = args.arena_min_wrong
    if getattr(args, "arena_clear_streak", None) is not None:
        body["arena_clear_streak"] = args.arena_clear_streak
    if getattr(args, "daily_limit", None) is not None:
        body["daily_limit"] = args.daily_limit
    if body:
        return {"ok": True, "values": app.save_settings(conn, body)}
    return {"ok": True, "values": app.get_settings(conn), "labels": app.SETTING_LABELS,
            "bounds": {k: list(v) for k, v in app.SETTING_BOUNDS.items()}}


def _add_common(p) -> None:
    """让 --full / --read-only 写在子命令后面也能生效（argparse 默认只认前置全局参数）。"""
    p.add_argument("--full", action="store_true", default=argparse.SUPPRESS,
                   help="列表不截断长文本")
    p.add_argument("--read-only", dest="read_only", action="store_true",
                   default=argparse.SUPPRESS, help="只读模式：拒绝写操作")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mb", description="错题本命令行（给 AI agent 用）")
    parser.add_argument("--db", default=app.DB_PATH, help="数据库路径")
    parser.add_argument("--text", action="store_true", help="输出人读格式而非 JSON")
    parser.add_argument("--read-only", dest="read_only", action="store_true",
                        help="只读模式：拒绝 add / review 等写操作")
    parser.add_argument("--full", action="store_true", help="列表不截断长文本")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("due", help="列出到期待复习的错题")
    p.add_argument("--limit", type=int, default=10)
    p.set_defaults(func=cmd_due)

    p = sub.add_parser("list", help="按条件检索")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--page", type=int, default=1)
    for name in ("q", "subject", "status", "tag", "mistake_type", "range", "knowledge"):
        p.add_argument("--" + name, default="")
    p.add_argument("--due", action="store_true")
    p.add_argument("--kq", default="", help="知识点关键词模糊匹配（记不清全名时用）")
    p.add_argument("--nokp", action="store_true", help="只看没填知识点的题")
    p.add_argument("--exact", action="store_true", help="知识点只匹配该节点，不含子类")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("show", help="查看一条错题（含复习历史、四档预览、变式题）")
    p.add_argument("id", type=int)
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("add", help="新增一条错题")
    p.add_argument("--question", required=True)
    p.add_argument("--answer", default="")
    p.add_argument("--analysis", default="", help="解析 / 解题过程（与最终答案分开）")
    p.add_argument("--my-answer", dest="my_answer", default="")
    p.add_argument("--error-reason", dest="error_reason", default="")
    p.add_argument("--mistake-type", dest="mistake_type", default="",
                   help=" / ".join(app.MISTAKE_TYPES))
    p.add_argument("--source", default="")
    p.add_argument("--knowledge", default="")
    p.add_argument("--tags", default="")
    p.add_argument("--subject", default="未分类")
    p.add_argument("--difficulty", type=int, default=3)
    p.add_argument("--json", default="", help="从 JSON 文件补充字段")
    p.set_defaults(func=cmd_add)

    p = sub.add_parser("import", help="从 --- 分块的纯文本批量导入")
    p.add_argument("--file", default="", help="文本文件路径；省略或 - 则读 stdin")
    p.set_defaults(func=cmd_import)

    p = sub.add_parser("review", help="记录一次复习")
    p.add_argument("id", type=int)
    p.add_argument("--rating", default="good",
                   choices=["again", "hard", "good", "easy", "mastered", "1", "2", "3", "4"])
    p.add_argument("--step", default="", choices=[""] + list(app.REVIEW_STEPS),
                   help="这次错在解题流程的哪一步（可选）")
    p.add_argument("--variant-question", dest="variant_question", default="",
                   help="顺手把这次用的变式题存进题库（自动去重）")
    p.add_argument("--variant-answer", dest="variant_answer", default="")
    p.add_argument("--variant-knowledge", dest="variant_knowledge", default="",
                   help="默认继承母题知识点")
    p.set_defaults(func=cmd_review)

    p = sub.add_parser("variant", help="变式题库：add / list / next / use")
    vsub = p.add_subparsers(dest="vsub")
    q = vsub.add_parser("add", help="为某道错题存一道变式")
    q.add_argument("id", type=int)
    q.add_argument("--question", required=True)
    q.add_argument("--answer", default="")
    q.add_argument("--knowledge", default="")
    q.add_argument("--source", default="ai")
    q.set_defaults(func=cmd_variant)
    q = vsub.add_parser("list", help="列出该题的变式")
    q.add_argument("id", type=int)
    q.set_defaults(func=cmd_variant)
    q = vsub.add_parser("next", help="取一道用得最少的变式（没有则 null）")
    q.add_argument("id", type=int)
    q.set_defaults(func=cmd_variant)
    q = vsub.add_parser("gaps", help="列出最缺变式的题（按缺口排序）")
    q.add_argument("--limit", type=int, default=20)
    q.add_argument("--subject", default="")
    q.set_defaults(func=cmd_variant)
    q = vsub.add_parser("use", help="标记某道变式被用过一次")
    q.add_argument("vid", type=int)
    q.set_defaults(func=cmd_variant)
    p.set_defaults(func=cmd_variant, vsub=None)

    p = sub.add_parser("profile", help="学习画像：薄弱知识点 + 证据")
    p.add_argument("--subject", default="")
    p.add_argument("--limit", type=int, default=20)
    p.set_defaults(func=cmd_profile)

    p = sub.add_parser("mastery", help="知识点掌握门禁判定")
    p.add_argument("--subject", default="")
    p.set_defaults(func=cmd_mastery)

    p = sub.add_parser("plan", help="今日复习计划：未来 N 天按天排的待复习题")
    p.add_argument("--days", type=int, default=7, help="窗口天数 1-30")
    p.add_argument("--limit", type=int, default=None,
                   help="每天最多几道 1-200（不传就用 settings 的每日上限）")
    p.add_argument("--subject", default="")
    p.set_defaults(func=cmd_plan)

    p = sub.add_parser("arena", help="再战区：反复错的题排队重练（配 suspend 斩题）")
    p.add_argument("--subject", default="")
    p.add_argument("--limit", type=int, default=50, help="返回条数 1-200")
    p.add_argument("--show", default="zone", choices=("zone", "cleared"),
                   help="zone=在区（默认），cleared=已出区")
    p.set_defaults(func=cmd_arena)

    p = sub.add_parser("analytics", help="学习分析：趋势 / 保持度 / 错因与学科分布")
    p.add_argument("--days", type=int, default=30, help="窗口天数 7-90")
    p.set_defaults(func=cmd_analytics)

    p = sub.add_parser("suspend", help="斩题：把题移出复习池（加 --resume 恢复）")
    p.add_argument("id", type=int)
    p.add_argument("--resume", action="store_true", help="恢复被斩的题")
    p.set_defaults(func=cmd_suspend)

    p = sub.add_parser("remind", help="复习提醒：到期/逾期数量 + 最紧急的几道")
    p.add_argument("--email", action="store_true", help="顺便发邮件（需 data/notify.json）")
    p.add_argument("--config", default="", help="通知配置路径，默认 data/notify.json")
    p.set_defaults(func=cmd_remind)

    p = sub.add_parser("merge", help="合并知识点：把若干脏值/同义写法并到一个规范名")
    p.add_argument("sources", nargs="+", help="要并掉的旧知识点，可多个")
    p.add_argument("--to", required=True, help="目标规范名，可带 / 层级")
    p.set_defaults(func=cmd_merge)

    p = sub.add_parser("ktree", help="知识点树：按 / 层级汇总掌握度")
    p.add_argument("--subject", default="")
    p.set_defaults(func=cmd_ktree)

    p = sub.add_parser("alias", help="知识点别名：add / list / rm")
    asub = p.add_subparsers(dest="asub")
    q = asub.add_parser("add", help="登记别名：把异体写法归到规范名")
    q.add_argument("alias")
    q.add_argument("canonical")
    q.set_defaults(func=cmd_alias)
    q = asub.add_parser("rm", help="删除别名")
    q.add_argument("alias")
    q.set_defaults(func=cmd_alias)
    q = asub.add_parser("list", help="列出全部别名")
    q.set_defaults(func=cmd_alias)
    p.set_defaults(func=cmd_alias, asub="list")

    p = sub.add_parser("stream", help="回放学习事件流（NDJSON 文件）")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--kind", default="",
                   help="只看某类：created / reviewed / mastered / suspended / resumed")
    p.add_argument("--id", type=int, default=0, help="只看某道错题")
    p.add_argument("--ndjson", action="store_true", help="逐行输出原始 NDJSON")
    p.set_defaults(func=cmd_stream)

    p = sub.add_parser("stats", help="统计")
    p.set_defaults(func=cmd_stats)

    p = sub.add_parser("export", help="导出全量 JSON 备份")
    p.add_argument("--out", default="")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("backup", help="备份数据库快照到 backups/（默认保留最近 14 份）")
    p.add_argument("--dir", default="", help="备份目录（默认数据库旁边的 backups/）")
    p.add_argument("--keep", type=int, default=app.BACKUP_KEEP, help="保留最近几份")
    p.set_defaults(func=cmd_backup)

    p = sub.add_parser("restore", help="用备份文件恢复数据库（覆盖当前库，先自动存一份当前库快照）")
    p.add_argument("--from", dest="src", required=True, help="备份文件路径，如 data/backups/mistakes-20261022-120000.db")
    p.add_argument("--dir", default="", help="安全快照存放目录（默认数据库旁边的 backups/）")
    p.set_defaults(func=cmd_restore)

    p = sub.add_parser("settings", help="查看/修改可调参数（再战区门槛、每日复习上限）")
    p.add_argument("--arena-min-wrong", dest="arena_min_wrong", type=int, default=None,
                   help="累计答错几次进再战区（1-20，默认 2）")
    p.add_argument("--arena-clear-streak", dest="arena_clear_streak", type=int, default=None,
                   help="上次答错后连对几次自动出区（1-20，默认 2）")
    p.add_argument("--daily-limit", dest="daily_limit", type=int, default=None,
                   help="计划页每天最多排几道（1-200，默认 20）")
    p.set_defaults(func=cmd_settings)

    for _p in sub.choices.values():
        _add_common(_p)

    return parser


def main(argv=None) -> int:
    # Windows 控制台默认 GBK，JSON 里的中文会变乱码；agent 读 stdout 时尤其致命
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    args = build_parser().parse_args(argv)
    if args.read_only and (args.cmd in WRITE_COMMANDS
                           or (args.cmd == "variant" and args.vsub == "add")
                           or (args.cmd == "alias" and args.asub != "list")
                           or (args.cmd == "settings"
                               and (args.arena_min_wrong is not None
                                    or args.arena_clear_streak is not None))):
        print(json.dumps({"ok": False,
                          "error": "--read-only 模式下不允许写操作: %s" % args.cmd},
                         ensure_ascii=False))
        return 2
    if args.cmd == "restore":   # 恢复要在打开连接之前做，否则会覆盖正在用的库
        try:
            data = app.restore_from_backup(args.db, args.src, args.dir or "")
        except (app.ValidationError, app.NotFound) as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
            return 1
        _dump(data, args.text)
        return 0
    app.init_db(args.db)
    conn = app.connect(args.db)
    try:
        data = args.func(args, conn)
    except (app.ValidationError, app.NotFound) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    finally:
        conn.close()
    if data is not None:   # stream --ndjson 自己打印，不套 JSON 信封
        _dump(data, args.text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
