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
      const value = cursor < seed.length ? seed[cursor] : (typeof init === 'function' ? init() : init);
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
};
const ITEM = { id: 6, question: '求 lim(x→0) sin x / x', subject: '高数', knowledge: '极限',
  next_review_at: '2026-10-23 10:00:00', review_count: 2 };
const DETAIL = { id: 6, question: '求 lim(x→0) sin x / x', answer: '1', analysis: '等价无穷小',
  my_answer: '0', mistake_type: '概念不清', knowledge: '极限', review_count: 2,
  subject: '高数', difficulty: 3, tags: '极限,洛必达' };

// Dropdown 的 hooks 顺序：open, active
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
});

test('App 骨架：标题、统计、六个页签、新建按钮都在', () => {
  const { plugin } = loadPlugin([]);
  const dom = render(plugin.__test__.MistakeBookApp({}));
  const text = textOf(dom).join('|');
  assert.match(text, /错题本/);
  assert.match(text, /共 0 道 · 到期 0 道/);
  assert.match(text, /＋ 新建/);
  for (const tab of ['错题', '学习', '计划', '分析', '再战', '回收站']) {
    assert.ok(text.includes(tab), '缺页签：' + tab);
  }
  assert.match(classesOf(dom).join(' '), /mb-tabs/);
  assert.match(classesOf(dom).join(' '), /mb-split/);
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

test('详情：编辑模式直接进表单，且不显示评分条', () => {
  const seed = [DETAIL, '', true, true, false, null, '', null, null];
  const dom = render(loadPlugin(seed).plugin.__test__.DetailPane({ id: 6, mode: 'edit', meta: META }));
  const text = textOf(dom).join('|');
  assert.match(text, /题目（必填）/);
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
  for (const label of ['题目（必填）', '我的错误答案', '正确答案', '解析', '学科',
    '知识点', '错因分类', '来源', '标签（逗号分隔）', '难度', '状态', '保存', '取消']) {
    assert.ok(text.includes(label), '缺字段：' + label);
  }
  assert.match(text, /Ctrl\+V/);
  assert.match(classesOf(dom).join(' '), /mb-form/);
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
test('计划页：今日/逾期/窗口内计数与按天分组', () => {
  const report = {
    window_days: 7, daily_limit: 10, today_count: 2, overdue: 1, total: 3, overflow: 0,
    days: [{ label: '今天', date: '2026-10-23', count: 2, items: [ITEM] },
      { label: '明天', date: '2026-10-24', count: 1, items: [ITEM] }],
  };
  const dom = render(loadPlugin(['7', '10', '', report, '']).plugin.__test__.PlanView({ meta: META }));
  const text = textOf(dom).join('|');
  assert.match(text, /今天要做/);
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

// ArenaView 的 hooks 顺序：show, subject, report, error, version
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
  assert.match(text, /知识点 2 个 · 已过门禁 1 个/);
  assert.match(text, /知识点画像/);
  assert.match(text, /极限/);
  assert.match(text, /未过：题量不足/);
  assert.match(text, /已过门禁/);
  assert.match(text, /知识点树/);
  assert.match(text, /单调性/);
  assert.match(text, /函数单调性 → 函数\/单调性/);
  assert.match(text, /变式缺口/);
});

// BulkDialog 的 hooks 顺序：fields, busy, error
test('批量修改：字段与标签方式都在', () => {
  const fields = { status: '', subject: '', mistake_type: '', knowledge: '', difficulty: '', tags: '', tagsMode: 'add' };
  const raw = loadPlugin([fields, false, '']).plugin.__test__.BulkDialog({
    ids: [1, 2], meta: META, onClose: () => {}, onDone: () => {},
  });
  const dom = render(raw);
  const text = textOf(dom).join('|');
  assert.match(text, /批量修改 · 2 道/);
  assert.match(text, /标签方式/);
  assert.match(text, /追加/);
  assert.ok(dropdownLabels(raw).includes('覆盖'), '缺标签方式选项：覆盖');
});

// ImportDialog 的 hooks 顺序：text, result, busy
test('批量导入：说明与分隔规则都在', () => {
  const dom = render(loadPlugin(['', '', false]).plugin.__test__.ImportDialog({ onClose: () => {}, onDone: () => {} }));
  const text = textOf(dom).join('|');
  assert.match(text, /批量导入/);
  assert.match(text, /空行或 --- 分隔/);
  assert.match(text, /导入/);
});
