
# -*- coding: utf-8 -*-
"""v0.34 面板渲染测试：知识点 facet 下拉 + 未归类 + 含子类。"""
import io

PATH = "tests/test_client_render.mjs"
src = io.open(PATH, encoding="utf-8").read()
orig = len(src)

anchor = """// 「更多」菜单：窄面板下按钮被挤到第二行左端，right:0 会把菜单推到视口外；"""
assert src.count(anchor) == 1
add = '''// v0.34：/api/meta 的 knowledge 变成 {path,name,parent,depth,count}。
// 下拉要按层级缩进 + 带题数，另给一个「未归类」项；老服务返回字符串数组也不能崩。
const META_FACETS = {
  subjects: ['高数'],
  knowledge: [
    { path: '函数', name: '函数', parent: '', depth: 1, count: 3 },
    { path: '函数/二次函数', name: '二次函数', parent: '函数', depth: 2, count: 2 },
    { path: '数列', name: '数列', parent: '', depth: 1, count: 1 },
  ],
  knowledge_flat: ['函数/二次函数', '数列'],
  knowledge_unclassified: 2,
  mistake_types: ['概念不清'], sources: ['作业'],
};

test('知识点下拉：按层级缩进、带题数、另有「未归类」项', () => {
  const seed = [Object.assign({}, FILTERS), [], 0, false, '', {}, false, false, false, true, ''];
  const { plugin } = loadPlugin(seed);
  const dom = render(plugin.__test__.ListTab({ meta: META_FACETS, onOpen: () => {} }));
  const labels = dropdownLabels(dom);
  assert.ok(labels.includes('全部知识点'), '保留全选项');
  assert.ok(labels.includes('（未归类 · 2 道）'), '未归类要带题数');
  // 平铺（depth 1）与子层（depth 2）都出现，子层前面有全角空格缩进
  assert.ok(labels.some((l) => l.includes('函数（3）')), '父节点带汇总题数');
  const child = labels.find((l) => l.includes('二次函数（2）'));
  assert.ok(child, '子节点带自己的题数');
  assert.ok(child.startsWith('\u3000'), '子节点要比父节点多一级缩进');
  assert.ok(labels.includes('数列（1）'));
});

test('知识点下拉：老服务返回字符串数组时不崩（兼容）', () => {
  const seed = [Object.assign({}, FILTERS), [], 0, false, '', {}, false, false, false, true, ''];
  const { plugin } = loadPlugin(seed);
  const dom = render(plugin.__test__.ListTab({ meta: META, onOpen: () => {} }));
  const labels = dropdownLabels(dom);
  assert.ok(labels.includes('极限'), '字符串形态直接当平铺节点');
  assert.ok(!labels.some((l) => l.includes('[object')), '不能渲染成 [object Object]');
});

test('筛选抽屉：选知识点带 kdeep，选未归类换成 nokp', () => {
  const byKp = Object.assign({}, FILTERS, { due: false, knowledge: '函数', kdeep: true, unclassified: false });
  let seed = [byKp, [], 0, false, '', {}, false, false, false, true, ''];
  let { plugin } = loadPlugin(seed);
  let text = textOf(render(plugin.__test__.ListTab({ meta: META_FACETS, onOpen: () => {} }))).join('|');
  assert.match(text, /知识点：函数（含子类）/);
  assert.match(text, /含子类/);

  const byNone = Object.assign({}, FILTERS, { due: false, knowledge: '', kdeep: true, unclassified: true });
  seed = [byNone, [], 0, false, '', {}, false, false, false, true, ''];
  ({ plugin } = loadPlugin(seed));
  text = textOf(render(plugin.__test__.ListTab({ meta: META_FACETS, onOpen: () => {} }))).join('|');
  assert.match(text, /未归类/);
});

'''
src = src.replace(anchor, add + anchor)
io.open(PATH, "w", encoding="utf-8", newline="\n").write(src)
print("patched %d -> %d bytes" % (orig, len(src)))
