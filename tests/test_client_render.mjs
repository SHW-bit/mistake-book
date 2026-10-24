// 错题本 DSH 插件 · 客户端半的**渲染**测试。
//
// test_client.mjs 只验证「注册了什么」，管不到 hyperscript 里的引用错误。本机没有 React 包
// （宿主把 React 打进自己的客户端 bundle 里了），所以这里自带一个极简渲染器：
// createElement 造 vnode，函数组件就地调用，hooks 从一份预设的 state 序列里按顺序取。
//
// v0.23 起不再「整棵 App 一次渲染 + 按 useState 声明顺序排 seed」——那种写法每加一个
// 状态就要挪索引，改一次界面全红。现在改成：工厂额外导出 __test__ 里的组件，逐个渲染，
// 每个用例只关心自己那个组件的 seed。代价是要知道组件内 hooks 的先后顺序（下面各用例
// 的注释里写明了）。
//
// 跑法：node --test tests/test_client_render.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(here, '..', 'dsh-plugin', 'lib', 'client.js');

/** 假 React：hooks 依次从 seed 取值；setState 是空操作（渲染一次就够）。 */
function fakeReact(seed) {
  let cursor = 0;
  return {
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    useState: (init) => {
      // 与 React 一致：没给 seed 时，函数式初值要被调用（ItemForm 的表单初值就是函数）。
      // seed 里显式写 undefined = 这一格用组件自己的初值，方便只覆盖后面的 hook。
      const value = cursor < seed.length && seed[cursor] !== undefined
        ? seed[cursor] : (typeof init === 'function' ? init() : init);
      cursor += 1;
      return [value, () => {}];
    },
    useEffect: (fn) => { try { fn(); } catch (error) { /* 效果里的异步失败不该弄崩渲染 */ } },
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
  };
}

/** 装载插件，返回 { inject, apply, __test__ }。seed 供 __test__ 里的组件渲染时取 state。 */
function loadPlugin(seed = []) {
  const registered = [];
  const sandbox = {
    window: { __ModuleLoader__: { load: (entry) => registered.push(entry) } },
    document: {
      getElementById: () => null,
      createElement: () => ({ set textContent(value) { void value; }, id: '' }),
      head: { appendChild: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: () => new Promise(() => {}),   // 永不落地：效果里的请求不影响这一次渲染
    console,
    Promise, JSON, String, Number, Array, Object, Error, Math, Date,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CLIENT, 'utf8'), sandbox, { filename: CLIENT });

  const slots = [];
  const plugin = registered[0].factory(() => fakeReact(seed));
  plugin.apply({
    get: () => null,
    slots: {
      inject: (name, cb) => cb(),
      register: (definition, component) => slots.push({ definition, component }),
    },
  });
  assert.ok(plugin.__test__, '工厂要导出 __test__ 组件表');
  return { plugin, slots };
}

/** 把 vnode 树摊平成 DOM 形状的普通对象（函数组件就地展开）。 */
function render(node) {
  if (node === null || node === undefined || node === false || node === true) return null;
  if (Array.isArray(node)) return node.map(render);
  if (typeof node !== 'object') return String(node);
  const type = node.type;
  const props = node.props || {};
  const kids = node.kids || [];
  if (typeof type === 'function') return render(type(Object.assign({}, props, { children: kids })));
  return { tag: type, props, children: kids.map(render) };
}

function textOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (Array.isArray(node)) { node.forEach((kid) => textOf(kid, out)); return out; }
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (node.children) textOf(node.children, out);
  return out;
}

function classesOf(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((kid) => classesOf(kid, out)); return out; }
  if (node.props && node.props.className) out.push(node.props.className);
  if (node.children) classesOf(node.children, out);
  return out;
}

/** 在**未展开**的 vnode 树里找下拉，收集全部选项文案（关闭态不会渲染选项）。 */
function dropdownLabels(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((kid) => dropdownLabels(kid, out)); return out; }
  const props = node.props || {};
  if (Array.isArray(props.options) && props.options.length
    && props.options.every((opt) => opt && 'value' in opt && 'label' in opt)) {
    props.options.forEach((opt) => out.push(String(opt.label)));
  }
  (node.kids || []).forEach((kid) => dropdownLabels(kid, out));
  return out;
}

/** 按标签收集已渲染的节点（用于断言控件类型，比如「上限是 number 输入框」）。 */
function nodesOf(node, tag, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((kid) => nodesOf(kid, tag, out)); return out; }
  if (node.tag === tag) out.push(node);
  if (node.children) node.children.forEach((kid) => nodesOf(kid, tag, out));
  return out;
}

const META = {
  subjects: ['高数'], knowledge: ['极限'], mistake_types: ['概念不清'], sources: ['作业'],
  // v0.49：来源 facets 只有库里真用过的值；示例走独立的只读字段 source_hints，
  // 既不进 facets 也不进下拉 —— 面板里因此不会出现删不掉的幽灵行。
  source_facets: [
    { name: '作业', count: 3 },
    { name: '自编卷', count: 1 },
  ],
  source_hints: ['作业', '练习册', '周测', '月考', '期中', '期末', '模拟考', '其他'],
  subject_facets: [{ name: '高数', count: 3 }],
  tag_facets: [{ name: '极限', count: 2 }],
};
// 到期徽标是拿「今天」比出来的，写死日期会在第二天变成「逾期 N 天」——按运行当天生成。
const TODAY = (() => {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
})();
const ITEM = { id: 6, question: '求 lim(x→0) sin x / x', subject: '高数', knowledge: '极限',
  next_review_at: TODAY + ' 10:00:00', review_count: 2 };
const DETAIL = { id: 6, question: '求 lim(x→0) sin x / x', answer: '1', analysis: '等价无穷小',
  my_answer: '0', mistake_type: '概念不清', knowledge: '极限', review_count: 2,
  subject: '高数', difficulty: 3, tags: '极限,洛必达' };

// Dropdown 的 hooks 顺序：open, active, pos, dark（后两个来自 usePopupAnchor）
test('自定义下拉：关闭态只显示当前项，展开态列出全部并标出选中项', () => {
  const options = [{ value: '', label: '全部学科' }, { value: '高数', label: '高数' },
    { value: '线代', label: '线代', disabled: true }];
  const closed = render(loadPlugin([false, -1]).plugin.__test__.Dropdown({
    value: '高数', options, onChange: () => {},
  }));
  const closedClasses = classesOf(closed).join(' ');
  const closedText = textOf(closed).join('|');
  assert.match(closedClasses, /mb-dd/);
  assert.ok(!/mb-dd open/.test(closedClasses), '关闭态不该带 open');
  assert.match(closedText, /高数/);
  assert.ok(!closedText.includes('全部学科'), '关闭态不该列出其它选项');
  assert.equal(closed.children[0].props['aria-expanded'], 'false');
  assert.equal(closed.children[0].props['aria-haspopup'], 'listbox');

  const opened = render(loadPlugin([true, 1]).plugin.__test__.Dropdown({
    value: '高数', options, onChange: () => {},
  }));
  const openText = textOf(opened).join('|');
  assert.match(classesOf(opened).join(' '), /mb-dd open/);
  assert.match(openText, /全部学科/);
  assert.match(openText, /线代/);
  assert.ok(openText.includes('✓'), '选中项要有勾');
  assert.equal(opened.children[0].props['aria-expanded'], 'true');
  const optionNodes = nodesOf(opened, 'button').filter((node) => node.props.role === 'option');
  assert.equal(optionNodes.length, 3);
  assert.equal(optionNodes[2].props.disabled, true, '禁用项要传下去');
  assert.equal(optionNodes[1].props['aria-selected'], 'true', '选中项要 aria-selected');
});

// 深色主题下弹层若用白底 + 继承来的浅色字就会看不见（v0.24.1 修的 bug）
test('自定义下拉：按宿主文字亮度决定弹层深浅', () => {
  const { isLightColor } = loadPlugin([]).plugin.__test__;
  assert.equal(isLightColor('rgb(221, 221, 221)'), true, '浅字 = 深色主题');
  assert.equal(isLightColor('rgba(255, 255, 255, 0.92)'), true);
  assert.equal(isLightColor('rgb(28, 28, 25)'), false, '深字 = 浅色主题');
  assert.equal(isLightColor('rgb(94, 94, 85)'), false);
  assert.equal(isLightColor(''), false, '拿不到颜色时按浅色兜底');
  assert.equal(isLightColor('not-a-color'), false);
});

// 弹层在滚动容器里会被裁（详情区、表单区都是 overflow:auto），所以定位改成 fixed。
test('自定义下拉：拿到坐标后用 fixed 定位，避开滚动容器裁剪', () => {
  const options = [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }];
  const opened = render(loadPlugin([true, 0, { top: 120, left: 36, width: 168, maxHeight: 200 }, false])
    .plugin.__test__.Dropdown({ value: 'a', options, onChange: () => {} }));
  const pop = opened.children[1];
  assert.equal(pop.props.style.position, 'fixed');
  assert.equal(pop.props.style.top, '120px');
  assert.equal(pop.props.style.left, '36px');
  assert.equal(pop.props.style.minWidth, '168px');
  assert.equal(pop.props.style.maxHeight, '200px');

  // 没有坐标（首帧 / 无 window）时退回 CSS 里的 absolute，不能崩
  const plain = render(loadPlugin([true, 0, null, false])
    .plugin.__test__.Dropdown({ value: 'a', options, onChange: () => {} }));
  assert.equal(plain.children[1].props.style, null);
});

// 上面测的是「该用深色弹层吗」；这条测「弹层真的够清楚吗」——直接算 WCAG 对比度，
// 防止以后有人把 color 改回 inherit（浅字 + 白底，对比度 1.0，肉眼就是一片白）。
test('自定义下拉：弹层两种配色的对比度都过 WCAG AA', () => {
  const css = fs.readFileSync(CLIENT, 'utf8');
  const luminance = (hex) => {
    const raw = hex.replace('#', '');
    const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
    const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const blockOf = (selector) => {
    const found = new RegExp("'" + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}').exec(css);
    assert.ok(found, 'client.js 里找不到 ' + selector);
    return found[1];
  };
  const colorsOf = (block) => ({
    bg: /(?:^|;)background:(#[0-9a-fA-F]{3,6})/.exec(block)[1],
    fg: /(?:^|;)color:(#[0-9a-fA-F]{3,6})/.exec(block)[1],
  });
  const light = colorsOf(blockOf('.mb-dd-pop'));
  const dark = colorsOf(blockOf('.mb-dd-pop.dark'));
  assert.ok(contrast(light.bg, light.fg) >= 4.5, '浅色弹层对比度不足：' + contrast(light.bg, light.fg).toFixed(2));
  assert.ok(contrast(dark.bg, dark.fg) >= 4.5, '深色弹层对比度不足：' + contrast(dark.bg, dark.fg).toFixed(2));

  // 「更多」菜单（.mb-pop）同样要过：v0.24.1 之前它只写 background 不写 color
  const popLight = colorsOf(blockOf('.mb-pop'));
  const popDark = colorsOf(blockOf('.mb-pop.dark'));
  assert.ok(contrast(popLight.bg, popLight.fg) >= 4.5, '浅色浮层对比度不足：' + contrast(popLight.bg, popLight.fg).toFixed(2));
  assert.ok(contrast(popDark.bg, popDark.fg) >= 4.5, '深色浮层对比度不足：' + contrast(popDark.bg, popDark.fg).toFixed(2));
});

test('App 骨架：标题、统计、六个页签、新建按钮都在', () => {
  const { plugin } = loadPlugin([]);
  const dom = render(plugin.__test__.MistakeBookApp({}));
  const text = textOf(dom).join('|');
  assert.match(text, /错题本/);
  // 计数被 <b> 包了（视觉上强调数字），textOf 用 '|' 连接子节点
  assert.match(text, /共 \|0\| 道 · 到期 \|0\| 道/);
  assert.match(text, /＋ 新建/);
  for (const tab of ['错题', '学习', '计划', '分析', '再战', '回收站']) {
    assert.ok(text.includes(tab), '缺页签：' + tab);
  }
  assert.match(classesOf(dom).join(' '), /mb-tabs/);
  assert.match(classesOf(dom).join(' '), /mb-split/);
  // 标题旁要有版本号：改了界面却「看不出区别」时，先看这里确认跑的是哪份代码
  assert.match(text, /v0\.51/);
});

// v0.43 起面板标题旁显示版本号，值必须与 package.json 一致 —— 否则它就是个骗人的标签。
test('标题旁的版本号与 package.json 的 version 一致', () => {
  const { plugin } = loadPlugin([]);
  const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'dsh-plugin', 'package.json'), 'utf8'));
  assert.equal(plugin.__test__.CLIENT_VERSION, pkg.version, 'CLIENT_VERSION 与 package.json 版本对不上');
  const text = textOf(render(plugin.__test__.MistakeBookApp({}))).join('|');
  assert.match(text, new RegExp('v' + pkg.version.split('.').slice(0, 2).join('\\.')));
});

// ListTab 的 hooks 顺序：filters, items, total, loading, error, picked,
// bulkOpen, importOpen, moreOpen, showFilters, qLive
const FILTERS = { q: '', subject: '', status: '', mistake_type: '', range: '', knowledge: '',
  tag: '', scopeQ: false, suspended: false, due: true, page: 1, pageSize: 20 };

test('列表空态：到期筛选下给的是「今天没有到期的错题」', () => {
  const seed = [Object.assign({}, FILTERS), [], 0, false, '', {}, false, false, false, false, ''];
  const { plugin } = loadPlugin(seed);
  const dom = render(plugin.__test__.ListTab({ meta: META, onOpen: () => {}, initialScope: 'due' }));
  const text = textOf(dom).join('|');
  assert.match(text, /今天没有到期的错题/);
  assert.match(text, /共 0 道 · 第 1\/1 页/);
  assert.match(text, /筛选/);
  assert.match(text, /更多 ▾/);
});

test('列表有数据：题干、学科、到期徽标、三个行内动作', () => {
  const seed = [Object.assign({}, FILTERS), [ITEM], 1, false, '', {}, false, false, false, false, ''];
  const { plugin } = loadPlugin(seed);
  const dom = render(plugin.__test__.ListTab({ meta: META, onOpen: () => {}, pickedId: 6 }));
  const text = textOf(dom).join('|');
  assert.match(text, /求 lim\(x→0\) sin x \/ x/);
  assert.match(text, /高数/);
  assert.match(text, /今天到期/);
  assert.match(text, /共 1 道 · 第 1\/1 页/);
  assert.ok(text.includes('复习') && text.includes('编辑') && text.includes('斩题'));
});

test('筛选抽屉与条件 chip：勾上的项能单独清除', () => {
  const filters = Object.assign({}, FILTERS, { subject: '高数', due: false });
  const seed = [filters, [], 0, false, '', {}, false, false, false, true, ''];
  const { plugin } = loadPlugin(seed);
  const dom = render(plugin.__test__.ListTab({ meta: META, onOpen: () => {} }));
  const text = textOf(dom).join('|');
  assert.match(text, /学科：高数/);
  assert.match(text, /全部状态/);
  assert.match(text, /全部错因/);
  assert.match(text, /只搜题干/);
  assert.match(text, /含已斩题/);
});

// v0.34：/api/meta 的 knowledge 变成 {path,name,parent,depth,count}。
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
  const labels = dropdownLabels(plugin.__test__.ListTab({ meta: META_FACETS, onOpen: () => {} }));
  assert.ok(labels.includes('全部知识点'), '保留全选项');
  assert.ok(labels.includes('（未归类 · 2 道）'), '未归类要带题数');
  // 平铺（depth 1）与子层（depth 2）都出现，子层前面有全角空格缩进
  assert.ok(labels.some((l) => l.includes('函数（3）')), '父节点带汇总题数');
  const child = labels.find((l) => l.includes('二次函数（2）'));
  assert.ok(child, '子节点带自己的题数');
  assert.ok(child.startsWith('　'), '子节点要比父节点多一级缩进');
  assert.ok(labels.includes('数列（1）'));
});

test('知识点下拉：老服务返回字符串数组时不崩（兼容）', () => {
  const seed = [Object.assign({}, FILTERS), [], 0, false, '', {}, false, false, false, true, ''];
  const { plugin } = loadPlugin(seed);
  const labels = dropdownLabels(plugin.__test__.ListTab({ meta: META, onOpen: () => {} }));
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

// 「更多」菜单：窄面板下按钮被挤到第二行左端，right:0 会把菜单推到视口外；
// 所以它跟下拉一样走 fixed + 坐标夹取，并且必须有 .mb-pop 的显式配色。
test('更多菜单：展开后带 mb-pop 配色与定位，点外部能收起', () => {
  const seed = [Object.assign({}, FILTERS), [], 0, false, '', {}, false, false, true, false, ''];
  const { plugin } = loadPlugin(seed);
  const dom = render(plugin.__test__.ListTab({ meta: META, onOpen: () => {} }));
  const classes = classesOf(dom).join(' ');
  assert.match(classes, /mb-pop/, '菜单要有 mb-pop（显式底色+字色）');
  const menu = (function find(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const kid of node) { const hit = find(kid); if (hit) return hit; } return null; }
    if (node.props && String(node.props.role) === 'menu') return node;
    if (node.children) { for (const kid of node.children) { const hit = find(kid); if (hit) return hit; } }
    return null;
  })(dom);
  assert.ok(menu, '要渲染出 role=menu 的菜单');
  assert.equal(menu.props.style.position, 'absolute', '没有坐标时退回 CSS 兜底');
  const text = textOf(menu).join('|');
  assert.match(text, /批量导入/);
  assert.match(text, /词表整理/);
  assert.match(text, /导出 CSV/);
  assert.match(text, /备份 JSON/);
});

// DetailPane 的 hooks 顺序：item, error, revealed, editing, busy, note, step, preview, ai
test('详情：答案折叠 → 展开后四档评分、断点下拉、变式、历史、AI 入口', () => {
  const folded = [DETAIL, '', false, false, false, null, '', null, null];
  let dom = render(loadPlugin(folded).plugin.__test__.DetailPane({ id: 6, mode: 'review', meta: META }));
  let text = textOf(dom).join('|');
  assert.match(text, /看答案与解析/);
  assert.ok(!text.includes('等价无穷小'), '折叠时不该出现解析');

  const shown = [DETAIL, '', true, false, false, null, '', null, null];
  const raw = loadPlugin(shown).plugin.__test__.DetailPane({ id: 6, mode: 'review', meta: META });
  dom = render(raw);
  text = textOf(dom).join('|');
  assert.match(text, /等价无穷小/);
  for (const word of ['忘了', '模糊', '记得', '简单']) assert.ok(text.includes(word), '缺评分档：' + word);
  assert.match(text, /错在哪一步/);
  assert.match(text, /不记录/);
  const stepOptions = dropdownLabels(raw);
  for (const step of ['审题', '建模', '计算', '检验', '表达', '记忆']) {
    assert.ok(stepOptions.includes(step), '缺断点选项：' + step);
  }
  assert.match(text, /查看 · 复习 2 次/);
  assert.match(text, /变式题/);
  assert.match(text, /让 AI 带我复习这道/);
  assert.match(text, /标记掌握/);
  assert.match(text, /斩题/);
  assert.match(text, /难度 ★★★☆☆/);
  assert.match(text, /极限/);
});

// v0.32：图片按 field 归位；点图放大走命令式浮层（data: URL 顶层跳转会被浏览器拦，所以不再开新标签）
test('详情：图片按 field 归位，每张都能点开放大', () => {
  const imgs = [
    { file: 'a.png', field: 'question', data: 'data:image/jpeg;base64,AAA' },
    { file: 'b.png', field: 'wrong', data: 'data:image/jpeg;base64,BBB' },
    { file: 'c.png', field: 'answer', data: 'data:image/jpeg;base64,CCC' },
    { file: 'd.png', field: 'analysis', data: 'data:image/jpeg;base64,DDD' },
  ];
  const item = Object.assign({}, DETAIL, { images: imgs });
  const dom = render(loadPlugin([item, '', true, false, false, null, '', null, null])
    .plugin.__test__.DetailPane({ id: 6, mode: 'review', meta: META }));

  const thumbs = nodesOf(dom, 'a').filter((n) => /(^|\s)mb-thumb(\s|$)/.test(n.props.className || ''));
  assert.equal(thumbs.length, 4, '四张图各一个缩略图');
  for (const node of thumbs) {
    assert.equal(typeof node.props.onClick, 'function', '每张图都要能点开放大');
    assert.ok(!node.props.target, '不该再开新标签');
    assert.match(node.props.href, /^data:image/);
  }

  const cardByHead = (head) => nodesOf(dom, 'div').find((n) => {
    const first = (n.children || [])[0];
    return /^mb-card/.test(n.props.className || '') && first && first.tag === 'div'
      && /mb-cardhead/.test(first.props.className || '') && textOf(first).join('') === head;
  });
  const imgsOf = (head) => {
    const card = cardByHead(head);
    assert.ok(card, '找不到卡片：' + head);
    return nodesOf(card, 'img').map((n) => n.props.src);
  };
  assert.deepEqual(imgsOf('题目 #6'), ['data:image/jpeg;base64,AAA'], '题目卡只放 question 的图');
  assert.deepEqual(imgsOf('我的答案'), ['data:image/jpeg;base64,BBB'], 'wrong 的图留在我的答案');
  assert.deepEqual(imgsOf('正确答案'), ['data:image/jpeg;base64,CCC', 'data:image/jpeg;base64,DDD'],
    'answer 与 analysis 都归在答案卡里');
});

test('录入表单：已有图片缩略图可点开放大', () => {
  const form = { question: '', my_answer: '', answer: '', analysis: '', subject: '',
    knowledge: '', mistake_type: '', source: '', tags: '', difficulty: '3', status: 'new' };
  const seed = [form, [{ src: 'data:image/png;base64,XXX', field: 'question' }], false, ''];
  const dom = render(loadPlugin(seed).plugin.__test__.ItemForm({
    meta: META, initial: null, onSave: () => {}, onCancel: () => {}, submitLabel: '保存',
  }));
  const thumbs = nodesOf(dom, 'img').filter((n) => /^data:image/.test(n.props.src || ''));
  assert.equal(thumbs.length, 1, '一张已有图片');
  assert.equal(typeof thumbs[0].props.onClick, 'function', '缩略图要能点开');
});

test('详情：编辑模式直接进表单，且不显示评分条', () => {
  const seed = [DETAIL, '', true, true, false, null, '', null, null];
  const dom = render(loadPlugin(seed).plugin.__test__.DetailPane({ id: 6, mode: 'edit', meta: META }));
  const text = textOf(dom).join('|');
  assert.match(text, /题目（题干或截图，至少一样）/);
  assert.match(text, /保存修改/);
  assert.ok(!text.includes('让 AI 带我复习这道'));
});

test('复习历史展开：逐条列出评分、时间、间隔与断点', () => {
  const log = {
    items: [
      { id: 9, result: 'good', reviewed_at: '2026-10-22 10:00:00', interval_days: 3, stage: 1, step: '计算' },
      { id: 8, result: 'again', reviewed_at: '2026-10-20 09:00:00', interval_days: 1, stage: 0 },
    ],
    total: 2, graded: 2, correct: 1, accuracy: 0.5,
  };
  const dom = render(loadPlugin([true, log, '']).plugin.__test__.HistoryBlock({ id: 6, count: 2 }));
  const text = textOf(dom).join('|');
  assert.match(text, /正确率 50%/);
  assert.match(text, /10-22 10:00/);
  assert.match(text, /答对 · 断点 计算/);
  assert.match(text, /间隔 3 天/);
  assert.match(text, /又错/);
});

// ItemForm 的 hooks 顺序：form, images, dirty, imgError（fileRef 走 useRef）
test('新建表单：字段齐全，保存与取消都在', () => {
  const form = { question: '', my_answer: '', answer: '', analysis: '', subject: '',
    knowledge: '', mistake_type: '', source: '', tags: '', difficulty: '3', status: 'new' };
  const seed = [form, [], false, ''];
  const dom = render(loadPlugin(seed).plugin.__test__.ItemForm({
    meta: META, initial: null, onSave: () => {}, onCancel: () => {}, submitLabel: '保存',
  }));
  const text = textOf(dom).join('|');
  for (const label of ['题目（题干或截图，至少一样）', '我的错误答案', '正确答案', '解析', '学科',
    '知识点', '错因分类', '来源', '标签（逗号分隔）', '难度', '状态', '保存', '取消']) {
    assert.ok(text.includes(label), '缺字段：' + label);
  }
  assert.match(text, /Ctrl\+V/);
  assert.match(classesOf(dom).join(' '), /mb-form/);
});

// v0.50：新建时继承上次填过的分类字段；编辑既有题时不继承
test('新建表单：继承上次填过的学科/知识点/来源/错因/难度（v0.50）', () => {
  const { plugin } = loadPlugin([]);
  Object.assign(plugin.__test__.LAST_VALUES, {
    subject: '高数', knowledge: '函数/单调性', source: '期中',
    mistake_type: '计算失误', difficulty: 4,
  });
  const meta = Object.assign({}, META, { mistake_types: ['概念不清', '计算失误', '审题错误'] });
  const dom = render(plugin.__test__.ItemForm({
    meta, initial: null, onSave: () => {}, onCancel: () => {}, submitLabel: '保存',
  }));
  const values = nodesOf(dom, 'input').map((node) => node.props.value);
  assert.ok(values.includes('高数'), '学科应继承：' + JSON.stringify(values));
  assert.ok(values.includes('函数/单调性'), '知识点应继承');
  assert.ok(values.includes('期中'), '来源应继承');
  const text = textOf(dom).join('|');
  assert.match(text, /计算失误/, '错因应继承');
  assert.match(text, /4 星/, '难度应继承');

  // 编辑既有题：用这道题自己的值，不套上次的新建值
  const edit = render(plugin.__test__.ItemForm({
    meta: META, initial: { id: 7, question: '旧题', subject: '英语' },
    onSave: () => {}, onCancel: () => {}, submitLabel: '保存',
  }));
  const editValues = nodesOf(edit, 'input').map((node) => node.props.value);
  assert.ok(editValues.includes('英语'), '编辑模式应保留原学科');
  assert.ok(!editValues.includes('高数'), '编辑模式不该被上次新建值污染');
});

// v0.49：候选只有活词表；示例来自后端只读常量，只拼 placeholder，不进下拉
test('录入表单：来源下拉只列用过的值，placeholder 用只读示例且优先提示没用过的', () => {
  const form = { question: '', my_answer: '', answer: '', analysis: '', subject: '',
    knowledge: '', mistake_type: '', source: '', tags: '', difficulty: '3', status: 'new' };
  const dom = render(loadPlugin([form, [], false, '']).plugin.__test__.ItemForm({
    meta: META, initial: null, onSave: () => {}, onCancel: () => {}, submitLabel: '保存',
  }));
  const list = nodesOf(dom, 'datalist').find((node) => node.props.id === 'mb-dl-source');
  assert.ok(list, '缺少来源 datalist');
  const options = list.children.flat(3).filter(Boolean);
  const values = options.map((node) => node.props.value);
  const labels = options.map((node) => node.props.label);
  assert.deepEqual(values, ['作业', '自编卷'], '候选只来自库里用过的值');
  assert.deepEqual(labels, ['作业 · 3 题', '自编卷 · 1 题'], '候选要带题量');
  const input = nodesOf(dom, 'input').find((node) => node.props.list === 'mb-dl-source');
  assert.ok(input, '缺少来源输入框');
  // v0.49：placeholder 来自 meta.source_hints（后端只读常量），且优先挑还没用过的写法
  assert.equal(input.props.placeholder, '如：练习册 / 周测 / 月考');
  assert.doesNotMatch(input.props.placeholder, /作业/, '已经用过的值不该再当示例');
  assert.deepEqual(values.includes('练习册'), false, '示例不能混进候选');
});

// v0.44：知识点下拉按层级缩进并带题量 —— 填进输入框的仍然是完整路径，不是缩进后的显示名。
test('录入表单：知识点下拉按层级缩进并带题量（v0.44）', () => {
  const form = { question: '', my_answer: '', answer: '', analysis: '', subject: '',
    knowledge: '', mistake_type: '', source: '', tags: '', difficulty: '3', status: 'new' };
  const meta = Object.assign({}, META, {
    knowledge: [
      { path: '函数', name: '函数', parent: '', depth: 1, count: 3 },
      { path: '函数/单调性', name: '单调性', parent: '函数', depth: 2, count: 2 },
    ],
  });
  const dom = render(loadPlugin([form, [], false, '']).plugin.__test__.ItemForm({
    meta, initial: null, onSave: () => {}, onCancel: () => {}, submitLabel: '保存',
  }));
  const list = nodesOf(dom, 'datalist').find((node) => node.props.id === 'mb-dl-knowledge');
  assert.ok(list, '缺少知识点 datalist');
  const options = list.children.flat(3).filter(Boolean);
  assert.deepEqual(options.map((node) => node.props.value), ['函数', '函数/单调性'],
    '写进输入框的必须是路径，不能带缩进和题量');
  assert.match(options[1].props.label, /^\u3000单调性/, '二级要缩进一个全角空格');
  assert.match(options[0].props.label, /（3）/);
});

// v0.44：自由文本字段的 × 清空 —— 有内容才出，空字段不留空按钮。
test('录入表单：学科/知识点/来源/标签有内容才出 × 清空（v0.44）', () => {
  const filled = { question: 'q', my_answer: '', answer: '', analysis: '', subject: '高数',
    knowledge: '极限', mistake_type: '', source: '作业', tags: '极限', difficulty: '3', status: 'new' };
  const dom = render(loadPlugin([filled, [], false, '']).plugin.__test__.ItemForm({
    meta: META, initial: null, onSave: () => {}, onCancel: () => {}, submitLabel: '保存',
  }));
  const clears = nodesOf(dom, 'button').filter((node) => node.props['aria-label'] === '清空');
  assert.equal(clears.length, 4, '学科、知识点、来源、标签各一个');

  const empty = { question: '', my_answer: '', answer: '', analysis: '', subject: '',
    knowledge: '', mistake_type: '', source: '', tags: '', difficulty: '3', status: 'new' };
  const dom2 = render(loadPlugin([empty, [], false, '']).plugin.__test__.ItemForm({
    meta: META, initial: null, onSave: () => {}, onCancel: () => {}, submitLabel: '保存',
  }));
  const none = nodesOf(dom2, 'button').filter((node) => node.props['aria-label'] === '清空');
  assert.equal(none.length, 0, '空字段不该出清空按钮');
});

// v0.45：× 只管这一次输入，改不了下拉候选；候选的合并/清空走「词表整理」。
// 所以四个自由文本字段的标签旁各给一个「管理」，点开就是同一块面板、定位到该档位。
test('录入表单：学科/知识点/来源/标签各有一个「管理」入口（v0.45）', () => {
  const form = { question: '', my_answer: '', answer: '', analysis: '', subject: '',
    knowledge: '', mistake_type: '', source: '', tags: '', difficulty: '3', status: 'new' };
  const dom = render(loadPlugin([form, [], false, '']).plugin.__test__.ItemForm({
    meta: META, initial: null, onSave: () => {}, onCancel: () => {}, submitLabel: '保存',
  }));
  const manages = nodesOf(dom, 'button').filter((node) => /^管理.+候选$/.test(node.props['aria-label'] || ''));
  assert.equal(manages.length, 4, '四个自由文本字段各一个');
  const labels = manages.map((node) => node.props['aria-label']);
  for (const want of ['管理学科候选', '管理知识点候选', '管理来源候选', '管理标签（逗号分隔）候选']) {
    assert.ok(labels.indexOf(want) >= 0, '缺入口：' + want);
  }
});

test('词表整理：从「管理」进来时直接落在对应档位（v0.45）', () => {
  const seed = [undefined, META, [], '', '', '', false, '', '', 0, '', null];
  const dom = render(loadPlugin(seed).plugin.__test__.VocabPanel({ initialKind: 'tag' }));
  const active = nodesOf(dom, 'button').filter((node) => node.props.className === 'on');
  assert.equal(active.length, 1, '同时只能有一个档位是选中态');
  assert.match(textOf(active[0]).join(''), /标签（1）/, '应当落在标签档');
  const text = textOf(dom).join('|');
  assert.match(text, /极限/);
  assert.ok(text.indexOf('自编卷') < 0, '不该把来源档的值也列出来');
});

// VocabPanel 的 hooks 顺序：kind, meta, picked, target, editing, editValue, busy, note, error, version, query, pending
test('词表整理：按档位列出值与题量，来源只有真用过的值（v0.48）', () => {
  const seed = ['source', META, [], '', '', '', false, '', '', 0, '', null];
  const dom = render(loadPlugin(seed).plugin.__test__.VocabPanel({}));
  const text = textOf(dom).join('|');
  assert.match(text, /来源（2）/);
  assert.match(text, /学科（1）/);
  assert.match(text, /知识点（1）/);
  assert.match(text, /标签（1）/);
  assert.match(text, /3 题/, '候选要带题量');
  // v0.48：内置来源已删除，不该再有「未使用」与「内置」标记，也没有删不掉的幽灵行
  assert.doesNotMatch(text, /未使用/);
  assert.doesNotMatch(text, /内置/);
  assert.equal(nodesOf(dom, 'input').filter((node) => node.props.type === 'checkbox').length, 2,
    '两个来源值各一个勾选框');
  assert.match(text, /清空勾选的 0 项/, '没勾选时按钮说明当前动作');
});

// v0.46：值一多就难找，给个即时过滤；只筛显示，不动已勾选的集合。
test('词表整理：搜索框只筛显示，勾选不受影响（v0.46）', () => {
  const seed = ['source', META, [], '', '', '', false, '', '', 0, '作', null];
  const dom = render(loadPlugin(seed).plugin.__test__.VocabPanel({}));
  const text = textOf(dom).join('|');
  assert.match(text, /作业/, '命中的值要留着');
  assert.ok(text.indexOf('练习册') < 0, '没命中的值不该显示');
  assert.equal(nodesOf(dom, 'input').filter((node) => node.props.type === 'checkbox').length, 1,
    '只剩命中的那一个勾选框');

  const none = ['source', META, [], '', '', '', false, '', '', 0, '查无此值', null];
  const dom2 = render(loadPlugin(none).plugin.__test__.VocabPanel({}));
  assert.match(textOf(dom2).join('|'), /没有匹配「查无此值」的值/);
});

// v0.46：合并/清空会真的改库且没有撤销，所以先 dry-run 出影响面再让人点确认。
test('词表整理：动之前先出确认条，写清影响几道题（v0.46）', () => {
  const seed = ['source', META, ['作业'], '', '', '', false, '', '', 0, '',
    { sources: ['作业'], to: '', moved: 3, samples: [{ id: 7, question: '求极限' }] }];
  const dom = render(loadPlugin(seed).plugin.__test__.VocabPanel({}));
  const text = textOf(dom).join('|');
  assert.match(text, /将清空 1 项/);
  assert.match(text, /影响 3 道题/);
  assert.match(text, /求极限/, '要给一道样例题，让人确认动的是不是它');
  const buttons = nodesOf(dom, 'button').map((node) => textOf(node).join(''));
  assert.ok(buttons.indexOf('确认') >= 0 && buttons.indexOf('取消') >= 0);
});

// v0.43：来源写了跟已有值只差一个字的，提示改用已有的（防再长脏值）
test('录入表单：来源写成近义值时提示改用已有的', () => {
  const form = { question: '', my_answer: '', answer: '', analysis: '', subject: '',
    knowledge: '', mistake_type: '', source: '作业本', tags: '', difficulty: '3', status: 'new' };
  const dom = render(loadPlugin([form, [], false, '']).plugin.__test__.ItemForm({
    meta: META, initial: null, onSave: () => {}, onCancel: () => {}, submitLabel: '保存',
  }));
  const text = textOf(dom).join('|');
  assert.match(text, /已有「作业」/, '要指出已有的近似值');
  assert.match(text, /用「作业」/, '要给一键改用的按钮');
});

// v0.30：四个文本块各带一个紧凑图片按钮，独立拖拽区已移除
test('录入表单：四块各有一个紧凑图片按钮，没有独立拖拽区', () => {
  const form = { question: '', my_answer: '', answer: '', analysis: '', subject: '',
    knowledge: '', mistake_type: '', source: '', tags: '', difficulty: '3', status: 'new' };
  const dom = render(loadPlugin([form, [], false, '']).plugin.__test__.ItemForm({
    meta: META, initial: null, onSave: () => {}, onCancel: () => {}, submitLabel: '保存',
  }));
  const classes = classesOf(dom);
  const blocks = classes.filter((c) => /(^|\s)mb-fb(\s|$)/.test(c));
  assert.equal(blocks.length, 4, '四块：题目 / 我的错误答案 / 正确答案 / 解析');
  assert.equal(classes.filter((c) => /(^|\s)mb-fbact(\s|$)/.test(c)).length, 4, '每块一个图片按钮');
  assert.equal(nodesOf(dom, 'textarea').length, 4, '四块都是 textarea');
  assert.equal(textOf(dom).filter((x) => x === '＋ 图片').length, 4);
  assert.ok(!classes.some((c) => /mb-drop|mb-imgs|mb-thumb/.test(c)), '旧的独立拖拽区与缩略图容器应已移除');
  const source = fs.readFileSync(CLIENT, 'utf8');
  assert.ok(source.includes("h('div.mb-detail.mb-page'") && source.includes("'新建错题'")
    && source.includes('← 返回错题'), '新建是整页视图（mb-detail.mb-page），与学习/计划同级');
});

// AnalyticsView 的 hooks 顺序：days, report, error
test('分析视图：趋势、保持度分桶、薄弱知识点、错因/学科/断点分布', () => {
  const report = {
    trend: [{ date: '2026-10-21', created: 0, reviewed: 2 },
      { date: '2026-10-22', created: 3, reviewed: 1 }],
    trend_totals: { created: 3, reviewed: 3 },
    retention: {
      counts: [{ key: 'strong', label: '稳固', count: 2 },
        { key: 'fading', label: '在遗忘', count: 1 }],
      total: 3, note: 'R = 0.9 ** (elapsed/stability)',
      weakest: [{ id: 6, knowledge: '极限', retention: 0.42 }],
    },
    weak_points: [{ knowledge: '导数应用', accuracy: 0, mistakes: 1 },
      { knowledge: '极限', accuracy: 0.5, mistakes: 2 }],
    by_type: [{ name: '概念不清', count: 3 }],
    by_subject: [{ name: '高数', count: 3 }],
    by_step: [{ name: '计算', count: 3 }, { name: '审题', count: 1 }],
    step_patterns: [{ knowledge: '极限', step: '计算', count: 3 }],
  };
  const dom = render(loadPlugin([30, report, '']).plugin.__test__.AnalyticsView({}));
  const text = textOf(dom).join('|');
  assert.match(text, /近 30 天/);
  assert.match(text, /录入与复习/);
  assert.match(text, /新增 3/);
  assert.match(text, /复习 3/);
  assert.match(text, /保持度预测 · 3 道在复习/);
  assert.match(text, /稳固/);
  assert.match(text, /在遗忘/);
  assert.match(text, /最快会忘的题/);
  assert.match(text, /最该补的知识点/);
  assert.match(text, /导数应用/);
  assert.match(text, /正确率 50%/);
  assert.match(text, /错因分布/);
  assert.match(text, /学科分布/);
  assert.match(text, /错在哪一步 · 共 4 次断点/);
  assert.match(text, /错了 3 次/);
  const classes = classesOf(dom).join(' ');
  assert.match(classes, /mb-chart/);
  assert.match(classes, /mb-fill/);
});

// PlanView 的 hooks 顺序：days, limit, subject, report, error, limitNote, limitDraft
// v0.50：分析页样本不足时，比例类结论前先给一条提示
test('分析页：样本不足时顶上加提示条，够了就不显示（v0.50）', () => {
  const base = {
    trend: [], trend_totals: {}, retention: { counts: [], total: 0 },
    weak_points: [], by_type: [], by_subject: [], by_step: [], step_patterns: [],
  };
  const few = Object.assign({}, base, {
    sample: { mistakes: 2, reviews: 3, enough: false, need_reviews: 20,
      note: '样本还少：已复习 3 次，至少 20 次才看得出趋势，下面的比例先当参考。' },
  });
  let text = textOf(render(loadPlugin([30, few, '']).plugin.__test__.AnalyticsView({}))).join('|');
  assert.match(text, /样本还少/);
  assert.match(text, /至少 20 次/);

  const enough = Object.assign({}, base, {
    sample: { mistakes: 40, reviews: 60, enough: true, need_reviews: 20, note: '' },
  });
  text = textOf(render(loadPlugin([30, enough, '']).plugin.__test__.AnalyticsView({}))).join('|');
  assert.doesNotMatch(text, /样本还少/);
});

test('计划页：今日/逾期/窗口内计数与按天分组', () => {
  const report = {
    window_days: 7, daily_limit: 10, today_count: 2, overdue: 1, total: 3, overflow: 0,
    days: [{ label: '今天', date: '2026-10-23', count: 2, items: [ITEM] },
      { label: '明天', date: '2026-10-24', count: 1, items: [ITEM] }],
  };
  const dom = render(loadPlugin(['7', '10', '', report, '']).plugin.__test__.PlanView({ meta: META }));
  const text = textOf(dom).join('|');
  assert.match(text, /今天有 2 道要复习/);
  assert.match(text, /已经逾期/);
  assert.match(text, /逾期/);
  assert.match(text, /今天/);
  assert.match(text, /明天/);
  assert.match(text, /2026-10-24/);
  assert.match(text, /每天/);
});

test('计划页：每日上限是 1–200 的数字输入框，默认值取 settings', () => {
  const report = { window_days: 7, daily_limit: 20, today_count: 0, overdue: 0, total: 0, overflow: 0, days: [] };
  const meta = Object.assign({}, META, { settings: { daily_limit: 35 } });
  const dom = render(loadPlugin(['7', '35', '', report, '']).plugin.__test__.PlanView({ meta }));
  const number = nodesOf(dom, 'input').find((node) => node.props.type === 'number');
  assert.ok(number, '缺每日上限输入框');
  assert.equal(number.props.min, '1');
  assert.equal(number.props.max, '200');
  assert.equal(number.props.value, '35', '输入框初值要取 settings.daily_limit');
});

test('计划页：今日建议卡把「为什么先练这几道」显示出来（v0.51）', () => {
  const report = {
    window_days: 7, daily_limit: 10, today_count: 1, overdue: 0, total: 1, overflow: 0,
    days: [{ label: '今天', date: '2026-10-23', count: 1, items: [ITEM] }],
  };
  const brief = {
    note: '今天 1 道到期，其中「极限」反复栽在「计算」（3 次），先拿这一类开刀。',
    items: [{ id: 6, subject: '高数', question: '求极限', reason: '逾期 2 天' }],
  };
  // PlanView hooks 顺序：days, limit, subject, report, error, limitNote, limitDraft, brief
  const dom = render(loadPlugin(['7', '10', '', report, '', undefined, undefined, brief])
    .plugin.__test__.PlanView({ meta: META }));
  const text = textOf(dom).join('|');
  assert.match(text, /今日建议/);
  assert.match(text, /反复栽在「计算」/);
  assert.match(text, /逾期 2 天/);
});

test('计划页：简报拿不到时不显示建议卡，页面照常', () => {
  const report = {
    window_days: 7, daily_limit: 10, today_count: 1, overdue: 0, total: 1, overflow: 0,
    days: [{ label: '今天', date: '2026-10-23', count: 1, items: [ITEM] }],
  };
  const dom = render(loadPlugin(['7', '10', '', report, '', undefined, undefined, null])
    .plugin.__test__.PlanView({ meta: META }));
  const text = textOf(dom).join('|');
  assert.doesNotMatch(text, /今日建议/);
  assert.match(text, /今天有 1 道要复习/);
});

test('计划页：每道题是按钮，点了把 id 交给 onOpen（跳到错题页）', () => {
  const report = {
    window_days: 7, daily_limit: 10, today_count: 1, overdue: 0, total: 1, overflow: 0,
    days: [{ label: '今天', date: '2026-10-23', count: 1, items: [ITEM] }],
  };
  const opened = [];
  const dom = render(loadPlugin(['7', '10', '', report, '']).plugin.__test__.PlanView({
    meta: META, onOpen: (id) => opened.push(id),
  }));
  const rows = nodesOf(dom, 'button').filter((node) => /pickable/.test(node.props.className || ''));
  assert.equal(rows.length, 1, '计划行要渲染成可点按钮');
  rows[0].props.onClick();
  assert.deepEqual(opened, [6]);
});

// ArenaView 的 hooks 顺序：show, subject, report, error, version, notice, minWrong, clearStreak, ruleNote
test('再战区：计数、规则、条目与斩题按钮', () => {
  const report = {
    counts: { zone: 2, cleared: 1, suspended: 0 },
    rule: { min_wrong: 3, clear_streak: 3 },
    limit: 100, truncated: false,
    items: [{ id: 6, question: '求 lim(x→0) sin x / x', subject: '高数', knowledge: '极限',
      wrong_count: 3, correct_streak: 1, need_streak: 3, accuracy: 0.33,
      last_result: 'again', last_reviewed_at: '2026-10-22 10:00:00',
      next_review_at: '2026-10-24 10:00:00', review_count: 5 }],
  };
  const dom = render(loadPlugin(['zone', '', report, '', 0]).plugin.__test__.ArenaView({ meta: META }));
  const text = textOf(dom).join('|');
  assert.match(text, /在战区/);
  assert.match(text, /错 3 次/);
  assert.match(text, /连对 1\/3/);
  assert.match(text, /斩题/);
  assert.match(text, /进区条件：错满/);
});

// TrashView 的 hooks 顺序：report, error, version
test('回收站：条目可恢复/彻底删除，空态有说明', () => {
  const report = { total: 1, items: [{ id: 7, subject: '高数', deleted_at: '2026-10-22 10:00:00',
    log_count: 2, question: '一道被删掉的题' }] };
  let dom = render(loadPlugin([report, '', 0]).plugin.__test__.TrashView({}));
  let text = textOf(dom).join('|');
  assert.match(text, /一道被删掉的题/);
  assert.match(text, /恢复/);
  assert.match(text, /彻底删除/);
  assert.match(text, /清空回收站/);

  dom = render(loadPlugin([{ total: 0, items: [] }, '', 0]).plugin.__test__.TrashView({}));
  text = textOf(dom).join('|');
  assert.match(text, /回收站是空的/);
});

// StudyView 的 hooks 顺序：subject, mastery, tree, aliases, gaps, error, alias, canonical, version
test('学习页：知识点画像、树、别名与变式缺口', () => {
  const mastery = {
    points_total: 2, passed_total: 1, thresholds: { min_mistakes: 2, min_stage: 3, min_stability: 7 },
    band_counts: { weak: 1, fair: 0, good: 1, mastered: 0 },
    pending: [{ knowledge: '极限', mistakes: 2, due: 1, accuracy: 0.5, avg_stability: 3,
      min_stability: 2, min_stage: 1, lapses: 1, reviews: 4, mastered_gate: false,
      band: { label: '薄弱' }, gate_reasons: ['题量不足'] }],
    passed: [{ knowledge: '导数', mistakes: 3, due: 0, accuracy: 0.9, avg_stability: 12,
      min_stability: 9, min_stage: 3, lapses: 0, reviews: 9, mastered_gate: true,
      band: { label: '良好' }, gate_reasons: [] }],
  };
  const tree = { leaf_total: 1, depth_max: 2, unclassified: 0,
    roots: [{ path: '函数', name: '函数', stats: { mistakes: 2, due: 1, accuracy: 0.5, band: { label: '薄弱' } },
      children: [{ path: '函数/单调性', name: '单调性', stats: { mistakes: 2, due: 1, accuracy: 0.5, band: { label: '薄弱' } }, children: [] }] }] };
  const aliases = { items: [{ alias: '函数单调性', canonical: '函数/单调性' }] };
  const gaps = { items: [{ id: 6, question: '求 lim', wrong: 3, variant_count: 0 }] };
  const dom = render(loadPlugin(['', mastery, tree, aliases, gaps, '', '', '', 0])
    .plugin.__test__.StudyView({ meta: META }));
  const text = textOf(dom).join('|');
  assert.match(text, /已过门禁/);
  assert.match(text, /今天到期/);
  assert.match(text, /知识点画像/);
  assert.match(text, /极限/);
  assert.match(text, /未过：题量不足/);
  assert.match(text, /已过门禁/);
  assert.match(text, /知识点树/);
  assert.match(text, /单调性/);
  assert.match(text, /函数单调性 → 函数\/单调性/);
  assert.match(text, /变式缺口/);
});

// BulkDialog 的 hooks 顺序：field, value, tagMode, log, busy, error
test('批量修改：一次只改一件事，八行「不改」表单已去掉（v0.47）', () => {
  const raw = loadPlugin([]).plugin.__test__.BulkDialog({
    ids: [1, 2], meta: META, onClose: () => {}, onDone: () => {},
  });
  const text = textOf(render(raw)).join('|');
  assert.match(text, /批量修改 · 2 道/);
  assert.match(text, /改哪一项/);
  assert.match(text, /改成/);
  assert.ok(!text.includes('不改'), '不该再出现一排「不改」');
  // 八个可改字段都在「改哪一项」的下拉里，一个不少
  const labels = dropdownLabels(raw);
  ['知识点', '标签', '学科', '来源', '试卷', '状态', '错因', '难度'].forEach((name) => {
    assert.ok(labels.includes(name), '改哪一项缺字段：' + name);
  });
});

test('批量修改：标签有独立的方式开关，且与后端 set/add/remove 对齐', () => {
  const raw = loadPlugin(['tags']).plugin.__test__.BulkDialog({
    ids: [1, 2], meta: META, onClose: () => {}, onDone: () => {},
  });
  const text = textOf(render(raw)).join('|');
  assert.match(text, /标签方式/);
  const labels = dropdownLabels(raw);
  assert.ok(labels.includes('追加到原有'), '缺标签方式选项：追加到原有');
  assert.ok(labels.includes('替换原有'), '缺标签方式选项：替换原有');
  assert.ok(labels.includes('从原有移除'), '缺标签方式选项：从原有移除');
  assert.ok(!labels.includes('覆盖'), '标签方式不该再有「覆盖」（后端不认 replace）');
});

test('批量修改：改完留在窗口里记流水，不用重新勾题（v0.47）', () => {
  const raw = loadPlugin(['knowledge', '', 'add', ['知识点 → 函数（2 道）'], false, '']).plugin.__test__.BulkDialog({
    ids: [1, 2], meta: META, onClose: () => {}, onDone: () => {},
  });
  const text = textOf(render(raw)).join('|');
  assert.match(text, /知识点 → 函数（2 道）/);
  assert.match(text, /应用到这 2 道/);
  assert.match(text, /完成/);
});

test('批量修改：字段切到标签时值控件换成方式开关（不再是文本框）', () => {
  const raw = loadPlugin(['tags']).plugin.__test__.BulkDialog({
    ids: [1], meta: META, onClose: () => {}, onDone: () => {},
  });
  const labels = dropdownLabels(raw);
  // 知识点档没有「标签方式」，标签档才有
  const plain = loadPlugin(['knowledge']).plugin.__test__.BulkDialog({
    ids: [1], meta: META, onClose: () => {}, onDone: () => {},
  });
  assert.ok(!dropdownLabels(plain).includes('追加到原有'), '知识点档不该出现标签方式');
  assert.ok(labels.includes('追加到原有'));
});

// ImportDialog 的 hooks 顺序：text, report, busy
test('批量导入：说明与分隔规则都在', () => {
  const dom = render(loadPlugin(['', '', false]).plugin.__test__.ImportDialog({ onClose: () => {}, onDone: () => {} }));
  const text = textOf(dom).join('|');
  assert.match(text, /批量导入/);
  assert.match(text, /空行/);
  assert.match(text, /---/);
  assert.match(text, /导入/);
});

test('批量导入：导入后不自动关窗，逐条列出结果', () => {
  const report = { created: 1, dup: 1, bad: 1, lines: ['第 2 段没导入：题目不能为空', '第 3 段与已有错题重复，已跳过（#7）'] };
  const dom = render(loadPlugin(['', report, false]).plugin.__test__.ImportDialog({ onClose: () => {}, onDone: () => {} }));
  const text = textOf(dom).join('|');
  assert.match(text, /成功 1 条/);
  assert.match(text, /重复跳过 1 条/);
  assert.match(text, /失败 1 条/);
  assert.match(text, /题目不能为空/);
  assert.match(text, /继续导入/);
  assert.match(text, /完成/);
});

// MathText 的 hooks 顺序：useKatex（useState + useEffect）、stamp=useRef('')、useEffect。
// 测试环境里 KaTeX 永远加载不到（head.appendChild 是空操作），所以必须原样显示文本：
// 公式渲染是增强，不能变成「渲染器没到位就白屏」。
test('公式块：渲染器未就绪时原样显示文本，class 可覆盖', () => {
  const { plugin } = loadPlugin();
  const raw = '求 $\\lim_{x\\to0}\\frac{\\sin x}{x}$ 的值';
  const dom = render(plugin.__test__.MathText({ text: raw }));
  assert.equal(textOf(dom).join(''), raw);
  assert.equal(dom.props.className, 'mb-text');
  const styled = render(plugin.__test__.MathText({ text: '纯文本', className: 'mb-q', style: { flex: '1' } }));
  assert.equal(styled.props.className, 'mb-q');
  assert.deepEqual(styled.props.style, { flex: '1' });
});

// v0.26：列表行加缩略图 + 左侧状态轨（对齐网页版），再战区可改门槛并给斩题回执，学习页缺口可点。
test('列表行：有图时出缩略图，状态轨逾期优先于复习状态', () => {
  const item = Object.assign({}, ITEM, { image_file: 'abc123.jpg', status: 'mastered' });
  const seed = [Object.assign({}, FILTERS), [item], 1, false, '', {}, false, false, false, false, ''];
  const { plugin } = loadPlugin(seed);
  const dom = render(plugin.__test__.ListTab({ meta: META, onOpen: () => {} }));
  const classes = classesOf(dom).join(' ');
  assert.match(classes, /mb-item st-overdue/, '今天到期时状态轨必须是逾期色');
  const thumb = nodesOf(dom, 'img').find((node) => /mb-listthumb/.test(node.props.className || ''));
  assert.ok(thumb, '有 image_file 时要渲染缩略图');
  assert.match(String(thumb.props.src), /abc123\.jpg/);
});

test('列表行：没有图就不留空位，状态轨退回复习状态', () => {
  const item = Object.assign({}, ITEM, { next_review_at: '2026-11-30 10:00:00', status: 'reviewing' });
  const seed = [Object.assign({}, FILTERS), [item], 1, false, '', {}, false, false, false, false, ''];
  const { plugin } = loadPlugin(seed);
  const dom = render(plugin.__test__.ListTab({ meta: META, onOpen: () => {} }));
  assert.equal(nodesOf(dom, 'img').filter((node) => /mb-listthumb/.test(node.props.className || '')).length, 0);
  assert.match(classesOf(dom).join(' '), /mb-item st-reviewing/);
});

test('再战区：两个门槛能在面板里改（数字输入，带当前值）', () => {
  const report = { counts: { zone: 0, cleared: 0, suspended: 0 },
    rule: { min_wrong: 3, clear_streak: 2 }, limit: 100, truncated: false, items: [] };
  const meta = Object.assign({}, META, { settings: { arena_min_wrong: 3, arena_clear_streak: 2, daily_limit: 20 } });
  const dom = render(loadPlugin(['zone', '', report, '', 0, null, '3', '2', '']).plugin.__test__.ArenaView({ meta }));
  const text = textOf(dom).join('|');
  assert.match(text, /规则设置/);
  assert.match(text, /次进区/);
  assert.match(text, /次出区/);
  const numbers = nodesOf(dom, 'input').filter((node) => node.props.type === 'number');
  assert.equal(numbers.length, 2, '两个门槛都是数字输入框');
  assert.equal(numbers[0].props.value, '3');
  assert.equal(numbers[1].props.value, '2');
});

test('再战区：斩题后给回执（可撤销），不是静默消失', () => {
  const report = { counts: { zone: 1, cleared: 0, suspended: 0 },
    rule: { min_wrong: 3, clear_streak: 2 }, limit: 100, truncated: false, items: [] };
  const notice = { id: 6, text: '已斩题 #6：它已移出复习池，再战区里不再显示。', canUndo: true };
  const dom = render(loadPlugin(['zone', '', report, '', 0, notice, '3', '2', '']).plugin.__test__.ArenaView({ meta: META }));
  const text = textOf(dom).join('|');
  assert.match(text, /已斩题 #6/);
  assert.match(text, /撤销/);
  assert.match(text, /知道了/);
});

test('学习页：变式缺口点得动，回程指向原题', () => {
  const mastery = { points_total: 0, passed_total: 0,
    thresholds: { min_mistakes: 2, min_stage: 3, min_stability: 7 },
    band_counts: {}, pending: [], passed: [] };
  const tree = { leaf_total: 0, depth_max: 0, unclassified: 0, roots: [] };
  const gaps = { items: [{ id: 6, question: '求 lim', wrong: 3, variant_count: 0 }] };
  const opened = [];
  const dom = render(loadPlugin(['', mastery, tree, { items: [] }, gaps, '', '', '', 0])
    .plugin.__test__.StudyView({ meta: META, onOpen: (id) => opened.push(id) }));
  const rows = nodesOf(dom, 'button').filter((node) => /pickable/.test(node.props.className || ''));
  assert.equal(rows.length, 1, '缺口行要渲染成可点按钮');
  rows[0].props.onClick();
  assert.deepEqual(opened, [6]);
});

// v0.33：三页各给一个能直接干活的入口（点了带着筛选条件跳到错题页）
test('学习页：最弱点给一个「先练」，点了带着知识点去错题页', () => {
  const mastery = { points_total: 1, passed_total: 0,
    thresholds: { min_mistakes: 2, min_stage: 3, min_stability: 7 },
    band_counts: { weak: 1 },
    pending: [{ knowledge: '极限', mistakes: 2, due: 1, accuracy: 0.5, avg_stability: 3,
      min_stability: 2, min_stage: 1, lapses: 1, reviews: 4, mastered_gate: false,
      band: { label: '薄弱' }, gate_reasons: [] }], passed: [] };
  const tree = { leaf_total: 0, depth_max: 0, unclassified: 0, roots: [] };
  const gotos = [];
  const dom = render(loadPlugin(['', mastery, tree, { items: [] }, { items: [] }, '', '', '', 0])
    .plugin.__test__.StudyView({ meta: META, onGoto: (patch) => gotos.push(patch) }));
  const btn = nodesOf(dom, 'button').find((node) => /先练/.test(textOf(node).join('')));
  assert.ok(btn, '学习页要有「先练」按钮');
  assert.match(textOf(btn).join(''), /极限/);
  btn.props.onClick();
  assert.equal(gotos.length, 1);
  assert.equal(gotos[0].knowledge, '极限');
});

test('计划页：今天有几道就给一个「开始今天」，点了只看到期', () => {
  const report = { window_days: 7, daily_limit: 10, today_count: 2, overdue: 1, total: 3, overflow: 0, days: [] };
  const gotos = [];
  const dom = render(loadPlugin(['7', '10', '', report, '', '', '10'])
    .plugin.__test__.PlanView({ meta: META, onGoto: (patch) => gotos.push(patch) }));
  const btn = nodesOf(dom, 'button').find((node) => /开始今天的 2 道/.test(textOf(node).join('')));
  assert.ok(btn, '计划页要有「开始今天」按钮');
  btn.props.onClick();
  assert.equal(gotos.length, 1);
  assert.equal(gotos[0].due, true);
});

test('分析页：最该补的知识点可以直接去练', () => {
  const report = { trend: [], trend_totals: {}, retention: { counts: [], total: 0 },
    weak_points: [{ knowledge: '导数应用', accuracy: 0, mistakes: 1 }], by_type: [], by_subject: [] };
  const gotos = [];
  const dom = render(loadPlugin([30, report, '']).plugin.__test__.AnalyticsView({ onGoto: (patch) => gotos.push(patch) }));
  const btn = nodesOf(dom, 'button').find((node) => /去练「导数应用」/.test(textOf(node).join('')));
  assert.ok(btn, '分析页要有「去练」按钮');
  btn.props.onClick();
  assert.equal(gotos.length, 1);
  assert.equal(gotos[0].knowledge, '导数应用');
});

test('去练：预设筛选被错题页取走，且只生效一次', () => {
  const { plugin } = loadPlugin([]);
  const search = (dom) => nodesOf(dom, 'input').find((node) => node.props.placeholder === '搜题干 / 知识点 / 标签');
  plugin.__test__.setPendingListFilter({ q: '极限' });
  assert.equal(search(render(plugin.__test__.ListTab({ meta: META, onOpen: () => {} }))).props.value, '极限');
  assert.equal(search(render(plugin.__test__.ListTab({ meta: META, onOpen: () => {} }))).props.value, '');
});
