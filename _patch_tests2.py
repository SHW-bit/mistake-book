
# -*- coding: utf-8 -*-
"""补 v0.34 前端结构测试：分层下拉 / 未归类 / 合并面板。"""
import io

PATH = "tests/test_api.py"
src = io.open(PATH, encoding="utf-8").read()
orig = len(src)

anchor = """    def test_create_requires_question(self):"""
assert src.count(anchor) == 1
new_test = '''    def test_static_knowledge_facets_ui(self):
        """知识点分层下拉 + 未归类项 + 合并面板（v0.34）。

        知识点以前是自由文本：「111」「2」这样的脏值也能进库，下拉里一串裸字符串
        既看不出层级也没有题数，点父节点还检索不到子节点里的题。这一版把三件事
        一起改掉，用断言钉住，免得以后又退回扁平字符串。
        """
        with urllib.request.urlopen(self.base + "/", timeout=5) as resp:
            html = resp.read().decode("utf-8")
        # 1) 分层下拉：读 facet 的 depth/count，渲染缩进与题数
        self.assertIn("m.knowledge_flat", html)
        self.assertIn("m.knowledge_unclassified", html)
        self.assertIn("'.join('\\u3000')" if False else "new Array((k.depth || 1)).join", html)
        # 2) 未归类走独立参数，不混进 knowledge
        self.assertIn("p.set('nokp', '1')", html)
        self.assertIn("p.set('kdeep', '1')", html)
        self.assertIn("value=\\"__none__\\"", html)
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

'''
src = src.replace(anchor, new_test + anchor)
io.open(PATH, "w", encoding="utf-8", newline="\n").write(src)
print("patched %d -> %d bytes" % (orig, len(src)))
