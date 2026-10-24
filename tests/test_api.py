# -*- coding: utf-8 -*-
"""错题本 API 端到端测试：真实启动 HTTP 服务，走完整闭环。"""
import base64
import datetime
import io
import json
import os
import shutil
import sys
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app  # noqa: E402
import mb  # noqa: E402

# 真实的 1x1 PNG。v0.15 起服务端会校验 magic bytes，随便编的 base64 不再通过。
PNG_1PX = ("data:image/png;base64,"
           "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def _png(extra: bytes = b"") -> str:
    """同一张 1x1 PNG 末尾追加不同字节，得到内容不同的合法图片。"""
    raw = base64.b64decode(PNG_1PX.split(",", 1)[1]) + extra
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


PNG_A, PNG_B, PNG_C = _png(b"A"), _png(b"B"), _png(b"C")


def _db_files(directory):
    """备份目录里只数 .db，images/ 子目录不算一份备份。"""
    return [n for n in os.listdir(directory) if n.endswith(".db")]


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmpdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tmp")
        shutil.rmtree(cls.tmpdir, ignore_errors=True)
        os.makedirs(cls.tmpdir, exist_ok=True)
        cls.db = os.path.join(cls.tmpdir, "test.db")
        cls.httpd = app.create_server("127.0.0.1", 0, cls.db)
        cls.base = "http://127.0.0.1:%d" % cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)
        shutil.rmtree(cls.tmpdir, ignore_errors=True)

    def setUp(self):
        conn = app.connect(self.db)
        conn.execute("DELETE FROM mistake_images")
        conn.execute("DELETE FROM mistakes")
        conn.execute("DELETE FROM papers")
        conn.execute("DELETE FROM review_logs")
        conn.execute("DELETE FROM variants")
        conn.execute("DELETE FROM knowledge_aliases")
        conn.execute("DELETE FROM settings")
        conn.execute("DELETE FROM trash")
        conn.commit()
        conn.close()
        # 图片目录也要清：否则前一个用例留下的 png 会让"同图只存一份"数错。
        shutil.rmtree(app.image_dir(self.db), ignore_errors=True)
        # 事件流是旁路文件，不在库里；不删会串到下一个用例。
        events = os.path.join(self.tmpdir, "events.ndjson")
        if os.path.exists(events):
            os.remove(events)

    def call(self, method, path, body=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            self.base + path, data=data, method=method,
            headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def create(self, **kwargs):
        payload = {"subject": "数学", "question": "求 f(x)=x^2 在 [0,1] 上的单调性"}
        payload.update(kwargs)
        status, body = self.call("POST", "/api/mistakes", payload)
        self.assertEqual(status, 201, body)
        return body["data"]

    # -- 批量导入 --
    def test_batch_import_text(self):
        text = ("题目: 求 lim x->0 sin x / x\n答案: 1\n知识点: 极限\n"
                "---\n"
                "题目: 第二题\n答案: 2\n错因分类: 粗心\n"
                "---\n"
                "题目: 错因写错的题\n错因分类: 乱写\n")
        status, body = self.call("POST", "/api/mistakes/batch", {"text": text})
        self.assertEqual(status, 201, body)
        data = body["data"]
        self.assertEqual(data["created_count"], 2)
        self.assertEqual(data["error_count"], 1)
        self.assertIn("错因分类", data["errors"][0]["error"])
        self.assertEqual(data["errors"][0]["index"], 2)

        status, body = self.call("GET", "/api/mistakes?q=" + urllib.parse.quote("极限"))
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["total"], 1)

    def test_batch_import_items(self):
        items = [{"question": "题目 A", "answer": "a"},
                 {"question": "题目 B", "tags": "x,y"},
                 {"answer": "没有题干"}]
        status, body = self.call("POST", "/api/mistakes/batch", {"items": items})
        self.assertEqual(status, 201, body)
        data = body["data"]
        self.assertEqual(data["created_count"], 2)
        self.assertEqual(data["error_count"], 1)
        self.assertIn("题目", data["errors"][0]["error"])

    def test_batch_import_multiline_and_plain_block(self):
        text = ("这道题没有键名，整块当题干\n第二行也算题干\n"
                "---\n"
                "题目: 有键名的题\n答案: 第一行\n第二行续上\n")
        items = app.parse_batch_text(text)
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["question"], "这道题没有键名，整块当题干\n第二行也算题干")
        self.assertEqual(items[1]["answer"], "第一行\n第二行续上")

    def test_batch_import_blank_line_split(self):
        # 空行也能分条：下一段以本块已出现过的键开头（面板与网页的提示都这么写）
        text = ("题目: 第一题\n答案: A\n\n"
                "题目: 第二题\n答案: B\n")
        items = app.parse_batch_text(text)
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["question"], "第一题")
        self.assertEqual(items[1]["question"], "第二题")
        # 但字段内部的空行（长题干分段）不能被拆开，也不能丢字
        text2 = "题目: 长题干第一段\n\n第二段\n答案: C\n"
        items2 = app.parse_batch_text(text2)
        self.assertEqual(len(items2), 1)
        self.assertIn("长题干第一段", items2[0]["question"])
        self.assertIn("第二段", items2[0]["question"])
        # 只出现一次键的块，空行不拆（避免把多段解析误判成两条）
        text3 = "题目: 单题\n\n答案: 只在后面出现\n"
        self.assertEqual(len(app.parse_batch_text(text3)), 1)

    def test_batch_import_limit(self):
        status, body = self.call("POST", "/api/mistakes/batch",
                                 {"items": [{"question": "q%d" % i} for i in range(201)]})
        self.assertEqual(status, 400, body)

    # -- 基础 --
    def test_health(self):
        status, body = self.call("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["status"], "ok")

    # -- 面板资产（v0.25：KaTeX 经 /api/asset 供给面板） --
    def test_asset_serves_katex(self):
        url = self.base + "/api/asset?path=" + urllib.parse.quote("/vendor/katex/katex.min.js")
        with urllib.request.urlopen(url, timeout=10) as resp:
            self.assertEqual(resp.status, 200)
            self.assertIn("text/javascript", resp.headers.get("Content-Type"))
            self.assertIn("max-age", resp.headers.get("Cache-Control"))
            body = resp.read()
        self.assertGreater(len(body), 100000)
        self.assertIn(b"katex", body[:5000].lower())

    def test_asset_serves_css(self):
        url = self.base + "/api/asset?path=" + urllib.parse.quote("/vendor/katex/katex.min.css")
        with urllib.request.urlopen(url, timeout=10) as resp:
            self.assertIn("text/css", resp.headers.get("Content-Type"))
            body = resp.read().decode("utf-8")
        self.assertIn("@font-face", body)

    def test_asset_rejects_escape_and_missing(self):
        for bad in ["/vendor/katex/../index.html", "/vendor/katex/../../app.py",
                    "/vendor/katex/nope.js", "/app.py", "/vendor/", ""]:
            status, body = self.call("GET", "/api/asset?path=" + urllib.parse.quote(bad))
            self.assertEqual(status, 404, bad)
            self.assertEqual(body["error"]["code"], "NOT_FOUND", bad)

    def _need_web(self):
        """本机删掉网页版静态文件时跳过（仓库里仍在；CI 上会真跑）。"""
        if not os.path.exists(os.path.join(app.STATIC_DIR, "index.html")):
            self.skipTest("本机已删除网页版静态文件（仓库里仍在）")

    def test_static_index(self):
        self._need_web()
        with urllib.request.urlopen(self.base + "/", timeout=5) as resp:
            html = resp.read().decode("utf-8")
        self.assertIn("错题本", html)
        self.assertIn("批量删除", html)
        # 学习页（知识点画像 / 掌握门禁）与变式题区块
        self.assertIn('data-view="study"', html)
        self.assertIn('id="st-list"', html)
        self.assertIn('id="var-box"', html)
        # v0.7：计划页 / 分析页 / 斩题
        self.assertIn('data-view="plan"', html)
        self.assertIn('data-view="an"', html)
        self.assertIn('id="pl-list"', html)
        self.assertIn('id="an-body"', html)
        self.assertIn('id="btn-suspend"', html)
        self.assertIn('id="scope-q"', html)
        self.assertIn('id="show-suspended"', html)
        # v0.8：组卷打印入口
        self.assertIn('id="btn-paper"', html)
        self.assertIn('id="dlg-paper"', html)
        self.assertIn('id="p-mode"', html)
        # v0.9：再战区
        self.assertIn('data-view="arena"', html)
        self.assertIn('id="ar-list"', html)
        self.assertIn('id="ar-show"', html)

    def test_static_three_pages_conclusion_first(self):
        """学习/计划/分析三页 = 结论卡 + 指标 + 折叠细节（v0.33）。

        这三页以前是「数据墙」：一屏全是数字，看完不知道该干什么。
        改成先说结论、再给一个按钮之后，用断言把结构钉住，免得以后又退回去。
        """
        self._need_web()
        with urllib.request.urlopen(self.base + "/", timeout=5) as resp:
            html = resp.read().decode("utf-8")
        # 每页都有结论卡与指标区
        for anchor in ('id="st-hero"', 'id="st-kpis"', 'id="pl-hero"',
                       'id="an-hero"', 'id="an-kpis"'):
            self.assertIn(anchor, html)
        # 旧的数据墙容器已经删掉，别再被加回来
        for gone in ('id="st-overview"', 'id="pl-overview"', 'id="an-overview"'):
            self.assertNotIn(gone, html)
        # 三页共用的结构与跳转工具函数
        for name in ('function jumpToList(', 'function kpi(', 'function kpVerdict(',
                     'function weakRow(', 'function planRow('):
            self.assertIn(name, html)
        # 每个主按钮都带 data-kp 或 id=pl-start，事件委托才能接住
        self.assertIn('class="primary" id="pl-start"', html)
        self.assertIn(".weekbars", html)

    def test_static_knowledge_facets_ui(self):
        """知识点分层下拉 + 未归类项 + 合并面板（v0.34）。

        知识点以前是自由文本：「111」「2」这样的脏值也能进库，下拉里一串裸字符串
        既看不出层级也没有题数，点父节点还检索不到子节点里的题。这一版把三件事
        一起改掉，用断言钉住，免得以后又退回扁平字符串。
        """
        self._need_web()
        with urllib.request.urlopen(self.base + "/", timeout=5) as resp:
            html = resp.read().decode("utf-8")
        # 1) 分层下拉：读 facet 的 depth/count，渲染缩进与题数
        self.assertIn("m.knowledge_flat", html)
        self.assertIn("m.knowledge_unclassified", html)
        self.assertIn("new Array((k.depth || 1)).join", html)
        # 2) 未归类走独立参数，不混进 knowledge
        self.assertIn("p.set('nokp', '1')", html)
        self.assertIn("p.set('kdeep', '1')", html)
        self.assertIn("value=\"__none__\"", html)
        # 3) 合并面板：勾选源 → 规范名 → POST /api/knowledge/merge
        self.assertIn('id="st-merge-box"', html)
        self.assertIn('id="mg-list"', html)
        self.assertIn('id="mg-merge"', html)
        self.assertIn("'/api/knowledge/merge'", html)
        for name in ('function mergeSources(', 'function loadMergeList('):
            self.assertIn(name, html)
        # 4) 表单知识点输入接上 datalist（原来没有建议列表）
        self.assertIn('id="f-knowledge" list="knowledge-list"', html)
        self.assertIn('<datalist id="knowledge-list">', html)
        # 5) 卡片 chip 只显示末段，全路径放 title
        self.assertIn("String(it.knowledge).split('/').pop()", html)

    def test_create_requires_question(self):
        status, body = self.call("POST", "/api/mistakes", {"subject": "数学"})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "VALIDATION_ERROR")

    def test_create_allows_image_only(self):
        # v0.52：截图录题是主要用法，题干可以空着，只要带了图
        status, body = self.call("POST", "/api/mistakes", {"subject": "高数", "images": [{"data": PNG_A}]})
        self.assertEqual(status, 201, body)
        item = body["data"]
        self.assertEqual(item["question"], "")
        self.assertTrue(item["has_image"])
        self.assertEqual(len(item["images"]), 1)

    def test_image_only_items_are_not_deduped(self):
        # 空题干不参与「3 秒内同题干」去重，否则连着截两张图只会留下第一张
        status1, body1 = self.call("POST", "/api/mistakes", {"images": [{"data": PNG_A}]})
        status2, body2 = self.call("POST", "/api/mistakes", {"images": [{"data": PNG_B}]})
        self.assertEqual((status1, status2), (201, 201))
        self.assertNotEqual(body1["data"]["id"], body2["data"]["id"])

    def test_update_keeps_image_only_item(self):
        status, body = self.call("POST", "/api/mistakes", {"images": [{"data": PNG_C}]})
        self.assertEqual(status, 201, body)
        mid = body["data"]["id"]
        # 只改知识点：题干空、也没带图，但库里已有图，照样能存
        status, body = self.call("PUT", "/api/mistakes/%d" % mid, {"knowledge": "极限"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["knowledge"], "极限")
        # 题干和图片都清空 → 拒
        status, body = self.call("PUT", "/api/mistakes/%d" % mid, {"question": "", "images": []})
        self.assertEqual(status, 400, body)
        self.assertEqual(body["error"]["code"], "VALIDATION_ERROR")

    def test_create_defaults(self):
        item = self.create()
        self.assertGreater(item["id"], 0)
        self.assertEqual(item["status"], "new")
        self.assertEqual(item["difficulty"], 3)
        self.assertEqual(item["review_count"], 0)
        self.assertEqual(item["stage"], 0)
        self.assertEqual(item["mistake_type"], "")
        self.assertEqual(item["source"], "")
        self.assertTrue(item["next_review_at"])
        # FSRS 状态初始为 0，第一次复习才初始化
        self.assertEqual(item["fsrs_stability"], 0)
        self.assertEqual(item["fsrs_difficulty"], 0)
        self.assertEqual(item["fsrs_reps"], 0)
        self.assertEqual(item["fsrs_lapses"], 0)

    def test_search_and_filters(self):
        self.create(subject="数学", question="二次函数最值", knowledge="二次函数", tags="函数,最值")
        self.create(subject="英语", question="虚拟语气用法", knowledge="语法", tags="语法")

        _, body = self.call("GET", "/api/mistakes?q=" + urllib.parse.quote("二次"))
        self.assertEqual(body["data"]["total"], 1)

        _, body = self.call("GET", "/api/mistakes?q=" + urllib.parse.quote("语法"))
        self.assertEqual(body["data"]["total"], 1)

        _, body = self.call("GET", "/api/mistakes?subject=" + urllib.parse.quote("英语"))
        self.assertEqual(body["data"]["total"], 1)

        _, body = self.call("GET", "/api/mistakes?tag=" + urllib.parse.quote("函数"))
        self.assertEqual(body["data"]["total"], 1)

        _, body = self.call("GET", "/api/mistakes?knowledge=" + urllib.parse.quote("二次函数"))
        self.assertEqual(body["data"]["total"], 1)

        _, body = self.call("GET", "/api/mistakes?knowledge=" + urllib.parse.quote("不存在"))
        self.assertEqual(body["data"]["total"], 0)

        _, body = self.call("GET", "/api/mistakes?page=1&page_size=1")
        self.assertEqual(body["data"]["total"], 2)
        self.assertEqual(len(body["data"]["items"]), 1)

    def test_mistake_type_and_source(self):
        item = self.create(mistake_type="计算失误", source="期中")
        self.assertEqual(item["mistake_type"], "计算失误")
        self.assertEqual(item["source"], "期中")

        # 来源参与关键词搜索
        _, body = self.call("GET", "/api/mistakes?q=" + urllib.parse.quote("期中"))
        self.assertEqual(body["data"]["total"], 1)

        # 按错因分类 / 来源精确筛选
        _, body = self.call("GET", "/api/mistakes?mistake_type=" + urllib.parse.quote("计算失误"))
        self.assertEqual(body["data"]["total"], 1)
        _, body = self.call("GET", "/api/mistakes?mistake_type=" + urllib.parse.quote("粗心"))
        self.assertEqual(body["data"]["total"], 0)
        _, body = self.call("GET", "/api/mistakes?source=" + urllib.parse.quote("期中"))
        self.assertEqual(body["data"]["total"], 1)

    def test_invalid_mistake_type_rejected(self):
        status, body = self.call("POST", "/api/mistakes",
                                 {"question": "x", "mistake_type": "瞎写的分类"})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "VALIDATION_ERROR")

    def test_duplicate_submit_guard(self):
        payload = {"subject": "数学", "question": "同一道题重复提交"}
        status1, body1 = self.call("POST", "/api/mistakes", payload)
        self.assertEqual(status1, 201)
        # 3 秒内相同题目 -> 复用已有记录，不再新建
        status2, body2 = self.call("POST", "/api/mistakes", payload)
        self.assertEqual(status2, 200)
        self.assertTrue(body2.get("duplicate"))
        self.assertEqual(body2["data"]["id"], body1["data"]["id"])
        _, body = self.call("GET", "/api/mistakes")
        self.assertEqual(body["data"]["total"], 1)

    def test_get_update_delete(self):
        item = self.create()
        mid = item["id"]

        status, body = self.call("GET", "/api/mistakes/%d" % mid)
        self.assertEqual(status, 200)

        status, body = self.call("PUT", "/api/mistakes/%d" % mid,
                                 {"status": "mastered", "difficulty": 5})
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["status"], "mastered")
        self.assertEqual(body["data"]["difficulty"], 5)
        self.assertEqual(body["data"]["question"], item["question"])  # 未提供字段保持不变

        status, _ = self.call("DELETE", "/api/mistakes/%d" % mid)
        self.assertEqual(status, 200)

        status, body = self.call("GET", "/api/mistakes/%d" % mid)
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["code"], "NOT_FOUND")

    def test_batch_delete(self):
        a = self.create(question="批量题 A")
        b = self.create(question="批量题 B")
        c = self.create(question="批量题 C")

        status, body = self.call("POST", "/api/mistakes/batch-delete",
                                 {"ids": [a["id"], b["id"], 999999]})
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["deleted"], 2)

        _, body = self.call("GET", "/api/mistakes")
        self.assertEqual(body["data"]["total"], 1)
        self.assertEqual(body["data"]["items"][0]["id"], c["id"])

        status, body = self.call("POST", "/api/mistakes/batch-delete", {"ids": []})
        self.assertEqual(status, 400)

    def test_review_schedule_and_history(self):
        item = self.create()
        mid = item["id"]

        status, body = self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "good"})
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["review_count"], 1)
        self.assertEqual(body["data"]["stage"], 1)
        self.assertEqual(body["data"]["status"], "reviewing")
        self.assertGreater(body["data"]["next_review_at"], body["data"]["last_reviewed_at"])
        # FSRS-6：首次 good -> 初始稳定性 w[2]=2.3065，间隔 2 天
        self.assertAlmostEqual(body["data"]["fsrs_stability"], 2.3065, places=3)
        self.assertEqual(body["data"]["fsrs_reps"], 1)
        self.assertEqual(body["data"]["fsrs_lapses"], 0)

        status, body = self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "good"})
        self.assertEqual(body["data"]["stage"], 2)

        # 答错 -> 阶梯归零，稳定性被打回 0.7751（遗忘公式），lapses +1
        status, body = self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "again"})
        self.assertEqual(body["data"]["stage"], 0)
        self.assertEqual(body["data"]["review_count"], 3)
        self.assertAlmostEqual(body["data"]["fsrs_stability"], 0.7751, places=3)
        self.assertEqual(body["data"]["fsrs_lapses"], 1)

        status, body = self.call("GET", "/api/mistakes/%d/reviews" % mid)
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["total"], 3)
        self.assertEqual(body["data"]["graded"], 3)
        self.assertEqual(body["data"]["correct"], 2)
        self.assertEqual([r["result"] for r in body["data"]["items"]],
                         ["again", "good", "good"])
        self.assertEqual([r["rating"] for r in body["data"]["items"]], [1, 3, 3])
        self.assertAlmostEqual(body["data"]["accuracy"], 0.667, places=3)

        status, body = self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "mastered"})
        self.assertEqual(body["data"]["status"], "mastered")
        self.assertIsNone(body["data"]["next_review_at"])

    def test_fsrs_preview(self):
        item = self.create()
        status, body = self.call("GET", "/api/mistakes/%d/preview" % item["id"])
        self.assertEqual(status, 200)
        plan = body["data"]["preview"]
        # 新题四档间隔：忘了 1 天、困难 1 天、记得 2 天、简单 8 天
        self.assertEqual(plan, {"again": 1, "hard": 1, "good": 2, "easy": 8})
        self.assertIsNone(body["data"]["retrievability"])

        # 复习一次后，可提取率应接近 1
        self.call("POST", "/api/mistakes/%d/review" % item["id"], {"result": "good"})
        _, body = self.call("GET", "/api/mistakes/%d/preview" % item["id"])
        self.assertAlmostEqual(body["data"]["retrievability"], 1.0, places=2)
        plan = body["data"]["preview"]
        # 已经复习过一次，四档间隔按 FSRS 重算，且简单 > 记得 > 忘了
        self.assertGreater(plan["easy"], plan["good"])
        self.assertGreaterEqual(plan["good"], plan["again"])

    def test_rating_accepts_numbers(self):
        item = self.create()
        # rating=4 等价 easy
        status, body = self.call("POST", "/api/mistakes/%d/review" % item["id"], {"rating": 4})
        self.assertEqual(status, 200)
        self.assertAlmostEqual(body["data"]["fsrs_stability"], 8.2956, places=3)
        self.assertEqual(body["data"]["status"], "reviewing")

        # rating 越界
        status, body = self.call("POST", "/api/mistakes/%d/review" % item["id"], {"rating": 9})
        self.assertEqual(status, 400)

    def test_fsrs_interval_grows_after_real_delay(self):
        item = self.create()
        mid = item["id"]
        self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "good"})
        # 把上次复习时间挪到 10 天前，模拟真实遗忘
        conn = app.connect(self.db)
        conn.execute("UPDATE mistakes SET last_reviewed_at=datetime('now','-10 days') "
                     "WHERE id=?", (mid,))
        conn.commit()
        conn.close()
        _, body = self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "good"})
        self.assertGreater(body["data"]["fsrs_stability"], 20)
        self.assertGreater(body["data"]["fsrs_stability"], 2.3065)

    def test_mastered_stops_scheduling(self):
        item = self.create()
        mid = item["id"]
        self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "good"})
        _, body = self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "mastered"})
        self.assertEqual(body["data"]["status"], "mastered")
        self.assertIsNone(body["data"]["next_review_at"])
        # 掌握不是记忆评分，不推进 FSRS
        self.assertAlmostEqual(body["data"]["fsrs_stability"], 2.3065, places=3)
        _, body = self.call("GET", "/api/mistakes/%d/reviews" % mid)
        self.assertEqual(body["data"]["graded"], 1)  # 只有那次 good 计入评分
        self.assertEqual(body["data"]["total"], 2)

    def test_review_invalid_result(self):
        item = self.create()
        status, body = self.call("POST", "/api/mistakes/%d/review" % item["id"],
                                 {"result": "nonsense"})
        self.assertEqual(status, 400)

    def test_delete_cascades_review_logs(self):
        item = self.create()
        mid = item["id"]
        self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "good"})
        self.call("DELETE", "/api/mistakes/%d" % mid)
        conn = app.connect(self.db)
        left = conn.execute("SELECT COUNT(*) FROM review_logs WHERE mistake_id=?",
                            (mid,)).fetchone()[0]
        conn.close()
        self.assertEqual(left, 0)

    def test_time_range_filter(self):
        self.create(question="新录入的题")
        old = self.create(question="很久以前的题")
        conn = app.connect(self.db)
        conn.execute("UPDATE mistakes SET created_at='2020-01-01 08:00:00' WHERE id=?",
                     (old["id"],))
        conn.commit()
        conn.close()

        _, body = self.call("GET", "/api/mistakes?range=week")
        self.assertEqual(body["data"]["total"], 1)
        _, body = self.call("GET", "/api/mistakes?range=month")
        self.assertEqual(body["data"]["total"], 1)
        _, body = self.call("GET", "/api/mistakes")
        self.assertEqual(body["data"]["total"], 2)

    def test_stats_and_meta(self):
        self.create(subject="数学", question="统计题一", tags="函数", mistake_type="概念不清",
                    source="期中")
        self.create(subject="数学", question="统计题二", tags="函数", mistake_type="计算失误")
        self.create(subject="英语", question="统计题三", tags="语法")

        status, body = self.call("GET", "/api/stats")
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["total"], 3)
        self.assertEqual(body["data"]["due"], 3)
        self.assertEqual(body["data"]["reviews"]["total"], 0)
        self.assertIsNone(body["data"]["reviews"]["accuracy"])
        types = {x["mistake_type"]: x["count"] for x in body["data"]["by_type"]}
        self.assertEqual(types, {"概念不清": 1, "计算失误": 1})

        status, body = self.call("GET", "/api/meta")
        self.assertEqual(sorted(body["data"]["subjects"]), ["数学", "英语"])
        self.assertIn("函数", body["data"]["tags"])
        self.assertIn("knowledge", body["data"])
        self.assertIn("概念不清", body["data"]["mistake_types"])
        # v0.43：sources 只回库里真用过的值，不再把 8 个内置值并进来
        self.assertEqual(body["data"]["sources"], ["期中"])
        self.assertIn("source_facets", body["data"])

    def test_meta_sources_are_live(self):
        """v0.43：来源候选只来自库里真用过的值，0 题的内置值不再占位。"""
        self.create(question="活词表一", source="周测")
        self.create(question="活词表二", source="周测")
        self.create(question="活词表三", source="自编卷")
        _, body = self.call("GET", "/api/meta")
        # 按题量降序：周测 2 题在前，自编卷 1 题在后
        self.assertEqual(body["data"]["sources"], ["周测", "自编卷"])
        self.assertNotIn("模拟考", body["data"]["sources"])
        self.assertNotIn("其他", body["data"]["sources"])

    def test_meta_source_facets_counted(self):
        self.create(question="分面一", source="周测")
        self.create(question="分面二", source="周测")
        self.create(question="分面三", source="自编卷")
        _, body = self.call("GET", "/api/meta")
        facets = {f["name"]: f for f in body["data"]["source_facets"]}
        self.assertEqual(facets["周测"]["count"], 2)
        self.assertTrue(facets["周测"]["system"])
        self.assertEqual(facets["自编卷"]["count"], 1)
        self.assertFalse(facets["自编卷"]["system"])
        # 0 题的内置值仍留在 facets 里（管理面板「未使用」分组要用），但 count=0
        self.assertEqual(facets["模拟考"]["count"], 0)
        self.assertTrue(facets["模拟考"]["system"])
        self.assertNotIn("模拟考", body["data"]["sources"])

    def test_meta_merge_source(self):
        a = self.create(question="来源合并一", source="周测")
        b = self.create(question="来源合并二", source="周测")
        c = self.create(question="来源合并三", source="小测")
        status, body = self.call("POST", "/api/meta/merge",
                                 {"kind": "source", "sources": ["小测"], "target": "周测"})
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["moved"], 1)
        for mid in (a["id"], b["id"], c["id"]):
            _, got = self.call("GET", "/api/mistakes/%d" % mid)
            self.assertEqual(got["data"]["source"], "周测")
        _, meta = self.call("GET", "/api/meta")
        self.assertEqual(meta["data"]["sources"], ["周测"])

    def test_meta_clear_source(self):
        """target 为空 = 删除这个来源值：题目不动，只是来源清空。"""
        item = self.create(question="来源清空", source="自编卷")
        status, body = self.call("POST", "/api/meta/merge",
                                 {"kind": "source", "sources": ["自编卷"], "target": ""})
        self.assertEqual(status, 200)
        self.assertTrue(body["data"]["cleared"])
        self.assertEqual(body["data"]["moved"], 1)
        _, got = self.call("GET", "/api/mistakes/%d" % item["id"])
        self.assertEqual(got["data"]["source"], "")
        _, meta = self.call("GET", "/api/meta")
        self.assertEqual(meta["data"]["sources"], [])

    def test_stats_review_accuracy(self):
        item = self.create()
        mid = item["id"]
        self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "good"})
        self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "again"})
        _, body = self.call("GET", "/api/stats")
        self.assertEqual(body["data"]["reviews"]["total"], 2)
        self.assertEqual(body["data"]["reviews"]["correct"], 1)
        self.assertAlmostEqual(body["data"]["reviews"]["accuracy"], 0.5)

    def test_export_csv(self):
        self.create(question="导出测试题", mistake_type="审题错误", source="月考")
        with urllib.request.urlopen(self.base + "/api/export.csv", timeout=5) as resp:
            text = resp.read().decode("utf-8-sig")
        self.assertIn("导出测试题", text)
        self.assertIn("学科", text)
        self.assertIn("错因分类", text)
        self.assertIn("审题错误", text)
        self.assertIn("月考", text)

    def test_export_json(self):
        item = self.create(question="备份测试题")
        self.call("POST", "/api/mistakes/%d/review" % item["id"], {"result": "good"})
        with urllib.request.urlopen(self.base + "/api/export.json", timeout=5) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        self.assertEqual(body["version"], 5)
        self.assertEqual(body["counts"], {"mistakes": 1, "review_logs": 1,
                                          "variants": 0, "knowledge_aliases": 0,
                                          "papers": 0, "mistake_images": 0})
        self.assertEqual(body["knowledge_aliases"], [])
        self.assertEqual(body["mistakes"][0]["question"], "备份测试题")
        self.assertEqual(body["review_logs"][0]["result"], "good")

    # -- v0.11：数据库备份 --
    def test_backup_creates_readable_snapshot(self):
        self.create(question="备份快照题")
        target = os.path.join(self.tmpdir, "bk")
        result = app.backup_db(self.db, backup_dir=target)
        self.assertTrue(os.path.exists(result["path"]))
        self.assertGreater(result["bytes"], 0)
        conn = app.connect(result["path"])
        try:
            rows = conn.execute("SELECT question FROM mistakes").fetchall()
        finally:
            conn.close()
        self.assertEqual([r[0] for r in rows], ["备份快照题"])

    def test_backup_keeps_only_n(self):
        target = os.path.join(self.tmpdir, "bk_keep")
        for _ in range(3):
            app.backup_db(self.db, backup_dir=target, keep=10)
        self.assertEqual(len(_db_files(target)), 3)
        app.backup_db(self.db, backup_dir=target, keep=2)
        self.assertEqual(len(_db_files(target)), 2)

    def test_backup_same_second_does_not_overwrite(self):
        target = os.path.join(self.tmpdir, "bk_same")
        first = app.backup_db(self.db, backup_dir=target)
        second = app.backup_db(self.db, backup_dir=target)
        self.assertNotEqual(first["path"], second["path"])
        self.assertEqual(len(_db_files(target)), 2)

    def test_auto_backup_skips_when_recent(self):
        target = os.path.join(self.tmpdir, "bk_auto")
        app.backup_db(self.db, backup_dir=target)
        result = app.auto_backup(self.db, backup_dir=target)
        self.assertEqual(result["skipped"], "too_soon")
        # 把 min_hours 设成 0，就应当真的再备一份
        result = app.auto_backup(self.db, backup_dir=target, min_hours=0)
        self.assertIn("path", result)

    def test_cli_backup(self):
        target = os.path.join(self.tmpdir, "bk_cli")
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "backup", "--dir", target, "--keep", "3"])
        self.assertEqual(code, 0)
        data = json.loads(out.getvalue())
        self.assertTrue(data["ok"])
        self.assertTrue(os.path.exists(data["path"]))
    # -- v0.4：变式题库 --
    def test_variant_crud(self):
        item = self.create(knowledge="极限")
        mid = item["id"]

        status, body = self.call("POST", "/api/mistakes/%d/variants" % mid,
                                 {"question": "求 lim sin(5x)/x", "answer": "5"})
        self.assertEqual(status, 201, body)
        v1 = body["data"]
        self.assertEqual(v1["parent_id"], mid)
        self.assertEqual(v1["knowledge"], "极限")   # 未传则继承母题知识点
        self.assertEqual(v1["times_used"], 0)

        status, body = self.call("POST", "/api/mistakes/%d/variants" % mid,
                                 {"question": "求 lim sin(7x)/(2x)", "answer": "7/2"})
        v2 = body["data"]

        _, body = self.call("GET", "/api/mistakes/%d/variants" % mid)
        self.assertEqual(body["data"]["total"], 2)

        # next 优先取用得最少的；用掉 v1 后应换成 v2
        _, body = self.call("GET", "/api/mistakes/%d/variants/next" % mid)
        self.assertEqual(body["data"]["next"]["id"], v1["id"])
        status, body = self.call("POST", "/api/variants/%d/use" % v1["id"])
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["times_used"], 1)
        _, body = self.call("GET", "/api/mistakes/%d/variants/next" % mid)
        self.assertEqual(body["data"]["next"]["id"], v2["id"])

        # 列表里带 variant_count
        _, body = self.call("GET", "/api/mistakes?q=" + urllib.parse.quote("单调性"))
        self.assertEqual(body["data"]["items"][0]["variant_count"], 2)

        status, _ = self.call("DELETE", "/api/variants/%d" % v1["id"])
        self.assertEqual(status, 200)
        _, body = self.call("GET", "/api/mistakes/%d/variants" % mid)
        self.assertEqual(body["data"]["total"], 1)

    def test_variant_validation(self):
        item = self.create()
        status, body = self.call("POST", "/api/mistakes/999999/variants",
                                 {"question": "孤儿变式"})
        self.assertEqual(status, 404)

        status, body = self.call("POST", "/api/mistakes/%d/variants" % item["id"],
                                 {"question": "   "})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "VALIDATION_ERROR")

        status, body = self.call("GET", "/api/mistakes/999999/variants")
        self.assertEqual(status, 404)
        status, body = self.call("GET", "/api/mistakes/999999/variants/next")
        self.assertEqual(status, 404)

    def test_variant_next_empty(self):
        item = self.create()
        _, body = self.call("GET", "/api/mistakes/%d/variants/next" % item["id"])
        self.assertIsNone(body["data"]["next"])
        self.assertIn("hint", body["data"])

    # -- v0.4：学习画像与掌握门禁 --
    def _drill(self, mid, rounds=3, days=20):
        """连续 good，并把上次复习时间往前挪，制造真实间隔。"""
        for _ in range(rounds):
            self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "good"})
            conn = app.connect(self.db)
            conn.execute("UPDATE mistakes SET last_reviewed_at = "
                         "strftime('%Y-%m-%d %H:%M:%S', last_reviewed_at, ?) WHERE id = ?",
                         ("-%d days" % days, mid))
            conn.commit()
            conn.close()

    def test_profile(self):
        ids = []
        for i in range(3):
            ids.append(self.create(question="极限题 %d" % i, knowledge="极限")["id"])
        self._drill(ids[0], rounds=1)
        self.call("POST", "/api/mistakes/%d/review" % ids[1], {"result": "again"})

        status, body = self.call("GET", "/api/profile")
        self.assertEqual(status, 200)
        data = body["data"]
        self.assertEqual(data["summary"]["total"], 3)
        self.assertEqual(data["summary"]["points"], 1)
        self.assertEqual(data["summary"]["graded"], 2)
        self.assertAlmostEqual(data["summary"]["accuracy"], 0.5)

        point = data["points"][0]
        self.assertEqual(point["knowledge"], "极限")
        self.assertEqual(point["mistakes"], 3)
        self.assertEqual(sorted(point["mistake_ids"]), sorted(ids))
        self.assertEqual(point["graded"], 2)
        self.assertEqual(point["correct"], 1)
        # 每条结论都要能追到具体的 review_log
        self.assertTrue(point["evidence_review_ids"])
        self.assertFalse(point["mastered_gate"])
        self.assertTrue(point["gate_reasons"])
        # 熟练度分档：S 还很小，应落在薄弱档
        self.assertEqual(point["band"]["key"], "weak")
        self.assertEqual(point["band"]["label"], "薄弱")

        # 按学科过滤
        _, body = self.call("GET", "/api/profile?subject=" + urllib.parse.quote("英语"))
        self.assertEqual(body["data"]["summary"]["total"], 0)

    def test_mastery_gate(self):
        ids = []
        for i in range(3):
            ids.append(self.create(question="门禁题 %d" % i, knowledge="导数")["id"])

        _, body = self.call("GET", "/api/mastery")
        self.assertEqual(body["data"]["points_total"], 1)
        self.assertEqual(body["data"]["passed_total"], 0)
        reasons = body["data"]["pending"][0]["gate_reasons"]
        self.assertTrue(any("题目不足" not in r for r in reasons))
        self.assertEqual(body["data"]["thresholds"],
                         {"min_mistakes": 3, "min_stage": 2, "min_stability": 21.0})

        self.assertEqual(body["data"]["bands"]["weak"], "薄弱")
        self.assertEqual(body["data"]["band_counts"]["weak"], 1)

        # 三道题各刷 3 轮 good 并伪造 20 天间隔 -> 稳定性与连续答对都过线
        for mid in ids:
            self._drill(mid)
        _, body = self.call("GET", "/api/mastery")
        self.assertEqual(body["data"]["passed_total"], 1)
        self.assertEqual(body["data"]["band_counts"]["weak"], 0)
        self.assertEqual(sum(body["data"]["band_counts"].values()), 1)
        self.assertEqual(body["data"]["pending"], [])
        self.assertTrue(body["data"]["passed"][0]["mastered_gate"])

        # 删掉一道 -> 题目数不足 3，门禁重新不通过
        self.call("DELETE", "/api/mistakes/%d" % ids[2])
        _, body = self.call("GET", "/api/mastery")
        self.assertEqual(body["data"]["passed_total"], 0)
        self.assertIn("题目不足", body["data"]["pending"][0]["gate_reasons"][0])

        # stats 里也带门禁口径
        _, body = self.call("GET", "/api/stats")
        self.assertEqual(body["data"]["mastery"], {"points": 1, "passed": 0})

    # -- v0.4：CLI 权限模型 --
    def test_mb_read_only_blocks_writes(self):
        item = self.create()
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "--read-only", "review",
                            str(item["id"]), "--rating", "good"])
        self.assertEqual(code, 2)
        self.assertIn("read-only", out.getvalue())
        # 没写进去
        _, body = self.call("GET", "/api/mistakes/%d/reviews" % item["id"])
        self.assertEqual(body["data"]["total"], 0)

        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "--read-only", "due", "--limit", "5"])
        self.assertEqual(code, 0)

    def test_mb_variant_and_profile(self):
        item = self.create(knowledge="极限")
        mid = item["id"]
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "variant", "add", str(mid),
                            "--question", "求 lim sin(9x)/x", "--answer", "9"])
        self.assertEqual(code, 0)
        self.assertIn("求 lim sin(9x)/x", out.getvalue())

        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "variant", "next", str(mid)])
        self.assertEqual(code, 0)
        self.assertIn("times_used", out.getvalue())

        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "profile"])
        self.assertEqual(code, 0)
        self.assertIn("evidence_review_ids", out.getvalue())

    def test_mb_plan_analytics_suspend(self):
        mid = self.create(question="计划 CLI 题", knowledge="极限")["id"]
        self._make_due(mid, 2)

        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "plan", "--days", "3", "--limit", "2"])
        self.assertEqual(code, 0)
        body = json.loads(out.getvalue())
        self.assertEqual(body["window_days"], 3)
        self.assertEqual(body["total"], 1)

        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "analytics", "--days", "7"])
        self.assertEqual(code, 0)
        self.assertIn("retention", json.loads(out.getvalue()))

        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "suspend", str(mid)])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["suspended"], 1)

        # --read-only 拦住 suspend
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "--read-only", "suspend", str(mid)])
        self.assertEqual(code, 2)

        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "suspend", str(mid), "--resume"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["suspended"], 0)

    def test_mb_list_truncates_long_text(self):
        long_q = "长题干" * 200
        self.create(question=long_q)
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "list"])
        self.assertEqual(code, 0)
        self.assertIn("truncated", out.getvalue())

        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "list", "--full"])
        self.assertEqual(code, 0)
        self.assertNotIn("question_truncated", out.getvalue())

    # -- v0.14.1：one() 兼容标量参数（修 CLI 筛选值被截成首字） --
    def test_one_handles_scalar_and_list(self):
        self.assertEqual(app.one({"q": "极限"}, "q"), "极限")
        self.assertEqual(app.one({"q": ["极限"]}, "q"), "极限")
        self.assertEqual(app.one({"q": ["极限", "多余"]}, "q"), "极限")
        self.assertEqual(app.one({"q": ""}, "q", "默认"), "默认")
        self.assertEqual(app.one({"q": []}, "q", "默认"), "默认")
        self.assertEqual(app.one({}, "q", "默认"), "默认")
        self.assertEqual(app.one({"n": 20}, "n"), "20")

    def test_build_filters_accepts_scalar_params(self):
        where, args = app.build_filters({"subject": "高数"})
        self.assertIn("subject = ?", where)
        self.assertIn("高数", args)

    def test_mb_list_two_char_keyword_not_truncated(self):
        mid = self.create(subject="高数", question="求极限 lim(x->0) sin x / x", knowledge="极限")["id"]
        self.create(subject="高数", question="求导数 f'(x)", knowledge="导数")
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "list", "--q", "极限"])
        self.assertEqual(code, 0)
        data = json.loads(out.getvalue())
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["id"], mid)

    def test_mb_list_limit_not_truncated(self):
        for i in range(12):
            self.create(question="分页题 %d" % i)
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "list", "--limit", "10"])
        self.assertEqual(code, 0)
        self.assertEqual(len(json.loads(out.getvalue())["items"]), 10)

    def test_mb_due_limit_not_truncated(self):
        ids = [self.create(question="到期题 %d" % i)["id"] for i in range(6)]
        for mid in ids:
            self._make_due(mid, 1)
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "due", "--limit", "5"])
        self.assertEqual(code, 0)
        self.assertEqual(len(json.loads(out.getvalue())["items"]), 5)

    # -- v0.7：今日复习计划 / 斩题 / 学习分析 --
    @staticmethod
    def _stamp(days=0):
        """本地时间的相对日期戳。

        刻意不用 SQLite 的 datetime('now', '+N days') —— 那是 UTC，而 app 的
        计划分桶用本地 datetime.now()。本机在 UTC+8，当地 0:00~8:00 之间两者
        差一天，测试会莫名其妙地红（2026-10-23 00:25 就踩过一次）。
        """
        return (datetime.datetime.now() + datetime.timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")

    def _make_due(self, mid, days_ago):
        conn = app.connect(self.db)
        stamp = self._stamp(-days_ago)
        conn.execute(
            "UPDATE mistakes SET next_review_at = ?, "
            "last_reviewed_at = ?, fsrs_stability = 5, "
            "stage = 1, status = 'reviewing' WHERE id = ?",
            (stamp, stamp, mid))
        conn.commit()
        conn.close()

    def test_plan_buckets_due_into_days(self):
        ids = [self.create(question="计划题 %d" % i)["id"] for i in range(3)]
        self._make_due(ids[0], 2)
        self._make_due(ids[1], 1)
        conn = app.connect(self.db)
        conn.execute("UPDATE mistakes SET next_review_at = ?, "
                     "status='reviewing' WHERE id=?", (self._stamp(3), ids[2]))
        conn.commit()
        conn.close()

        status, body = self.call("GET", "/api/plan?days=7&limit=2")
        self.assertEqual(status, 200, body)
        data = body["data"]
        self.assertEqual(data["window_days"], 7)
        self.assertEqual(data["daily_limit"], 2)
        self.assertEqual(len(data["days"]), 7)
        self.assertEqual(data["days"][0]["label"], "今天")
        self.assertEqual(data["days"][0]["count"], 2)
        self.assertEqual(data["overdue"], 2)
        self.assertEqual(data["days"][3]["count"], 1)
        self.assertEqual(data["total"], 3)

    def test_plan_respects_daily_limit_and_overflow(self):
        ids = [self.create(question="超额题 %d" % i)["id"] for i in range(3)]
        for mid in ids:
            self._make_due(mid, 5)
        status, body = self.call("GET", "/api/plan?days=2&limit=1")
        self.assertEqual(status, 200, body)
        data = body["data"]
        self.assertEqual(data["days"][0]["count"], 1)
        self.assertEqual(data["days"][1]["count"], 1)
        self.assertEqual(data["overflow"], 1)
        self.assertEqual(data["total"], 2)

    def test_suspend_removes_from_due_plan_and_restores(self):
        mid = self.create(question="斩掉的题")["id"]
        self._make_due(mid, 3)
        _, body = self.call("GET", "/api/plan")
        self.assertEqual(body["data"]["total"], 1)

        status, body = self.call("POST", "/api/mistakes/%d/suspend" % mid)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["suspended"], 1)

        _, body = self.call("GET", "/api/mistakes")
        self.assertEqual(body["data"]["total"], 0)
        _, body = self.call("GET", "/api/mistakes?suspended=1")
        self.assertEqual(body["data"]["total"], 1)
        _, body = self.call("GET", "/api/plan")
        self.assertEqual(body["data"]["total"], 0)
        _, body = self.call("GET", "/api/stats")
        self.assertEqual(body["data"]["due"], 0)
        self.assertEqual(body["data"]["suspended"], 1)

        status, body = self.call("POST", "/api/mistakes/%d/resume" % mid)
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["suspended"], 0)
        _, body = self.call("GET", "/api/plan")
        self.assertEqual(body["data"]["total"], 1)

    def test_suspend_unknown_id(self):
        status, body = self.call("POST", "/api/mistakes/999999/suspend")
        self.assertEqual(status, 404, body)

    def test_search_scope_question_excludes_answer(self):
        self.create(question="求导题", answer="答案是洛必达")
        self.create(question="另一题", answer="无关")
        _, body = self.call("GET", "/api/mistakes?q=" + urllib.parse.quote("洛必达"))
        self.assertEqual(body["data"]["total"], 1)
        _, body = self.call("GET", "/api/mistakes?q=" +
                            urllib.parse.quote("洛必达") + "&scope=question")
        self.assertEqual(body["data"]["total"], 0)

    def test_analytics_shape_and_trend(self):
        mid = self.create(question="分析题", knowledge="极限",
                          mistake_type="概念不清")["id"]
        self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "good"})
        status, body = self.call("GET", "/api/analytics?days=14")
        self.assertEqual(status, 200, body)
        data = body["data"]
        self.assertEqual(data["window_days"], 14)
        self.assertEqual(len(data["trend"]), 14)
        self.assertEqual(data["trend_totals"]["created"], 1)
        self.assertEqual(data["trend_totals"]["reviewed"], 1)
        self.assertEqual(data["by_type"], [{"name": "概念不清", "count": 1}])
        self.assertEqual(data["by_subject"][0]["name"], "数学")
        self.assertEqual(data["retention"]["total"], 1)
        self.assertEqual(sum(c["count"] for c in data["retention"]["counts"]), 1)
        self.assertIn("retention", data["retention"]["weakest"][0])
        self.assertEqual(data["weak_points"][0]["knowledge"], "极限")

    def test_analytics_empty_db(self):
        status, body = self.call("GET", "/api/analytics")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["retention"]["total"], 0)
        self.assertEqual(body["data"]["by_type"], [])
        self.assertEqual(len(body["data"]["trend"]), 30)


    # -- 组卷 / 打印（v0.8） --
    def _review(self, mid, result):
        status, body = self.call("POST", "/api/mistakes/%d/review" % mid, {"result": result})
        self.assertEqual(status, 200, body)
        return body["data"]

    def test_paper_weak_order_and_count(self):
        weak = self.create(question="薄弱题 A")["id"]
        strong = self.create(question="熟练题 B")["id"]
        self._review(weak, "again")
        self._review(weak, "again")
        self._review(strong, "good")
        self._review(strong, "good")

        status, body = self.call("GET", "/api/paper?order=weak&count=10")
        self.assertEqual(status, 200, body)
        data = body["data"]
        self.assertEqual(data["count"], 2)
        self.assertEqual(data["available"], 2)
        self.assertEqual([i["question"] for i in data["items"]], ["薄弱题 A", "熟练题 B"])
        self.assertEqual([i["no"] for i in data["items"]], [1, 2])
        self.assertEqual(data["items"][0]["accuracy"], 0.0)
        self.assertEqual(data["items"][1]["accuracy"], 1.0)
        self.assertEqual(data["mode"], "question")
        self.assertEqual(data["order_label"], "薄弱优先")

    def test_paper_count_limit_and_subject_filter(self):
        for i in range(3):
            self.create(question="数学题 %d" % i, subject="数学")
        self.create(question="物理题", subject="物理")
        query = "count=2&subject=" + urllib.parse.quote("数学")
        status, body = self.call("GET", "/api/paper?" + query)
        self.assertEqual(status, 200, body)
        data = body["data"]
        self.assertEqual(data["available"], 3)
        self.assertEqual(data["count"], 2)

        # count 会被夹到 1..MAX_PAPER_ITEMS
        _, body = self.call("GET", "/api/paper?count=0")
        self.assertEqual(body["data"]["count"], 1)
        _, body = self.call("GET", "/api/paper?count=9999")
        self.assertEqual(body["data"]["count"], 4)

    def test_paper_random_seed_is_deterministic(self):
        for i in range(6):
            self.create(question="随机题 %d" % i)
        _, first = self.call("GET", "/api/paper?order=random&seed=42&count=6")
        _, second = self.call("GET", "/api/paper?order=random&seed=42&count=6")
        self.assertEqual([i["id"] for i in first["data"]["items"]],
                         [i["id"] for i in second["data"]["items"]])

    def test_paper_image_only_when_requested(self):
        self.create(question="带图题", image_data=PNG_1PX)
        _, body = self.call("GET", "/api/paper")
        self.assertNotIn("image_url", body["data"]["items"][0])
        _, body = self.call("GET", "/api/paper?images=1")
        self.assertTrue(body["data"]["items"][0]["image_url"].startswith("/api/images/"))

    def test_print_page_html(self):
        self.create(question="题 <script>alert(1)</script> 干", answer="答案 1")
        self.create(question="第二题", answer="答案 2")

        with urllib.request.urlopen(self.base + "/print?mode=split", timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.headers["Content-Type"], "text/html; charset=utf-8")
            page = resp.read().decode("utf-8")
        self.assertIn("错题重做卷", page)
        self.assertIn("姓名", page)
        self.assertIn("答案与解析", page)
        self.assertIn("pagebreak", page)
        self.assertIn("答案 1", page)
        self.assertNotIn("<script>alert(1)</script>", page)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", page)

        with urllib.request.urlopen(self.base + "/print?mode=question", timeout=5) as resp:
            only_q = resp.read().decode("utf-8")
        self.assertNotIn("答案与解析", only_q)
        self.assertNotIn("答案 1", only_q)
        self.assertIn('class="blank"', only_q)

        with urllib.request.urlopen(self.base + "/print?mode=answer&blank=0", timeout=5) as resp:
            answer_page = resp.read().decode("utf-8")
        self.assertIn("正确答案", answer_page)
        self.assertNotIn('class="blank"', answer_page)

    def test_print_page_rejects_post(self):
        req = urllib.request.Request(self.base + "/print", data=b"{}", method="POST",
                                     headers={"Content-Type": "application/json"})
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(ctx.exception.code, 405)

    def test_paper_empty_db(self):
        status, body = self.call("GET", "/api/paper")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["count"], 0)
        self.assertEqual(body["data"]["items"], [])


    # -- 再战区（v0.9） --
    def test_arena_entry_and_exit(self):
        mid = self.create(question="反复错题")["id"]
        self._review(mid, "again")
        status, body = self.call("GET", "/api/arena")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["counts"]["zone"], 0)   # 只错一次算正常遗忘

        self._review(mid, "again")
        _, body = self.call("GET", "/api/arena")
        data = body["data"]
        self.assertEqual(data["rule"], {"min_wrong": 2, "clear_streak": 2})
        self.assertEqual(data["counts"]["zone"], 1)
        item = data["items"][0]
        self.assertEqual(item["wrong_count"], 2)
        self.assertEqual(item["correct_streak"], 0)
        self.assertEqual(item["need_streak"], 2)

        self._review(mid, "good")
        _, body = self.call("GET", "/api/arena")
        self.assertEqual(body["data"]["counts"]["zone"], 1)   # 连对 1 次还不够出区

        self._review(mid, "good")
        _, body = self.call("GET", "/api/arena")
        self.assertEqual(body["data"]["counts"]["zone"], 0)
        self.assertEqual(body["data"]["counts"]["cleared"], 1)

        _, body = self.call("GET", "/api/arena?show=cleared")
        self.assertEqual(body["data"]["show"], "cleared")
        self.assertEqual([i["id"] for i in body["data"]["items"]], [mid])

    def test_arena_fail_again_returns_to_zone(self):
        mid = self.create(question="出区又错")["id"]
        for _ in range(2):
            self._review(mid, "again")
        for _ in range(2):
            self._review(mid, "good")
        _, body = self.call("GET", "/api/arena")
        self.assertEqual(body["data"]["counts"]["zone"], 0)

        self._review(mid, "again")
        _, body = self.call("GET", "/api/arena")
        data = body["data"]
        self.assertEqual(data["counts"]["zone"], 1)
        self.assertEqual(data["items"][0]["correct_streak"], 0)
        self.assertEqual(data["items"][0]["wrong_count"], 3)

    def test_arena_suspend_removes_and_resume_restores(self):
        mid = self.create(question="斩了再恢复")["id"]
        for _ in range(2):
            self._review(mid, "again")
        status, _ = self.call("POST", "/api/mistakes/%d/suspend" % mid)
        self.assertEqual(status, 200)
        _, body = self.call("GET", "/api/arena")
        self.assertEqual(body["data"]["counts"]["zone"], 0)
        self.assertEqual(body["data"]["counts"]["suspended"], 1)

        status, _ = self.call("POST", "/api/mistakes/%d/resume" % mid)
        self.assertEqual(status, 200)
        _, body = self.call("GET", "/api/arena")
        self.assertEqual(body["data"]["counts"]["zone"], 1)
        self.assertEqual(body["data"]["counts"]["suspended"], 0)

    def test_arena_sort_and_subject_filter(self):
        a = self.create(question="错三次", subject="数学")["id"]
        b = self.create(question="错两次", subject="数学")["id"]
        c = self.create(question="物理错两次", subject="物理")["id"]
        for _ in range(3):
            self._review(a, "again")
        for _ in range(2):
            self._review(b, "again")
            self._review(c, "again")

        _, body = self.call("GET", "/api/arena")
        self.assertEqual([i["question"] for i in body["data"]["items"]],
                         ["错三次", "错两次", "物理错两次"])

        _, body = self.call("GET", "/api/arena?subject=" + urllib.parse.quote("物理"))
        self.assertEqual(body["data"]["counts"]["zone"], 1)
        self.assertEqual([i["question"] for i in body["data"]["items"]], ["物理错两次"])

    def test_arena_empty(self):
        status, body = self.call("GET", "/api/arena")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["items"], [])
        self.assertEqual(body["data"]["counts"],
                         {"zone": 0, "cleared": 0, "suspended": 0, "tracked": 0})

    def test_mb_arena(self):
        mid = self.create(question="CLI 再战题")["id"]
        for _ in range(2):
            self._review(mid, "again")
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "arena", "--limit", "10"])
        self.assertEqual(code, 0)
        body = json.loads(out.getvalue())
        self.assertEqual(body["counts"]["zone"], 1)
        self.assertEqual(body["items"][0]["id"], mid)

    # -- v0.12：独立解析字段 --
    def test_analysis_roundtrip(self):
        item = self.create(question="解析题", answer="42", analysis="因为 6x7=42")
        self.assertEqual(item["answer"], "42")
        self.assertEqual(item["analysis"], "因为 6x7=42")

        status, body = self.call("GET", "/api/mistakes/%d" % item["id"])
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["analysis"], "因为 6x7=42")

        # 只改解析，答案不动
        status, body = self.call("PUT", "/api/mistakes/%d" % item["id"],
                                 {"analysis": "先算 6x7，再验算"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["analysis"], "先算 6x7，再验算")
        self.assertEqual(body["data"]["answer"], "42")

    def test_analysis_is_searchable(self):
        self.create(question="洛必达题", analysis="用到洛必达法则")
        self.create(question="普通题", analysis="")
        _, body = self.call("GET", "/api/mistakes?q=" + urllib.parse.quote("洛必达法则"))
        self.assertEqual([i["question"] for i in body["data"]["items"]], ["洛必达题"])
        # scope=question 只看题干，不搜解析
        _, body = self.call("GET", "/api/mistakes?scope=question&q="
                            + urllib.parse.quote("洛必达法则"))
        self.assertEqual(body["data"]["items"], [])

    def test_batch_import_analysis_key(self):
        text = "题目: 批量解析题\n答案: 1\n解析: 因为 sin x / x -> 1\n"
        status, body = self.call("POST", "/api/mistakes/batch", {"text": text})
        self.assertEqual(status, 201, body)
        mid = body["data"]["created"][0]["id"]
        _, detail = self.call("GET", "/api/mistakes/%d" % mid)
        self.assertEqual(detail["data"]["analysis"], "因为 sin x / x -> 1")

    def test_csv_has_analysis_column(self):
        self.create(question="CSV 题", answer="1", analysis="解析文本 ABC")
        with urllib.request.urlopen(self.base + "/api/export.csv", timeout=5) as resp:
            text = resp.read().decode("utf-8-sig")
        header, row = text.splitlines()[0], text.splitlines()[1]
        self.assertIn("解析", header)
        self.assertIn("解析文本 ABC", row)

    def test_print_analysis_toggle(self):
        self.create(question="打印解析题", answer="42", analysis="解析内容 XYZ")
        with urllib.request.urlopen(self.base + "/print?mode=answer", timeout=5) as resp:
            page = resp.read().decode("utf-8")
        self.assertIn("解析内容 XYZ", page)
        with urllib.request.urlopen(self.base + "/print?mode=answer&analysis=0", timeout=5) as resp:
            page = resp.read().decode("utf-8")
        self.assertNotIn("解析内容 XYZ", page)
        self.assertIn("正确答案", page)

    # -- v0.12：可调阈值 --
    def test_settings_defaults_and_meta(self):
        status, body = self.call("GET", "/api/settings")
        self.assertEqual(status, 200, body)
        data = body["data"]
        self.assertEqual(data["values"], {"arena_min_wrong": 2, "arena_clear_streak": 2,
                                          "daily_limit": 20})
        self.assertIn("arena_min_wrong", data["labels"])
        self.assertEqual(data["bounds"]["arena_min_wrong"], [1, 20])

        _, meta_body = self.call("GET", "/api/meta")
        self.assertEqual(meta_body["data"]["settings"]["arena_min_wrong"], 2)

    def test_settings_change_arena_entry_threshold(self):
        mid = self.create(question="门槛题")["id"]
        for _ in range(2):
            self._review(mid, "again")
        _, body = self.call("GET", "/api/arena")
        self.assertEqual(body["data"]["counts"]["zone"], 1)

        status, body = self.call("PUT", "/api/settings", {"arena_min_wrong": 3})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["arena_min_wrong"], 3)

        _, body = self.call("GET", "/api/arena")
        self.assertEqual(body["data"]["rule"]["min_wrong"], 3)
        self.assertEqual(body["data"]["counts"]["zone"], 0)   # 错 2 次不够了

        self._review(mid, "again")
        _, body = self.call("GET", "/api/arena")
        self.assertEqual(body["data"]["counts"]["zone"], 1)

    def test_settings_change_clear_streak(self):
        mid = self.create(question="出区门槛")["id"]
        for _ in range(2):
            self._review(mid, "again")
        self.call("PUT", "/api/settings", {"arena_clear_streak": 3})
        for _ in range(2):
            self._review(mid, "good")
        _, body = self.call("GET", "/api/arena")
        self.assertEqual(body["data"]["counts"]["zone"], 1)   # 连对 2 次还不够
        self.assertEqual(body["data"]["items"][0]["need_streak"], 3)

        self._review(mid, "good")
        _, body = self.call("GET", "/api/arena")
        self.assertEqual(body["data"]["counts"]["cleared"], 1)

    def test_settings_validation(self):
        cases = [({"arena_min_wrong": 0}, "1-20"),
                 ({"arena_min_wrong": 21}, "1-20"),
                 ({"arena_clear_streak": "x"}, "整数"),
                 ({"unknown_key": 1}, "没有可保存")]
        for payload, fragment in cases:
            status, body = self.call("PUT", "/api/settings", payload)
            self.assertEqual(status, 400, body)
            self.assertIn(fragment, body["error"]["message"])
        _, body = self.call("GET", "/api/settings")
        self.assertEqual(body["data"]["values"]["arena_min_wrong"], 2)

    def test_settings_daily_limit_used_by_plan(self):
        # 3 道题都到期，上限调到 1 之后 /api/plan 不传 limit 就只排 1 道
        for i in range(3):
            mid = self.create(question="上限题%d" % i)["id"]
            self._make_due(mid, 1)

        status, body = self.call("PUT", "/api/settings", {"daily_limit": 1})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["daily_limit"], 1)

        _, body = self.call("GET", "/api/plan")
        self.assertEqual(body["data"]["daily_limit"], 1)
        self.assertEqual(body["data"]["today_count"], 1)
        # 塞不下的顺延到明天，而不是丢掉
        self.assertEqual(body["data"]["total"], 3)
        self.assertEqual(body["data"]["days"][1]["count"], 1)
        self.assertEqual(body["data"]["overflow"], 0)

        # 显式传 limit 仍然优先于 settings
        _, body = self.call("GET", "/api/plan?limit=3")
        self.assertEqual(body["data"]["daily_limit"], 3)
        self.assertEqual(body["data"]["today_count"], 3)

        # 越界与非整数都要 400，且不改动已存的值
        for payload, fragment in (({"daily_limit": 0}, "1-200"),
                                  ({"daily_limit": 201}, "1-200"),
                                  ({"daily_limit": "x"}, "整数")):
            status, body = self.call("PUT", "/api/settings", payload)
            self.assertEqual(status, 400, body)
            self.assertIn(fragment, body["error"]["message"])
        _, body = self.call("GET", "/api/settings")
        self.assertEqual(body["data"]["values"]["daily_limit"], 1)

        # CLI 也能改
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "settings", "--daily-limit", "7"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["values"]["daily_limit"], 7)

    def test_mb_settings(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "settings"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["values"]["arena_min_wrong"], 2)

        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "settings", "--arena-min-wrong", "4"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["values"]["arena_min_wrong"], 4)

        # 只读模式不许改
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "--read-only", "settings",
                            "--arena-min-wrong", "5"])
        self.assertEqual(code, 2)
        self.assertIn("--read-only", out.getvalue())

    # -- v0.9：复习提醒 --
    def _set_next_review(self, mid, stamp):
        conn = app.connect(self.db)
        conn.execute("UPDATE mistakes SET next_review_at = ? WHERE id = ?", (stamp, mid))
        conn.commit()
        conn.close()

    def test_reminders_empty(self):
        status, body = self.call("GET", "/api/reminders")
        self.assertEqual(status, 200, body)
        data = body["data"]
        self.assertEqual((data["due"], data["overdue"], data["today"]), (0, 0, 0))
        self.assertFalse(data["should_notify"])
        self.assertIn("没有到期", data["message"])

    def test_reminders_due_overdue_and_top(self):
        a = self.create(question="逾期题")["id"]
        b = self.create(question="今日到期题")["id"]
        c = self.create(question="以后再说题")["id"]
        self._set_next_review(a, "2020-01-01 08:00:00")
        self._set_next_review(b, "2020-06-01 08:00:00")
        self._set_next_review(c, "2099-01-01 08:00:00")

        _, body = self.call("GET", "/api/reminders")
        data = body["data"]
        self.assertEqual(data["due"], 2)
        self.assertEqual(data["overdue"], 2)
        self.assertEqual([i["id"] for i in data["top"]], [a, b])
        self.assertEqual(data["next_at"], "2099-01-01 08:00:00")
        self.assertTrue(data["should_notify"])
        self.assertIn("2 道错题到期", data["message"])

    def test_reminders_skip_mastered_and_suspended(self):
        mid = self.create(question="已掌握题")["id"]
        self._set_next_review(mid, "2020-01-01 08:00:00")
        self.call("POST", "/api/mistakes/%d/review" % mid, {"result": "mastered"})
        _, body = self.call("GET", "/api/reminders")
        self.assertEqual(body["data"]["due"], 0)

    def test_mb_remind(self):
        mid = self.create(question="CLI 提醒题")["id"]
        self._set_next_review(mid, "2020-01-01 08:00:00")
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "remind"])
        self.assertEqual(code, 0)
        body = json.loads(out.getvalue())
        self.assertEqual(body["due"], 1)
        self.assertEqual(body["top"][0]["id"], mid)

    # -- v0.9：知识点树 --
    def test_knowledge_path_normalized(self):
        item = self.create(knowledge=" 函数 /  二次函数 ")
        self.assertEqual(item["knowledge"], "函数/二次函数")

    def test_knowledge_alias_resolves_on_write(self):
        status, body = self.call("POST", "/api/knowledge/aliases",
                                 {"alias": "二次函數", "canonical": "函数/二次函数"})
        self.assertEqual(status, 201, body)
        item = self.create(question="繁体写法题", knowledge="二次函數")
        self.assertEqual(item["knowledge"], "函数/二次函数")

        # 更新时也要解析
        status, body = self.call("PUT", "/api/mistakes/%d" % item["id"],
                                 {"knowledge": "二次函數"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["knowledge"], "函数/二次函数")

    def test_knowledge_alias_cycle_rejected(self):
        self.call("POST", "/api/knowledge/aliases", {"alias": "A", "canonical": "B"})
        status, body = self.call("POST", "/api/knowledge/aliases",
                                 {"alias": "B", "canonical": "A"})
        self.assertEqual(status, 400, body)
        self.assertIn("环", body["error"]["message"])

    def test_knowledge_alias_list_and_delete(self):
        self.call("POST", "/api/knowledge/aliases", {"alias": "导数", "canonical": "微积分/导数"})
        _, body = self.call("GET", "/api/knowledge/aliases")
        self.assertEqual(body["data"]["total"], 1)
        alias = urllib.parse.quote(body["data"]["items"][0]["alias"])
        status, _ = self.call("DELETE", "/api/knowledge/aliases/" + alias)
        self.assertEqual(status, 200)
        _, body = self.call("GET", "/api/knowledge/aliases")
        self.assertEqual(body["data"]["total"], 0)

    def test_knowledge_tree_rolls_up_children(self):
        self.create(question="二次函数 1", knowledge="函数/二次函数")
        self.create(question="二次函数 2", knowledge="函数/二次函数")
        self.create(question="单调性", knowledge="函数/单调性")
        self.create(question="数列", knowledge="数列")

        _, body = self.call("GET", "/api/knowledge/tree")
        tree = body["data"]
        self.assertEqual(tree["points_total"], 3)
        paths = [n["path"] for n in tree["roots"]]
        self.assertIn("函数", paths)
        node = next(n for n in tree["roots"] if n["path"] == "函数")
        self.assertEqual(node["stats"]["mistakes"], 3)
        self.assertEqual(node["own_mistakes"], 0)
        self.assertEqual(len(node["children"]), 2)
        self.assertEqual(node["children"][0]["path"], "函数/二次函数")
        self.assertEqual(node["children"][0]["stats"]["mistakes"], 2)

    def test_knowledge_filter_deep(self):
        self.create(question="二次函数题", knowledge="函数/二次函数")
        self.create(question="单调性题", knowledge="函数/单调性")
        self.create(question="数列题", knowledge="数列")

        # v0.34 改了默认值：点父节点就该看到子树里的题，显式 kdeep=0 才只看自己
        _, body = self.call("GET", "/api/mistakes?knowledge=" + urllib.parse.quote("函数"))
        self.assertEqual(body["data"]["total"], 2)

        _, body = self.call("GET", "/api/mistakes?knowledge=" + urllib.parse.quote("函数")
                            + "&kdeep=1")
        self.assertEqual(body["data"]["total"], 2)

        _, body = self.call("GET", "/api/mistakes?knowledge=" + urllib.parse.quote("函数")
                            + "&kdeep=0")
        self.assertEqual(body["data"]["total"], 0)  # 没有题直接挂在「函数」上

    # -- v0.34：分类/归类 --
    def test_meta_knowledge_facets_have_counts_and_depth(self):
        self.create(question="a", knowledge="函数/二次函数")
        self.create(question="b", knowledge="函数/二次函数")
        self.create(question="c", knowledge="函数/单调性")
        self.create(question="d", knowledge="数列")
        self.create(question="e")  # 没归类

        _, body = self.call("GET", "/api/meta")
        data = body["data"]
        items = {it["path"]: it for it in data["knowledge"]}
        self.assertEqual(items["函数"]["count"], 3)          # 自己没题，汇总两个子节点
        self.assertEqual(items["函数"]["depth"], 1)
        self.assertEqual(items["函数"]["parent"], "")
        self.assertEqual(items["函数/二次函数"]["count"], 2)
        self.assertEqual(items["函数/二次函数"]["depth"], 2)
        self.assertEqual(items["函数/二次函数"]["parent"], "函数")
        self.assertEqual(items["数列"]["count"], 1)
        self.assertEqual(data["knowledge_flat"],
                         ["函数/二次函数", "函数/单调性", "数列"])
        self.assertEqual(data["knowledge_unclassified"], 1)

    def test_knowledge_filter_keyword_and_unclassified(self):
        self.create(question="二次函数题", knowledge="函数/二次函数")
        self.create(question="数列题", knowledge="数列")
        self.create(question="脏值题", knowledge="111")
        self.create(question="没归类")

        _, body = self.call("GET", "/api/mistakes?kq=" + urllib.parse.quote("函数"))
        self.assertEqual(body["data"]["total"], 1)

        _, body = self.call("GET", "/api/mistakes?nokp=1")
        self.assertEqual(body["data"]["total"], 1)
        self.assertEqual(body["data"]["items"][0]["question"], "没归类")

    def test_knowledge_merge_moves_children_and_registers_alias(self):
        a = self.create(question="脏值一", knowledge="111")
        b = self.create(question="脏值二", knowledge="2")
        c = self.create(question="子树", knowledge="111/子节点")

        status, body = self.call("POST", "/api/knowledge/merge", {
            "sources": ["111", "2"], "target": "函数/二次函数"})
        self.assertEqual(status, 200, body)
        data = body["data"]
        self.assertEqual(data["target"], "函数/二次函数")
        self.assertEqual(data["merged"], 2)
        self.assertEqual(data["moved"], 3)
        self.assertEqual(sorted(data["ids"]), sorted([a["id"], b["id"], c["id"]]))

        for mid, expect in ((a["id"], "函数/二次函数"), (b["id"], "函数/二次函数"),
                            (c["id"], "函数/二次函数/子节点")):
            _, got = self.call("GET", "/api/mistakes/%d" % mid)
            self.assertEqual(got["data"]["knowledge"], expect)

        # 源名登记成别名：以后再录 "111" 自动落到规范名
        _, aliases = self.call("GET", "/api/knowledge/aliases")
        pairs = {it["alias"]: it["canonical"] for it in aliases["data"]["items"]}
        self.assertEqual(pairs["111"], "函数/二次函数")
        self.assertEqual(pairs["2"], "函数/二次函数")
        item = self.create(question="又写脏了", knowledge="111")
        self.assertEqual(item["knowledge"], "函数/二次函数")

    def test_knowledge_merge_rejects_parent_into_child(self):
        self.create(question="题", knowledge="函数/二次函数")
        status, body = self.call("POST", "/api/knowledge/merge", {
            "sources": ["函数"], "target": "函数/二次函数"})
        self.assertEqual(status, 400)
        self.assertIn("子知识点", body["error"]["message"])

    def test_knowledge_merge_rejects_empty(self):
        status, _ = self.call("POST", "/api/knowledge/merge", {"sources": [], "target": "x"})
        self.assertEqual(status, 400)

    def test_knowledge_merge_empty_target_clears(self):
        # v0.39：目标留空 = 删除这个知识点，把题上的值清空，而不是报错。
        item = self.create(question="脏值题", knowledge="111")["id"]
        status, body = self.call("POST", "/api/knowledge/merge",
                                 {"sources": ["111"], "target": ""})
        self.assertEqual(status, 200, body)
        self.assertTrue(body["data"]["cleared"])
        self.assertEqual(body["data"]["moved"], 1)
        _, got = self.call("GET", "/api/mistakes/%d" % item)
        self.assertEqual(got["data"]["knowledge"], "")
        # 删除不登记别名：之后正常录入 "111" 不会被悄悄清空
        status, _ = self.call("POST", "/api/mistakes",
                              {"question": "再写一次", "knowledge": "111"})
        self.assertEqual(status, 201)

    def test_mb_list_knowledge_flags(self):
        self.create(question="二次函数题", knowledge="函数/二次函数")
        self.create(question="数列题", knowledge="数列")
        self.create(question="脏值题", knowledge="111")
        self.create(question="没归类")

        def run(argv):
            out = io.StringIO()
            with redirect_stdout(out):
                code = mb.main(["--db", self.db, "list"] + argv)
            self.assertEqual(code, 0)
            return json.loads(out.getvalue())

        # --knowledge 走子树：点父节点能看到子节点里的题
        self.assertEqual(run(["--knowledge", "函数"])["total"], 1)
        # --exact 只此节点
        self.assertEqual(run(["--knowledge", "函数", "--exact"])["total"], 0)
        # --kq 模糊
        self.assertEqual(run(["--kq", "函数"])["total"], 1)
        # --nokp 只看没归类的
        data = run(["--nokp"])
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["question"], "没归类")

    def test_mb_merge_cli(self):
        a = self.create(question="脏值一", knowledge="111")
        b = self.create(question="脏值二", knowledge="2")
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "merge", "111", "2", "--to", "函数/二次函数"])
        self.assertEqual(code, 0)
        data = json.loads(out.getvalue())
        self.assertEqual(data["merged"], 2)
        self.assertEqual(data["moved"], 2)
        _, got = self.call("GET", "/api/mistakes/%d" % a["id"])
        self.assertEqual(got["data"]["knowledge"], "函数/二次函数")
        _, got = self.call("GET", "/api/mistakes/%d" % b["id"])
        self.assertEqual(got["data"]["knowledge"], "函数/二次函数")

    def test_mb_merge_read_only_refused(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "--read-only", "merge", "a", "--to", "b"])
        self.assertEqual(code, 2)
        self.assertIn("read-only", out.getvalue())

    def test_mb_ktree(self):
        self.create(question="树题", knowledge="函数/二次函数")
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "ktree"])
        self.assertEqual(code, 0)
        body = json.loads(out.getvalue())
        self.assertEqual(body["roots"][0]["path"], "函数")

    # -- v0.9：变式自动积累 --
    def test_review_captures_variant(self):
        mid = self.create(question="母题")["id"]
        status, body = self.call("POST", "/api/mistakes/%d/review" % mid, {
            "result": "good",
            "variant": {"question": "变式一", "answer": "42"},
        })
        self.assertEqual(status, 200, body)
        variant = body["data"]["variant"]
        self.assertEqual(variant["question"], "变式一")
        self.assertEqual(variant["times_used"], 1)

        _, body = self.call("GET", "/api/mistakes/%d/variants" % mid)
        self.assertEqual(body["data"]["total"], 1)

    def test_review_variant_dedup(self):
        mid = self.create(question="母题2")["id"]
        payload = {"result": "good", "variant_question": "同一道变式", "variant_answer": "1"}
        self.call("POST", "/api/mistakes/%d/review" % mid, payload)
        status, body = self.call("POST", "/api/mistakes/%d/review" % mid, payload)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["data"]["variant"]["duplicate"])
        self.assertEqual(body["data"]["variant"]["times_used"], 2)
        _, body = self.call("GET", "/api/mistakes/%d/variants" % mid)
        self.assertEqual(body["data"]["total"], 1)

    def test_variant_gaps_prefers_missing(self):
        a = self.create(question="有变式的题")["id"]
        b = self.create(question="没变式的题")["id"]
        self.call("POST", "/api/mistakes/%d/variants" % a, {"question": "变式 X"})
        _, body = self.call("GET", "/api/variants/gaps")
        items = body["data"]["items"]
        self.assertEqual(items[0]["id"], b)
        self.assertEqual(items[0]["variant_count"], 0)
        self.assertIn("还没有变式", items[0]["hint"])

    def test_mb_review_with_variant(self):
        mid = self.create(question="CLI 变式题")["id"]
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "review", str(mid), "--rating", "good",
                            "--variant-question", "CLI 变式", "--variant-answer", "7"])
        self.assertEqual(code, 0)
        body = json.loads(out.getvalue())
        self.assertEqual(body["variant"]["question"], "CLI 变式")


    # -- v0.13：回收站 + 备份恢复 + 错因 textarea --
    def test_delete_moves_to_trash_and_restore(self):
        item = self.create(question="要删的题", error_reason="粗心")
        mid = item["id"]
        self.call("POST", "/api/mistakes/%d/review" % mid, {"rating": "good"})

        status, body = self.call("DELETE", "/api/mistakes/%d" % mid)
        self.assertEqual(status, 200, body)
        _, body = self.call("GET", "/api/mistakes")
        self.assertEqual(body["data"]["total"], 0)

        _, body = self.call("GET", "/api/trash")
        trash = body["data"]
        self.assertEqual(trash["total"], 1)
        entry = trash["items"][0]
        self.assertEqual(entry["mistake_id"], mid)
        self.assertEqual(entry["question"], "要删的题")
        self.assertEqual(entry["log_count"], 1)

        status, body = self.call("POST", "/api/trash/%d/restore" % entry["id"])
        self.assertEqual(status, 200, body)
        restored = body["data"]
        self.assertEqual(restored["id"], mid)          # AUTOINCREMENT 不复用，原 id 能沿用
        self.assertEqual(restored["question"], "要删的题")
        self.assertEqual(restored["review_count"], 1)

        _, body = self.call("GET", "/api/mistakes/%d/reviews" % mid)
        self.assertEqual(len(body["data"]["items"]), 1)   # 复习记录一起回来

        _, body = self.call("GET", "/api/trash")
        self.assertEqual(body["data"]["total"], 0)

    def test_trash_purge_one_and_all(self):
        a = self.create(question="题 A")["id"]
        b = self.create(question="题 B")["id"]
        self.call("POST", "/api/mistakes/batch-delete", {"ids": [a, b]})
        _, body = self.call("GET", "/api/trash")
        self.assertEqual(body["data"]["total"], 2)
        tid = body["data"]["items"][0]["id"]
        status, body = self.call("DELETE", "/api/trash/%d" % tid)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["deleted"], 1)
        _, body = self.call("GET", "/api/trash")
        self.assertEqual(body["data"]["total"], 1)
        status, body = self.call("POST", "/api/trash/purge")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["deleted"], 1)
        _, body = self.call("GET", "/api/trash")
        self.assertEqual(body["data"]["total"], 0)

    def test_trash_restore_missing(self):
        status, body = self.call("POST", "/api/trash/99999/restore")
        self.assertEqual(status, 404, body)

    def test_trash_meta_count(self):
        mid = self.create(question="计数题")["id"]
        self.call("DELETE", "/api/mistakes/%d" % mid)
        _, body = self.call("GET", "/api/meta")
        self.assertEqual(body["data"]["trash_count"], 1)

    def test_batch_delete_returns_real_count(self):
        a = self.create(question="批删 A")["id"]
        b = self.create(question="批删 B")["id"]
        status, body = self.call("POST", "/api/mistakes/batch-delete",
                                 {"ids": [a, b, 99999]})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["deleted"], 2)

    def test_mb_restore_from_backup(self):
        self.create(question="备份时存在的题")
        backup = app.backup_db(self.db, backup_dir=os.path.join(self.tmpdir, "bk"))
        self.create(question="备份之后加的题")
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "restore", "--from", backup["path"]])
        self.assertEqual(code, 0, out.getvalue())
        data = json.loads(out.getvalue())
        self.assertEqual(data["counts"]["mistakes"], 1)
        self.assertTrue(os.path.exists(data["safety_backup"]))
        _, body = self.call("GET", "/api/mistakes")
        self.assertEqual(body["data"]["total"], 1)
        self.assertEqual(body["data"]["items"][0]["question"], "备份时存在的题")

    def test_mb_restore_rejects_bad_file(self):
        bad = os.path.join(self.tmpdir, "not-a-db.txt")
        with open(bad, "w", encoding="utf-8") as fh:
            fh.write("hello")
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "restore", "--from", bad])
        self.assertEqual(code, 1)
        self.assertIn("不是错题本数据库", out.getvalue())

    def test_mb_restore_read_only_refused(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(["--db", self.db, "--read-only", "restore", "--from", "x.db"])
        self.assertEqual(code, 2)
        self.assertIn("--read-only", out.getvalue())

    def test_frontend_trash_and_textarea(self):
        self._need_web()
        with open(os.path.join(app.STATIC_DIR, "index.html"), "r", encoding="utf-8") as fh:
            html = fh.read()
        self.assertIn('<textarea id="f-error-reason"', html)
        self.assertNotIn('<input id="f-error-reason"', html)
        self.assertIn('id="view-trash"', html)
        self.assertIn("/api/trash", html)

    # -- v0.17：列表卡片缩略图（默认不带，thumbs=1 才带）--
    def test_list_thumbs_is_opt_in(self):
        item = self.create(question="列表缩略图", image_data=PNG_1PX)
        _, body = self.call("GET", "/api/mistakes")
        self.assertNotIn("image_url", body["data"]["items"][0])
        _, body = self.call("GET", "/api/mistakes?thumbs=1")
        row = body["data"]["items"][0]
        self.assertEqual(row["image_url"], item["image_url"])
        self.assertTrue(row["has_image"])
        _, body = self.call("GET", "/api/mistakes?thumbs=1")
        self.assertNotIn("image_file", row)      # 内部字段不外泄

    # -- v0.15：图片落盘 + 流式导出 + 前端纯函数 --
    def test_image_saved_to_file_not_db(self):
        item = self.create(question="带图题", image_data=PNG_1PX)
        self.assertTrue(item["has_image"])
        self.assertTrue(item["image_url"].startswith("/api/images/"))
        conn = app.connect(self.db)
        try:
            row = conn.execute("SELECT image_data, image_file FROM mistakes WHERE id=?",
                               (item["id"],)).fetchone()
        finally:
            conn.close()
        self.assertEqual(row["image_data"], "")          # 库里不再存 base64
        self.assertTrue(row["image_file"].endswith(".png"))
        path = os.path.join(app.image_dir(self.db), row["image_file"])
        self.assertTrue(os.path.exists(path))
        with open(path, "rb") as fh:
            self.assertTrue(fh.read().startswith(b"\x89PNG"))

    def test_image_served_from_disk(self):
        item = self.create(question="看图题", image_data=PNG_1PX)
        with urllib.request.urlopen(self.base + item["image_url"], timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.headers["Content-Type"], "image/png")
            body = resp.read()
        self.assertTrue(body.startswith(b"\x89PNG"))
        # 文件名是内容哈希，可以长缓存
        self.assertIn("immutable", resp.headers.get("Cache-Control", ""))

    def test_image_deduped_by_content(self):
        a = self.create(question="同图题一", image_data=PNG_1PX)
        b = self.create(question="同图题二", image_data=PNG_1PX)
        self.assertEqual(a["image_url"], b["image_url"])   # 同一张图只存一份
        files = [n for n in os.listdir(app.image_dir(self.db)) if n.endswith(".png")]
        self.assertEqual(len(files), 1)

    def test_image_rejects_svg_and_mismatched_magic(self):
        status, body = self.call("POST", "/api/mistakes", {
            "question": "svg 题", "image_data": "data:image/svg+xml;base64,PHN2Zy8+"})
        self.assertEqual(status, 400, body)
        self.assertIn("不支持的图片格式", body["error"]["message"])
        # 声明 jpeg 但内容是 PNG：magic bytes 对不上
        png_bytes = __import__("base64").b64decode(PNG_1PX.split(",", 1)[1])
        wrong = "data:image/jpeg;base64," + __import__("base64").b64encode(png_bytes).decode()
        status, body = self.call("POST", "/api/mistakes", {
            "question": "假 jpeg 题", "image_data": wrong})
        self.assertEqual(status, 400, body)
        self.assertIn("格式不符", body["error"]["message"])

    def test_update_keeps_image_when_not_sent(self):
        item = self.create(question="改题干", image_data=PNG_1PX)
        status, body = self.call("PUT", "/api/mistakes/%d" % item["id"],
                                 {"question": "改了题干"})
        self.assertEqual(status, 200, body)
        self.assertTrue(body["data"]["has_image"])
        self.assertEqual(body["data"]["image_url"], item["image_url"])

    def test_update_removes_image_with_empty_string(self):
        item = self.create(question="要删图", image_data=PNG_1PX)
        status, body = self.call("PUT", "/api/mistakes/%d" % item["id"],
                                 {"image_data": ""})
        self.assertEqual(status, 200, body)
        self.assertFalse(body["data"]["has_image"])
        conn = app.connect(self.db)
        try:
            row = conn.execute("SELECT image_file FROM mistakes WHERE id=?",
                               (item["id"],)).fetchone()
        finally:
            conn.close()
        self.assertEqual(row["image_file"], "")

    def test_export_json_has_image_url_not_base64(self):
        self.create(question="导出带图题", image_data=PNG_1PX)
        with urllib.request.urlopen(self.base + "/api/export.json", timeout=5) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        row = body["mistakes"][0]
        self.assertNotIn("image_data", row)
        self.assertTrue(row["image_url"].startswith("/api/images/"))

    def test_export_json_stream_is_valid_at_chunk_one(self):
        for i in range(5):
            self.create(question="流式题 %d" % i)
        conn = app.connect(self.db)
        try:
            text = "".join(app.iter_export(conn, chunk=1))   # 每批 1 行，最碎的切分
        finally:
            conn.close()
        data = json.loads(text)
        self.assertEqual(data["version"], 5)
        self.assertEqual(data["counts"]["mistakes"], 5)
        self.assertEqual([m["question"] for m in data["mistakes"]],
                         ["流式题 %d" % i for i in range(5)])

    def test_backup_and_restore_include_images(self):
        item = self.create(question="图要备份", image_data=PNG_1PX)
        name = os.path.basename(item["image_url"])
        target = os.path.join(self.tmpdir, "bk_img")
        backup = app.backup_db(self.db, backup_dir=target)
        self.assertEqual(backup["images_copied"], 1)
        self.assertTrue(os.path.exists(os.path.join(target, "images", name)))
        os.remove(os.path.join(app.image_dir(self.db), name))   # 模拟图片丢了
        app.restore_from_backup(self.db, backup["path"], backup_dir=target)
        self.assertTrue(os.path.exists(os.path.join(app.image_dir(self.db), name)))

    def test_lib_js_served_and_used(self):
        self._need_web()
        with urllib.request.urlopen(self.base + "/lib.js", timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            js = resp.read().decode("utf-8")
        self.assertIn("localStamp", js)
        self.assertIn("module.exports", js)
        with open(os.path.join(app.STATIC_DIR, "index.html"), "r", encoding="utf-8") as fh:
            html = fh.read()
        self.assertIn('src="/lib.js"', html)


    # ------------------------------------------------------------------ #
    # v0.20：一题多图 / 试卷维度 / 批量修改
    # ------------------------------------------------------------------ #
    def test_multi_images_create_order_and_urls(self):
        item = self.create(question="三张图的题", images=[PNG_A, PNG_B, PNG_C])
        self.assertTrue(item["has_image"])
        self.assertEqual(len(item["images"]), 3)
        files = [img["file"] for img in item["images"]]
        self.assertEqual(len(set(files)), 3)          # 三张内容不同 -> 三个文件
        self.assertEqual(item["image_url"], item["images"][0]["url"])
        self.assertTrue(all(img["url"].startswith("/api/images/") for img in item["images"]))
        # 顺序按 sort 稳定
        status, body = self.call("GET", "/api/mistakes/%d" % item["id"])
        self.assertEqual(status, 200, body)
        self.assertEqual([i["file"] for i in body["data"]["images"]], files)

    def test_multi_images_same_content_reuses_file(self):
        item = self.create(question="重复图", images=[PNG_A, PNG_A])
        self.assertEqual(len(item["images"]), 2)
        self.assertEqual(item["images"][0]["file"], item["images"][1]["file"])

    def test_images_carry_field_per_block(self):
        # v0.30：每张图归属一个文本块（question/wrong/answer/analysis）
        item = self.create(question="分块图", images=[
            {"data": PNG_A, "field": "answer"},
            {"data": PNG_B, "field": "analysis"},
            {"data": PNG_C},
        ])
        self.assertEqual([i["field"] for i in item["images"]], ["answer", "analysis", "question"])

    def test_images_field_survives_update(self):
        item = self.create(question="分块图保留", images=[{"data": PNG_A, "field": "wrong"}])
        first = item["images"][0]["file"]
        # 只改题干、不改图：field 要原样保留
        status, body = self.call("PUT", "/api/mistakes/%d" % item["id"], {"question": "改题干"})
        self.assertEqual(status, 200, body)
        self.assertEqual([(i["file"], i["field"]) for i in body["data"]["images"]],
                         [(first, "wrong")])
        # 传文件名 + field 改归属
        status, body = self.call("PUT", "/api/mistakes/%d" % item["id"],
                                 {"images": [{"file": first, "field": "analysis"}]})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["images"][0]["field"], "analysis")

    def test_images_unknown_field_is_dropped(self):
        item = self.create(question="野字段", images=[{"data": PNG_A, "field": "bogus"}])
        self.assertEqual(item["images"][0]["field"], "")

    def test_multi_images_update_replace_and_clear(self):
        item = self.create(question="换图", images=[PNG_A, PNG_B])
        first = item["images"][0]["file"]
        # 只保留第一张（传文件名表示保留）
        status, body = self.call("PUT", "/api/mistakes/%d" % item["id"],
                                 {"images": [first]})
        self.assertEqual(status, 200, body)
        self.assertEqual(len(body["data"]["images"]), 1)
        self.assertEqual(body["data"]["images"][0]["file"], first)
        # 空数组 = 全删
        status, body = self.call("PUT", "/api/mistakes/%d" % item["id"], {"images": []})
        self.assertEqual(status, 200, body)
        self.assertFalse(body["data"]["has_image"])
        self.assertEqual(body["data"]["images"], [])

    def test_multi_images_update_without_images_keeps_them(self):
        item = self.create(question="只改题干", images=[PNG_A, PNG_B])
        status, body = self.call("PUT", "/api/mistakes/%d" % item["id"],
                                 {"question": "只改题干（改了）"})
        self.assertEqual(status, 200, body)
        self.assertEqual(len(body["data"]["images"]), 2)

    def test_multi_images_legacy_image_data_still_works(self):
        item = self.create(question="老接口", image_data=PNG_A)
        self.assertEqual(len(item["images"]), 1)
        status, body = self.call("PUT", "/api/mistakes/%d" % item["id"],
                                 {"image_data": ""})
        self.assertEqual(status, 200, body)
        self.assertFalse(body["data"]["has_image"])

    def test_multi_images_limit(self):
        status, body = self.call("POST", "/api/mistakes",
                                 {"question": "七张图", "images": [PNG_A] * 7})
        self.assertEqual(status, 400, body)
        self.assertIn("图片最多", body["error"]["message"])

    def test_multi_images_rejects_bad_name(self):
        status, body = self.call("POST", "/api/mistakes",
                                 {"question": "坏图名", "images": ["../../etc/passwd"]})
        self.assertEqual(status, 400, body)
        self.assertIn("图片标识不合法", body["error"]["message"])

    def test_papers_crud_and_filter(self):
        status, body = self.call("POST", "/api/papers",
                                 {"name": "2026 秋期中 高数", "subject": "高数",
                                  "exam_date": "2026-11-05"})
        self.assertEqual(status, 201, body)
        paper = body["data"]
        self.assertEqual(paper["name"], "2026 秋期中 高数")
        self.assertEqual(paper["count"], 0)

        a = self.create(question="卷内题 A", paper_id=paper["id"])
        self.assertEqual(a["paper_id"], paper["id"])
        self.create(question="卷外题 B")

        status, body = self.call("GET", "/api/papers")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["papers"][0]["count"], 1)

        status, body = self.call("GET", "/api/mistakes?paper_id=%d" % paper["id"])
        self.assertEqual(body["data"]["total"], 1)
        self.assertEqual(body["data"]["items"][0]["question"], "卷内题 A")

        status, body = self.call("GET", "/api/mistakes?paper_id=0")
        self.assertEqual(body["data"]["total"], 1)
        self.assertEqual(body["data"]["items"][0]["question"], "卷外题 B")

        status, body = self.call("PUT", "/api/papers/%d" % paper["id"],
                                 {"name": "改名后的卷"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["name"], "改名后的卷")
        self.assertEqual(body["data"]["subject"], "高数")   # 没传的字段保持原样

    def test_paper_delete_detaches_mistakes(self):
        status, body = self.call("POST", "/api/papers", {"name": "要删的卷"})
        pid = body["data"]["id"]
        item = self.create(question="卷里的题", paper_id=pid)
        status, body = self.call("DELETE", "/api/papers/%d" % pid)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["detached"], 1)
        status, body = self.call("GET", "/api/mistakes/%d" % item["id"])
        self.assertEqual(body["data"]["paper_id"], 0)

    def test_paper_name_required_and_too_long(self):
        status, body = self.call("POST", "/api/papers", {"name": "   "})
        self.assertEqual(status, 400, body)
        status, body = self.call("POST", "/api/papers", {"name": "长" * 121})
        self.assertEqual(status, 400, body)
        self.assertIn("过长", body["error"]["message"])

    def test_paper_id_must_exist(self):
        status, body = self.call("POST", "/api/mistakes",
                                 {"question": "挂到不存在的卷", "paper_id": 999999})
        self.assertEqual(status, 400, body)
        self.assertIn("试卷不存在", body["error"]["message"])

    def test_meta_includes_papers(self):
        self.call("POST", "/api/papers", {"name": "元数据里的卷"})
        status, body = self.call("GET", "/api/meta")
        self.assertEqual(status, 200, body)
        self.assertEqual(len(body["data"]["papers"]), 1)
        self.assertEqual(body["data"]["papers"][0]["name"], "元数据里的卷")

    def test_bulk_update_fields(self):
        a = self.create(question="批量 A")
        b = self.create(question="批量 B")
        status, body = self.call("POST", "/api/mistakes/bulk-update",
                                 {"ids": [a["id"], b["id"]],
                                  "fields": {"status": "mastered", "subject": "物理",
                                             "difficulty": 5}})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["updated"], 2)
        for mid in (a["id"], b["id"]):
            status, got = self.call("GET", "/api/mistakes/%d" % mid)
            self.assertEqual(got["data"]["status"], "mastered")
            self.assertEqual(got["data"]["subject"], "物理")
            self.assertEqual(got["data"]["difficulty"], 5)

    def test_bulk_update_tags_modes(self):
        a = self.create(question="标签题", tags="极限,计算")
        # add
        status, body = self.call("POST", "/api/mistakes/bulk-update",
                                 {"ids": [a["id"]],
                                  "fields": {"tags": "极限,新标签", "tags_mode": "add"}})
        self.assertEqual(status, 200, body)
        status, got = self.call("GET", "/api/mistakes/%d" % a["id"])
        self.assertEqual(got["data"]["tags"], "极限,计算,新标签")
        # remove
        self.call("POST", "/api/mistakes/bulk-update",
                  {"ids": [a["id"]], "fields": {"tags": "计算", "tags_mode": "remove"}})
        status, got = self.call("GET", "/api/mistakes/%d" % a["id"])
        self.assertEqual(got["data"]["tags"], "极限,新标签")
        # set
        self.call("POST", "/api/mistakes/bulk-update",
                  {"ids": [a["id"]], "fields": {"tags": "只剩这个", "tags_mode": "set"}})
        status, got = self.call("GET", "/api/mistakes/%d" % a["id"])
        self.assertEqual(got["data"]["tags"], "只剩这个")

    def test_bulk_update_validation(self):
        status, body = self.call("POST", "/api/mistakes/bulk-update",
                                 {"ids": [], "fields": {"status": "mastered"}})
        self.assertEqual(status, 400, body)
        status, body = self.call("POST", "/api/mistakes/bulk-update",
                                 {"ids": [1], "fields": {}})
        self.assertEqual(status, 400, body)
        status, body = self.call("POST", "/api/mistakes/bulk-update",
                                 {"ids": [1], "fields": {"status": "乱写"}})
        self.assertEqual(status, 400, body)
        status, body = self.call("POST", "/api/mistakes/bulk-update",
                                 {"ids": list(range(1, 502)), "fields": {"status": "new"}})
        self.assertEqual(status, 400, body)
        self.assertIn("最多改", body["error"]["message"])

    def test_bulk_update_ignores_unknown_fields(self):
        a = self.create(question="未知字段")
        status, body = self.call("POST", "/api/mistakes/bulk-update",
                                 {"ids": [a["id"]],
                                  "fields": {"question": "不该被改", "status": "new"}})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["fields"], ["status"])
        status, got = self.call("GET", "/api/mistakes/%d" % a["id"])
        self.assertEqual(got["data"]["question"], "未知字段")

    # -- LaTeX / 打印页 --
    def test_math_js_and_katex_served(self):
        self._need_web()
        for path in ("/math.js", "/vendor/katex/katex.min.js",
                     "/vendor/katex/katex.min.css"):
            with urllib.request.urlopen(self.base + path, timeout=5) as resp:
                self.assertEqual(resp.status, 200, path)
                self.assertTrue(resp.read(), path)
        with open(os.path.join(app.STATIC_DIR, "index.html"), "r", encoding="utf-8") as fh:
            html = fh.read()
        self.assertIn('src="/math.js"', html)
        self.assertIn('src="/vendor/katex/katex.min.js"', html)
        self.assertIn("mbMath.render", html)

    def test_print_page_loads_math_renderer(self):
        self.create(question="求 $\\lim_{x\\to 0}\\frac{\\sin x}{x}$ 的值",
                    answer="1")
        with urllib.request.urlopen(self.base + "/print?count=5", timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            page = resp.read().decode("utf-8")
        self.assertIn("/vendor/katex/katex.min.js", page)
        self.assertIn("/math.js", page)
        self.assertIn("mbMath.apply", page)

    def test_print_page_respects_paper_filter(self):
        status, body = self.call("POST", "/api/papers", {"name": "只印这张"})
        pid = body["data"]["id"]
        self.create(question="卷内独有题", paper_id=pid)
        self.create(question="卷外不该出现")
        with urllib.request.urlopen(self.base + "/print?paper_id=%d" % pid, timeout=5) as resp:
            page = resp.read().decode("utf-8")
        self.assertIn("卷内独有题", page)
        self.assertNotIn("卷外不该出现", page)

    def test_export_json_includes_papers_and_images(self):
        status, body = self.call("POST", "/api/papers", {"name": "导出卷"})
        pid = body["data"]["id"]
        self.create(question="导出多图", images=[PNG_A, PNG_B], paper_id=pid)
        with urllib.request.urlopen(self.base + "/api/export.json", timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        self.assertEqual(data["version"], 5)
        self.assertEqual(data["counts"]["papers"], 1)
        self.assertEqual(data["counts"]["mistake_images"], 2)
        self.assertEqual(len(data["papers"]), 1)
        self.assertEqual(data["mistakes"][0]["paper_id"], pid)
        self.assertEqual(len(data["mistake_images"]), 2)


    # ── v0.22 结构化断点 + NDJSON 事件流 ──

    def test_review_records_step(self):
        mid = self.create(question="断点题", knowledge="极限")["id"]
        status, body = self.call("POST", "/api/mistakes/%d/review" % mid,
                                 {"rating": "good", "step": "计算"})
        self.assertEqual(status, 200, body)
        status, body = self.call("GET", "/api/mistakes/%d/reviews" % mid)
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["items"][0]["step"], "计算")

    def test_review_without_step_is_allowed(self):
        mid = self.create(question="不断点题")["id"]
        status, body = self.call("POST", "/api/mistakes/%d/review" % mid, {"rating": "good"})
        self.assertEqual(status, 200, body)
        status, body = self.call("GET", "/api/mistakes/%d/reviews" % mid)
        self.assertEqual(body["data"]["items"][0]["step"], "")

    def test_review_rejects_unknown_step(self):
        mid = self.create(question="乱填断点")["id"]
        status, body = self.call("POST", "/api/mistakes/%d/review" % mid,
                                 {"rating": "good", "step": "瞎写"})
        self.assertEqual(status, 400, body)
        self.assertEqual(body["error"]["code"], "VALIDATION_ERROR")

    def test_meta_lists_steps(self):
        status, body = self.call("GET", "/api/meta")
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["steps"], list(app.REVIEW_STEPS))

    def test_analytics_aggregates_by_step(self):
        mid = self.create(question="断点聚合题", knowledge="极限")["id"]
        for _ in range(2):
            self.call("POST", "/api/mistakes/%d/review" % mid,
                      {"rating": "again", "step": "计算"})
        self.call("POST", "/api/mistakes/%d/review" % mid, {"rating": "good", "step": "审题"})
        status, body = self.call("GET", "/api/analytics?days=30")
        self.assertEqual(status, 200)
        data = body["data"]
        steps = {row["name"]: row["count"] for row in data["by_step"]}
        self.assertEqual(steps.get("计算"), 2)
        self.assertEqual(steps.get("审题"), 1)
        patterns = {(row["knowledge"], row["step"]): row["count"]
                    for row in data["step_patterns"]}
        self.assertEqual(patterns.get(("极限", "计算")), 2)
        self.assertNotIn(("极限", "审题"), patterns)   # 只错一次不算模式

    def test_events_record_create_and_review(self):
        mid = self.create(question="事件题", subject="高数", knowledge="导数")["id"]
        self.call("POST", "/api/mistakes/%d/review" % mid,
                  {"rating": "good", "step": "建模"})
        status, body = self.call("GET", "/api/events?limit=10")
        self.assertEqual(status, 200)
        kinds = [ev["kind"] for ev in body["data"]["items"]]
        self.assertEqual(kinds, ["created", "reviewed"])
        reviewed = body["data"]["items"][1]
        self.assertEqual(reviewed["step"], "建模")
        self.assertEqual(reviewed["id"], mid)
        self.assertEqual(reviewed["subject"], "高数")

    def test_events_filter_by_kind_and_id(self):
        first = self.create(question="事件甲")["id"]
        second = self.create(question="事件乙")["id"]
        self.call("POST", "/api/mistakes/%d/review" % second, {"rating": "hard"})
        status, body = self.call("GET", "/api/events?kind=reviewed")
        self.assertEqual([ev["id"] for ev in body["data"]["items"]], [second])
        status, body = self.call("GET", "/api/events?id=%d" % first)
        self.assertEqual([ev["kind"] for ev in body["data"]["items"]], ["created"])
        status, body = self.call("GET", "/api/events?kind=reviewed&id=%d" % first)
        self.assertEqual(body["data"]["items"], [])

    def test_events_file_sits_next_to_db(self):
        self.create(question="事件路径")
        self.assertTrue(os.path.exists(os.path.join(self.tmpdir, "events.ndjson")))

    def test_suspended_event(self):
        mid = self.create(question="斩题事件")["id"]
        self.call("POST", "/api/mistakes/%d/suspend" % mid)
        status, body = self.call("GET", "/api/events?kind=suspended")
        self.assertEqual([ev["id"] for ev in body["data"]["items"]], [mid])


    # ------------------------------------------------------------------ #
    # v0.35：列表排序器 / 学科与标签合并
    # ------------------------------------------------------------------ #
    def test_list_sort_options(self):
        """排序器四档 + 非法值回落。"""
        a = self.create(question='错最多')['id']
        b = self.create(question='最快到期')['id']
        c = self.create(question='最新录入')['id']
        for _ in range(3):
            self._review(a, 'again')
        self._make_due(b, 1)          # b 昨天就到期了

        _, body = self.call('GET', '/api/mistakes?sort=errors')
        self.assertEqual(body['data']['sort'], 'errors')
        self.assertEqual(body['data']['items'][0]['id'], a)

        _, body = self.call('GET', '/api/mistakes?sort=due')
        self.assertEqual(body['data']['sort'], 'due')
        self.assertEqual(body['data']['items'][0]['id'], b)

        _, body = self.call('GET', '/api/mistakes?sort=stability')
        self.assertEqual(body['data']['items'][0]['id'], a)

        # 拼错的档位落回默认，并把实际生效的档回传，前端下拉才不会选中不存在的项
        _, body = self.call('GET', '/api/mistakes?sort=bogus')
        self.assertEqual(body['data']['sort'], 'created')
        self.assertEqual(body['data']['items'][0]['id'], c)

    def test_meta_field_facets(self):
        self.create(question='q1', subject='数学', tags='极限,函数')
        self.create(question='q2', subject='数学', tags='极限')
        self.create(question='q3', subject='1', tags='4,14')
        _, body = self.call('GET', '/api/meta')
        data = body['data']
        sf = {f['name']: f['count'] for f in data['subject_facets']}
        self.assertEqual(sf['数学'], 2)
        self.assertEqual(sf['1'], 1)
        self.assertEqual(data['subject_facets'][0]['name'], '数学')   # 题多的排前面
        tf = {f['name']: f['count'] for f in data['tag_facets']}
        self.assertEqual(tf['极限'], 2)
        self.assertEqual(tf['4'], 1)
        self.assertEqual(tf['14'], 1)                                 # 子串不能串味
        # 老字段仍是裸字符串数组，CLI / 老前端不受影响
        self.assertEqual(data['subjects'][0], '数学')
        self.assertIn('极限', data['tags'])

    def test_meta_merge_subject(self):
        bad = self.create(question='学科写错', subject='1')['id']
        self.create(question='正常', subject='数学')
        status, body = self.call('POST', '/api/meta/merge', {
            'kind': 'subject', 'sources': ['1'], 'target': '数学'})
        self.assertEqual(status, 200, body)
        self.assertEqual(body['data']['kind'], 'subject')
        self.assertEqual(body['data']['moved'], 1)
        _, got = self.call('GET', '/api/mistakes/%d' % bad)
        self.assertEqual(got['data']['subject'], '数学')

    def test_meta_merge_tag_is_exact(self):
        """LIKE 是粗筛：并掉 '4' 不能把 '14' 一起吃了。"""
        item = self.create(question='标签陷阱', tags='4,14')['id']
        status, body = self.call('POST', '/api/meta/merge', {
            'kind': 'tag', 'sources': ['4'], 'target': '极限'})
        self.assertEqual(status, 200, body)
        self.assertEqual(body['data']['moved'], 1)
        _, got = self.call('GET', '/api/mistakes/%d' % item)
        self.assertEqual(got['data']['tags'], '极限,14')
        # 同一个标签并两次不会写出重复项
        self.call('POST', '/api/meta/merge', {
            'kind': 'tag', 'sources': ['极限'], 'target': '极限'})
        _, got = self.call('GET', '/api/mistakes/%d' % item)
        self.assertEqual(got['data']['tags'], '极限,14')

    def test_meta_merge_validation(self):
        for payload in ({'kind': 'knowledge', 'sources': ['a'], 'target': 'b'},
                        {'kind': 'subject', 'sources': [], 'target': 'b'}):
            status, body = self.call('POST', '/api/meta/merge', payload)
            self.assertEqual(status, 400, body)
            self.assertEqual(body['error']['code'], 'VALIDATION_ERROR')

    def test_meta_merge_empty_target_clears(self):
        # v0.39：目标留空 = 删除这个值（学科变未分类 / 标签消失）。
        a = self.create(question='脏学科', subject='1')['id']
        b = self.create(question='脏标签', tags='14,极限')['id']
        status, body = self.call('POST', '/api/meta/merge',
                                 {'kind': 'subject', 'sources': ['1'], 'target': ''})
        self.assertEqual(status, 200, body)
        self.assertTrue(body['data']['cleared'])
        _, got = self.call('GET', '/api/mistakes/%d' % a)
        self.assertEqual(got['data']['subject'], '')
        status, body = self.call('POST', '/api/meta/merge',
                                 {'kind': 'tag', 'sources': ['14'], 'target': ''})
        self.assertEqual(status, 200, body)
        _, got = self.call('GET', '/api/mistakes/%d' % b)
        self.assertEqual(got['data']['tags'], '极限')

    def test_meta_merge_writes_event(self):
        self.create(question='事件', subject='1')
        self.call('POST', '/api/meta/merge', {
            'kind': 'subject', 'sources': ['1'], 'target': '数学'})
        _, body = self.call('GET', '/api/events?kind=merged_subject')
        self.assertEqual(len(body['data']['items']), 1)
        self.assertEqual(body['data']['items'][0]['target'], '数学')

    def test_tags_keep_inner_spaces(self):
        # v0.46：标签里带空格的（「洛必达 法则」）以前被当两个标签切开，现在只按逗号切。
        item = self.create(question='带空格的标签', tags='洛必达 法则, 极限')
        self.assertEqual(item['tags'], '洛必达 法则,极限')
        # 全角逗号、换行都算分隔符；重复项只留一个
        item = self.create(question='重复标签', tags='极限，极限\n导数')
        self.assertEqual(item['tags'], '极限,导数')
        _, body = self.call('GET', '/api/mistakes?tag=' + urllib.parse.quote('洛必达 法则'))
        self.assertEqual(body['data']['total'], 1, '带空格的标签要能被筛到')

    def test_knowledge_merge_dry_run_changes_nothing(self):
        # v0.46：先试算影响面，用户确认了才真写。dry 必须一个字都不落库。
        a = self.create(question='脏值一', knowledge='111')['id']
        self.create(question='脏值二', knowledge='111/子节点')
        status, body = self.call('POST', '/api/knowledge/merge', {
            'sources': ['111'], 'target': '函数', 'dry': True})
        self.assertEqual(status, 200, body)
        data = body['data']
        self.assertTrue(data['dry'])
        self.assertEqual(data['moved'], 2)
        self.assertEqual(data['samples'][0]['id'], a)
        self.assertIn('脏值一', data['samples'][0]['question'])
        # 没写库：题还是脏值，别名也没登记
        _, got = self.call('GET', '/api/mistakes/%d' % a)
        self.assertEqual(got['data']['knowledge'], '111')
        _, aliases = self.call('GET', '/api/knowledge/aliases')
        self.assertEqual(aliases['data']['items'], [])
        # 真正执行一次，结果与预览一致
        status, body = self.call('POST', '/api/knowledge/merge', {
            'sources': ['111'], 'target': '函数'})
        self.assertEqual(status, 200, body)
        self.assertEqual(body['data']['moved'], 2)
        self.assertNotIn('dry', body['data'])
        _, got = self.call('GET', '/api/mistakes/%d' % a)
        self.assertEqual(got['data']['knowledge'], '函数')

    def test_meta_merge_dry_run_changes_nothing(self):
        a = self.create(question='脏标签', tags='14,极限')['id']
        status, body = self.call('POST', '/api/meta/merge', {
            'kind': 'tag', 'sources': ['14'], 'target': '', 'dry': True})
        self.assertEqual(status, 200, body)
        self.assertTrue(body['data']['dry'])
        self.assertEqual(body['data']['moved'], 1)
        _, got = self.call('GET', '/api/mistakes/%d' % a)
        self.assertEqual(got['data']['tags'], '14,极限', 'dry 不该动标签')
        status, body = self.call('POST', '/api/meta/merge', {
            'kind': 'tag', 'sources': ['14'], 'target': ''})
        self.assertEqual(status, 200, body)
        _, got = self.call('GET', '/api/mistakes/%d' % a)
        self.assertEqual(got['data']['tags'], '极限')
    def test_mb_list_sort_cli(self):
        a = self.create(question='错最多')['id']
        self.create(question='别的')
        self._review(a, 'again')
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(['--db', self.db, 'list', '--sort', 'errors'])
        self.assertEqual(code, 0)
        data = json.loads(out.getvalue())
        self.assertEqual(data['sort'], 'errors')
        self.assertEqual(data['items'][0]['id'], a)

    def test_mb_meta_merge_cli(self):
        self.create(question='脏学科', subject='1')
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(['--db', self.db, 'meta-merge', 'subject', '1', '--to', '数学'])
        self.assertEqual(code, 0)
        data = json.loads(out.getvalue())
        self.assertEqual(data['kind'], 'subject')
        self.assertEqual(data['moved'], 1)
        self.assertEqual(data['target'], '数学')

    def test_mb_meta_merge_read_only_refused(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = mb.main(['--db', self.db, '--read-only', 'meta-merge', 'tag', '4', '--to', 'x'])
        self.assertEqual(code, 2)
        self.assertIn('read-only', out.getvalue())

    def test_static_v035_ui(self):
        """排序下拉、弹窗翻页、合并面板三档（v0.35）。"""
        self._need_web()
        with urllib.request.urlopen(self.base + '/', timeout=5) as resp:
            html = resp.read().decode('utf-8')
        self.assertIn('id="sort"', html)
        self.assertIn("p.set('sort'", html)
        for value in ('created', 'due', 'stability', 'errors'):
            self.assertIn('<option value="%s">' % value, html)
        self.assertIn('id="btn-prev-item"', html)
        self.assertIn('id="btn-next-item"', html)
        for name in ('function stepItem(', 'function syncNav(', 'function orderPos('):
            self.assertIn(name, html)
        self.assertIn('id="mg-kind"', html)
        self.assertIn("'/api/meta/merge'", html)
        for value in ('knowledge', 'subject', 'tag'):
            self.assertIn('<option value="%s">' % value, html)

if __name__ == "__main__":
    unittest.main(verbosity=2)