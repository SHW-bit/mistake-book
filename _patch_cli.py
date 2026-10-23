
# -*- coding: utf-8 -*-
"""v0.34 CLI：list 支持 --kq/--nokp/--exact，新增 merge 子命令。"""
import io, sys

PATH = "mb.py"
src = io.open(PATH, encoding="utf-8").read()
orig = len(src)
applied = []


def sub(anchor, new, tag, count=1):
    global src
    n = src.count(anchor)
    if n != count:
        print("ANCHOR-FAIL %s: found %d, want %d" % (tag, n, count))
        sys.exit(1)
    src = src.replace(anchor, new)
    applied.append(tag)


sub('WRITE_COMMANDS = ("add", "review", "import", "suspend", "restore")',
    'WRITE_COMMANDS = ("add", "review", "import", "suspend", "restore", "merge")',
    "write-cmds")

sub("""    if args.due:
        params["due"] = "1"
    return _trim(app.query_mistakes(conn, params), args.full)""",
    """    if args.due:
        params["due"] = "1"
    # v0.34 知识点三档：--knowledge 默认含子类（后端默认 kdeep），--exact 退回只此节点，
    # --kq 是记不清全名时的模糊找，--nokp 捞没归类的漏网题
    if getattr(args, "kq", ""):
        params["kq"] = args.kq
    if getattr(args, "nokp", False):
        params["nokp"] = "1"
    if getattr(args, "exact", False):
        params["kdeep"] = "0"
    return _trim(app.query_mistakes(conn, params), args.full)""",
    "cmd-list")

sub("""    p.add_argument("--due", action="store_true")
    p.set_defaults(func=cmd_list)""",
    """    p.add_argument("--due", action="store_true")
    p.add_argument("--kq", default="", help="知识点关键词模糊匹配（记不清全名时用）")
    p.add_argument("--nokp", action="store_true", help="只看没填知识点的题")
    p.add_argument("--exact", action="store_true", help="知识点只匹配该节点，不含子类")
    p.set_defaults(func=cmd_list)""",
    "list-parser")

sub("""def cmd_ktree(args, conn) -> dict:""",
    """def cmd_merge(args, conn) -> dict:
    \"\"\"把若干知识点并到一个规范名（脏值清理 + 同义归一）。\"\"\"
    return app.merge_knowledge(conn, args.sources, args.to)


def cmd_ktree(args, conn) -> dict:""",
    "cmd-merge")

sub("""    p = sub.add_parser("ktree", help="知识点树：按 / 层级汇总掌握度")""",
    """    p = sub.add_parser("merge", help="合并知识点：把若干脏值/同义写法并到一个规范名")
    p.add_argument("sources", nargs="+", help="要并掉的旧知识点，可多个")
    p.add_argument("--to", required=True, help="目标规范名，可带 / 层级")
    p.set_defaults(func=cmd_merge)

    p = sub.add_parser("ktree", help="知识点树：按 / 层级汇总掌握度")""",
    "merge-parser")

io.open(PATH, "w", encoding="utf-8", newline="\n").write(src)
print("patched %d -> %d bytes; %d edits: %s" % (orig, len(src), len(applied), ", ".join(applied)))
