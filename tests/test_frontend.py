# -*- coding: utf-8 -*-
"""把前端 Node 测试接进 unittest：python -m unittest discover -s tests 一个入口跑全部。

Node 不在 PATH 上就跳过（不把前端测试变成硬依赖）。
"""
import os
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_FILE = os.path.join(ROOT, "tests", "frontend.test.cjs")


@unittest.skipUnless(shutil.which("node"), "node 不在 PATH 上，跳过前端测试")
class FrontendTest(unittest.TestCase):
    def test_node_unit_tests_pass(self):
        result = subprocess.run(
            ["node", "--test", TEST_FILE],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=120)
        if result.returncode != 0:
            sys.stderr.write(result.stdout or "")
            sys.stderr.write(result.stderr or "")
        self.assertEqual(result.returncode, 0, "前端测试失败，见上方输出")

    def test_lib_js_is_valid_syntax(self):
        result = subprocess.run(
            ["node", "--check", os.path.join(ROOT, "static", "lib.js")],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
