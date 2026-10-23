
import io, re, sys

path = "app.py"
src = io.open(path, encoding="utf-8").read()

def sub(old, new, count=1):
    global src
    n = src.count(old)
    if n != count:
        raise SystemExit("anchor count %d != %d for %r" % (n, count, old[:60]))
    src = src.replace(old, new, count)

# ---- A: meta() 的 knowledge 改成带计数/层级的 facets ----
sub(
'''    knowledge = [r[0] for r in conn.execute(
        "SELECT DISTINCT knowledge FROM mistakes WHERE knowledge <> '' ORDER BY knowledge")]
''',
'''    facets = knowledge_facets(conn)
''')

sub(
'''    return {"subjects": subjects, "tags": tags, "knowledge": knowledge,
            "steps": list(REVIEW_STEPS),''',
'''    return {"subjects": subjects, "tags": tags,
            # v0.34：knowledge 从「字符串数组」升级成带 count/depth/parent 的 facets；
            # knowledge_flat 保留旧形状，老调用方（CLI、老前端）不至于一升级就断。
            "knowledge": facets["items"],
            "knowledge_flat": facets["flat"],
            "knowledge_unclassified": facets["unclassified"],
            "steps": list(REVIEW_STEPS),''')

# ---- B: build_filters 的知识点分支 ----
sub(
'''    # 知识点：默认精确匹配；kdeep=1 时连子知识点一起选（函数 -> 函数/二次函数）
    knowledge = one(params, "knowledge").strip()
    if knowledge:
        knowledge = normalize_knowledge_path(knowledge)
    if knowledge and one(params, "kdeep").strip() in ("1", "true", "yes"):
        where.append("(knowledge = ? OR knowledge LIKE ?)")
        args.extend([knowledge, knowledge + "/%"])
    elif knowledge:
        where.append("knowledge = ?")
        args.append(knowledge)
''',
'''    # 知识点（v0.34 三档）：
    #   knowledge=函数        默认连子树一起选（点父节点能看到「函数/二次函数」下的题）
    #   knowledge=函数&kdeep=0 退回精确匹配，只看这个节点自己
    #   kq=函                   关键词式模糊找（记不清全名时用）
    #   nokp=1                 只看没归类（knowledge 为空）的题
    knowledge = one(params, "knowledge").strip()
    if knowledge:
        knowledge = normalize_knowledge_path(knowledge)
    if one(params, "nokp").strip().lower() in ("1", "true", "yes"):
        where.append("knowledge = ''")
    elif knowledge:
        deep = one(params, "kdeep").strip().lower() not in ("0", "false", "no")
        if deep:
            where.append("(knowledge = ? OR knowledge LIKE ?)")
            args.extend([knowledge, knowledge + "/%"])
        else:
            where.append("knowledge = ?")
            args.append(knowledge)
    keyword_path = one(params, "kq").strip()
    if keyword_path:
        where.append("knowledge LIKE ?")
        args.append("%" + keyword_path + "%")
''')

# ---- C: knowledge_facets + merge_knowledge，插在 delete_alias 之后 ----
sub(
'''    if cur.rowcount == 0:
        raise NotFound("别名不存在: %s" % alias)


_EMPTY_TREE_STATS''',
'''    if cur.rowcount == 0:
        raise NotFound("别名不存在: %s" % alias)


def knowledge_facets(conn: sqlite3.Connection, subject: str = "") -> dict:
    """知识点下拉用的分面：每个节点带题量、层级、父节点。

    为什么要单独一个函数：meta() 原来只回一串 DISTINCT knowledge，
    前端拿到了也没法排序（"2" 会排在 "函数" 前面）、没法知道哪个是父节点、
    更没法告诉用户「这一项下面有几道题」。这里一次 GROUP BY 就把计数和祖先补齐，
    仍然不建表 —— 层级继续从字符串派生（见 knowledge_tree 的同一套思路）。
    """
    where, args = ["knowledge <> ''"], []
    if subject:
        where.append("subject = ?")
        args.append(subject)
    rows = conn.execute(
        "SELECT knowledge, COUNT(*) FROM mistakes WHERE " + " AND ".join(where) +
        " GROUP BY knowledge ORDER BY knowledge", args).fetchall()

    nodes = {}
    for path, count in rows:
        parts = path.split("/")
        for depth in range(1, len(parts) + 1):
            key = "/".join(parts[:depth])
            node = nodes.get(key)
            if node is None:
                node = nodes[key] = {"path": key, "name": parts[depth - 1],
                                     "parent": "/".join(parts[:depth - 1]),
                                     "depth": depth, "count": 0}
            node["count"] += count

    empty_where, empty_args = ["knowledge = ''", "suspended = 0"], []
    if subject:
        empty_where.append("subject = ?")
        empty_args.append(subject)
    unclassified = conn.execute(
        "SELECT COUNT(*) FROM mistakes WHERE " + " AND ".join(empty_where),
        empty_args).fetchone()[0]

    return {"items": [nodes[k] for k in sorted(nodes)],
            "flat": [r[0] for r in rows],
            "unclassified": unclassified}


def merge_knowledge(conn: sqlite3.Connection, sources, target: str) -> dict:
    """把若干个知识点（连同其子知识点）并到一个规范名下，并登记别名。

    存在的理由：自由文本框让 "111"、"2"、"函数 单调性" 这类脏值进了库，
    没有合并入口就只能一条条手改，改完下次再录还会再脏。
    并完顺手把源名登记成别名，之后录入/批量修改写脏名会自动落到规范名上。
    """
    if not isinstance(sources, list) or not sources:
        raise ValidationError("sources 必须是非空的知识点数组")
    target = resolve_knowledge(conn, target or "")
    if not target:
        raise ValidationError("目标知识点不能为空")

    clean = []
    for item in sources:
        path = normalize_knowledge_path(item)
        if not path or path == target or path in clean:
            continue
        # 把父节点并进自己的子节点会让层级自相矛盾（函数 -> 函数/二次函数），直接拒绝
        if target.startswith(path + "/"):
            raise ValidationError("不能把父知识点并到它自己的子知识点下：%s -> %s"
                                  % (path, target))
        clean.append(path)

    stamp = now_str()
    moved, aliases_added = [], 0
    for path in clean:
        rows = conn.execute("SELECT id, knowledge FROM mistakes WHERE knowledge = ? "
                            "OR knowledge LIKE ?", (path, path + "/%")).fetchall()
        for row in rows:
            suffix = row["knowledge"][len(path):]
            conn.execute("UPDATE mistakes SET knowledge = ?, updated_at = ? WHERE id = ?",
                         (target + suffix, stamp, row["id"]))
            moved.append(row["id"])
        # 源名 -> 规范名：以后写 "111" 会自动归到规范名
        conn.execute("INSERT INTO knowledge_aliases (alias, canonical, created_at) "
                     "VALUES (?,?,?) ON CONFLICT(alias) DO UPDATE SET canonical = excluded.canonical",
                     (path, target, stamp))
        aliases_added += 1
    conn.commit()

    if moved:
        append_event(conn, "merged", knowledge=target, sources=",".join(clean),
                     count=len(moved))
    return {"target": target, "sources": clean, "merged": len(clean),
            "moved": len(moved), "ids": moved, "aliases_added": aliases_added}


_EMPTY_TREE_STATS''')

# ---- D: POST /api/knowledge/merge ----
sub(
'''            match = re.fullmatch(r"/api/knowledge/aliases/(.+)", path)''',
'''            if path == "/api/knowledge/merge" and method == "POST":
                body = self._read_json()
                return self._json(200, {"ok": True, "data": merge_knowledge(
                    conn, body.get("sources") or body.get("from") or [],
                    body.get("target") or body.get("to") or "")})
            match = re.fullmatch(r"/api/knowledge/aliases/(.+)", path)''')

io.open(path, "w", encoding="utf-8", newline="\n").write(src)
print("patched", len(src))
