"""性能基准（开发用，不参与服务运行）。

    python bench.py --rows 20000

会在 tests/_tmp/perf.db 生成一个临时库并灌入数据，然后逐个接口计时。
不会碰 data/mistakes.db。
"""
import argparse
import os
import random
import statistics
import sys
import time
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app  # noqa: E402

SUBJECTS = ["高数", "线代", "概率论", "英语", "政治", "数据结构", "操作系统", "计算机网络"]
KNOWLEDGE = [
    "极限", "导数/求导", "导数/单调性", "积分/不定积分", "积分/定积分", "级数",
    "矩阵/秩", "矩阵/特征值", "向量/线性相关", "概率/条件概率", "概率/期望", "随机变量/分布",
    "阅读/长难句", "阅读/主旨题", "写作/论证", "翻译/从句",
    "进程/调度", "内存/分页", "文件/索引", "死锁/条件",
    "链表/反转", "树/遍历", "排序/快排", "哈希/冲突",
    "TCP/握手", "HTTP/缓存", "子网/掩码",
    "马原/矛盾", "史纲/时间线", "时政/会议",
]
TAGS = ["期中", "月考", "易错", "计算", "概念", "重点", "二刷", "真题"]
SOURCES = ["作业", "练习册", "周测", "月考", "期中", "期末", "模拟考"]


def _rm(path):
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(path + suffix)
        except OSError:
            pass


def seed(db_path, rows):
    _rm(db_path)
    app.init_db(db_path)
    conn = app.connect(db_path)
    now = datetime.now()
    fmt = "%Y-%m-%d %H:%M:%S"
    mistakes = []
    for i in range(rows):
        created = now - timedelta(minutes=random.randint(0, 365 * 24 * 60))
        status = random.choices(["new", "reviewing", "mastered"], [0.4, 0.5, 0.1])[0]
        suspended = 1 if random.random() < 0.05 else 0
        has_review = status != "new" and random.random() < 0.9
        stability = round(random.uniform(0.5, 80), 2) if has_review else 0.0
        last = (created + timedelta(days=random.randint(1, 30))).strftime(fmt) if has_review else None
        if status == "mastered":
            nxt = None
        elif random.random() < 0.45:
            nxt = (now + timedelta(days=random.randint(-45, 45))).strftime(fmt)
        else:
            nxt = (now + timedelta(days=random.randint(1, 120))).strftime(fmt)
        mistakes.append((
            random.choice(SUBJECTS),
            "题干 %d：求极限与导数的综合题，涉及%s" % (i, random.choice(KNOWLEDGE)),
            "答案 %d" % i,
            "解析过程 %d：先化简再求导" % i,
            "我的错答 %d" % i,
            "错因描述 %d" % i,
            random.choice(app.MISTAKE_TYPES),
            random.choice(SOURCES),
            random.choice(KNOWLEDGE),
            ",".join(random.sample(TAGS, random.randint(0, 2))),
            random.randint(1, 5),
            status,
            suspended,
            "",
            random.randint(0, 8),
            random.randint(0, 6),
            stability,
            round(random.uniform(1, 9), 2),
            random.randint(0, 10),
            random.randint(0, 4),
            last,
            nxt,
            created.strftime(fmt),
            created.strftime(fmt),
        ))
    conn.executemany(
        "INSERT INTO mistakes (subject, question, answer, analysis, my_answer, error_reason, "
        "mistake_type, source, knowledge, tags, difficulty, status, suspended, image_data, "
        "review_count, stage, fsrs_stability, fsrs_difficulty, fsrs_reps, fsrs_lapses, "
        "last_reviewed_at, next_review_at, created_at, updated_at) "
        "VALUES (" + ",".join(["?"] * 24) + ")", mistakes)

    logs = []
    for mid in range(1, rows + 1):
        if random.random() > 0.85:
            continue
        for _ in range(random.randint(1, 5)):
            reviewed = now - timedelta(minutes=random.randint(0, 300 * 24 * 60))
            rating = random.choice([1, 1, 2, 3, 3, 4])
            logs.append((mid, ["again", "hard", "good", "easy"][rating - 1], rating,
                         random.randint(0, 6), random.randint(1, 60),
                         round(random.uniform(0.5, 60), 2), round(random.uniform(1, 9), 2),
                         reviewed.strftime(fmt)))
    conn.executemany(
        "INSERT INTO review_logs (mistake_id, result, rating, stage, interval_days, "
        "fsrs_stability, fsrs_difficulty, reviewed_at) VALUES (?,?,?,?,?,?,?,?)", logs)
    conn.commit()
    return conn, len(mistakes), len(logs)


def P(**kw):
    """HTTP 层 params 是 parse_qs 的 list[str]；这里保持同样的形状。"""
    return {k: [v] for k, v in kw.items()}


def timeit(fn, repeat=3):
    fn()
    samples = []
    for _ in range(repeat):
        t0 = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - t0) * 1000.0)
    return statistics.median(samples)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", type=int, default=20000)
    ap.add_argument("--db", default=os.path.join(app.BASE_DIR, "tests", "_tmp", "perf.db"))
    args = ap.parse_args()
    os.makedirs(os.path.dirname(args.db), exist_ok=True)
    random.seed(20261022)

    conn, n_rows, n_logs = seed(args.db, args.rows)
    print("数据规模: %d 道错题, %d 条复习记录" % (n_rows, n_logs))
    print("%-28s %10s" % ("操作", "中位耗时(ms)"))
    print("-" * 42)

    ops = [
        ("列表 首页(page1)", lambda: app.query_mistakes(conn, {})),
        ("列表 第100页", lambda: app.query_mistakes(conn, P(page="100"))),
        ("列表 关键词搜索", lambda: app.query_mistakes(conn, P(q="极限"))),
        ("列表 学科筛选", lambda: app.query_mistakes(conn, P(subject="高数"))),
        ("列表 待复习", lambda: app.query_mistakes(conn, P(due="1"))),
        ("统计 stats", lambda: app.stats(conn)),
        ("元数据 meta", lambda: app.meta(conn)),
        ("复习计划 plan", lambda: app.plan(conn, 7, 10)),
        ("再战区 arena", lambda: app.arena(conn, limit=50)),
        ("分析 analytics", lambda: app.analytics(conn, 30)),
        ("学习画像 profile", lambda: app.profile(conn)),
        ("掌握门禁 mastery", lambda: app.mastery(conn)),
        ("到期提醒 reminders", lambda: app.reminders(conn)),
        ("组卷 build_paper(30)", lambda: app.build_paper(conn, P(count="30"))),
        ("全量导出 export_all", lambda: app.export_all(conn)),
        ("回收站列表 trash", lambda: app.list_trash(conn, 50)),
    ]
    results = []
    for name, fn in ops:
        ms = timeit(fn)
        results.append((name, ms))
        print("%-28s %10.1f" % (name, ms))

    first = app.meta(conn), app.stats(conn), app.query_mistakes(conn, {}), app.reminders(conn)
    print("%-28s %10.1f" % ("首页首屏(meta+stats+list+remind)",
                            timeit(lambda: (app.meta(conn), app.stats(conn),
                                            app.query_mistakes(conn, {}), app.reminders(conn)))))

    body = {"question": "基准写入题：求 lim x->0 sin(x)/x", "subject": "高数"}
    def write_cycle():
        item = app.create_mistake(conn, body)
        app.delete_mistake(conn, item["id"])
    print("%-28s %10.1f" % ("写入+删除(含回收站快照)", timeit(write_cycle, repeat=5)))

    print()
    print("=== EXPLAIN QUERY PLAN ===")
    for label, sql in [
        ("列表首页", "SELECT id FROM mistakes WHERE suspended=0 ORDER BY created_at DESC, id DESC LIMIT 20"),
        ("关键词", "SELECT id FROM mistakes WHERE question LIKE '%极限%' LIMIT 20"),
        ("统计主查询", "SELECT COUNT(*), SUM(CASE WHEN status='mastered' THEN 1 ELSE 0 END) FROM mistakes"),
        ("知识点聚合", "SELECT knowledge, COUNT(*) FROM mistakes WHERE knowledge<>'' AND suspended=0 GROUP BY knowledge"),
        ("复习日志关联", "SELECT m.knowledge, l.id FROM mistakes m LEFT JOIN review_logs l ON l.mistake_id=m.id WHERE m.knowledge<>'' AND m.suspended=0"),
    ]:
        plan = " | ".join(r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql))
        print("%-14s %s" % (label, plan))


if __name__ == "__main__":
    main()
