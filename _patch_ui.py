
# -*- coding: utf-8 -*-
"""v0.34 前端：分层知识点下拉 + 未归类 + 关键词 + 合并面板（一次性补丁）。"""
import io, sys

PATH = "static/index.html"
src = io.open(PATH, encoding="utf-8").read()
orig_len = len(src)
applied = []


def sub(anchor, new, tag, count=1):
    global src
    n = src.count(anchor)
    if n != count:
        print("ANCHOR-FAIL %s: found %d, want %d" % (tag, n, count))
        sys.exit(1)
    src = src.replace(anchor, new)
    applied.append(tag)


# 1) 表单知识点输入接上 datalist
sub('<input id="f-knowledge" placeholder="如 函数单调性">',
    '<input id="f-knowledge" list="knowledge-list" placeholder="如 函数/单调性（用 / 分层）">',
    "f-knowledge")

# 2) datalist 容器
sub('  <datalist id="source-list"></datalist>',
    '  <datalist id="source-list"></datalist>\n  <datalist id="knowledge-list"></datalist>',
    "knowledge-datalist")

# 3) 筛选下拉：分层 + 计数 + 未归类
old = """      var ksel = $('#knowledge');
      var kcur = ksel.value;
      ksel.innerHTML = '<option value="">全部知识点</option>' + (m.knowledge || []).map(function (x) {
        return '<option value="' + esc(x) + '">' + esc(x) + '</option>';
      }).join('');
      ksel.value = kcur;"""
new = """      // v0.34：知识点从「一串裸字符串」升级成带 parent/depth/count 的 facet 列表。
      // 选项按全路径排序，前面补全角空格做缩进，父节点能看出子节点关系；带计数才知道哪堆题多。
      var facets = (m.knowledge || []).map(function (k) {
        return typeof k === 'string'
          ? { path: k, name: k, depth: 1, count: 0 }
          : k;
      });
      var ksel = $('#knowledge');
      var kcur = ksel.value;
      ksel.innerHTML = '<option value="">全部知识点</option>' +
        ((m.knowledge_unclassified || 0)
          ? '<option value="__none__">（未归类 · ' + m.knowledge_unclassified + ' 道）</option>'
          : '') +
        facets.map(function (k) {
          var pad = new Array((k.depth || 1)).join('\u3000');
          return '<option value="' + esc(k.path) + '">' + pad + esc(k.name) +
            '（' + (k.count || 0) + '）</option>';
        }).join('');
      ksel.value = kcur;

      $('#knowledge-list').innerHTML = (m.knowledge_flat || []).map(function (x) {
        return '<option value="' + esc(x) + '">';
      }).join('');"""
sub(old, new, "knowledge-select")

# 4) query()：未归类 / 子树
sub("""    if ($('#knowledge').value) { p.set('knowledge', $('#knowledge').value); }""",
    """    // 「未归类」不是一个知识点名，走独立参数 nokp=1。
    // 选中某个知识点时显式带 kdeep=1（后端默认已含子树，这里写明意图）。
    var kn = $('#knowledge').value;
    if (kn === '__none__') { p.set('nokp', '1'); }
    else if (kn) { p.set('knowledge', kn); p.set('kdeep', '1'); }""",
    "query-knowledge")

# 5) chip 上显示末段名，title 给全路径（长路径会把一行撑爆）
sub("""          (it.knowledge ? '<span class="chip kp">' + esc(it.knowledge) + '</span>' : '') +""",
    """          (it.knowledge ? '<span class="chip kp" title="' + esc(it.knowledge) + '">' +
            esc(String(it.knowledge).split('/').pop()) + '</span>' : '') +""",
    "list-chip")

# 6) chip 文案：未归类
sub("""  function filterText(d, v) {
    if (d.id === 'paper') {""",
    """  function filterText(d, v) {
    if (d.id === 'knowledge' && v === '__none__') { return '未归类'; }
    if (d.id === 'paper') {""",
    "filterText")

# 7) 学习页加「合并 / 清理」面板
sub("""    <div class="varlist" id="al-list"></div>
  </details>""",
    """    <div class="varlist" id="al-list"></div>
  </details>
  <details class="panel" id="st-merge-box">
    <summary>合并 / 清理知识点（把「111」这类脏值并到规范名）</summary>
    <div class="aliasform">
      <input id="mg-target" list="knowledge-list" placeholder="规范名，如 函数/单调性">
      <button type="button" id="mg-merge">合并所选</button>
    </div>
    <div class="varlist" id="mg-list"></div>
  </details>""",
    "merge-panel")

# 8) 合并面板的加载与提交
sub("""  // ---- 变式缺口 ----
  function loadGaps() {""",
    """  // ---- 知识点合并（v0.34）----
  // 别名只影响「以后」的写入，库里已有的脏值还得搬一次；
  // 这个面板就是搬的那一下：多选源 → 一个规范名 → POST /api/knowledge/merge。
  function mergeSources() {
    var out = [];
    var boxes = document.querySelectorAll('#mg-list input[type="checkbox"]');
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked) { out.push(boxes[i].value); }
    }
    return out;
  }

  function loadMergeList() {
    return api('/api/meta').then(function (m) {
      var facets = (m.knowledge || []).map(function (k) {
        return typeof k === 'string' ? { path: k, name: k, depth: 1, count: 0 } : k;
      });
      if (!facets.length) {
        $('#mg-list').innerHTML =
          '<div style="font-size:12px;color:var(--muted)">还没有知识点。</div>';
        return;
      }
      $('#mg-list').innerHTML = facets.map(function (k) {
        return '<label class="varitem mgitem">' +
          '<input type="checkbox" value="' + esc(k.path) + '">' +
          '<span class="vq" title="' + esc(k.path) + '">' +
            new Array((k.depth || 1)).join('\u3000') + esc(k.name) + '</span>' +
          '<span class="vm">' + (k.count || 0) + ' 题</span></label>';
      }).join('');
      if (m.knowledge_unclassified) {
        $('#mg-list').insertAdjacentHTML('beforeend',
          '<div style="font-size:12px;color:var(--muted);margin-top:4px">' +
          '另有 ' + m.knowledge_unclassified + ' 道题没填知识点，用「批量修改」补。</div>');
      }
    }).catch(function (e) {
      $('#mg-list').innerHTML = '<div style="font-size:12px;color:var(--danger)">加载失败：' +
        esc(e.message) + '</div>';
    });
  }

  // ---- 变式缺口 ----
  function loadGaps() {""",
    "loadMergeList")

# 9) 合并按钮
sub("""  $('#al-add').addEventListener('click', function () {""",
    """  $('#mg-merge').addEventListener('click', function () {
    var sources = mergeSources();
    var target = $('#mg-target').value.trim();
    if (!sources.length) { alert('先勾选要合并的知识点'); return; }
    if (!target) { alert('填一个规范名，比如 函数/单调性'); return; }
    if (!confirm('把 ' + sources.length + ' 个知识点并到「' + target + '」？\\n' +
                 '题目会被改写，且不会自动还原。')) { return; }
    api('/api/knowledge/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: sources, target: target })
    }).then(function (d) {
      $('#mg-target').value = '';
      alert('已合并 ' + d.merged + ' 个知识点，改写 ' + d.moved + ' 道题 → ' + d.target);
      return Promise.all([loadMergeList(), loadStats(), loadTree()]);
    }).catch(function (err) { alert('合并失败：' + err.message); });
  });

  $('#al-add').addEventListener('click', function () {""",
    "merge-handler")

# 10) 进入学习页 / 首屏时加载合并列表
sub("    if (name === 'study') { loadStudy(); loadAliases(); loadGaps(); }",
    "    if (name === 'study') { loadStudy(); loadAliases(); loadGaps(); loadMergeList(); }",
    "switchView")
sub("  loadStudy(); loadAliases(); loadGaps();",
    "  loadStudy(); loadAliases(); loadGaps(); loadMergeList();",
    "bootstrap")

# 11) CSS
sub(""".aliasform input{flex:1;min-width:160px}""",
    """.aliasform input{flex:1;min-width:160px}
.mgitem{cursor:pointer}
.mgitem input{flex:none;margin:0}""",
    "css")

io.open(PATH, "w", encoding="utf-8", newline="\n").write(src)
print("patched %d -> %d bytes; %d edits: %s" % (orig_len, len(src), len(applied), ", ".join(applied)))
