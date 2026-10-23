
# -*- coding: utf-8 -*-
"""v0.34 DSH 面板：知识点分层下拉 + 未归类 + 合并入口。"""
import io, sys

PATH = "dsh-plugin/lib/client.js"
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


# 0) 顶部工具：facet 归一化（meta.knowledge 可能是字符串数组，也可能是 {path,count,depth} 对象数组）
sub("""    // 学习/计划/分析页的「去练」把筛选条件暂存在这里，切到错题页时 ListTab 挂载即取走
    let pendingListFilter = null;""",
    """    // v0.34：/api/meta 的 knowledge 从裸字符串数组升级成 {path,name,parent,depth,count} 对象数组。
    // 老数据库/老服务仍可能返回字符串，这里统一成对象，调用处不必再判断类型。
    function knowledgeFacets(meta) {
      const list = (meta && meta.knowledge) || [];
      return list.map((item) => (typeof item === 'string'
        ? { path: item, name: item, parent: '', depth: 1, count: 0 }
        : { path: item.path, name: item.name || item.path, parent: item.parent || '',
          depth: item.depth || 1, count: item.count || 0 }));
    }

    // 层级用全角空格缩进：dropdown 的 label 是纯文本，没有别的缩进手段
    function facetLabel(facet) {
      const pad = new Array(Math.max(1, facet.depth || 1)).join('\u3000');
      return pad + facet.name + (facet.count ? '（' + facet.count + '）' : '');
    }

    // 学习/计划/分析页的「去练」把筛选条件暂存在这里，切到错题页时 ListTab 挂载即取走
    let pendingListFilter = null;""",
    "helpers")

# 1) 表单的知识点 datalist 用扁平全路径
sub("            choices('mb-dl-knowledge', meta && meta.knowledge)),",
    "            choices('mb-dl-knowledge', (meta && meta.knowledge_flat) || knowledgeFacets(meta).map((f) => f.path))),",
    "form-datalist")

# 2) 筛选初始值加 nokp / kdeep
sub("          q: '', subject: '', status: '', mistake_type: '', range: '', knowledge: '', tag: '',\n          scopeQ: false, suspended: false, due: initialScope === 'due', page: 1, pageSize: 20,",
    "          q: '', subject: '', status: '', mistake_type: '', range: '', knowledge: '', tag: '',\n          kdeep: true, unclassified: false,\n          scopeQ: false, suspended: false, due: initialScope === 'due', page: 1, pageSize: 20,",
    "filters-init")

# 3) 请求参数
sub("          if (filters.knowledge) params.push('knowledge=' + encodeURIComponent(filters.knowledge));",
    """          // 选具体知识点时默认含子树（kdeep=1）；「未归类」走独立的 nokp=1
          if (filters.unclassified) params.push('nokp=1');
          else if (filters.knowledge) {
            params.push('knowledge=' + encodeURIComponent(filters.knowledge));
            if (filters.kdeep) params.push('kdeep=1');
          }""",
    "params")

# 4) chip
sub("      if (filters.knowledge) chips.push(['knowledge', '知识点：' + filters.knowledge]);",
    """      if (filters.unclassified) chips.push(['unclassified', '未归类']);
      else if (filters.knowledge) {
        chips.push(['knowledge', '知识点：' + filters.knowledge + (filters.kdeep ? '（含子类）' : '')]);
      }""",
    "chips")

# 5) 筛选下拉：把知识点换成 facet 列表 + 未归类 + 含子类勾选
sub("""          h(Dropdown, {
            value: filters.knowledge, placeholder: '全部知识点',
            options: [{ value: '', label: '全部知识点' }].concat(
              ((meta && meta.knowledge) || []).map((name) => ({ value: name, label: name }))),
            onChange: (value) => patch({ knowledge: value }),
          }),""",
    """          h(Dropdown, {
            value: filters.unclassified ? '__none__' : filters.knowledge, placeholder: '全部知识点',
            options: [{ value: '', label: '全部知识点' }]
              .concat(((meta && meta.knowledge_unclassified) || 0)
                ? [{ value: '__none__', label: '（未归类 · ' + meta.knowledge_unclassified + ' 道）' }]
                : [])
              .concat(knowledgeFacets(meta).map((facet) => ({ value: facet.path, label: facetLabel(facet) }))),
            onChange: (value) => patch(value === '__none__'
              ? { unclassified: true, knowledge: '' }
              : { unclassified: false, knowledge: value }),
          }),
          h('label.mb-meta.full', { style: { gap: '12px' } },
            h('label', null,
              h('input', {
                type: 'checkbox', checked: filters.kdeep,
                onChange: (e) => patch({ kdeep: e.target.checked }),
              }), ' 含子类')),""",
    "knowledge-dropdown")

io.open(PATH, "w", encoding="utf-8", newline="\n").write(src)
print("patched %d -> %d bytes; %d edits: %s" % (orig, len(src), len(applied), ", ".join(applied)))
