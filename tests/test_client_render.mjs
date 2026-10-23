// 错题本 DSH 插件 · 客户端半的**渲染**测试。
//
// test_client.mjs 只验证「注册了什么」，管不到 JSX 里的引用错误。本机没有 React 包
// （宿主把 React 打进自己的客户端 bundle 里了），所以这里自带一个 60 行的极简渲染器：
// createElement 造 vnode，函数组件就地调用，hooks 从一份预设的 state 序列里按顺序取。
//
// 代价：state 的顺序是写死的，组件里增删 useState 会让用例失败——这正是想要的效果，
// 它逼着改代码的人同步更新这里。跑法：node --test tests/test_client_render.mjs
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
      const value = cursor < seed.length ? seed[cursor] : init;
      cursor += 1;
      return [value, () => {}];
    },
    useEffect: (fn) => { try { fn(); } catch (error) { /* 效果里的异步失败不该弄崩渲染 */ } },
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
  };
}

function loadPlugin(seed) {
  const registered = [];
  const sandbox = {
    window: { __ModuleLoader__: { load: (entry) => registered.push(entry) } },
    document: {
      getElementById: () => null,
      createElement: () => ({ set textContent(value) { void value; }, id: '' }),
      head: { appendChild: () => {} },
    },
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
  const main = slots.find((slot) => slot.definition.name === 'main');
  assert.ok(main, '没注册 main 座位');
  return main.component;
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

// 顺序 = MistakeBookApp 里 useState 的声明顺序（step 故意放在最后一个，新增状态不必挪索引）
const BASE = ['due', { total: 3, due: 2 }, [], false, '', 0, null, false, false, null,
  null, null, 'review', false, '', '', '', ''];

const ITEM = { id: 6, question: '求 lim(x→0) sin x / x', subject: '高数', knowledge: '极限',
  next_review_at: '2026-10-23 10:00:00' };
const DETAIL = { id: 6, question: '求 lim(x→0) sin x / x', answer: '1', analysis: '等价无穷小',
  my_answer: '0', mistake_type: '概念不清', knowledge: '极限', review_count: 2 };

test('首屏：头部、工具条、空列表文案都在', () => {
  const tree = render(loadPlugin(BASE)({}) && null);
  void tree;
  const App = loadPlugin(BASE);
  const dom = render(App({}));
  const text = textOf(dom).join('|');
  assert.match(text, /错题复习/);
  assert.match(text, /共 3 道 · 到期 2 道/);
  assert.match(text, /＋ 新建/);
  assert.match(text, /到期/);
  assert.match(text, /今天没有到期的错题/);
  const classes = classesOf(dom).join(' ');
  assert.match(classes, /mb-toolbar/);
  assert.match(classes, /mb-body/);
});

test('有数据：列表出条目，详情出答案折叠、四档评分、复习历史、AI 入口', () => {
  const seed = BASE.slice();
  seed[2] = [ITEM];
  seed[5] = 6;
  seed[6] = DETAIL;
  const dom = render(loadPlugin(seed)({}));
  const text = textOf(dom).join('|');
  assert.match(text, /求 lim\(x→0\) sin x \/ x/);
  assert.match(text, /看答案与解析/);
  assert.match(text, /忘了/);
  assert.match(text, /模糊/);
  assert.match(text, /记得/);
  assert.match(text, /简单/);
  assert.match(text, /查看 · 复习 2 次/);
  assert.match(text, /让 AI 带我复习这道/);
  assert.match(text, /概念不清/);
  // v0.22：评分前可以顺手记「错在哪一步」
  assert.match(text, /错在哪一步/);
  assert.match(text, /不记录/);
  for (const step of ['审题', '建模', '计算', '检验', '表达', '记忆']) {
    assert.ok(text.includes(step), '缺断点选项：' + step);
  }
});

test('分析视图：趋势、保持度分桶、薄弱知识点、错因与学科分布', () => {
  const seed = BASE.slice();
  seed[12] = 'stats';
  const report = {
    trend: [{ date: '2026-10-21', created: 0, reviewed: 2 },
      { date: '2026-10-22', created: 3, reviewed: 1 }],
    trend_totals: { created: 3, reviewed: 3 },
    retention: {
      counts: [{ key: 'strong', label: '稳固', count: 2 },
        { key: 'fading', label: '在遗忘', count: 1 }],
      total: 3, note: 'R = 0.9 ** (elapsed/stability)',
    },
    weak_points: [{ knowledge: '导数应用', accuracy: 0, mistakes: 1 },
      { knowledge: '极限', accuracy: 0.5, mistakes: 2 }],
    by_type: [{ name: '概念不清', count: 3 }],
    by_subject: [{ name: '高数', count: 3 }],
    by_step: [{ name: '计算', count: 3 }, { name: '审题', count: 1 }],
    step_patterns: [{ knowledge: '极限', step: '计算', count: 3 }],
  };
  const dom = render(loadPlugin(seed.concat([30, report, '']))({}));
  const text = textOf(dom).join('|');
  assert.match(text, /近 30 天/);
  assert.match(text, /录入与复习/);
  assert.match(text, /新增 3/);
  assert.match(text, /复习 3/);
  assert.match(text, /保持度预测 · 3 道在复习/);
  assert.match(text, /稳固/);
  assert.match(text, /在遗忘/);
  assert.match(text, /最该补的知识点/);
  assert.match(text, /导数应用/);
  assert.match(text, /正确率 50%/);
  assert.match(text, /错因分布/);
  assert.match(text, /学科分布/);
  // v0.22：断点分布与「知识点 × 哪一步」的固定失手模式
  assert.match(text, /错在哪一步 · 共 4 次断点/);
  assert.match(text, /计算/);
  assert.match(text, /错了 3 次/);
  const classes = classesOf(dom).join(' ');
  assert.match(classes, /mb-chart/);
  assert.match(classes, /mb-fill/);
});

test('新建表单：字段齐全，保存与取消都在', () => {
  const seed = BASE.slice();
  seed[11] = { subjects: ['高数'], knowledge: ['极限'], mistake_types: ['概念不清'],
    sources: ['作业'] };
  seed[13] = true;
  const form = { question: '', my_answer: '', answer: '', analysis: '', subject: '',
    knowledge: '', mistake_type: '', source: '', tags: '', difficulty: '3' };
  const dom = render(loadPlugin(seed.concat([form, false, '']))({}));
  const text = textOf(dom).join('|');
  for (const label of ['题目（必填）', '我的错误答案', '正确答案', '解析', '学科',
    '知识点', '错因分类', '来源', '标签（逗号分隔）', '难度', '保存', '取消']) {
    assert.ok(text.includes(label), '缺字段：' + label);
  }
  assert.match(classesOf(dom).join(' '), /mb-form/);
});

test('复习历史展开：逐条列出评分、时间与间隔', () => {
  const seed = BASE.slice();
  seed[2] = [ITEM];
  seed[5] = 6;
  seed[6] = DETAIL;
  const log = {
    items: [{ id: 9, result: 'good', reviewed_at: '2026-10-22 10:00:00', interval_days: 3, stage: 1, step: '计算' },
      { id: 8, result: 'again', reviewed_at: '2026-10-20 09:00:00', interval_days: 1, stage: 0 }],
    total: 2, graded: 2, correct: 1, accuracy: 0.5,
  };
  const dom = render(loadPlugin(seed.concat([true, log, '']))({}));
  const text = textOf(dom).join('|');
  assert.match(text, /正确率 50%/);
  assert.match(text, /10-22 10:00/);
  assert.match(text, /记得/);
  assert.match(text, /忘了/);
  assert.match(text, /间隔 3 天/);
  // v0.22：历史行带上断点
  assert.match(text, /记得 · 断点 计算/);
});
