
# -*- coding: utf-8 -*-
"""补 v0.34 CLI 测试：list 的新参数 + merge 子命令。"""
import io, sys

PATH = "tests/test_api.py"
src = io.open(PATH, encoding="utf-8").read()
orig = len(src)

anchor = """    def test_mb_ktree(self):"""
assert src.count(anchor) == 1
new_tests = '''    def test_mb_list_knowledge_flags(self):
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

'''
src = src.replace(anchor, new_tests + anchor)
io.open(PATH, "w", encoding="utf-8", newline="\n").write(src)
print("patched %d -> %d bytes" % (orig, len(src)))
