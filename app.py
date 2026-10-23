#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""错题本 MVP — Python 标准库 + SQLite，零第三方依赖。

启动:  python app.py
访问:  http://127.0.0.1:8000
"""
from __future__ import annotations

import argparse
import base64
import binascii
import csv
import hashlib
import html
import io
import json
import os
import random
import re
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from functools import partial

import fsrs  # 本地模块：FSRS-6 间隔重复调度器
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
# v0.25：DSH 面板跑在另一个 origin 里，直接 <script src="/vendor/katex/…"> 会被同源策略拦掉。
# 所以把渲染器挂到 /api/asset 上，让面板经宿主代理取回；只放行 vendor/katex/ 一个目录，
# 不把整个 static/ 敞开成通用文件服务。
ASSET_PREFIX = "/vendor/katex/"
ASSET_MIME = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
}
DB_PATH = os.environ.get("MISTAKE_DB", os.path.join(BASE_DIR, "data", "mistakes.db"))

STATUSES = ("new", "reviewing", "mastered")
STATUS_LABELS = {"new": "待复习", "reviewing": "复习中", "mastered": "已掌握"}
# 结构化错因分类：值即中文标签，省掉一层映射
MISTAKE_TYPES = ("概念不清", "计算失误", "审题错误", "方法不会", "粗心", "其他")
# 结构化断点（v0.22）：这次错在解题流程的哪一步。用枚举而不是自由文本，
# 否则「计算错了」「算错」「计算失误」会碎成三堆，易错模式就聚合不出来了。
REVIEW_STEPS = ("审题", "建模", "计算", "检验", "表达", "记忆")
SOURCE_HINTS = ("作业", "练习册", "周测", "月考", "期中", "期末", "模拟考", "其他")
# 复习评分 -> FSRS rating（1=again 2=hard 3=good 4=easy）
RESULT_RATINGS = {"again": 1, "hard": 2, "good": 3, "easy": 4}
DEDUP_WINDOW_SEC = 3                       # 防双击重复提交
MAX_BODY = 4 * 1024 * 1024                 # 请求体上限 4MB（含图片 Data URL）
MAX_IMAGE_CHARS = 2_800_000                # 单张 Data URL 字符上限，约 2MB 图片
MAX_IMAGES = 6                             # 一道题最多几张图（几何题两三张够用，再多是误操作）
# v0.15：图片从 base64 存库改成落盘（内容寻址），库里只留文件名。
# 好处：数据库不再被图片撑大，备份/导出/列表都快；文件按 sha256 命名，天然去重。
IMAGE_DIR_NAME = "images"                  # 与数据库文件同级的 images/ 目录
MAX_IMAGE_BYTES = 2 * 1024 * 1024          # 解码后上限 2MB
IMAGE_EXTS = {"png": "png", "jpeg": "jpg", "jpg": "jpg",
              "gif": "gif", "webp": "webp", "bmp": "bmp"}
IMAGE_MIME = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif",
              "webp": "image/webp", "bmp": "image/bmp"}
IMAGE_NAME_RE = re.compile(r"^[0-9a-f]{32}\.(?:png|jpg|gif|webp|bmp)$")
# 只接受真实位图：SVG 可以内嵌脚本，直接当图片回源有 XSS 风险，一律拒绝。
IMAGE_MAGIC = {
    "png": b"\x89PNG\r\n\x1a\n",
    "jpg": b"\xff\xd8\xff",
    "gif": b"GIF8",
    "webp": b"RIFF",
    "bmp": b"BM",
}

# 掌握门禁（v0.4）：知识点算「真掌握」的硬条件，替代一键点 mastered 的虚高
MASTERY_MIN_MISTAKES = 3        # 至少 3 道不同题
MASTERY_MIN_STAGE = 2           # 每道题连续答对 >= 2 次
MASTERY_MIN_STABILITY = 21.0    # 每道题 FSRS 稳定性 >= 21 天
ARENA_MIN_WRONG = 2             # 答错 >= 2 次才进再战区（错一次算正常遗忘）
ARENA_CLEAR_STREAK = 2          # 最近一次答错后连对 >= 2 次就出区
ARENA_MAX_ITEMS = 200           # 再战区单次返回上限
DAILY_PLAN_LIMIT = 20           # 计划页每天默认最多排几道（v0.24 起可调）

# 可调参数（v0.12）：存 settings 表，网页和 CLI 都能改，改完立刻生效不用重启
DEFAULT_SETTINGS = {"arena_min_wrong": ARENA_MIN_WRONG,
                    "arena_clear_streak": ARENA_CLEAR_STREAK,
                    "daily_limit": DAILY_PLAN_LIMIT}
SETTING_BOUNDS = {"arena_min_wrong": (1, 20), "arena_clear_streak": (1, 20),
                  "daily_limit": (1, 200)}
SETTING_LABELS = {"arena_min_wrong": "进区门槛（累计答错几次进再战区）",
                  "arena_clear_streak": "出区门槛（连对几次自动出区）",
                  "daily_limit": "每日复习上限（计划页一天最多排几道）"}
MAX_VARIANTS_PER_MISTAKE = 50   # 单题变式上限，防 AI 灌爆

# 知识点树（v0.9）：knowledge 用 "/" 表示层级（如 函数/二次函数），别名表合并异体写法
KNOWLEDGE_MAX_DEPTH = 6         # 最多 6 级，防误把整段话当路径
KNOWLEDGE_SEGMENT_MAX = 60      # 单段名字上限
KNOWLEDGE_ALIAS_HOPS = 5        # 别名链最多解析 5 跳，防环
REMINDER_TOP = 10               # 提醒里最多列几道题
VARIANT_GAP_LIMIT = 50          # 变式缺口单次返回上限

BACKUP_KEEP = 14                # 备份保留最近 14 份
BACKUP_MIN_HOURS = 20.0         # 距上一份不足 20 小时就跳过（每天最多一份）
TRASH_KEEP = 200                # 回收站最多留 200 条，超了从最旧的开始清

EDITABLE = ("subject", "question", "answer", "analysis", "my_answer", "error_reason",
            "mistake_type", "source", "knowledge", "tags", "difficulty",
            "status", "image_data")

LIST_COLUMNS = ("id, subject, question, answer, analysis, my_answer, error_reason, mistake_type, "
                "source, knowledge, tags, difficulty, status, suspended, review_count, stage, "
                "fsrs_stability, fsrs_difficulty, fsrs_reps, fsrs_lapses, paper_id, "
                "last_reviewed_at, next_review_at, created_at, updated_at, "
                "(image_file IS NOT NULL AND image_file <> '') AS has_image, "
                "(SELECT COUNT(*) FROM variants WHERE variants.parent_id = mistakes.id) "
                "AS variant_count")

SCHEMA = """
CREATE TABLE IF NOT EXISTS mistakes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    subject          TEXT    NOT NULL DEFAULT '未分类',
    question         TEXT    NOT NULL,
    answer           TEXT    NOT NULL DEFAULT '',
    analysis         TEXT    NOT NULL DEFAULT '',
    my_answer        TEXT    NOT NULL DEFAULT '',
    error_reason     TEXT    NOT NULL DEFAULT '',
    mistake_type     TEXT    NOT NULL DEFAULT '',
    source           TEXT    NOT NULL DEFAULT '',
    knowledge        TEXT    NOT NULL DEFAULT '',
    tags             TEXT    NOT NULL DEFAULT '',
    difficulty       INTEGER NOT NULL DEFAULT 3,
    status           TEXT    NOT NULL DEFAULT 'new',
    suspended        INTEGER NOT NULL DEFAULT 0,
    image_data       TEXT    NOT NULL DEFAULT '',   -- v0.15 起不再写入，仅用于迁移旧数据
    image_file       TEXT    NOT NULL DEFAULT '',   -- 图片文件名（images/ 下，sha256 命名）
    review_count     INTEGER NOT NULL DEFAULT 0,
    stage            INTEGER NOT NULL DEFAULT 0,
    fsrs_stability   REAL    NOT NULL DEFAULT 0,
    fsrs_difficulty  REAL    NOT NULL DEFAULT 0,
    fsrs_reps        INTEGER NOT NULL DEFAULT 0,
    fsrs_lapses      INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TEXT,
    next_review_at   TEXT,
    created_at       TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mistakes_subject    ON mistakes(subject);
CREATE INDEX IF NOT EXISTS idx_mistakes_status     ON mistakes(status);
CREATE INDEX IF NOT EXISTS idx_mistakes_next_review ON mistakes(next_review_at);
-- v0.14：列表按 created_at 倒序、meta 去重、组卷按知识点/来源过滤都要走索引
CREATE INDEX IF NOT EXISTS idx_mistakes_created   ON mistakes(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_mistakes_knowledge ON mistakes(knowledge);
CREATE INDEX IF NOT EXISTS idx_mistakes_source    ON mistakes(source);
CREATE TABLE IF NOT EXISTS review_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    mistake_id   INTEGER NOT NULL,
    result       TEXT    NOT NULL,
    rating       INTEGER NOT NULL DEFAULT 0,
    stage        INTEGER NOT NULL DEFAULT 0,
    interval_days INTEGER NOT NULL DEFAULT 0,
    fsrs_stability  REAL NOT NULL DEFAULT 0,
    fsrs_difficulty REAL NOT NULL DEFAULT 0,
    step         TEXT    NOT NULL DEFAULT '',
    reviewed_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_mistake ON review_logs(mistake_id, reviewed_at);
-- 覆盖索引：再战区/组卷/知识点统计只读 (mistake_id, rating) 两列
CREATE INDEX IF NOT EXISTS idx_logs_rating ON review_logs(mistake_id, rating);
CREATE TABLE IF NOT EXISTS variants (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id    INTEGER NOT NULL,
    question     TEXT    NOT NULL,
    answer       TEXT    NOT NULL DEFAULT '',
    knowledge    TEXT    NOT NULL DEFAULT '',
    source       TEXT    NOT NULL DEFAULT 'ai',
    times_used   INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_variants_parent ON variants(parent_id, times_used);
CREATE TABLE IF NOT EXISTS knowledge_aliases (
    alias      TEXT PRIMARY KEY,
    canonical  TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- 回收站（v0.13）：删除前把整行 + 复习日志快照进来，恢复时原样写回
CREATE TABLE IF NOT EXISTS trash (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mistake_id  INTEGER NOT NULL,
    subject     TEXT    NOT NULL DEFAULT '',
    question    TEXT    NOT NULL DEFAULT '',
    payload     TEXT    NOT NULL,
    logs        TEXT    NOT NULL DEFAULT '[]',
    deleted_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trash_deleted ON trash(id DESC);
-- v0.20：一道题多张图。mistakes.image_file 保留为第一张（缩略图/打印/导出仍读它），
-- 这里是完整图片列表，顺序由 sort 决定。
CREATE TABLE IF NOT EXISTS mistake_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    mistake_id INTEGER NOT NULL,
    file       TEXT    NOT NULL,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mimages_mid ON mistake_images(mistake_id, sort, id);
-- v0.20：试卷维度。一次月考/周测是一张卷，题目用 mistakes.paper_id 归属。
CREATE TABLE IF NOT EXISTS papers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    subject    TEXT    NOT NULL DEFAULT '',
    exam_date  TEXT    NOT NULL DEFAULT '',
    note       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_papers_date ON papers(exam_date DESC, id DESC);
"""

# 老库升级：新增列时补 ALTER，不丢数据。元组: (表, 列, DDL)
MIGRATIONS = (
    ("mistakes", "analysis", "TEXT NOT NULL DEFAULT ''"),
    ("mistakes", "mistake_type", "TEXT NOT NULL DEFAULT ''"),
    ("mistakes", "source", "TEXT NOT NULL DEFAULT ''"),
    ("mistakes", "stage", "INTEGER NOT NULL DEFAULT 0"),
    ("mistakes", "fsrs_stability", "REAL NOT NULL DEFAULT 0"),
    ("mistakes", "fsrs_difficulty", "REAL NOT NULL DEFAULT 0"),
    ("mistakes", "fsrs_reps", "INTEGER NOT NULL DEFAULT 0"),
    ("mistakes", "fsrs_lapses", "INTEGER NOT NULL DEFAULT 0"),
    ("mistakes", "suspended", "INTEGER NOT NULL DEFAULT 0"),
    ("review_logs", "rating", "INTEGER NOT NULL DEFAULT 0"),
    ("review_logs", "fsrs_stability", "REAL NOT NULL DEFAULT 0"),
    ("review_logs", "fsrs_difficulty", "REAL NOT NULL DEFAULT 0"),
    ("mistakes", "image_file", "TEXT NOT NULL DEFAULT ''"),
    ("mistakes", "paper_id", "INTEGER NOT NULL DEFAULT 0"),
    ("review_logs", "step", "TEXT NOT NULL DEFAULT ''"),
)


class ValidationError(Exception):
    """请求数据不合法 -> 400"""


class NotFound(Exception):
    """资源不存在 -> 404"""


# --------------------------------------------------------------------------- #
# 基础设施
# --------------------------------------------------------------------------- #
def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _events_path(conn: sqlite3.Connection) -> str:
    """事件流文件放数据库旁边，跟着 --db 走，多份库互不干扰。"""
    for row in conn.execute("PRAGMA database_list").fetchall():
        if row[1] == "main" and row[2]:
            return os.path.join(os.path.dirname(os.path.abspath(row[2])), "events.ndjson")
    return os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "events.ndjson")


def append_event(conn: sqlite3.Connection, kind: str, **fields) -> dict:
    """追加一条 NDJSON 事件。

    为什么单独一个文件而不是加表：事件是「只增不改」的流水，用来回放一次学习
    发生了什么（谁、哪道题、错在哪一步、隔多久）。塞进 SQLite 会逼着每次复习
    都多一次写事务，还会被 --read-only 误伤；旁路文件坏了也不影响主流程。
    """
    event = {"ts": now_str(), "kind": kind}
    for key, value in fields.items():
        if value is None or value == "":
            continue
        event[key] = value
    try:
        path = _events_path(conn)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, ensure_ascii=False) + "\n")
    except OSError:
        pass  # 事件流是旁路：写不进去也不能拖垮复习本身
    return event


def read_events(conn: sqlite3.Connection, limit: int = 50, kind: str = "",
                mid: int = 0) -> dict:
    """读事件流尾部；坏行直接跳过（手工编辑过的文件不至于整条流读不出来）。"""
    path = _events_path(conn)
    if not os.path.exists(path):
        return {"items": [], "total": 0, "path": path}
    items = []
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if not isinstance(event, dict):
                continue
            if kind and event.get("kind") != kind:
                continue
            if mid and int(event.get("id") or 0) != mid:
                continue
            items.append(event)
    return {"items": items[-limit:], "total": len(items), "path": path}


def connect(db_path: str = DB_PATH) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    # v0.14：默认页缓存只有 2MB，大库排序/聚合会频繁读盘
    conn.execute("PRAGMA cache_size=-64000")      # 64MB 页缓存
    conn.execute("PRAGMA temp_store=MEMORY")      # 临时表/排序走内存
    conn.execute("PRAGMA mmap_size=268435456")    # 256MB 内存映射
    return conn


def init_db(db_path: str = DB_PATH) -> None:
    conn = connect(db_path)
    try:
        conn.executescript(SCHEMA)
        for table, name, ddl in MIGRATIONS:
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(%s)" % table)}
            if name not in cols:
                conn.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, name, ddl))
        conn.commit()
        migrate_images(conn)
        migrate_image_table(conn)
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# 图片文件存储（v0.15）
# --------------------------------------------------------------------------- #
def db_path_of(conn: sqlite3.Connection) -> str:
    """从连接上取主库文件路径。图片目录跟着库文件走，测试用临时库也不会污染项目。"""
    for row in conn.execute("PRAGMA database_list").fetchall():
        if row[1] == "main":
            return row[2] or ""
    return ""


def image_dir(db_path: str = "") -> str:
    base = os.path.dirname(os.path.abspath(db_path or DB_PATH))
    return os.path.join(base, IMAGE_DIR_NAME)


def image_url(name: str) -> str:
    return ("/api/images/" + name) if name else ""


def _decode_image(data_url: str) -> tuple:
    """校验 Data URL 并解码，返回 (原始字节, 扩展名)。"""
    match = re.match(r"^data:image/([a-zA-Z0-9.+-]+);base64,(.*)$", data_url, re.S)
    if not match:
        raise ValidationError("图片必须是 data:image/...;base64,... 格式")
    subtype = match.group(1).lower()
    ext = IMAGE_EXTS.get(subtype)
    if not ext:
        raise ValidationError("不支持的图片格式: %s（只支持 png/jpeg/gif/webp/bmp）" % subtype)
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise ValidationError("图片 base64 解码失败")
    if not raw:
        raise ValidationError("图片内容为空")
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValidationError("图片过大（解码后上限 2MB）")
    if not raw.startswith(IMAGE_MAGIC[ext]):
        raise ValidationError("图片内容与声明的格式不符")
    if ext == "webp" and raw[8:12] != b"WEBP":
        raise ValidationError("图片内容与声明的格式不符")
    return raw, ext


def save_image(data_url: str, conn: sqlite3.Connection) -> str:
    """把 Data URL 写进 images/，返回文件名；空值返回 ''。内容相同复用同一文件。"""
    data_url = (data_url or "").strip()
    if not data_url:
        return ""
    raw, ext = _decode_image(data_url)
    name = hashlib.sha256(raw).hexdigest()[:32] + "." + ext
    target = os.path.join(image_dir(db_path_of(conn)), name)
    if not os.path.exists(target):
        os.makedirs(os.path.dirname(target), exist_ok=True)
        tmp = target + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(raw)
        os.replace(tmp, target)
    return name


def migrate_images(conn: sqlite3.Connection) -> int:
    """把旧库里 base64 的 image_data 搬到文件并清空该列。返回迁移条数。"""
    rows = conn.execute(
        "SELECT id, image_data FROM mistakes "
        "WHERE image_data <> '' AND (image_file IS NULL OR image_file = '')").fetchall()
    moved = 0
    for row in rows:
        try:
            name = save_image(row["image_data"], conn)
        except ValidationError:
            continue   # 坏数据保留原样，不因一张图挡住启动
        if name:
            conn.execute("UPDATE mistakes SET image_file = ?, image_data = '' WHERE id = ?",
                         (name, row["id"]))
            moved += 1
    if moved:
        conn.commit()
    return moved


def migrate_image_table(conn: sqlite3.Connection) -> int:
    """把老库的 image_file 补进 mistake_images（一张图的老记录）。返回补的条数。"""
    rows = conn.execute(
        "SELECT id, image_file FROM mistakes WHERE image_file <> '' "
        "AND NOT EXISTS (SELECT 1 FROM mistake_images WHERE mistake_id = mistakes.id)"
    ).fetchall()
    for row in rows:
        conn.execute(
            "INSERT INTO mistake_images (mistake_id, file, sort, created_at) VALUES (?,?,0,?)",
            (row["id"], row["image_file"], now_str()))
    if rows:
        conn.commit()
    return len(rows)


def images_of(conn: sqlite3.Connection, mid: int) -> list:
    """一道题的全部图片，按 sort 排序。老记录没有子表行时回落到 image_file。"""
    rows = conn.execute(
        "SELECT file FROM mistake_images WHERE mistake_id = ? ORDER BY sort, id", (mid,)).fetchall()
    files = [r["file"] for r in rows]
    if not files:
        legacy = conn.execute("SELECT image_file FROM mistakes WHERE id = ?", (mid,)).fetchone()
        if legacy is not None and legacy["image_file"]:
            files = [legacy["image_file"]]
    return [{"file": name, "url": image_url(name)} for name in files]


def _set_images(conn: sqlite3.Connection, mid: int, files) -> None:
    """整组替换某道题的图片行（调用方负责提交事务）。"""
    conn.execute("DELETE FROM mistake_images WHERE mistake_id = ?", (mid,))
    now = now_str()
    for index, name in enumerate(files):
        conn.execute(
            "INSERT INTO mistake_images (mistake_id, file, sort, created_at) VALUES (?,?,?,?)",
            (mid, name, index, now))


def _apply_images(conn: sqlite3.Connection, data: dict, base_files) -> list:
    """按 normalize 的结果落盘图片，返回最终的文件名列表。

    images 里既可能是新图的 Data URL，也可能是已存在图片的文件名（表示保留）。
    没带 images 时沿用 base_files。
    """
    changed = data.pop("images_changed", False)
    raw = data.pop("images", None)
    if not changed:
        return list(base_files or [])
    files = []
    for entry in (raw or []):
        if entry.startswith("data:image/"):
            files.append(save_image(entry, conn))
        else:
            files.append(entry)
    return files


def one(params: dict, key: str, default: str = "") -> str:
    """取单个参数值。

    HTTP 走 parse_qs，值是 list；CLI（mb.py）直接传标量字符串。
    早先只处理 list，标量会被 values[0] 截成首字（--q 极限 只搜「极」）。
    """
    values = params.get(key)
    if isinstance(values, (list, tuple)):
        return values[0] if values else default
    if values is None or values == "":
        return default
    return str(values)


def to_int(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------------------- #
# 数据读写
# --------------------------------------------------------------------------- #
def row_to_dict(row: sqlite3.Row, include_image: bool = False) -> dict:
    data = dict(row)
    name = data.pop("image_file", "") or ""
    data.pop("image_data", None)   # 旧字段不再外泄
    if include_image:
        data["has_image"] = bool(name)
        if name:
            data["image_url"] = image_url(name)
    else:
        data["has_image"] = bool(row["has_image"]) if "has_image" in row.keys() else bool(name)
    return data


def get_mistake(conn: sqlite3.Connection, mid: int) -> dict:
    row = conn.execute("SELECT * FROM mistakes WHERE id = ?", (mid,)).fetchone()
    if row is None:
        raise NotFound("错题不存在: id=%d" % mid)
    data = row_to_dict(row, include_image=True)
    data["images"] = images_of(conn, mid)
    return data


def normalize(body: dict, base: dict | None = None) -> dict:
    """校验并归一化可编辑字段。base 提供更新时的兜底值。"""
    base = base or {}

    def text(key: str, default: str = "") -> str:
        value = body[key] if key in body else base.get(key, default)
        if value is None:
            value = default
        if not isinstance(value, str):
            raise ValidationError("字段 %s 必须是字符串" % key)
        return value.strip()

    subject = text("subject") or "未分类"
    question = text("question")
    if not question:
        raise ValidationError("题目内容不能为空")
    if len(question) > 20000:
        raise ValidationError("题目内容过长（上限 20000 字）")

    status = text("status", "new") or "new"
    if status not in STATUSES:
        raise ValidationError("状态只能是 new / reviewing / mastered")

    mistake_type = text("mistake_type")
    if mistake_type and mistake_type not in MISTAKE_TYPES:
        raise ValidationError("错因分类只能是: " + " / ".join(MISTAKE_TYPES))

    source = text("source")
    if len(source) > 100:
        raise ValidationError("来源过长（上限 100 字）")

    raw_difficulty = body["difficulty"] if "difficulty" in body else base.get("difficulty", 3)
    try:
        difficulty = int(raw_difficulty)
    except (TypeError, ValueError):
        raise ValidationError("难度必须是 1-5 的整数")
    if not 1 <= difficulty <= 5:
        raise ValidationError("难度必须在 1-5 之间")

    raw_tags = text("tags")
    tags = ",".join(t.strip() for t in re.split(r"[,，\s]+", raw_tags) if t.strip())

    # 图片（v0.20 起多张）：请求里带了 images 才算"改图"。
    # 元素可以是新图的 Data URL，也可以是已有图片的文件名（表示保留这张）。
    # 没带 images 就沿用 base 的图片；空数组表示全部删掉。
    # 老客户端仍可只传 image_data（单张），等价于 images:[那张]。
    if "images" in body:
        raw_images = body.get("images")
        if raw_images is None:
            raw_images = []
        if not isinstance(raw_images, list):
            raise ValidationError("images 必须是数组")
        images_changed = True
    elif "image_data" in body:
        legacy = body.get("image_data") or ""
        if not isinstance(legacy, str):
            raise ValidationError("image_data 必须是字符串")
        legacy = legacy.strip()
        raw_images = [legacy] if legacy else []
        images_changed = True
    else:
        raw_images = None
        images_changed = False

    if raw_images is not None:
        if len(raw_images) > MAX_IMAGES:
            raise ValidationError("图片最多 %d 张" % MAX_IMAGES)
        cleaned = []
        for entry in raw_images:
            if not isinstance(entry, str):
                raise ValidationError("images 的元素必须是字符串")
            entry = entry.strip()
            if not entry:
                continue
            if entry.startswith("data:image/"):
                if len(entry) > MAX_IMAGE_CHARS:
                    raise ValidationError("单张图片过大（上限约 2MB）")
            elif not IMAGE_NAME_RE.match(entry):
                raise ValidationError("图片标识不合法: %s" % entry[:40])
            cleaned.append(entry)
        raw_images = cleaned

    paper_id = body["paper_id"] if "paper_id" in body else base.get("paper_id", 0)
    paper_id = to_int(paper_id, 0)
    if paper_id < 0:
        paper_id = 0

    return {
        "subject": subject,
        "question": question,
        "answer": text("answer"),
        "analysis": text("analysis"),
        "my_answer": text("my_answer"),
        "error_reason": text("error_reason"),
        "mistake_type": mistake_type,
        "source": source,
        "knowledge": text("knowledge"),
        "tags": tags,
        "difficulty": difficulty,
        "status": status,
        "paper_id": paper_id,
        "images": raw_images,
        "images_changed": images_changed,
    }


def _find_recent_duplicate(conn: sqlite3.Connection, question: str):
    """3 秒内相同题目 -> 视为重复提交，返回已有记录。"""
    since = (datetime.now() - timedelta(seconds=DEDUP_WINDOW_SEC)).strftime("%Y-%m-%d %H:%M:%S")
    return conn.execute(
        "SELECT id FROM mistakes WHERE question = ? AND created_at >= ? "
        "ORDER BY id DESC LIMIT 1", (question, since)).fetchone()


def _check_paper(conn: sqlite3.Connection, paper_id: int) -> int:
    """试卷必须真实存在；0 表示不归卷。"""
    if not paper_id:
        return 0
    row = conn.execute("SELECT id FROM papers WHERE id = ?", (paper_id,)).fetchone()
    if row is None:
        raise ValidationError("试卷不存在: id=%d" % paper_id)
    return paper_id


def create_mistake(conn: sqlite3.Connection, body: dict) -> dict:
    data = normalize(body)
    data["knowledge"] = resolve_knowledge(conn, data["knowledge"])
    data["paper_id"] = _check_paper(conn, data["paper_id"])
    files = _apply_images(conn, data, [])
    data["image_file"] = files[0] if files else ""
    dup = _find_recent_duplicate(conn, data["question"])
    if dup is not None:
        item = get_mistake(conn, dup["id"])
        item["duplicate"] = True
        return item

    now = now_str()
    cur = conn.execute(
        "INSERT INTO mistakes (subject, question, answer, analysis, my_answer, error_reason, "
        "mistake_type, source, knowledge, tags, difficulty, status, image_file, paper_id, "
        "review_count, stage, last_reviewed_at, next_review_at, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,NULL,?,?,?)",
        (data["subject"], data["question"], data["answer"], data["analysis"], data["my_answer"],
         data["error_reason"], data["mistake_type"], data["source"], data["knowledge"],
         data["tags"], data["difficulty"], data["status"], data["image_file"], data["paper_id"],
         now, now, now),
    )
    _set_images(conn, cur.lastrowid, files)
    conn.commit()
    append_event(conn, "created", id=cur.lastrowid, subject=data["subject"],
                 knowledge=data["knowledge"], mistake_type=data["mistake_type"],
                 source=data["source"], question=data["question"][:80])
    return get_mistake(conn, cur.lastrowid)


# 批量导入的键名别名：中文为主，顺带兼容英文与常见写法
BATCH_KEYS = {
    "题目": "question", "题干": "question", "question": "question",
    "答案": "answer", "正确答案": "answer", "answer": "answer",
    "解析": "analysis", "解题过程": "analysis", "分析": "analysis", "analysis": "analysis",
    "我的答案": "my_answer", "错答": "my_answer", "my_answer": "my_answer",
    "错因": "error_reason", "错因描述": "error_reason", "error_reason": "error_reason",
    "错因分类": "mistake_type", "类型": "mistake_type", "mistake_type": "mistake_type",
    "来源": "source", "source": "source",
    "知识点": "knowledge", "knowledge": "knowledge",
    "标签": "tags", "tags": "tags",
    "学科": "subject", "subject": "subject",
    "难度": "difficulty", "difficulty": "difficulty",
    "状态": "status", "status": "status",
}


def parse_batch_text(text: str) -> list:
    """把「--- 分块 + 键: 值」的纯文本拆成待入库的 dict 列表。

    刻意用规则而不是 AI：录入必须可预期、可离线、出错能定位到第几块。
    一行 `---` 分一条；块内 `键: 值`；不带键的行视为上一条键的续行。
    整个块都没有键时，整块当题目。
    """
    if not isinstance(text, str):
        raise ValidationError("批量文本必须是字符串")
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    def key_of(line: str):
        """一行若是可识别的「键: 值」，返回规范键名，否则 None。"""
        match = re.match(r"^([^:：]{1,12})[:：]\s*(.*)$", line.strip())
        return BATCH_KEYS.get(match.group(1).strip()) if match else None

    blocks, cur, cur_keys = [], [], set()

    def flush():
        nonlocal cur, cur_keys
        blocks.append(cur)
        cur, cur_keys = [], set()

    for index, line in enumerate(lines):
        if line.strip() == "---":
            flush()
            continue
        if not line.strip():
            # 空行也当分条符——但只在下一非空行是「本块已出现过的键」时，
            # 否则它是字段内部的空行（长题干分段），不能拆。
            nxt = ""
            for later in lines[index + 1:]:
                if later.strip():
                    nxt = later
                    break
            key = key_of(nxt) if nxt else None
            if key and key in cur_keys:
                flush()
                continue
            cur.append(line)
            continue
        key = key_of(line)
        if key:
            cur_keys.add(key)
        cur.append(line)
    flush()

    items = []
    for block in blocks:
        fields, loose, last = {}, [], None
        for line in block:
            stripped = line.strip()
            if not stripped:
                last = None
                continue
            match = re.match(r"^([^:：]{1,12})[:：]\s*(.*)$", stripped)
            key = BATCH_KEYS.get(match.group(1).strip()) if match else None
            if key:
                fields[key] = match.group(2).strip()
                last = key
            elif last and not loose:
                fields[last] = (fields[last] + "\n" + stripped).strip()
            else:
                loose.append(stripped)
        if loose:
            if fields.get("question"):
                fields["question"] = (fields["question"] + "\n" + "\n".join(loose)).strip()
            else:
                fields["question"] = "\n".join(loose)
        if fields:
            items.append(fields)
    return items


def create_mistakes(conn: sqlite3.Connection, items) -> dict:
    """批量入库：逐条校验，单条失败不中断，返回可逐条核对的报告。

    借鉴 Amend 的 report.md 思路——导入必须给「哪条成了、哪条没成、为什么」。
    """
    if not isinstance(items, list):
        raise ValidationError("items 必须是数组")
    if len(items) > 200:
        raise ValidationError("单次最多导入 200 条")
    created, duplicates, errors = [], [], []
    for index, body in enumerate(items):
        if not isinstance(body, dict):
            errors.append({"index": index, "error": "第 %d 条不是对象" % (index + 1)})
            continue
        try:
            item = create_mistake(conn, body)
        except ValidationError as exc:
            errors.append({"index": index, "error": str(exc)})
            continue
        if item.pop("duplicate", False):
            duplicates.append({"index": index, "id": item["id"]})
        else:
            created.append({"index": index, "id": item["id"]})
    return {
        "created": created, "duplicates": duplicates, "errors": errors,
        "created_count": len(created), "duplicate_count": len(duplicates),
        "error_count": len(errors),
    }


def update_mistake(conn: sqlite3.Connection, mid: int, body: dict) -> dict:
    row = conn.execute("SELECT * FROM mistakes WHERE id = ?", (mid,)).fetchone()
    if row is None:
        raise NotFound("错题不存在: id=%d" % mid)
    data = normalize(body, base=dict(row))
    data["knowledge"] = resolve_knowledge(conn, data["knowledge"])
    data["paper_id"] = _check_paper(conn, data["paper_id"])
    base_files = [r["file"] for r in conn.execute(
        "SELECT file FROM mistake_images WHERE mistake_id = ? ORDER BY sort, id", (mid,)).fetchall()]
    if not base_files and row["image_file"]:
        base_files = [row["image_file"]]
    files = _apply_images(conn, data, base_files)
    data["image_file"] = files[0] if files else ""
    conn.execute(
        "UPDATE mistakes SET subject=?, question=?, answer=?, analysis=?, my_answer=?, error_reason=?, "
        "mistake_type=?, source=?, knowledge=?, tags=?, difficulty=?, status=?, image_file=?, "
        "paper_id=?, image_data='', updated_at=? WHERE id=?",
        (data["subject"], data["question"], data["answer"], data["analysis"], data["my_answer"],
         data["error_reason"], data["mistake_type"], data["source"], data["knowledge"],
         data["tags"], data["difficulty"], data["status"], data["image_file"], data["paper_id"],
         now_str(), mid),
    )
    _set_images(conn, mid, files)
    conn.commit()
    return get_mistake(conn, mid)


def _snapshot_for_trash(conn: sqlite3.Connection, mid: int):
    """取一行错题 + 它的复习日志，供回收站存档。返回 (row_dict, logs) 或 None。"""
    row = conn.execute("SELECT * FROM mistakes WHERE id = ?", (mid,)).fetchone()
    if row is None:
        return None
    logs = [dict(r) for r in conn.execute(
        "SELECT result, rating, stage, interval_days, fsrs_stability, fsrs_difficulty, reviewed_at "
        "FROM review_logs WHERE mistake_id = ? ORDER BY id", (mid,)).fetchall()]
    return dict(row), logs


def _push_trash(conn: sqlite3.Connection, mid: int) -> bool:
    snap = _snapshot_for_trash(conn, mid)
    if snap is None:
        return False
    row, logs = snap
    conn.execute(
        "INSERT INTO trash (mistake_id, subject, question, payload, logs, deleted_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (mid, row["subject"], row["question"],
         json.dumps(row, ensure_ascii=False), json.dumps(logs, ensure_ascii=False), now_str()))
    return True


def _prune_trash(conn: sqlite3.Connection, keep: int = TRASH_KEEP) -> None:
    conn.execute("DELETE FROM trash WHERE id NOT IN "
                 "(SELECT id FROM trash ORDER BY id DESC LIMIT ?)", (max(keep, 1),))


def delete_mistake(conn: sqlite3.Connection, mid: int) -> None:
    """删除 = 先把整行快照进回收站，再物理删。可随时从 /api/trash 恢复。"""
    if not _push_trash(conn, mid):
        raise NotFound("错题不存在: id=%d" % mid)
    conn.execute("DELETE FROM mistakes WHERE id = ?", (mid,))
    conn.execute("DELETE FROM review_logs WHERE mistake_id = ?", (mid,))
    _prune_trash(conn)
    conn.commit()


def delete_mistakes(conn: sqlite3.Connection, ids) -> dict:
    """批量删除。非法 id 忽略，返回真正删掉的条数。"""
    if not isinstance(ids, list) or not ids:
        raise ValidationError("ids 必须是非空数组")
    clean = []
    for raw in ids:
        try:
            clean.append(int(raw))
        except (TypeError, ValueError):
            continue
    if not clean:
        raise ValidationError("ids 中没有合法整数")
    deleted = 0
    for mid in clean:
        if not _push_trash(conn, mid):
            continue
        conn.execute("DELETE FROM mistakes WHERE id = ?", (mid,))
        conn.execute("DELETE FROM review_logs WHERE mistake_id = ?", (mid,))
        deleted += 1
    _prune_trash(conn)
    conn.commit()
    return {"deleted": deleted}


def list_trash(conn: sqlite3.Connection, limit: int = 50) -> dict:
    limit = max(1, min(int(limit), 200))
    rows = conn.execute(
        "SELECT id, mistake_id, subject, question, logs, deleted_at FROM trash "
        "ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    items = []
    for row in rows:
        try:
            log_count = len(json.loads(row["logs"] or "[]"))
        except (TypeError, ValueError):
            log_count = 0
        items.append({"id": row["id"], "mistake_id": row["mistake_id"],
                      "subject": row["subject"], "question": row["question"],
                      "log_count": log_count, "deleted_at": row["deleted_at"]})
    total = conn.execute("SELECT COUNT(*) FROM trash").fetchone()[0]
    return {"items": items, "total": total}


def restore_trash(conn: sqlite3.Connection, trash_id: int) -> dict:
    """从回收站恢复一条：连同复习日志一起写回，原 id 空闲就沿用。"""
    row = conn.execute("SELECT * FROM trash WHERE id = ?", (trash_id,)).fetchone()
    if row is None:
        raise NotFound("回收站里没有这条记录: id=%d" % trash_id)
    try:
        payload = json.loads(row["payload"])
        logs = json.loads(row["logs"] or "[]")
    except (TypeError, ValueError):
        raise ValidationError("回收站记录已损坏，无法恢复")
    if not isinstance(payload, dict) or "id" not in payload:
        raise ValidationError("回收站记录已损坏，无法恢复")

    cols = [c for c in payload if c != "id"]
    values = [payload[c] for c in cols]
    target = int(payload["id"])
    if conn.execute("SELECT 1 FROM mistakes WHERE id = ?", (target,)).fetchone():
        target = None  # AUTOINCREMENT 正常不复用；万一被占用就换新 id
    if target is None:
        cur = conn.execute("INSERT INTO mistakes (%s) VALUES (%s)" % (
            ", ".join(cols), ", ".join("?" * len(cols))), values)
        target = cur.lastrowid
    else:
        conn.execute("INSERT INTO mistakes (id, %s) VALUES (?, %s)" % (
            ", ".join(cols), ", ".join("?" * len(cols))), [target] + values)

    for log in logs:
        if not isinstance(log, dict):
            continue
        conn.execute(
            "INSERT INTO review_logs (mistake_id, result, rating, stage, interval_days, "
            "fsrs_stability, fsrs_difficulty, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (target, log.get("result") or "", int(log.get("rating") or 0),
             int(log.get("stage") or 0), int(log.get("interval_days") or 0),
             float(log.get("fsrs_stability") or 0), float(log.get("fsrs_difficulty") or 0),
             log.get("reviewed_at") or now_str()))
    conn.execute("DELETE FROM trash WHERE id = ?", (trash_id,))
    conn.commit()
    return get_mistake(conn, target)


def purge_trash(conn: sqlite3.Connection, trash_id: int | None = None) -> dict:
    """清空回收站（trash_id 为空）或彻底删除其中一条。"""
    if trash_id is None:
        cur = conn.execute("DELETE FROM trash")
    else:
        cur = conn.execute("DELETE FROM trash WHERE id = ?", (trash_id,))
    conn.commit()
    if trash_id is not None and cur.rowcount == 0:
        raise NotFound("回收站里没有这条记录: id=%d" % trash_id)
    return {"deleted": cur.rowcount}


def trash_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM trash").fetchone()[0]


def set_suspended(conn: sqlite3.Connection, mid: int, suspended: bool = True) -> dict:
    """斩题：把已掌握的题移出复习池，历史全部保留，可随时恢复。"""
    row = conn.execute("SELECT id FROM mistakes WHERE id = ?", (mid,)).fetchone()
    if row is None:
        raise NotFound("错题不存在: id=%d" % mid)
    conn.execute("UPDATE mistakes SET suspended = ?, updated_at = ? WHERE id = ?",
                 (1 if suspended else 0, now_str(), mid))
    conn.commit()
    append_event(conn, "suspended" if suspended else "resumed", id=mid)
    return get_mistake(conn, mid)


def _elapsed_days(last_reviewed_at: str | None, now: datetime) -> float:
    """距上次复习过了多少天；从未复习过返回 0。"""
    if not last_reviewed_at:
        return 0.0
    try:
        last = datetime.strptime(last_reviewed_at, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return 0.0
    return max(0.0, (now - last).total_seconds() / 86400.0)


def _parse_step(body: dict) -> str:
    """这次错在解题流程的哪一步；不填就存空串（不强制，免得录一道题还得先想清楚）。"""
    raw = body.get("step")
    if raw is None:
        return ""
    raw = str(raw).strip()
    if not raw:
        return ""
    if raw not in REVIEW_STEPS:
        raise ValidationError("错在哪一步只能是：%s" % "、".join(REVIEW_STEPS))
    return raw


def _parse_rating(body: dict) -> int:
    """把 result(again/hard/good/easy) 或 rating(1-4) 归一化成 FSRS 评分。"""
    raw = body.get("result")
    if raw is None or raw == "":
        raw = body.get("rating", "good")
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        raw = str(int(raw))
    raw = str(raw).strip().lower()
    if raw in RESULT_RATINGS:
        return RESULT_RATINGS[raw]
    if raw in ("1", "2", "3", "4"):
        return int(raw)
    raise ValidationError("评分只能是 again/hard/good/easy，或 rating 1-4")


def _extract_variant(body: dict):
    """复习时顺带提交的变式题。

    两种写法都认：
      {"variant": {"question": ..., "answer": ...}}
      {"variant_question": ..., "variant_answer": ...}
    """
    raw = body.get("variant")
    if isinstance(raw, dict):
        question = (raw.get("question") or "").strip()
        if question:
            return {"question": question,
                    "answer": (raw.get("answer") or "").strip(),
                    "knowledge": (raw.get("knowledge") or "").strip(),
                    "source": (raw.get("source") or "ai").strip() or "ai"}
    question = (body.get("variant_question") or "").strip()
    if question:
        return {"question": question,
                "answer": (body.get("variant_answer") or "").strip(),
                "knowledge": (body.get("variant_knowledge") or "").strip(),
                "source": "ai"}
    return None


def review_mistake(conn: sqlite3.Connection, mid: int, body: dict) -> dict:
    row = conn.execute("SELECT * FROM mistakes WHERE id = ?", (mid,)).fetchone()
    if row is None:
        raise NotFound("错题不存在: id=%d" % mid)

    step = _parse_step(body)

    # 变式先入库：万一变式不合法，这次复习整体不生效，不留半条记录
    variant = _extract_variant(body)
    if variant is not None:
        variant = create_variant(conn, mid, variant, dedup=True)
        if not variant.get("duplicate"):
            # 新存的这道变式就是本次练习用的，记一次使用
            variant = use_variant(conn, variant["id"])

    now = datetime.now()
    stamp = now.strftime("%Y-%m-%d %H:%M:%S")
    stage = int(row["stage"] or 0)

    # 掌握是"暂停复习"，不是一次记忆评分，所以不参与 FSRS 状态更新
    raw = str(body.get("result") or "").strip().lower()
    if raw == "mastered":
        conn.execute(
            "UPDATE mistakes SET status='mastered', next_review_at=NULL, "
            "review_count=review_count+1, last_reviewed_at=?, updated_at=? WHERE id=?",
            (stamp, stamp, mid))
        conn.execute(
            "INSERT INTO review_logs (mistake_id, result, rating, stage, interval_days, "
            "fsrs_stability, fsrs_difficulty, step, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (mid, "mastered", 0, stage, 0,
             float(row["fsrs_stability"] or 0), float(row["fsrs_difficulty"] or 0),
             step, stamp))
        conn.commit()
        append_event(conn, "mastered", id=mid, step=step, knowledge=row["knowledge"],
                     subject=row["subject"])
        item = get_mistake(conn, mid)
        item["variant"] = variant
        return item

    rating = _parse_rating(body)
    elapsed = _elapsed_days(row["last_reviewed_at"], now)
    result = fsrs.schedule(
        float(row["fsrs_stability"] or 0),
        float(row["fsrs_difficulty"] or 0),
        int(row["fsrs_reps"] or 0),
        int(row["fsrs_lapses"] or 0),
        rating, elapsed)

    interval = result["interval_days"]
    next_at = (now + timedelta(days=interval)).strftime("%Y-%m-%d %H:%M:%S")
    stage = 0 if rating == 1 else stage + 1

    conn.execute(
        "UPDATE mistakes SET status='reviewing', review_count=review_count+1, stage=?, "
        "fsrs_stability=?, fsrs_difficulty=?, fsrs_reps=?, fsrs_lapses=?, "
        "last_reviewed_at=?, next_review_at=?, updated_at=? WHERE id=?",
        (stage, result["stability"], result["difficulty"], result["reps"],
         result["lapses"], stamp, next_at, stamp, mid),
    )
    conn.execute(
        "INSERT INTO review_logs (mistake_id, result, rating, stage, interval_days, "
        "fsrs_stability, fsrs_difficulty, step, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (mid, {1: "again", 2: "hard", 3: "good", 4: "easy"}[rating], rating, stage,
         interval, result["stability"], result["difficulty"], step, stamp),
    )
    conn.commit()
    append_event(conn, "reviewed", id=mid, rating=rating,
                 result={1: "again", 2: "hard", 3: "good", 4: "easy"}[rating],
                 step=step, interval_days=interval, next_review_at=next_at,
                 knowledge=row["knowledge"], subject=row["subject"])
    item = get_mistake(conn, mid)
    item["variant"] = variant
    return item


def preview_review(conn: sqlite3.Connection, mid: int) -> dict:
    """四档评分各自会排到多少天后，供前端显示。"""
    row = conn.execute("SELECT * FROM mistakes WHERE id = ?", (mid,)).fetchone()
    if row is None:
        raise NotFound("错题不存在: id=%d" % mid)
    elapsed = _elapsed_days(row["last_reviewed_at"], datetime.now())
    plan = fsrs.preview(float(row["fsrs_stability"] or 0),
                        float(row["fsrs_difficulty"] or 0),
                        int(row["fsrs_reps"] or 0),
                        int(row["fsrs_lapses"] or 0), elapsed)
    return {"preview": plan,
            "retrievability": None if not row["fsrs_stability"] else round(
                fsrs.retrievability(elapsed, float(row["fsrs_stability"])), 4)}


def get_reviews(conn: sqlite3.Connection, mid: int) -> dict:
    if conn.execute("SELECT 1 FROM mistakes WHERE id = ?", (mid,)).fetchone() is None:
        raise NotFound("错题不存在: id=%d" % mid)
    rows = conn.execute(
        "SELECT id, result, rating, stage, interval_days, fsrs_stability, "
        "fsrs_difficulty, step, reviewed_at FROM review_logs "
        "WHERE mistake_id = ? ORDER BY id DESC", (mid,)).fetchall()
    items = [dict(r) for r in rows]
    # 掌握不算对错；hard/good/easy 算答对，again 算答错
    graded = [r for r in items if r["rating"] in (1, 2, 3, 4)]
    correct = sum(1 for r in graded if r["rating"] >= 2)
    return {"items": items, "total": len(items), "graded": len(graded),
            "correct": correct,
            "accuracy": round(correct / len(graded), 3) if graded else None}


# --------------------------------------------------------------------------- #
# 复习提醒（v0.9）：把 next_review_at 变成「会主动说话」的东西
# --------------------------------------------------------------------------- #
def reminders(conn: sqlite3.Connection) -> dict:
    """到期/逾期/今日数量 + 最紧急的几道 + 一句人话，供 CLI / 前端横幅 / 邮件共用。"""
    now = datetime.now()
    stamp = now.strftime("%Y-%m-%d %H:%M:%S")
    today_start = now.strftime("%Y-%m-%d 00:00:00")
    tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d 00:00:00")

    base = ("FROM mistakes WHERE suspended = 0 AND status <> 'mastered' "
            "AND next_review_at IS NOT NULL")

    # v0.14：三次全表 COUNT 合成一次（原来 3 次扫描同一批行）
    counts = conn.execute(
        "SELECT SUM(CASE WHEN next_review_at <= ? THEN 1 ELSE 0 END) AS due, "
        "SUM(CASE WHEN next_review_at < ? THEN 1 ELSE 0 END) AS overdue, "
        "SUM(CASE WHEN next_review_at >= ? AND next_review_at < ? THEN 1 ELSE 0 END) AS today "
        + base, (stamp, today_start, today_start, tomorrow)).fetchone()
    due = counts["due"] or 0
    overdue = counts["overdue"] or 0
    today = counts["today"] or 0
    next_at = conn.execute("SELECT MIN(next_review_at) " + base + " AND next_review_at > ?",
                           (stamp,)).fetchone()[0]

    rows = conn.execute(
        "SELECT id, subject, knowledge, question, next_review_at, status " + base +
        " AND next_review_at <= ? ORDER BY next_review_at ASC, id ASC LIMIT ?",
        (stamp, REMINDER_TOP)).fetchall()
    top = []
    for row in rows:
        item = dict(row)
        item["question"] = (item["question"] or "").replace("\n", " ")[:60]
        top.append(item)

    if due == 0:
        message = "今天没有到期的错题"
        if next_at:
            message += "，最近一次在 %s" % next_at
    else:
        message = "今天有 %d 道错题到期" % due
        if overdue:
            message += "，其中 %d 道已逾期" % overdue
    return {"now": stamp, "due": due, "overdue": overdue, "today": today,
            "next_at": next_at, "top": top, "message": message,
            "should_notify": due > 0}


# --------------------------------------------------------------------------- #
# 变式题库（v0.4，借鉴 DeepTutor 的 Question Bank）
# --------------------------------------------------------------------------- #
def get_variant(conn: sqlite3.Connection, vid: int) -> dict:
    row = conn.execute("SELECT * FROM variants WHERE id = ?", (vid,)).fetchone()
    if row is None:
        raise NotFound("变式题不存在: id=%d" % vid)
    return dict(row)


def _variant_fingerprint(question: str) -> str:
    """变式题去重指纹：去掉所有空白再比较，避免只差换行/空格被当成两道题。"""
    return re.sub(r"\s+", "", question or "")


def create_variant(conn: sqlite3.Connection, parent_id: int, body: dict,
                   dedup: bool = False) -> dict:
    """存一道变式。dedup=True 时若同题已存在，返回它并记一次「刚练过」。"""
    if conn.execute("SELECT 1 FROM mistakes WHERE id = ?", (parent_id,)).fetchone() is None:
        raise NotFound("错题不存在: id=%d" % parent_id)

    question = (body.get("question") or "").strip()
    if not question:
        raise ValidationError("变式题题目不能为空")
    if len(question) > 20000:
        raise ValidationError("变式题题目过长（上限 20000 字）")

    if dedup:
        want = _variant_fingerprint(question)
        for row in conn.execute("SELECT id, question FROM variants WHERE parent_id = ?",
                                (parent_id,)):
            if _variant_fingerprint(row["question"]) == want:
                existing = use_variant(conn, row["id"])
                existing["duplicate"] = True
                return existing

    count = conn.execute("SELECT COUNT(*) FROM variants WHERE parent_id = ?",
                         (parent_id,)).fetchone()[0]
    if count >= MAX_VARIANTS_PER_MISTAKE:
        raise ValidationError("单题变式上限 %d 条，请先清理" % MAX_VARIANTS_PER_MISTAKE)

    answer = (body.get("answer") or "").strip()
    knowledge = (body.get("knowledge") or "").strip()
    if not knowledge:
        parent = conn.execute("SELECT knowledge FROM mistakes WHERE id = ?",
                              (parent_id,)).fetchone()
        knowledge = (parent["knowledge"] or "") if parent else ""
    source = (body.get("source") or "ai").strip() or "ai"

    cur = conn.execute(
        "INSERT INTO variants (parent_id, question, answer, knowledge, source, "
        "times_used, last_used_at, created_at) VALUES (?,?,?,?,?,0,NULL,?)",
        (parent_id, question, answer, knowledge, source, now_str()))
    conn.commit()
    return get_variant(conn, cur.lastrowid)


def list_variants(conn: sqlite3.Connection, parent_id: int) -> dict:
    if conn.execute("SELECT 1 FROM mistakes WHERE id = ?", (parent_id,)).fetchone() is None:
        raise NotFound("错题不存在: id=%d" % parent_id)
    rows = conn.execute(
        "SELECT * FROM variants WHERE parent_id = ? ORDER BY times_used ASC, id ASC",
        (parent_id,)).fetchall()
    return {"parent_id": parent_id, "items": [dict(r) for r in rows], "total": len(rows)}


def pick_variant(conn: sqlite3.Connection, parent_id: int) -> dict:
    """挑一道用得最少的变式；没有则返回 next=null，由调用方现场出题。"""
    data = list_variants(conn, parent_id)
    if not data["items"]:
        return {"parent_id": parent_id, "next": None,
                "hint": "该题还没有变式，请现场出一道同知识点的新题，再用 variant add 存下来。"}
    return {"parent_id": parent_id, "next": data["items"][0]}


def use_variant(conn: sqlite3.Connection, vid: int) -> dict:
    get_variant(conn, vid)
    conn.execute("UPDATE variants SET times_used = times_used + 1, last_used_at = ? "
                 "WHERE id = ?", (now_str(), vid))
    conn.commit()
    return get_variant(conn, vid)


def delete_variant(conn: sqlite3.Connection, vid: int) -> None:
    cur = conn.execute("DELETE FROM variants WHERE id = ?", (vid,))
    conn.commit()
    if cur.rowcount == 0:
        raise NotFound("变式题不存在: id=%d" % vid)


def variant_gaps(conn: sqlite3.Connection, limit: int = 20, subject: str = "") -> dict:
    """「最该补变式」的题：变式少的优先，其次错得多、失误次数多。

    离线环境没法凭空生成题目，这个接口做的是**缺口提示**：告诉 agent 该给谁出题。
    """
    limit = min(VARIANT_GAP_LIMIT, max(1, limit))
    sql = ("SELECT m.id, m.subject, m.knowledge, m.question, m.stage, m.status, "
           "m.fsrs_lapses, m.next_review_at, "
           "(SELECT COUNT(*) FROM variants v WHERE v.parent_id = m.id) AS variant_count, "
           "(SELECT COUNT(*) FROM review_logs l WHERE l.mistake_id = m.id "
           " AND l.rating = 1) AS wrong, "
           "(SELECT COUNT(*) FROM review_logs l WHERE l.mistake_id = m.id "
           " AND l.rating >= 2) AS right "
           "FROM mistakes m WHERE m.suspended = 0")
    args = []
    if subject:
        sql += " AND m.subject = ?"
        args.append(subject)
    sql += (" ORDER BY variant_count ASC, wrong DESC, m.fsrs_lapses DESC, m.id DESC "
            "LIMIT ?")
    args.append(limit)

    items = []
    for row in conn.execute(sql, args):
        item = dict(row)
        item["question"] = (item["question"] or "").replace("\n", " ")[:120]
        item["hint"] = ("还没有变式：出一道同知识点的新题，复习回写时用 "
                        "--variant-question 一并存下" if item["variant_count"] == 0
                        else "变式偏少：可再补一道")
        items.append(item)
    return {"items": items, "total": len(items),
            "hint": "按顺序给这些题出变式，复习回写时一并提交，变式库就会自己长大。"}


# --------------------------------------------------------------------------- #
# 掌握门禁 + 学习画像（v0.4，借鉴 DeepTutor 的 mastery gate / 三层记忆）
# --------------------------------------------------------------------------- #
# 熟练度分档（借鉴 agent-tutor-skill 的 stability 徽章）
BANDS = (
    (90.0, "mastered", "已牢固"),
    (14.0, "good", "良好"),
    (3.0, "fair", "一般"),
    (0.0, "weak", "薄弱"),
)


def _band(stability: float) -> dict:
    """按平均稳定性把知识点分成四档，给人一眼能看懂的程度。"""
    s = stability or 0.0
    for floor, key, label in BANDS:
        if s >= floor:
            return {"key": key, "label": label, "stability": round(s, 2)}
    return {"key": "weak", "label": "薄弱", "stability": round(s, 2)}


def _gate(count: int, min_stage: int, min_stability: float):
    """门禁判定，返回 (是否通过, 未通过原因列表)。"""
    reasons = []
    if count < MASTERY_MIN_MISTAKES:
        reasons.append("题目不足 %d 道（现有 %d 道）" % (MASTERY_MIN_MISTAKES, count))
    if (min_stage or 0) < MASTERY_MIN_STAGE:
        reasons.append("有题未连续答对 %d 次（最低 %d 次）" % (MASTERY_MIN_STAGE, min_stage or 0))
    if (min_stability or 0) < MASTERY_MIN_STABILITY:
        reasons.append("有题稳定性不足 %g 天（最低 %g 天）"
                       % (MASTERY_MIN_STABILITY, round(min_stability or 0, 2)))
    return (not reasons), reasons


# --------------------------------------------------------------------------- #
# 知识点树（v0.9）
#   - knowledge 字段本身就是路径："函数/二次函数" -> 父节点 函数，叶子 二次函数
#   - 不建 parent 表：层级从字符串派生，改层级只需改字符串，零迁移
#   - knowledge_aliases 只负责「异体写法 -> 规范名」的归并（二次函數 -> 函数/二次函数）
# --------------------------------------------------------------------------- #
def normalize_knowledge_path(name: str) -> str:
    """把 "函数 / 二次函数" 归一成 "函数/二次函数"；半角/全角斜杠都认。"""
    if not isinstance(name, str):
        return ""
    parts = [re.sub(r"\s+", " ", seg).strip() for seg in re.split(r"[/／]", name)]
    parts = [seg for seg in parts if seg]
    if len(parts) > KNOWLEDGE_MAX_DEPTH:
        raise ValidationError("知识点层级最多 %d 级" % KNOWLEDGE_MAX_DEPTH)
    for seg in parts:
        if len(seg) > KNOWLEDGE_SEGMENT_MAX:
            raise ValidationError("知识点单段名字过长（上限 %d 字）" % KNOWLEDGE_SEGMENT_MAX)
    return "/".join(parts)


def resolve_knowledge(conn: sqlite3.Connection, name: str) -> str:
    """别名 -> 规范名。支持别名链，最多 KNOWLEDGE_ALIAS_HOPS 跳，遇环即停。"""
    path = normalize_knowledge_path(name)
    if not path:
        return ""
    seen = set()
    for _ in range(KNOWLEDGE_ALIAS_HOPS):
        if path in seen:
            break
        seen.add(path)
        row = conn.execute("SELECT canonical FROM knowledge_aliases WHERE alias = ?",
                           (path,)).fetchone()
        if row is None:
            break
        path = normalize_knowledge_path(row["canonical"])
    return path


def list_aliases(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("SELECT alias, canonical, created_at FROM knowledge_aliases "
                        "ORDER BY canonical, alias").fetchall()
    items = [dict(r) for r in rows]
    return {"items": items, "total": len(items)}


def set_alias(conn: sqlite3.Connection, alias: str, canonical: str) -> dict:
    """登记别名。先解析 canonical，再反查是否成环，最后 upsert。"""
    alias = normalize_knowledge_path(alias)
    raw_canonical = normalize_knowledge_path(canonical)
    canonical = resolve_knowledge(conn, raw_canonical)
    if not alias or not canonical:
        raise ValidationError("别名和规范名都不能为空")
    if alias == raw_canonical:
        raise ValidationError("别名不能等于规范名")
    # 顺着别名链往上走，撞到 alias 就是环（例如已有 A->B，再登记 B->A）
    probe, seen = canonical, set()
    while probe and probe not in seen:
        if probe == alias:
            raise ValidationError("别名会形成环：%s -> %s" % (alias, canonical))
        seen.add(probe)
        row = conn.execute("SELECT canonical FROM knowledge_aliases WHERE alias = ?",
                           (probe,)).fetchone()
        probe = normalize_knowledge_path(row["canonical"]) if row else ""
    conn.execute("INSERT INTO knowledge_aliases (alias, canonical, created_at) VALUES (?,?,?) "
                 "ON CONFLICT(alias) DO UPDATE SET canonical = excluded.canonical",
                 (alias, canonical, now_str()))
    conn.commit()
    return {"alias": alias, "canonical": canonical}


def delete_alias(conn: sqlite3.Connection, alias: str) -> None:
    cur = conn.execute("DELETE FROM knowledge_aliases WHERE alias = ?",
                       (normalize_knowledge_path(alias),))
    conn.commit()
    if cur.rowcount == 0:
        raise NotFound("别名不存在: %s" % alias)


_EMPTY_TREE_STATS = {"mistakes": 0, "due": 0, "graded": 0, "correct": 0, "lapses": 0,
                     "mastered": 0, "reviews": 0, "ids": [],
                     "min_stage": None, "min_stability": None}


def _merge_tree_stats(a, b):
    """把 b 并入 a。题量/次数求和，min_stage/min_stability 取最严（最弱的那道题）。"""
    if a is None:
        return {**b, "ids": list(b["ids"])}
    for key in ("mistakes", "due", "graded", "correct", "lapses", "mastered", "reviews"):
        a[key] += b[key]
    a["ids"].extend(b["ids"])
    for key in ("min_stage", "min_stability"):
        if b[key] is not None:
            a[key] = b[key] if a[key] is None else min(a[key], b[key])
    return a


def knowledge_tree(conn: sqlite3.Connection, subject: str = "") -> dict:
    """把扁平 knowledge 按 "/" 聚合成树；父节点汇总子节点，口径与 _knowledge_points 一致。"""
    points = _knowledge_points(conn, subject)

    roots: dict = {}
    for point in points:
        segments = point["knowledge"].split("/")
        parent = None
        for depth, seg in enumerate(segments):
            bucket = roots if parent is None else parent["children"]
            node = bucket.get(seg)
            if node is None:
                node = {"name": seg, "path": "/".join(segments[:depth + 1]),
                        "own": [], "children": {}}
                bucket[seg] = node
            parent = node
        parent["own"].append(point)

    def build(node):
        stats = None
        for point in node["own"]:
            stats = _merge_tree_stats(stats, {
                "mistakes": point["mistakes"], "due": point["due"],
                "graded": point["graded"], "correct": point["correct"],
                "lapses": point["lapses"], "mastered": point["mastered"],
                "reviews": point["reviews"], "ids": list(point["mistake_ids"]),
                "min_stage": point["min_stage"], "min_stability": point["min_stability"],
            })
        children = [build(child) for child in node["children"].values()]
        for child in children:
            stats = _merge_tree_stats(stats, child["stats"])
        stats = stats or dict(_EMPTY_TREE_STATS, ids=[])
        passed, reasons = _gate(stats["mistakes"], stats["min_stage"] or 0,
                                stats["min_stability"] or 0)
        accuracy = (round(stats["correct"] / stats["graded"], 3)
                    if stats["graded"] else None)
        children.sort(key=lambda n: (-n["stats"]["mistakes"], n["path"]))
        return {
            "name": node["name"],
            "path": node["path"],
            "own_mistakes": sum(p["mistakes"] for p in node["own"]),
            "children": children,
            "stats": {
                **stats,
                "accuracy": accuracy,
                "band": _band(stats["min_stability"] or 0),
                "mastered_gate": passed,
                "gate_reasons": reasons,
            },
        }

    tree = [build(node) for node in roots.values()]
    tree.sort(key=lambda n: (-n["stats"]["mistakes"], n["path"]))
    unclassified = conn.execute(
        "SELECT COUNT(*) FROM mistakes WHERE knowledge = '' AND suspended = 0").fetchone()[0]
    return {
        "subject": subject or "全部",
        "roots": tree,
        "points_total": len(points),
        "leaf_total": sum(1 for p in points if "/" not in p["knowledge"]),
        "depth_max": max((len(p["knowledge"].split("/")) for p in points), default=0),
        "unclassified": unclassified,
        "note": "knowledge 用 / 表示层级；父节点数字是整棵子树的汇总，min_stability 取最弱那道题。",
    }


def _knowledge_points(conn: sqlite3.Connection, subject: str = "") -> list:
    """按知识点聚合掌握度 + 门禁判定，并附 review_log id 作为证据。

    v0.14：原来是 mistakes LEFT JOIN review_logs 把每一行日志都拉进 Python 去重
    （O(题目数 × 日志数)，50k 行要 864ms）。改成三条 SQL：题目聚合（含 GROUP_CONCAT(id)）、
    日志按知识点聚合、证据每个点取最后 5 条，靠 knowledge 索引把每步压到毫秒级。
    输出字段与顺序保持原样，调用方（mastery/profile/analytics/knowledge_tree/stats）不用改。
    """
    where = "WHERE m.knowledge <> '' AND m.suspended = 0"
    args = []
    if subject:
        where += " AND m.subject = ?"
        args.append(subject)

    rows = conn.execute(
        "SELECT m.knowledge AS k, COUNT(*) AS mistakes, MIN(m.stage) AS min_stage, "
        "MIN(m.fsrs_stability) AS min_stability, AVG(m.fsrs_stability) AS avg_stability, "
        "SUM(m.fsrs_lapses) AS lapses, "
        "SUM(CASE WHEN m.status='mastered' THEN 1 ELSE 0 END) AS mastered, "
        "SUM(CASE WHEN m.status<>'mastered' AND m.next_review_at IS NOT NULL "
        "         AND m.next_review_at <= ? THEN 1 ELSE 0 END) AS due, "
        "GROUP_CONCAT(m.id) AS ids "
        "FROM mistakes m " + where + " GROUP BY m.knowledge ORDER BY mistakes DESC, k",
        (now_str(), *args)).fetchall()

    log_stats = {}
    for r in conn.execute(
            "SELECT m.knowledge AS k, COUNT(l.id) AS reviews, "
            "SUM(CASE WHEN l.rating BETWEEN 1 AND 4 THEN 1 ELSE 0 END) AS graded, "
            "SUM(CASE WHEN l.rating >= 2 THEN 1 ELSE 0 END) AS correct "
            "FROM mistakes m LEFT JOIN review_logs l ON l.mistake_id = m.id "
            + where + " GROUP BY m.knowledge", args):
        log_stats[r["k"]] = (r["reviews"] or 0, r["graded"] or 0, r["correct"] or 0)

    # 证据：每个知识点最近 5 条日志 id（知识点只有几十个，逐点查走 knowledge 索引）
    ev_sql = ("SELECT l.id FROM review_logs l JOIN mistakes m ON m.id = l.mistake_id "
              + where + " ORDER BY l.id DESC LIMIT 5")
    evidence = {}
    for r in rows:
        k = r["k"]
        if log_stats.get(k, (0, 0, 0))[0]:
            evidence[k] = [x[0] for x in conn.execute(ev_sql, args)][::-1]

    points = []
    for r in rows:
        k = r["k"]
        count = r["mistakes"]
        passed, reasons = _gate(count, r["min_stage"], r["min_stability"])
        reviews, gd, correct = log_stats.get(k, (0, 0, 0))
        points.append({
            "knowledge": k,
            "mistakes": count,
            "mistake_ids": [int(x) for x in (r["ids"] or "").split(",") if x],
            "reviews": reviews,
            "graded": gd,
            "correct": correct,
            "accuracy": round(correct / gd, 3) if gd else None,
            "avg_stability": round(r["avg_stability"] or 0, 2),
            "band": _band(r["avg_stability"] or 0),
            "min_stability": round(r["min_stability"] or 0, 2),
            "min_stage": r["min_stage"] or 0,
            "lapses": r["lapses"] or 0,
            "due": r["due"] or 0,
            "mastered": r["mastered"] or 0,
            "mastered_gate": passed,
            "gate_reasons": reasons,
            "evidence_review_ids": evidence.get(k, [])[-5:],
        })
    return points


def mastery(conn: sqlite3.Connection, subject: str = "") -> dict:
    points = _knowledge_points(conn, subject)
    return {
        "thresholds": {"min_mistakes": MASTERY_MIN_MISTAKES,
                       "min_stage": MASTERY_MIN_STAGE,
                       "min_stability": MASTERY_MIN_STABILITY},
        "bands": {b[1]: b[2] for b in BANDS},
        "band_counts": {b[1]: sum(1 for p in points if p["band"]["key"] == b[1])
                        for b in BANDS},
        "points_total": len(points),
        "passed_total": sum(1 for p in points if p["mastered_gate"]),
        "passed": [p for p in points if p["mastered_gate"]],
        "pending": [p for p in points if not p["mastered_gate"]],
    }


def profile(conn: sqlite3.Connection, subject: str = "", limit: int = 20) -> dict:
    """学习画像：哪里弱、弱到什么程度、证据在哪。给 AI 当提示词上下文用。"""
    points = _knowledge_points(conn, subject)
    total = conn.execute(
        "SELECT COUNT(*) FROM mistakes" + (" WHERE subject = ?" if subject else ""),
        (subject,) if subject else ()).fetchone()[0]
    logs = conn.execute(
        "SELECT COUNT(*) AS total, "
        "SUM(CASE WHEN rating BETWEEN 2 AND 4 THEN 1 ELSE 0 END) AS correct, "
        "SUM(CASE WHEN rating BETWEEN 1 AND 4 THEN 1 ELSE 0 END) AS graded "
        "FROM review_logs").fetchone()
    gd = logs["graded"] or 0
    weak = sorted((p for p in points if p["accuracy"] is not None),
                  key=lambda p: (p["accuracy"], -p["mistakes"]))[:5]
    by_type = [dict(r) for r in conn.execute(
        "SELECT mistake_type, COUNT(*) AS count FROM mistakes WHERE mistake_type <> '' "
        "GROUP BY mistake_type ORDER BY count DESC")]
    return {
        "generated_at": now_str(),
        "scope": subject or "全部",
        "summary": {"total": total, "points": len(points),
                    "points_passed": sum(1 for p in points if p["mastered_gate"]),
                    "reviews": logs["total"] or 0, "graded": gd,
                    "accuracy": round((logs["correct"] or 0) / gd, 3) if gd else None},
        "weak_points": weak,
        "points": points[:limit],
        "by_type": by_type,
        "note": "每条结论都带 evidence_review_ids，指向 review_logs 的具体记录，不要凭空下判断。",
    }


WEEKDAYS_CN = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")


def _day_label(day: datetime, today: datetime) -> str:
    delta = (day.date() - today.date()).days
    if delta == 0:
        return "今天"
    if delta == 1:
        return "明天"
    if delta == 2:
        return "后天"
    return WEEKDAYS_CN[day.weekday()]


def plan(conn: sqlite3.Connection, days: int = 7, limit=None, subject: str = "") -> dict:
    """今日复习计划：把到期题按「每日上限」摊到未来 N 天，逾期优先。

    逾期题按 next_review_at 升序先塞今天，塞不下顺延到明天，依次类推；
    这样既不会一天堆 200 道劝退，也不会让逾期题永远沉底。
    """
    days = min(30, max(1, to_int(days, 7)))
    if limit is None:                       # 不传就跟随 settings 里的每日上限
        limit = get_settings(conn).get("daily_limit", DAILY_PLAN_LIMIT)
    limit = min(200, max(1, to_int(limit, DAILY_PLAN_LIMIT)))
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    horizon = today + timedelta(days=days)

    where = ["suspended = 0", "next_review_at IS NOT NULL", "next_review_at < ?"]
    args = [horizon.strftime("%Y-%m-%d %H:%M:%S")]
    if subject:
        where.append("subject = ?")
        args.append(subject)
    rows = conn.execute(
        "SELECT " + LIST_COLUMNS + " FROM mistakes WHERE " + " AND ".join(where) +
        " ORDER BY next_review_at ASC, id ASC", args).fetchall()

    buckets = [[] for _ in range(days)]
    overflow = 0
    for row in rows:
        due = datetime.strptime(row["next_review_at"], "%Y-%m-%d %H:%M:%S")
        start = max(0, min(days - 1, (due.date() - today.date()).days))
        for slot in range(start, days):
            if len(buckets[slot]) < limit:
                buckets[slot].append(row_to_dict(row))
                break
        else:
            overflow += 1

    now = now_str()
    out = []
    for i, items in enumerate(buckets):
        day = today + timedelta(days=i)
        out.append({"date": day.strftime("%Y-%m-%d"), "label": _day_label(day, today),
                    "count": len(items), "items": items})
    return {"days": out, "daily_limit": limit, "window_days": days,
            "total": sum(len(b) for b in buckets), "overflow": overflow,
            "overdue": sum(1 for r in rows if r["next_review_at"] <= now),
            "today_count": out[0]["count"] if out else 0}


ARENA_COLUMNS = (
    "id, subject, question, knowledge, tags, mistake_type, source, difficulty, "
    "status, suspended, review_count, stage, fsrs_stability, fsrs_lapses, "
    "last_reviewed_at, next_review_at, created_at")


def get_settings(conn: sqlite3.Connection) -> dict:
    """读取可调参数：默认值打底，settings 表覆盖；脏值/越界一律回落默认，不炸。"""
    result = dict(DEFAULT_SETTINGS)
    try:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    except sqlite3.OperationalError:   # 老库还没建表
        return result
    for key, value in rows:
        if key not in SETTING_BOUNDS:
            continue
        lo, hi = SETTING_BOUNDS[key]
        try:
            num = int(str(value).strip())
        except (TypeError, ValueError):
            continue
        if lo <= num <= hi:
            result[key] = num
    return result


def save_settings(conn: sqlite3.Connection, body: dict) -> dict:
    """只接受 SETTING_BOUNDS 里的键；范围外的值直接 400，不做静默截断。"""
    if not isinstance(body, dict):
        raise ValidationError("设置必须是对象")
    updates = {}
    for key, (lo, hi) in SETTING_BOUNDS.items():
        if key not in body:
            continue
        try:
            num = int(body[key])
        except (TypeError, ValueError):
            raise ValidationError("%s 必须是整数" % SETTING_LABELS[key])
        if not lo <= num <= hi:
            raise ValidationError("%s 必须在 %d-%d 之间" % (SETTING_LABELS[key], lo, hi))
        updates[key] = num
    if not updates:
        raise ValidationError("没有可保存的设置项")
    for key, num in updates.items():
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(num)))
    conn.commit()
    return get_settings(conn)


def _attach_last_results(conn: sqlite3.Connection, items: list) -> None:
    """只给最终展示的那几条（默认 50 条）补“上一次评分”。

    v0.14：原来 last_result 是每行一个相关子查询，全表 5 万行都要跑；
    现在只对切出来的几十条查一次。
    """
    ids = [item["id"] for item in items]
    if not ids:
        return
    marks = ",".join("?" * len(ids))
    rows = conn.execute(
        "SELECT l.mistake_id AS mid, l.result FROM review_logs l "
        "WHERE l.id IN (SELECT MAX(id) FROM review_logs "
        "WHERE mistake_id IN (" + marks + ") AND rating > 0 GROUP BY mistake_id)",
        ids).fetchall()
    latest = {r["mid"]: r["result"] for r in rows}
    for item in items:
        item["last_result"] = latest.get(item["id"])


def arena(conn: sqlite3.Connection, subject: str = "", limit: int = 50,
          show: str = "zone") -> dict:
    """再战区：反复错的题排队重练，与斩题/恢复配套。

    入区：累计答错 >= ARENA_MIN_WRONG 次。错一次只当正常遗忘，不打扰。
    出区：最近一次答错之后连续答对 >= ARENA_CLEAR_STREAK 次，自动出区（不用手动清）。
    斩题：suspended=1 立刻移出再战区且不计入在区数；恢复后若仍满足入区条件就回来。
    """
    limit = min(ARENA_MAX_ITEMS, max(1, to_int(limit, 50)))
    show = "cleared" if show == "cleared" else "zone"
    rule = get_settings(conn)
    min_wrong = rule["arena_min_wrong"]
    clear_streak = rule["arena_clear_streak"]

    # v0.14：原来每行跑 4 个相关子查询（5 万行约 500ms）。改成 CTE 一次性预聚合，
    # 并在 SQL 里直接滤掉“没进区”的行，只把候选行（约 1 万）带回 Python 分类排序。
    # last_result 改到切片后按 id 补（见 _attach_last_results）。
    sql = (
        "WITH agg AS ("
        "  SELECT mistake_id,"
        "         SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS wrong_count,"
        "         SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END) AS right_count"
        "  FROM review_logs GROUP BY mistake_id),"
        " last_wrong AS ("
        "  SELECT mistake_id, MAX(id) AS lid FROM review_logs"
        "  WHERE rating = 1 GROUP BY mistake_id),"
        " streak AS ("
        "  SELECT l.mistake_id, COUNT(*) AS correct_streak"
        "  FROM review_logs l JOIN last_wrong w ON w.mistake_id = l.mistake_id"
        "  WHERE l.rating >= 2 AND l.id > w.lid GROUP BY l.mistake_id)"
        " SELECT " + ARENA_COLUMNS + ","
        " a.wrong_count, a.right_count,"
        " COALESCE(s.correct_streak, 0) AS correct_streak"
        " FROM mistakes JOIN agg a ON a.mistake_id = mistakes.id"
        " LEFT JOIN streak s ON s.mistake_id = mistakes.id"
        " WHERE mistakes.suspended = 0 AND a.wrong_count >= ?")
    args = [min_wrong]
    if subject:
        sql += " AND mistakes.subject = ?"
        args.append(subject)

    in_zone, cleared = [], []
    for row in conn.execute(sql, args).fetchall():
        item = dict(row)
        wrong = int(item["wrong_count"] or 0)
        right = int(item.pop("right_count", 0) or 0)
        streak = int(item["correct_streak"] or 0)
        graded = wrong + right
        item["need_streak"] = clear_streak
        item["accuracy"] = round(right / graded, 3) if graded else None
        if streak >= clear_streak:
            cleared.append(item)
        else:
            in_zone.append(item)

    # 错得最多的先练；同样错几次的，最久没碰过的先练。
    in_zone.sort(key=lambda x: (-x["wrong_count"], x["last_reviewed_at"] or "", x["id"]))
    cleared.sort(key=lambda x: x["last_reviewed_at"] or "", reverse=True)

    suspended_sql = (
        "SELECT COUNT(*) FROM mistakes m WHERE m.suspended = 1 AND "
        "(SELECT COUNT(*) FROM review_logs l WHERE l.mistake_id = m.id AND l.rating = 1) >= ?")
    suspended_args = [min_wrong]
    if subject:
        suspended_sql += " AND m.subject = ?"
        suspended_args.append(subject)
    suspended = conn.execute(suspended_sql, suspended_args).fetchone()[0]

    picked = cleared if show == "cleared" else in_zone
    items = picked[:limit]
    _attach_last_results(conn, items)
    return {
        "rule": {"min_wrong": min_wrong, "clear_streak": clear_streak},
        "show": show,
        "counts": {"zone": len(in_zone), "cleared": len(cleared),
                   "suspended": suspended, "tracked": len(in_zone) + len(cleared)},
        "total": len(picked),
        "truncated": len(picked) > limit,
        "limit": limit,
        "items": items,
    }


RETENTION_BUCKETS = (
    ("strong", "稳固", 0.9, 1.01),
    ("ok", "尚可", 0.8, 0.9),
    ("fading", "在遗忘", 0.6, 0.8),
    ("lost", "已遗忘", 0.0, 0.6),
)


def analytics(conn: sqlite3.Connection, days: int = 30) -> dict:
    """学习分析：录入/复习趋势、遗忘曲线预测、错因与学科分布、薄弱知识点。

    保持度用 FSRS 的简化公式 R = 0.9 ** (距上次复习天数 / 稳定性)，
    只是给人看的粗略预测，不参与调度决策。
    """
    days = min(90, max(7, to_int(days, 30)))
    start = (datetime.now() - timedelta(days=days - 1)).replace(
        hour=0, minute=0, second=0, microsecond=0)
    start_s = start.strftime("%Y-%m-%d %H:%M:%S")

    created = {r["d"]: r["c"] for r in conn.execute(
        "SELECT substr(created_at,1,10) AS d, COUNT(*) AS c FROM mistakes "
        "WHERE created_at >= ? GROUP BY d", (start_s,))}
    reviewed = {r["d"]: r["c"] for r in conn.execute(
        "SELECT substr(reviewed_at,1,10) AS d, COUNT(*) AS c FROM review_logs "
        "WHERE reviewed_at >= ? GROUP BY d", (start_s,))}

    trend = []
    for i in range(days):
        day = start + timedelta(days=i)
        key = day.strftime("%Y-%m-%d")
        trend.append({"date": key, "created": created.get(key, 0),
                      "reviewed": reviewed.get(key, 0)})

    now = datetime.now()
    counts = {b[0]: 0 for b in RETENTION_BUCKETS}
    samples = []
    for r in conn.execute(
            "SELECT id, subject, knowledge, fsrs_stability, last_reviewed_at "
            "FROM mistakes WHERE suspended = 0 AND fsrs_stability > 0 "
            "AND last_reviewed_at IS NOT NULL").fetchall():
        try:
            last = datetime.strptime(r["last_reviewed_at"], "%Y-%m-%d %H:%M:%S")
        except (TypeError, ValueError):
            continue
        elapsed = max(0.0, (now - last).total_seconds() / 86400.0)
        retention = 0.9 ** (elapsed / max(0.1, r["fsrs_stability"]))
        key = next(b[0] for b in RETENTION_BUCKETS if b[3] > retention >= b[2])
        counts[key] += 1
        samples.append({"id": r["id"], "subject": r["subject"], "knowledge": r["knowledge"],
                        "retention": round(retention, 3), "elapsed_days": round(elapsed, 1),
                        "stability": round(r["fsrs_stability"], 2)})
    samples.sort(key=lambda s: s["retention"])

    weak = [p for p in _knowledge_points(conn) if p["accuracy"] is not None]
    weak.sort(key=lambda p: (p["accuracy"], -p["mistakes"]))

    # 结构化断点：按「哪一步」聚合，以及「知识点 × 哪一步」的个人易错模式。
    # 后者只收 ≥2 次的组合——只错一次的偶然事件不算模式。
    by_step = [dict(r) for r in conn.execute(
        "SELECT step AS name, COUNT(*) AS count FROM review_logs "
        "WHERE step <> '' GROUP BY step ORDER BY count DESC, step").fetchall()]
    step_patterns = [dict(r) for r in conn.execute(
        "SELECT m.knowledge AS knowledge, l.step AS step, COUNT(*) AS count "
        "FROM review_logs l JOIN mistakes m ON m.id = l.mistake_id "
        "WHERE l.step <> '' AND m.knowledge <> '' "
        "GROUP BY m.knowledge, l.step HAVING COUNT(*) >= 2 "
        "ORDER BY count DESC, m.knowledge LIMIT 10").fetchall()]

    return {
        "generated_at": now_str(), "window_days": days,
        "trend": trend,
        "trend_totals": {"created": sum(x["created"] for x in trend),
                         "reviewed": sum(x["reviewed"] for x in trend)},
        "retention": {
            "counts": [{"key": b[0], "label": b[1], "count": counts[b[0]]}
                       for b in RETENTION_BUCKETS],
            "total": len(samples),
            "weakest": samples[:8],
            "note": "R = 0.9 ** (距上次复习天数 / 稳定性)，粗略预测，仅供参考",
        },
        "by_step": by_step,
        "step_patterns": step_patterns,
        "by_type": [dict(r) for r in conn.execute(
            "SELECT mistake_type AS name, COUNT(*) AS count FROM mistakes "
            "WHERE suspended = 0 AND mistake_type <> '' "
            "GROUP BY mistake_type ORDER BY count DESC")],
        "by_subject": [dict(r) for r in conn.execute(
            "SELECT subject AS name, COUNT(*) AS count FROM mistakes "
            "WHERE suspended = 0 GROUP BY subject ORDER BY count DESC LIMIT 10")],
        "weak_points": [{"knowledge": p["knowledge"], "accuracy": p["accuracy"],
                         "mistakes": p["mistakes"], "band": p["band"]} for p in weak[:8]],
    }


# --------------------------------------------------------------------------- #
# 查询
# --------------------------------------------------------------------------- #
# --------------------------------------------------------------------------- #
# 试卷维度（v0.20）：一次月考/周测是一张卷，题目归到卷下
# --------------------------------------------------------------------------- #
PAPER_NAME_MAX = 120


def _paper_row(row: sqlite3.Row, count: int = 0) -> dict:
    return {"id": row["id"], "name": row["name"], "subject": row["subject"],
            "exam_date": row["exam_date"], "note": row["note"],
            "count": count, "created_at": row["created_at"], "updated_at": row["updated_at"]}


def _paper_input(body: dict, base: dict | None = None) -> dict:
    base = base or {}

    def text(key: str) -> str:
        value = body[key] if key in body else base.get(key, "")
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise ValidationError("字段 %s 必须是字符串" % key)
        return value.strip()

    name = text("name")
    if not name:
        raise ValidationError("试卷名称不能为空")
    if len(name) > PAPER_NAME_MAX:
        raise ValidationError("试卷名称过长（上限 %d 字）" % PAPER_NAME_MAX)
    exam_date = text("exam_date")
    if exam_date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", exam_date):
        raise ValidationError("考试日期格式应为 YYYY-MM-DD")
    return {"name": name, "subject": text("subject") or "未分类",
            "exam_date": exam_date, "note": text("note")}


def list_papers(conn: sqlite3.Connection, subject: str = "") -> dict:
    """试卷列表，带每张卷的题目数。按考试日期倒序（没填日期的按创建时间）。"""
    sql = ("SELECT p.*, (SELECT COUNT(*) FROM mistakes m WHERE m.paper_id = p.id) AS cnt "
           "FROM papers p")
    args = []
    if subject:
        sql += " WHERE p.subject = ?"
        args.append(subject)
    sql += " ORDER BY CASE WHEN p.exam_date = '' THEN 1 ELSE 0 END, p.exam_date DESC, p.id DESC"
    rows = conn.execute(sql, args).fetchall()
    papers = [_paper_row(r, r["cnt"]) for r in rows]
    return {"papers": papers, "total": len(papers),
            "subjects": sorted({p["subject"] for p in papers if p["subject"]})}


def get_paper(conn: sqlite3.Connection, pid: int) -> dict:
    row = conn.execute("SELECT * FROM papers WHERE id = ?", (pid,)).fetchone()
    if row is None:
        raise NotFound("试卷不存在: id=%d" % pid)
    count = conn.execute("SELECT COUNT(*) FROM mistakes WHERE paper_id = ?", (pid,)).fetchone()[0]
    return _paper_row(row, count)


def create_paper(conn: sqlite3.Connection, body: dict) -> dict:
    data = _paper_input(body)
    now = now_str()
    cur = conn.execute(
        "INSERT INTO papers (name, subject, exam_date, note, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?)",
        (data["name"], data["subject"], data["exam_date"], data["note"], now, now))
    conn.commit()
    return get_paper(conn, cur.lastrowid)


def update_paper(conn: sqlite3.Connection, pid: int, body: dict) -> dict:
    row = conn.execute("SELECT * FROM papers WHERE id = ?", (pid,)).fetchone()
    if row is None:
        raise NotFound("试卷不存在: id=%d" % pid)
    data = _paper_input(body, dict(row))
    conn.execute("UPDATE papers SET name=?, subject=?, exam_date=?, note=?, updated_at=? WHERE id=?",
                 (data["name"], data["subject"], data["exam_date"], data["note"], now_str(), pid))
    conn.commit()
    return get_paper(conn, pid)


def delete_paper(conn: sqlite3.Connection, pid: int) -> dict:
    """删卷不删题：卷下的题退回"不归卷"，题目本身还在。"""
    row = conn.execute("SELECT id FROM papers WHERE id = ?", (pid,)).fetchone()
    if row is None:
        raise NotFound("试卷不存在: id=%d" % pid)
    detached = conn.execute("SELECT COUNT(*) FROM mistakes WHERE paper_id = ?", (pid,)).fetchone()[0]
    conn.execute("UPDATE mistakes SET paper_id = 0 WHERE paper_id = ?", (pid,))
    conn.execute("DELETE FROM papers WHERE id = ?", (pid,))
    conn.commit()
    return {"deleted": pid, "detached": detached}


# --------------------------------------------------------------------------- #
# 批量改字段（v0.20）：勾一批题，统一改状态/学科/标签/错因/知识点/试卷
# --------------------------------------------------------------------------- #
BULK_FIELDS = ("status", "subject", "mistake_type", "knowledge", "source",
               "paper_id", "difficulty", "tags")
BULK_MAX_IDS = 500


def bulk_update(conn: sqlite3.Connection, ids, fields: dict) -> dict:
    """只改请求里明确给出的字段，其余字段保持不动。

    tags 支持三种写法：默认替换；tags_mode=add 追加（去重）；tags_mode=remove 移除。
    用一条 UPDATE 处理整批，避免 500 次往返。
    """
    if not isinstance(ids, list):
        raise ValidationError("ids 必须是数组")
    clean = []
    for raw in ids:
        try:
            mid = int(raw)
        except (TypeError, ValueError):
            raise ValidationError("ids 里有非整数: %r" % (raw,))
        if mid > 0:
            clean.append(mid)
    clean = list(dict.fromkeys(clean))
    if not clean:
        raise ValidationError("没有选中任何错题")
    if len(clean) > BULK_MAX_IDS:
        raise ValidationError("一次最多改 %d 道题" % BULK_MAX_IDS)
    if not isinstance(fields, dict):
        raise ValidationError("fields 必须是对象")

    sets, args = [], []
    for key in BULK_FIELDS:
        if key not in fields:
            continue
        value = fields[key]
        if key == "status":
            value = "" if value is None else str(value).strip()
            if value not in STATUSES:
                raise ValidationError("状态只能是 new / reviewing / mastered")
            sets.append("status = ?")
            args.append(value)
        elif key == "mistake_type":
            value = "" if value is None else str(value).strip()
            if value and value not in MISTAKE_TYPES:
                raise ValidationError("错因分类只能是: " + " / ".join(MISTAKE_TYPES))
            sets.append("mistake_type = ?")
            args.append(value)
        elif key == "subject":
            value = "" if value is None else str(value).strip()
            if len(value) > 40:
                raise ValidationError("学科名过长（上限 40 字）")
            sets.append("subject = ?")
            args.append(value or "未分类")
        elif key == "source":
            value = "" if value is None else str(value).strip()
            if len(value) > 100:
                raise ValidationError("来源过长（上限 100 字）")
            sets.append("source = ?")
            args.append(value)
        elif key == "knowledge":
            value = resolve_knowledge(conn, "" if value is None else str(value))
            sets.append("knowledge = ?")
            args.append(value)
        elif key == "paper_id":
            sets.append("paper_id = ?")
            args.append(_check_paper(conn, to_int(value, 0)))
        elif key == "difficulty":
            try:
                level = int(value)
            except (TypeError, ValueError):
                raise ValidationError("难度必须是 1-5 的整数")
            if not 1 <= level <= 5:
                raise ValidationError("难度必须在 1-5 之间")
            sets.append("difficulty = ?")
            args.append(level)
        elif key == "tags":
            raw = "" if value is None else str(value)
            incoming = [t.strip() for t in re.split(r"[,，\s]+", raw) if t.strip()]
            mode = str(fields.get("tags_mode") or "set").strip().lower()
            if mode not in ("set", "add", "remove"):
                raise ValidationError("tags_mode 只能是 set / add / remove")
            if mode == "set":
                sets.append("tags = ?")
                args.append(",".join(incoming))
            else:
                # 追加/移除要逐题算（每题原有标签不同），单独处理
                return _bulk_tags(conn, clean, incoming, mode, sets, args)

    if not sets:
        raise ValidationError("没有要修改的字段")
    sets.append("updated_at = ?")
    args.append(now_str())
    placeholders = ",".join("?" * len(clean))
    cur = conn.execute("UPDATE mistakes SET " + ", ".join(sets) +
                       " WHERE id IN (" + placeholders + ")", args + clean)
    conn.commit()
    return {"updated": cur.rowcount, "ids": clean, "fields": [k for k in fields if k in BULK_FIELDS]}


def _bulk_tags(conn: sqlite3.Connection, ids, incoming, mode: str, sets, args) -> dict:
    """标签追加/移除：逐题读写，题量有上限（500）所以可以接受。"""
    now = now_str()
    changed = 0
    for mid in ids:
        row = conn.execute("SELECT tags FROM mistakes WHERE id = ?", (mid,)).fetchone()
        if row is None:
            continue
        current = [t for t in (row["tags"] or "").split(",") if t]
        if mode == "add":
            merged = current + [t for t in incoming if t not in current]
        else:
            drop = set(incoming)
            merged = [t for t in current if t not in drop]
        conn.execute("UPDATE mistakes SET tags = ?, updated_at = ? WHERE id = ?",
                     (",".join(merged), now, mid))
        changed += 1
    conn.commit()
    return {"updated": changed, "ids": ids, "fields": ["tags"], "tags_mode": mode}


def build_filters(params: dict):
    where, args = [], []

    # 检索范围：默认搜全部字段；scope=question 只搜题干（对应「关键词不搜答案区」）
    keyword = one(params, "q").strip()
    if keyword:
        like = "%" + keyword + "%"
        if one(params, "scope").strip() == "question":
            where.append("(question LIKE ? OR knowledge LIKE ? OR tags LIKE ?)")
            args.extend([like] * 3)
        else:
            where.append("(question LIKE ? OR answer LIKE ? OR analysis LIKE ? OR my_answer LIKE ? "
                         "OR error_reason LIKE ? OR knowledge LIKE ? OR tags LIKE ? "
                         "OR subject LIKE ? OR source LIKE ?)")
            args.extend([like] * 9)

    for key in ("subject", "status", "mistake_type", "source"):
        value = one(params, key).strip()
        if value:
            where.append(key + " = ?")
            args.append(value)

    tag = one(params, "tag").strip()
    if tag:
        where.append("(',' || tags || ',') LIKE ?")
        args.append("%," + tag + ",%")

    # 知识点：默认精确匹配；kdeep=1 时连子知识点一起选（函数 -> 函数/二次函数）
    knowledge = one(params, "knowledge").strip()
    if knowledge:
        knowledge = normalize_knowledge_path(knowledge)
    if knowledge and one(params, "kdeep").strip() in ("1", "true", "yes"):
        where.append("(knowledge = ? OR knowledge LIKE ?)")
        args.extend([knowledge, knowledge + "/%"])
    elif knowledge:
        where.append("knowledge = ?")
        args.append(knowledge)

    # 斩题（挂起）：默认不出现；suspended=1 只看已斩题，all=全部
    suspended = one(params, "suspended").strip()
    if suspended in ("1", "true", "yes"):
        where.append("suspended = 1")
    elif suspended != "all":
        where.append("suspended = 0")

    # 时间范围：按录入时间
    span = one(params, "range").strip()
    if span in ("week", "month"):
        days = 7 if span == "week" else 30
        where.append("created_at >= ?")
        args.append((datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S"))

    if one(params, "due").strip() in ("1", "true", "yes"):
        where.append("next_review_at IS NOT NULL AND next_review_at <= ?")
        args.append(now_str())

    # 试卷维度：paper_id=3 只看那张卷；paper_id=0 或 none 只看没归卷的题
    paper = one(params, "paper_id").strip()
    if paper:
        if paper in ("0", "none", "no"):
            where.append("paper_id = 0")
        else:
            where.append("paper_id = ?")
            args.append(to_int(paper, 0))

    return where, args


def query_mistakes(conn: sqlite3.Connection, params: dict) -> dict:
    where, args = build_filters(params)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    total = conn.execute("SELECT COUNT(*) FROM mistakes" + where_sql, args).fetchone()[0]
    page = max(1, to_int(one(params, "page"), 1))
    size = min(100, max(1, to_int(one(params, "page_size"), 20)))

    # v0.17：thumbs=1 时多带一个 image_file，列表卡片直接渲染缩略图。
    # 默认不带，保持 v0.15 定下的对外契约（列表响应里没有 image_url）。
    thumbs = str(one(params, "thumbs") or "").lower() in ("1", "true", "yes")
    cols = LIST_COLUMNS + ", image_file" if thumbs else LIST_COLUMNS
    rows = conn.execute(
        "SELECT " + cols + " FROM mistakes" + where_sql +
        " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
        (*args, size, (page - 1) * size),
    ).fetchall()

    return {"items": [row_to_dict(r, include_image=thumbs) for r in rows],
            "total": total, "page": page, "page_size": size}


def stats(conn: sqlite3.Connection) -> dict:
    now = now_str()
    row = conn.execute(
        "SELECT COUNT(*) AS total, "
        "SUM(CASE WHEN status='mastered' THEN 1 ELSE 0 END) AS mastered, "
        "SUM(CASE WHEN status='reviewing' THEN 1 ELSE 0 END) AS reviewing, "
        "SUM(CASE WHEN status<>'mastered' AND suspended=0 AND next_review_at IS NOT NULL "
        "         AND next_review_at<=? THEN 1 ELSE 0 END) AS due, "
        "SUM(CASE WHEN suspended=1 THEN 1 ELSE 0 END) AS suspended "
        "FROM mistakes", (now,),
    ).fetchone()

    by_subject = [dict(r) for r in conn.execute(
        "SELECT subject, COUNT(*) AS count FROM mistakes GROUP BY subject ORDER BY count DESC"
    ).fetchall()]
    # 错因分布图读的是 /api/analytics 的 by_type（mistake_type 是 6 项枚举，可聚合）。
    # error_reason 是自由文本，按它 GROUP BY 只会得到一堆各 1 条的长句，故不再输出 by_reason。
    by_type = [dict(r) for r in conn.execute(
        "SELECT mistake_type, COUNT(*) AS count FROM mistakes WHERE mistake_type <> '' "
        "GROUP BY mistake_type ORDER BY count DESC"
    ).fetchall()]

    logs = conn.execute(
        "SELECT COUNT(*) AS total, "
        "SUM(CASE WHEN rating BETWEEN 2 AND 4 THEN 1 ELSE 0 END) AS correct, "
        "SUM(CASE WHEN rating BETWEEN 1 AND 4 THEN 1 ELSE 0 END) AS graded "
        "FROM review_logs").fetchone()
    total_reviews = logs["total"] or 0
    graded_reviews = logs["graded"] or 0
    correct_reviews = logs["correct"] or 0
    last7 = conn.execute(
        "SELECT COUNT(*) FROM review_logs WHERE reviewed_at >= ?",
        ((datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S"),)).fetchone()[0]

    # v0.14：stats 只需要“几个知识点、几个过关”两个数字，
    # 不再为它跑一遍全量知识点聚合（原来这一步占 stats 的 80%）。
    gate = conn.execute(
        "SELECT COUNT(*) AS points, "
        "SUM(CASE WHEN mistakes >= ? AND COALESCE(min_stage, 0) >= ? "
        "         AND COALESCE(min_stability, 0) >= ? THEN 1 ELSE 0 END) AS passed "
        "FROM (SELECT knowledge, COUNT(*) AS mistakes, MIN(stage) AS min_stage, "
        "             MIN(fsrs_stability) AS min_stability "
        "      FROM mistakes WHERE knowledge <> '' AND suspended = 0 "
        "      GROUP BY knowledge)",
        (MASTERY_MIN_MISTAKES, MASTERY_MIN_STAGE, MASTERY_MIN_STABILITY)).fetchone()
    return {"total": row["total"], "mastered": row["mastered"] or 0,
            "reviewing": row["reviewing"] or 0, "due": row["due"] or 0,
            "suspended": row["suspended"] or 0,
            "by_subject": by_subject, "by_type": by_type,
            "mastery": {"points": gate["points"] or 0,
                        "passed": gate["passed"] or 0},
            "reviews": {"total": total_reviews, "graded": graded_reviews,
                        "correct": correct_reviews,
                        "accuracy": round(correct_reviews / graded_reviews, 3)
                                    if graded_reviews else None,
                        "last_7_days": last7}}


def meta(conn: sqlite3.Connection) -> dict:
    subjects = [r[0] for r in conn.execute(
        "SELECT DISTINCT subject FROM mistakes WHERE subject <> '' ORDER BY subject")]
    tags = sorted({t for (raw,) in conn.execute("SELECT tags FROM mistakes WHERE tags <> ''")
                   for t in raw.split(",") if t})
    knowledge = [r[0] for r in conn.execute(
        "SELECT DISTINCT knowledge FROM mistakes WHERE knowledge <> '' ORDER BY knowledge")]
    sources = [r[0] for r in conn.execute(
        "SELECT DISTINCT source FROM mistakes WHERE source <> '' ORDER BY source")]
    return {"subjects": subjects, "tags": tags, "knowledge": knowledge,
            "steps": list(REVIEW_STEPS),
            "statuses": [{"value": k, "label": v} for k, v in STATUS_LABELS.items()],
            "mistake_types": list(MISTAKE_TYPES),
            "sources": sorted(set(sources) | set(SOURCE_HINTS)),
            "settings": get_settings(conn),
            "setting_labels": SETTING_LABELS,
            "papers": list_papers(conn)["papers"],
            "trash_count": trash_count(conn),
            "ratings": [{"value": r, "key": k, "label": fsrs.RATING_LABELS[r]}
                        for k, r in RESULT_RATINGS.items()]}


# v0.20：导出加 papers 与 mistake_images 两张表，老备份仍能读（缺的键按空处理）
EXPORT_TABLES = ("mistakes", "review_logs", "variants", "knowledge_aliases",
                 "papers", "mistake_images")


def _export_row(row: sqlite3.Row) -> dict:
    """导出用的行：去掉 base64 图片（太大），换成图片文件的 URL。"""
    data = dict(row)
    name = data.pop("image_file", "") or ""
    data.pop("image_data", None)
    if name:
        data["image_url"] = image_url(name)
    return data


def iter_export(conn: sqlite3.Connection, chunk: int = 200):
    """流式导出 JSON：一次只取一小批行，边读边产出文本片段。

    片段拼起来就是合法 JSON。调用方可以逐段写进 socket 或文件，
    不必把整库（5 万题约 70MB）先拼成一个字符串再发。
    注意：图片二进制不在 JSON 里，在 data/images/ 目录，备份时要一起拷。
    """
    counts = {t: conn.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
              for t in EXPORT_TABLES}
    yield ('{\n  "version": 5,\n  "exported_at": %s,\n  "counts": %s,\n'
           % (json.dumps(now_str(), ensure_ascii=False),
              json.dumps(counts, ensure_ascii=False)))
    for index, table in enumerate(EXPORT_TABLES):
        yield '  "%s": [' % table
        sql = ("SELECT * FROM knowledge_aliases ORDER BY alias" if table == "knowledge_aliases"
               else "SELECT * FROM %s ORDER BY id" % table)
        cursor = conn.execute(sql)
        first = True
        while True:
            rows = cursor.fetchmany(chunk)
            if not rows:
                break
            parts = []
            for row in rows:
                data = _export_row(row) if table == "mistakes" else dict(row)
                parts.append(("," if not first else "") + "\n    "
                             + json.dumps(data, ensure_ascii=False))
                first = False
            yield "".join(parts)
        yield "\n  ]" + ("," if index < len(EXPORT_TABLES) - 1 else "") + "\n"
    yield "}\n"


def export_all(conn: sqlite3.Connection) -> dict:
    """全量备份（内存版）。

    和 iter_export 输出同样结构，但一次 json.dumps 完更省 CPU（实测 2 万题
    608ms vs 228ms）。所以：要马上拿到 dict 用它，要写大文件/发大响应走 iter_export。
    """
    mistakes = [_export_row(r) for r in conn.execute("SELECT * FROM mistakes ORDER BY id")]
    logs = [dict(r) for r in conn.execute("SELECT * FROM review_logs ORDER BY id")]
    variants = [dict(r) for r in conn.execute("SELECT * FROM variants ORDER BY id")]
    aliases = [dict(r) for r in conn.execute("SELECT * FROM knowledge_aliases ORDER BY alias")]
    papers = [dict(r) for r in conn.execute("SELECT * FROM papers ORDER BY id")]
    images = [dict(r) for r in conn.execute("SELECT * FROM mistake_images ORDER BY id")]
    return {"version": 5, "exported_at": now_str(),
            "counts": {"mistakes": len(mistakes), "review_logs": len(logs),
                       "variants": len(variants), "knowledge_aliases": len(aliases),
                       "papers": len(papers), "mistake_images": len(images)},
            "mistakes": mistakes, "review_logs": logs, "variants": variants,
            "knowledge_aliases": aliases, "papers": papers, "mistake_images": images}


# --------------------------------------------------------------------------- #
# 组卷 / 打印（v0.8）
# --------------------------------------------------------------------------- #
PAPER_MODES = ("question", "answer", "split")   # 只题目 / 题目+答案 / 题目与答案分页
PAPER_ORDERS = ("weak", "random", "recent", "oldest")
MAX_PAPER_ITEMS = 100
PAPER_MODE_LABELS = {"question": "只有题目（留答题空位）",
                     "answer": "题目 + 答案（对照复习）",
                     "split": "题目与答案分页（先做后对）"}
PAPER_ORDER_LABELS = {"weak": "薄弱优先", "random": "随机抽题",
                      "recent": "最近录入", "oldest": "最早录入"}


def build_paper(conn: sqlite3.Connection, params: dict) -> dict:
    """按筛选条件抽题组卷。复用 build_filters，所以列表页的筛选条件都能带过来。"""
    where, args = build_filters(params)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    count = min(MAX_PAPER_ITEMS, max(1, to_int(one(params, "count"), 20)))
    order = one(params, "order").strip()
    if order not in PAPER_ORDERS:
        order = "weak"
    mode = one(params, "mode").strip()
    if mode not in PAPER_MODES:
        mode = "question"
    include_images = one(params, "images").strip() in ("1", "true", "yes")
    show_meta = one(params, "meta").strip() not in ("0", "false", "no")
    show_analysis = one(params, "analysis").strip() not in ("0", "false", "no")
    blank = min(400, max(0, to_int(one(params, "blank"), 56)))
    title = one(params, "title").strip() or "错题重做卷"

    # v0.14：原来把全部匹配行（含每条两个相关子查询）拉进 Python 再排序切片，
    # 5 万行约 500ms。现在 graded/correct 用一次聚合 LEFT JOIN 算出，排序和 LIMIT 交给 SQL。
    cols = LIST_COLUMNS + ", image_file"
    agg_join = (
        " LEFT JOIN ("
        "  SELECT mistake_id,"
        "         SUM(CASE WHEN rating BETWEEN 1 AND 4 THEN 1 ELSE 0 END) AS graded,"
        "         SUM(CASE WHEN rating BETWEEN 3 AND 4 THEN 1 ELSE 0 END) AS correct"
        "  FROM review_logs GROUP BY mistake_id) g ON g.mistake_id = mistakes.id")
    seed = to_int(one(params, "seed"), 0) or None

    if order == "random":
        # 随机抽题保留“先洗牌再取前 N”的语义（同一 seed 可复现），但只拉 id 洗牌，
        # 不再把全部字段搬进内存。
        ids = [r[0] for r in conn.execute(
            "SELECT id FROM mistakes" + where_sql + " ORDER BY id", args)]
        available = len(ids)
        random.Random(seed).shuffle(ids)
        picked_ids = ids[:count]
        items = []
        if picked_ids:
            marks = ",".join("?" * len(picked_ids))
            rows = conn.execute(
                "SELECT " + cols + ", COALESCE(g.graded, 0) AS graded, "
                "COALESCE(g.correct, 0) AS correct FROM mistakes" + agg_join +
                " WHERE mistakes.id IN (" + marks + ")", picked_ids).fetchall()
            by_id = {}
            for row in rows:
                data = dict(row)
                graded = data.pop("graded", 0) or 0
                correct = data.pop("correct", 0) or 0
                data["accuracy"] = round(correct / graded, 4) if graded else None
                by_id[data["id"]] = data
            items = [by_id[i] for i in picked_ids if i in by_id]
    else:
        available = conn.execute(
            "SELECT COUNT(*) FROM mistakes" + where_sql, args).fetchone()[0]
        order_sql = {
            # 正确率低的在前；没做过的按 0.5 处理（风险未知，排中间），再按稳定性升序
            "weak": ("CASE WHEN COALESCE(g.graded, 0) = 0 THEN 0.5 "
                     "ELSE CAST(g.correct AS REAL) / g.graded END ASC, "
                     "fsrs_stability ASC, id ASC"),
            "recent": "created_at DESC, id DESC",
            "oldest": "created_at ASC, id ASC",
        }[order]
        rows = conn.execute(
            "SELECT " + cols + ", COALESCE(g.graded, 0) AS graded, "
            "COALESCE(g.correct, 0) AS correct FROM mistakes" + agg_join +
            where_sql + " ORDER BY " + order_sql + " LIMIT ?",
            args + [count]).fetchall()
        items = []
        for row in rows:
            data = dict(row)
            graded = data.pop("graded", 0) or 0
            correct = data.pop("correct", 0) or 0
            data["accuracy"] = round(correct / graded, 4) if graded else None
            items.append(data)

    picked = items[:count]
    for index, data in enumerate(picked, 1):
        data["no"] = index
        name = data.pop("image_file", "") or ""
        if include_images and name:
            data["image_url"] = image_url(name)

    return {"title": title, "mode": mode, "order": order,
            "mode_label": PAPER_MODE_LABELS[mode], "order_label": PAPER_ORDER_LABELS[order],
            "show_meta": show_meta, "show_analysis": show_analysis,
            "include_images": include_images,
            "blank": blank, "count": len(picked), "available": available,
            "generated_at": now_str(), "items": picked}


PAPER_CSS = """
/* v0.19 批 5：打印页改成「纸面」方向 —— 暖白画布、纯白纸面、墨色正文、墨绿强调。
   中文字体优先宋体，打印时才是"卷子"的观感；屏幕上仍可读。 */
*{box-sizing:border-box}
body{margin:0;background:#f6f6f3;color:#1c1c19;
     font:14px/1.85 "Songti SC","SimSun","PingFang SC","Microsoft YaHei",serif;
     -webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{background:#fff;max-width:820px;margin:24px auto;padding:16mm 14mm;
       border:1px solid #e3e3da;box-shadow:0 2px 18px rgba(28,28,25,.07)}
h1{font-size:21px;text-align:center;margin:0 0 6px;letter-spacing:3px;font-weight:600}
.sub{text-align:center;color:#8a8a80;font-size:12px;margin:0 0 16px;letter-spacing:.5px}
.fill{display:flex;gap:26px;justify-content:center;font-size:12px;color:#5e5e55;
      border-bottom:1px solid #cfcfc3;padding-bottom:10px;margin-bottom:22px}
.q{break-inside:avoid;page-break-inside:avoid;margin:0 0 20px;orphans:3;widows:3}
.qhead{display:flex;gap:8px;align-items:baseline}
.qno{flex:none;display:inline-block;min-width:21px;height:21px;line-height:21px;
     text-align:center;background:#2f6f4f;color:#fff;border-radius:50%;
     font-size:12px;font-weight:600;font-family:-apple-system,"Segoe UI",sans-serif}
.qmeta{color:#8a8a80;font-size:12px}
.qtext{margin:6px 0 0 29px;word-break:break-word}
.qimg{margin:8px 0 0 29px}
.qimg img{max-width:100%;max-height:230px;border:1px solid #e3e3da}
.blank{margin:8px 0 0 29px;border-bottom:1px dashed #cfcfc3}
.ans{margin:8px 0 0 29px;background:#f7f7f2;border-left:3px solid #2f6f4f;
     padding:9px 12px;font-size:13px;line-height:1.75;break-inside:avoid}
.ans .k{color:#5e5e55}
.ans .line{margin:2px 0}
.pagebreak{break-before:page;page-break-before:always}
.anshead{font-size:16px;margin:0 0 14px;text-align:center;letter-spacing:3px;font-weight:600}
.ablock{margin:0 0 16px;break-inside:avoid}
/* 顶部工具条：屏幕上有，打印时隐藏 */
.bar{position:sticky;top:0;z-index:9;background:#fff;border-bottom:1px solid #e3e3da;
     color:#1c1c19;padding:9px 16px;display:flex;gap:10px;align-items:center;
     font-size:13px;flex-wrap:wrap;font-family:-apple-system,"Segoe UI","PingFang SC",sans-serif}
.bar button{background:#2f6f4f;color:#fff;border:1px solid #2f6f4f;border-radius:7px;
            padding:6px 14px;cursor:pointer;font-size:13px;font-family:inherit}
.bar button:hover{background:#255a40;border-color:#255a40}
.bar a{color:#5e5e55;border:1px solid #cfcfc3;border-radius:7px;padding:5px 10px;
       text-decoration:none;font-size:13px}
.bar a:hover{color:#1c1c19;border-color:#8a8a80}
.bar .sp{margin-left:auto}
.bar .meta{color:#8a8a80;font-size:12px}
.bar .tip{color:#8a8a80;font-size:12px}
@media print{
  body{background:#fff}
  .sheet{margin:0;padding:0;max-width:none;border:0;box-shadow:none}
  .noprint{display:none !important}
}
@page{size:A4;margin:16mm 14mm}
"""

def _paper_item_meta(item: dict) -> str:
    bits = []
    if item.get("subject"):
        bits.append(html.escape(str(item["subject"])))
    if item.get("knowledge"):
        bits.append("知识点：" + html.escape(str(item["knowledge"])))
    if item.get("mistake_type"):
        bits.append(html.escape(str(item["mistake_type"])))
    if item.get("difficulty"):
        bits.append("难度 " + html.escape(str(item["difficulty"])))
    return " · ".join(bits)


def _paper_item_text(value) -> str:
    return html.escape(str(value or "")).replace("\n", "<br>")


def _paper_answer_html(item: dict, with_analysis: bool = True) -> str:
    lines = []
    if item.get("answer"):
        lines.append('<div class="line"><span class="k">正确答案：</span>%s</div>'
                     % _paper_item_text(item["answer"]))
    if with_analysis and item.get("analysis"):
        lines.append('<div class="line"><span class="k">解析：</span>%s</div>'
                     % _paper_item_text(item["analysis"]))
    if item.get("my_answer"):
        lines.append('<div class="line"><span class="k">我的答案：</span>%s</div>'
                     % _paper_item_text(item["my_answer"]))
    if item.get("error_reason"):
        lines.append('<div class="line"><span class="k">错因：</span>%s</div>'
                     % _paper_item_text(item["error_reason"]))
    return "".join(lines)


def _paper_html(paper: dict, query: dict) -> str:
    """服务端渲染 A4 试卷页。浏览器 Ctrl+P 即可存 PDF，不需要任何 PDF 库。"""
    from urllib.parse import urlencode

    def link(mode: str) -> str:
        params = dict(query)
        params["mode"] = mode
        params.pop("seed", None)
        return "/print?" + urlencode(params)

    bar = ['<div class="bar noprint">',
           '<button type="button" onclick="window.print()">打印 / 存为 PDF</button>',
           '<span class="meta">版式：%s ｜ %s ｜ 共 %d 题</span>'
           % (html.escape(paper["mode_label"]), html.escape(paper["order_label"]), paper["count"]),
           '<span class="sp"></span>',
           '<span class="tip">Ctrl+P / ⌘P → 另存为 PDF</span>']
    for mode in PAPER_MODES:
        if mode != paper["mode"]:
            bar.append('<a href="%s">切到「%s」</a>'
                       % (html.escape(link(mode)), html.escape(PAPER_MODE_LABELS[mode])))
    bar.append("</div>")

    head = [
        "<!doctype html>",
        '<html lang="zh-CN"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        "<title>%s</title>" % html.escape(paper["title"]),
        "<style>%s</style>" % PAPER_CSS,
        # 打印页也要渲染公式：题目/答案里的 $...$ 用本地 KaTeX 转成 HTML。
        '<link rel="stylesheet" href="/vendor/katex/katex.min.css">',
        "</head><body>",
        "".join(bar),
        '<div class="sheet">',
        "<h1>%s</h1>" % html.escape(paper["title"]),
        '<div class="sub">%s · 生成于 %s</div>'
        % (html.escape(paper["order_label"]), html.escape(paper["generated_at"])),
        '<div class="fill"><span>姓名 ____________</span><span>班级 ____________</span>'
        '<span>日期 ____________</span><span>共 %d 题</span></div>' % paper["count"],
    ]

    body = []
    for item in paper["items"]:
        meta = _paper_item_meta(item) if paper["show_meta"] else ""
        meta_html = ('<span class="qmeta">%s</span>' % meta) if meta else ""
        image_html = ""
        if paper["include_images"] and item.get("image_url"):
            image_html = ('<div class="qimg"><img src="%s" alt="题目图片"></div>'
                          % html.escape(item["image_url"], quote=True))
        blank_html = ('<div class="blank" style="height:%dpx"></div>' % paper["blank"]
                      if paper["blank"] else "")
        answer_html = ""
        if paper["mode"] == "answer":
            inner = _paper_answer_html(item, paper["show_analysis"])
            if inner:
                answer_html = '<div class="ans">%s</div>' % inner
        body.append('<section class="q"><div class="qhead"><span class="qno">%d</span>%s</div>'
                    '<div class="qtext">%s</div>%s%s%s</section>'
                    % (item["no"], meta_html, _paper_item_text(item.get("question")),
                       image_html, blank_html, answer_html))

    tail = []
    if paper["mode"] == "split":
        tail.append('<div class="pagebreak"></div>')
        tail.append('<h2 class="anshead">答案与解析</h2>')
        for item in paper["items"]:
            inner = _paper_answer_html(item, paper["show_analysis"]) or '<div class="line">（暂无答案）</div>'
            tail.append('<div class="ablock"><div class="qhead"><span class="qno">%d</span>'
                        '<span class="qmeta">%s</span></div><div class="ans">%s</div></div>'
                        % (item["no"], html.escape(_paper_item_meta(item)), inner))
    tail.append("</div>")
    tail.append('<script src="/vendor/katex/katex.min.js"></script>')
    tail.append('<script src="/math.js"></script>')
    tail.append("<script>mbMath.apply(document.body);</script>")
    tail.append("</body></html>")
    return "\n".join(head + body + tail)


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
class AppHandler(SimpleHTTPRequestHandler):
    server_version = "MistakeBook/1.3"

    # -- 基础输出 --
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, code: str, message: str) -> None:
        self._json(status, {"ok": False, "error": {"code": code, "message": message}})

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValidationError("请求体过大（上限 4MB）")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValidationError("请求体不是合法 JSON")
        if not isinstance(data, dict):
            raise ValidationError("请求体必须是 JSON 对象")
        return data

    def _stream(self, content_type: str, chunks, filename: str = "") -> None:
        """边生成边发：不预先知道长度，靠关闭连接来结束响应体。

        用于导出这类可能几十 MB 的响应——原来要先把整库拼成一个字符串，
        5 万题约 73MB 常驻内存。现在每 200 行写一次，内存只跟批大小有关。
        """
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        if filename:
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % filename)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            for chunk in chunks:
                if chunk:
                    self.wfile.write(chunk.encode("utf-8") if isinstance(chunk, str) else chunk)
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass   # 用户中途取消下载，不算错误

    def _image(self, name: str) -> None:
        """按文件名回源图片。文件名是内容哈希，所以可以放心长缓存。"""
        if not IMAGE_NAME_RE.match(name):
            raise NotFound("图片不存在: %s" % name)
        path = os.path.join(image_dir(self.server.db_path), name)
        if not os.path.isfile(path):
            raise NotFound("图片不存在: %s" % name)
        with open(path, "rb") as fh:
            body = fh.read()
        ext = name.rsplit(".", 1)[-1]
        self.send_response(200)
        self.send_header("Content-Type", IMAGE_MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _asset(self, target: str) -> None:
        """回源 vendor/katex/ 下的静态文件（面板的公式渲染器）。

        target 来自查询串，必须当成不可信输入：先按前缀挡掉，再用 realpath 确认
        落点仍在 vendor/katex/ 里面，防止 ../ 跳出目录。
        """
        if not target.startswith(ASSET_PREFIX) or ".." in target or "\\" in target or "//" in target:
            raise NotFound("资产不存在: %s" % target)
        root = os.path.realpath(os.path.join(STATIC_DIR, "vendor", "katex"))
        path = os.path.realpath(os.path.join(STATIC_DIR, target.lstrip("/")))
        if path != root and not path.startswith(root + os.sep):
            raise NotFound("资产不存在: %s" % target)
        if not os.path.isfile(path):
            raise NotFound("资产不存在: %s" % target)
        with open(path, "rb") as fh:
            body = fh.read()
        ext = os.path.splitext(path)[1].lower()
        self.send_response(200)
        self.send_header("Content-Type", ASSET_MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(body)

    # -- 路由 --
    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _dispatch(self, method: str) -> None:
        url = urlparse(self.path)
        if url.path in ("/print", "/print/"):
            return self._print_page(method, url)
        if not url.path.startswith("/api/"):
            if method == "GET":
                return super().do_GET()
            return self._error(405, "METHOD_NOT_ALLOWED", "静态资源仅支持 GET")
        try:
            self._route(method, url)
        except ValidationError as exc:
            self._error(400, "VALIDATION_ERROR", str(exc))
        except NotFound as exc:
            self._error(404, "NOT_FOUND", str(exc))
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write("ERROR %s %s -> %r\n" % (method, self.path, exc))
            self._error(500, "INTERNAL_ERROR", "服务器内部错误: %s" % exc)

    def _print_page(self, method: str, url) -> None:
        """GET /print?... -> A4 试卷 HTML。浏览器 Ctrl+P 存 PDF，零依赖。"""
        if method != "GET":
            return self._error(405, "METHOD_NOT_ALLOWED", "打印页只支持 GET")
        params = parse_qs(url.query, keep_blank_values=True)
        conn = connect(self.server.db_path)
        try:
            paper = build_paper(conn, params)
        except ValidationError as exc:
            return self._error(400, "VALIDATION_ERROR", str(exc))
        finally:
            conn.close()

        flat = {key: values[0] for key, values in params.items() if values}
        body = _paper_html(paper, flat).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _route(self, method: str, url) -> None:
        path = url.path
        params = parse_qs(url.query, keep_blank_values=True)
        conn = connect(self.server.db_path)
        try:
            if path == "/api/health" and method == "GET":
                return self._json(200, {"ok": True, "data": {"status": "ok", "time": now_str()}})
            if path == "/api/meta" and method == "GET":
                return self._json(200, {"ok": True, "data": meta(conn)})
            if path == "/api/settings":
                if method == "GET":
                    return self._json(200, {"ok": True, "data": {
                        "values": get_settings(conn), "labels": SETTING_LABELS,
                        "bounds": {k: list(v) for k, v in SETTING_BOUNDS.items()}}})
                if method in ("PUT", "POST"):
                    return self._json(200, {"ok": True,
                                            "data": save_settings(conn, self._read_json())})
            if path == "/api/trash" and method == "GET":
                return self._json(200, {"ok": True, "data": list_trash(
                    conn, to_int(one(params, "limit"), 50))})
            if path == "/api/trash/purge" and method == "POST":
                return self._json(200, {"ok": True, "data": purge_trash(conn)})
            match = re.fullmatch(r"/api/trash/(\d+)/restore", path)
            if match and method == "POST":
                return self._json(200, {"ok": True, "data": restore_trash(conn, int(match.group(1)))})
            match = re.fullmatch(r"/api/trash/(\d+)", path)
            if match and method == "DELETE":
                return self._json(200, {"ok": True, "data": purge_trash(conn, int(match.group(1)))})

            if path == "/api/stats" and method == "GET":
                return self._json(200, {"ok": True, "data": stats(conn)})
            if path == "/api/plan" and method == "GET":
                limit_raw = one(params, "limit").strip()
                return self._json(200, {"ok": True, "data": plan(
                    conn, to_int(one(params, "days"), 7),
                    to_int(limit_raw, None) if limit_raw else None,
                    one(params, "subject").strip())})
            if path == "/api/analytics" and method == "GET":
                return self._json(200, {"ok": True, "data": analytics(
                    conn, to_int(one(params, "days"), 30))})
            if path == "/api/events" and method == "GET":
                return self._json(200, {"ok": True, "data": read_events(
                    conn, min(500, max(1, to_int(one(params, "limit"), 50))),
                    one(params, "kind").strip(), to_int(one(params, "id"), 0))})
            if path == "/api/arena" and method == "GET":
                return self._json(200, {"ok": True, "data": arena(
                    conn, one(params, "subject").strip(),
                    to_int(one(params, "limit"), 50), one(params, "show").strip())})
            if path == "/api/paper" and method == "GET":
                return self._json(200, {"ok": True, "data": build_paper(conn, params)})
            if path == "/api/profile" and method == "GET":
                return self._json(200, {"ok": True, "data": profile(
                    conn, one(params, "subject").strip(),
                    min(50, max(1, to_int(one(params, "limit"), 20))))})
            if path == "/api/mastery" and method == "GET":
                return self._json(200, {"ok": True, "data": mastery(
                    conn, one(params, "subject").strip())})
            if path == "/api/export.csv" and method == "GET":
                return self._csv(conn, params)
            if path == "/api/export.json" and method == "GET":
                return self._stream("application/json; charset=utf-8",
                                    iter_export(conn), "mistakes-backup.json")
            if path == "/api/asset" and method == "GET":
                return self._asset(one(params, "path"))
            match = re.fullmatch(r"/api/images/([^/]+)", path)
            if match and method == "GET":
                return self._image(unquote(match.group(1)))

            if path == "/api/reminders" and method == "GET":
                return self._json(200, {"ok": True, "data": reminders(conn)})
            if path == "/api/knowledge/tree" and method == "GET":
                return self._json(200, {"ok": True, "data": knowledge_tree(
                    conn, one(params, "subject").strip())})
            if path == "/api/knowledge/aliases":
                if method == "GET":
                    return self._json(200, {"ok": True, "data": list_aliases(conn)})
                if method == "POST":
                    body = self._read_json()
                    return self._json(201, {"ok": True, "data": set_alias(
                        conn, body.get("alias") or "", body.get("canonical") or "")})
            match = re.fullmatch(r"/api/knowledge/aliases/(.+)", path)
            if match and method == "DELETE":
                alias = unquote(match.group(1))
                delete_alias(conn, alias)
                return self._json(200, {"ok": True, "data": {"deleted": alias}})
            if path == "/api/variants/gaps" and method == "GET":
                return self._json(200, {"ok": True, "data": variant_gaps(
                    conn, to_int(one(params, "limit"), 20), one(params, "subject").strip())})

            if path == "/api/papers":
                if method == "GET":
                    return self._json(200, {"ok": True, "data": list_papers(
                        conn, one(params, "subject").strip())})
                if method == "POST":
                    return self._json(201, {"ok": True,
                                            "data": create_paper(conn, self._read_json())})
            match = re.fullmatch(r"/api/papers/(\d+)", path)
            if match:
                pid = int(match.group(1))
                if method == "GET":
                    return self._json(200, {"ok": True, "data": get_paper(conn, pid)})
                if method in ("PUT", "PATCH"):
                    return self._json(200, {"ok": True,
                                            "data": update_paper(conn, pid, self._read_json())})
                if method == "DELETE":
                    return self._json(200, {"ok": True, "data": delete_paper(conn, pid)})

            if path == "/api/mistakes/bulk-update" and method == "POST":
                body = self._read_json()
                return self._json(200, {"ok": True, "data": bulk_update(
                    conn, body.get("ids"), body.get("fields") or {})})

            if path == "/api/mistakes":
                if method == "GET":
                    return self._json(200, {"ok": True, "data": query_mistakes(conn, params)})
                if method == "POST":
                    item = create_mistake(conn, self._read_json())
                    if item.pop("duplicate", False):
                        return self._json(200, {"ok": True, "data": item, "duplicate": True})
                    return self._json(201, {"ok": True, "data": item})

            if path == "/api/mistakes/batch" and method == "POST":
                body = self._read_json()
                items = body.get("items")
                if items is None:
                    items = parse_batch_text(body.get("text") or "")
                return self._json(201, {"ok": True, "data": create_mistakes(conn, items)})

            if path == "/api/mistakes/batch-delete" and method == "POST":
                body = self._read_json()
                return self._json(200, {"ok": True,
                                        "data": delete_mistakes(conn, body.get("ids"))})

            match = re.fullmatch(r"/api/mistakes/(\d+)", path)
            if match:
                mid = int(match.group(1))
                if method == "GET":
                    return self._json(200, {"ok": True, "data": get_mistake(conn, mid)})
                if method == "PUT":
                    item = update_mistake(conn, mid, self._read_json())
                    return self._json(200, {"ok": True, "data": item})
                if method == "DELETE":
                    delete_mistake(conn, mid)
                    return self._json(200, {"ok": True, "data": {"deleted": mid}})

            match = re.fullmatch(r"/api/mistakes/(\d+)/review", path)
            if match and method == "POST":
                item = review_mistake(conn, int(match.group(1)), self._read_json())
                return self._json(200, {"ok": True, "data": item})

            match = re.fullmatch(r"/api/mistakes/(\d+)/reviews", path)
            if match and method == "GET":
                return self._json(200, {"ok": True, "data": get_reviews(conn, int(match.group(1)))})

            match = re.fullmatch(r"/api/mistakes/(\d+)/(suspend|resume)", path)
            if match and method == "POST":
                return self._json(200, {"ok": True, "data": set_suspended(
                    conn, int(match.group(1)), match.group(2) == "suspend")})

            match = re.fullmatch(r"/api/mistakes/(\d+)/preview", path)
            if match and method == "GET":
                return self._json(200, {"ok": True, "data": preview_review(conn, int(match.group(1)))})

            match = re.fullmatch(r"/api/mistakes/(\d+)/variants", path)
            if match:
                pid = int(match.group(1))
                if method == "GET":
                    return self._json(200, {"ok": True, "data": list_variants(conn, pid)})
                if method == "POST":
                    return self._json(201, {"ok": True,
                                            "data": create_variant(conn, pid, self._read_json())})

            match = re.fullmatch(r"/api/mistakes/(\d+)/variants/next", path)
            if match and method == "GET":
                return self._json(200, {"ok": True, "data": pick_variant(conn, int(match.group(1)))})

            match = re.fullmatch(r"/api/variants/(\d+)", path)
            if match:
                vid = int(match.group(1))
                if method == "DELETE":
                    delete_variant(conn, vid)
                    return self._json(200, {"ok": True, "data": {"deleted": vid}})

            match = re.fullmatch(r"/api/variants/(\d+)/use", path)
            if match and method == "POST":
                return self._json(200, {"ok": True, "data": use_variant(conn, int(match.group(1)))})

            raise NotFound("接口不存在: %s %s" % (method, path))
        finally:
            conn.close()

    def _csv(self, conn: sqlite3.Connection, params: dict) -> None:
        where, args = build_filters(params)
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""

        header = ["ID", "学科", "题目", "我的答案", "正确答案", "解析", "错因", "错因分类",
                  "来源", "知识点", "标签", "难度", "状态", "复习次数",
                  "下次复习", "创建时间"]
        cursor = conn.execute(
            "SELECT " + LIST_COLUMNS + " FROM mistakes" + where_sql +
            " ORDER BY created_at DESC, id DESC", args)

        def chunks():
            buffer = io.StringIO()
            buffer.write("\ufeff")  # BOM，方便 Excel 直接打开
            writer = csv.writer(buffer)
            writer.writerow(header)
            yield buffer.getvalue()
            while True:
                rows = cursor.fetchmany(200)
                if not rows:
                    break
                buffer.seek(0)
                buffer.truncate(0)
                for row in rows:
                    writer.writerow([row["id"], row["subject"], row["question"], row["my_answer"],
                                     row["answer"], row["analysis"], row["error_reason"],
                                     row["mistake_type"], row["source"], row["knowledge"],
                                     row["tags"], row["difficulty"],
                                     STATUS_LABELS.get(row["status"], row["status"]),
                                     row["review_count"], row["next_review_at"] or "",
                                     row["created_at"]])
                yield buffer.getvalue()

        self._stream("text/csv; charset=utf-8", chunks(), "mistakes.csv")


def _backup_dir(db_path: str, backup_dir: str = "") -> str:
    """备份目录默认放在数据库文件旁边的 backups/，不写死在项目根。"""
    if backup_dir:
        return os.path.abspath(backup_dir)
    return os.path.join(os.path.dirname(os.path.abspath(db_path)), "backups")


def _list_backups(target_dir: str) -> list:
    """返回备份文件，最新在前。

    按 mtime 而不是纯文件名排序：同一秒内会生成 x.db / x-2.db，
    字符串序会把 -2 排在前面，导致轮转时误删最新的那份。
    """
    try:
        names = [n for n in os.listdir(target_dir)
                 if n.startswith("mistakes-") and n.endswith(".db")]
    except OSError:
        return []

    def key(name):
        try:
            return (os.path.getmtime(os.path.join(target_dir, name)), name)
        except OSError:
            return (0.0, name)

    return sorted(names, key=key, reverse=True)


def _prune_backups(target_dir: str, keep: int) -> int:
    removed = 0
    for name in _list_backups(target_dir)[max(keep, 1):]:
        try:
            os.remove(os.path.join(target_dir, name))
            removed += 1
        except OSError:
            pass
    return removed


def _sync_images(src_dir: str, dst_dir: str) -> int:
    """增量同步图片目录，返回新拷的个数。

    文件名就是内容哈希，所以"目标已存在"等价于"内容相同"，可以直接跳过：
    多次备份不会重复占空间，恢复时也只会补缺失的图。
    """
    if not os.path.isdir(src_dir):
        return 0
    os.makedirs(dst_dir, exist_ok=True)
    copied = 0
    for name in os.listdir(src_dir):
        if not IMAGE_NAME_RE.match(name):
            continue
        target = os.path.join(dst_dir, name)
        if not os.path.exists(target):
            shutil.copy2(os.path.join(src_dir, name), target)
            copied += 1
    return copied


def backup_db(db_path: str = DB_PATH, backup_dir: str = "", keep: int = BACKUP_KEEP) -> dict:
    """用 sqlite3 自带的在线备份 API 复制一份快照。

    不直接 copy 文件：WAL 模式下 .db 旁边还有 -wal/-shm，单独拷 .db 可能拷到
    还没落盘的半截数据。conn.backup() 走的是 SQLite 自己的页级复制，会等写锁、
    得到一份一致的快照，而且备份过程中不影响正在读写的进程。
    """
    if not os.path.exists(db_path):
        raise ValidationError("数据库还不存在，先录入一道题再备份")
    target_dir = _backup_dir(db_path, backup_dir)
    os.makedirs(target_dir, exist_ok=True)
    stem = os.path.join(target_dir, "mistakes-%s" % datetime.now().strftime("%Y%m%d-%H%M%S"))
    path = stem + ".db"
    seq = 2
    while os.path.exists(path):  # 同一秒内连备两次，别互相覆盖
        path = "%s-%d.db" % (stem, seq)
        seq += 1
    src = sqlite3.connect(db_path)
    try:
        dst = sqlite3.connect(path)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    # 图片不进 .db：另存一份增量镜像到 backups/images/，恢复时再同步回来。
    images = _sync_images(image_dir(db_path), os.path.join(target_dir, IMAGE_DIR_NAME))
    return {"ok": True, "path": path, "bytes": os.path.getsize(path),
            "images_copied": images, "removed": _prune_backups(target_dir, keep)}


def auto_backup(db_path: str = DB_PATH, backup_dir: str = "", keep: int = BACKUP_KEEP,
                min_hours: float = BACKUP_MIN_HOURS) -> dict:
    """启动时调一次：距上一份够久才备份。任何异常都不该挡住启动。"""
    if not os.path.exists(db_path):
        return {"skipped": "no_db"}
    target_dir = _backup_dir(db_path, backup_dir)
    names = _list_backups(target_dir)
    if names:
        newest = os.path.join(target_dir, names[0])
        try:
            age_hours = (time.time() - os.path.getmtime(newest)) / 3600.0
        except OSError:
            age_hours = min_hours + 1.0
        if age_hours < min_hours:
            return {"skipped": "too_soon", "last": names[0]}
    return backup_db(db_path, backup_dir, keep)


def restore_from_backup(db_path: str = DB_PATH, src_path: str = "",
                        backup_dir: str = "") -> dict:
    """用备份文件覆盖当前库。

    覆盖前先给当前库留一份 pre-restore 快照（还在 backups/ 里，误恢复也能退回去）。
    走 sqlite3 的 backup API 而不是直接 copy 文件：备份文件可能带 -wal，
    页级复制会把已提交但没 checkpoint 的内容一起带过来。
    """
    if not src_path:
        raise ValidationError("必须指定备份文件路径（mb.py restore --from <file.db>）")
    src_path = os.path.abspath(src_path)
    db_path = os.path.abspath(db_path)
    if not os.path.exists(src_path):
        raise ValidationError("备份文件不存在: %s" % src_path)
    if src_path == db_path:
        raise ValidationError("备份文件和当前库是同一个文件")

    probe = sqlite3.connect(src_path)
    try:
        try:
            names = {r[0] for r in probe.execute(
                "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        except sqlite3.DatabaseError:
            raise ValidationError("这不是错题本数据库（无法读取）: %s" % src_path)
        if "mistakes" not in names:
            raise ValidationError("这不是错题本数据库（缺 mistakes 表）: %s" % src_path)
        counts = {t: probe.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
                  for t in ("mistakes", "review_logs", "variants") if t in names}
    finally:
        probe.close()

    safety = None
    if os.path.exists(db_path):
        safety = backup_db(db_path, backup_dir)["path"]
        for suffix in ("-wal", "-shm"):   # 旧 WAL 不能回放到新库
            try:
                os.remove(db_path + suffix)
            except OSError:
                pass

    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    src = sqlite3.connect(src_path)
    try:
        dst = sqlite3.connect(db_path)
        try:
            src.backup(dst)
            dst.execute("PRAGMA journal_mode=WAL")
        finally:
            dst.close()
    finally:
        src.close()
    images = _sync_images(os.path.join(_backup_dir(db_path, backup_dir), IMAGE_DIR_NAME),
                          image_dir(db_path))
    return {"ok": True, "restored_from": src_path, "safety_backup": safety,
            "images_restored": images, "counts": counts,
            "note": "如果网页服务正在运行，请重启后再用，它才会打开恢复后的库"}


def create_server(host: str = "127.0.0.1", port: int = 8000, db_path: str | None = None):
    db_path = db_path or DB_PATH
    init_db(db_path)
    handler = partial(AppHandler, directory=STATIC_DIR)
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.daemon_threads = True
    httpd.db_path = db_path
    return httpd


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="错题本 MVP（零依赖）")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--db", default=DB_PATH)
    parser.add_argument("--no-backup", dest="no_backup", action="store_true",
                        help="启动时不做自动备份")
    args = parser.parse_args(argv)

    had_db = os.path.exists(args.db)
    init_db(args.db)
    if had_db and not args.no_backup:
        try:
            result = auto_backup(args.db)
            if result.get("path"):
                print("已自动备份: %s" % result["path"], flush=True)
        except Exception as exc:  # 备份失败绝不能挡住启动
            print("自动备份失败（不影响使用）: %s" % exc, flush=True)

    httpd = create_server(args.host, args.port, args.db)
    host, port = httpd.server_address[:2]
    print("错题本已启动: http://%s:%s" % (host, port))
    print("数据库文件: %s" % os.path.abspath(args.db))
    print("按 Ctrl+C 停止")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
