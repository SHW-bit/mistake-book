// 错题本 DSH 插件 · 工具域（lib/tools.js）的单元测试。
//
// 不碰真服务：把 globalThis.fetch 换成路由表，health 一律通（否则 ensureServer 会去
// spawn python），其余按路径回 {ok:true,data}。这样能钉住「工具发出去的请求长什么样」。
//
// 跑法：node --test tests/test_tools.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { apply } from '../dsh-plugin/lib/tools.js';

const CONFIG = { url: 'http://127.0.0.1:9', home: 'C:/ws', python: 'python' };

/** 装一张假路由表，返回收集到的请求；用完必须 restore()。 */
function stubFetch(routes) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push({ url: target, init });
    const path = target.replace(CONFIG.url, '').split('?')[0];
    const body = path === '/api/health'
      ? { status: 'ok' }
      : (Object.prototype.hasOwnProperty.call(routes, path) ? routes[path] : undefined);
    if (body === undefined) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: path } }),
        { status: 404, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true, data: body }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = prev; } };
}

/** 注册一遍工具，按名字取回来。 */
function tools() {
  const registered = [];
  apply({ tools: { register: (definition) => registered.push(definition) } }, CONFIG);
  const map = {};
  for (const item of registered) map[item.name] = item;
  return { list: registered, map };
}

test('注册 8 个工具，名字不重复', () => {
  const { list } = tools();
  const names = list.map((item) => item.name).sort();
  assert.equal(names.length, 8);
  assert.deepEqual(names, ['mb_add', 'mb_due', 'mb_events', 'mb_get', 'mb_review',
    'mb_search', 'mb_stats', 'mb_weak_steps']);
});

test('mb_review 带 step：请求体里有 step，回执里带上断点', async () => {
  const stub = stubFetch({
    '/api/mistakes/12/review': { mistake: { next_review_at: '2026-10-30 08:00:00', stage: 2, review_count: 3 } },
  });
  try {
    const { map } = tools();
    const value = await map.mb_review.execute({ id: 12, rating: 'good', step: '计算' });
    const sent = JSON.parse(stub.calls.find((item) => item.url.includes('/review')).init.body);
    assert.deepEqual(sent, { rating: 'good', step: '计算' });
    assert.match(value.text, /断点 计算/);
    assert.match(value.text, /下次复习：2026-10-30 08:00:00/);
  } finally {
    stub.restore();
  }
});

test('mb_review 不带 step 时不发这个字段', async () => {
  const stub = stubFetch({
    '/api/mistakes/12/review': { mistake: { next_review_at: '2026-10-30 08:00:00' } },
  });
  try {
    const { map } = tools();
    const value = await map.mb_review.execute({ id: 12, rating: 'hard' });
    const sent = JSON.parse(stub.calls.find((item) => item.url.includes('/review')).init.body);
    assert.deepEqual(sent, { rating: 'hard' });
    assert.doesNotMatch(value.text, /断点/);
  } finally {
    stub.restore();
  }
});

test('mb_review 的 step 非法时当场拒绝，不发请求', async () => {
  const stub = stubFetch({});
  try {
    const { map } = tools();
    await assert.rejects(() => map.mb_review.execute({ id: 12, rating: 'good', step: '瞎写' }),
      /step 只能是/);
    assert.equal(stub.calls.filter((item) => item.url.includes('/review')).length, 0);
  } finally {
    stub.restore();
  }
});



test('mb_add 不传难度时不发 difficulty 字段（v0.37 修：以前塞 0 会被 400 拒）', async () => {
  const stub = stubFetch({
    '/api/mistakes': { id: 5, subject: '高数', mistake_type: '概念不清', next_review_at: '2026-11-01 08:00:00' },
  });
  try {
    const { map } = tools();
    await map.mb_add.execute({ question: '求极限' });
    const sent = JSON.parse(stub.calls.find((item) => item.url.includes('/api/mistakes')).init.body);
    assert.equal(Object.prototype.hasOwnProperty.call(sent, 'difficulty'), false);
  } finally {
    stub.restore();
  }
});

test('mb_add 传难度时夹到 1-5', async () => {
  const stub = stubFetch({ '/api/mistakes': { id: 6 } });
  try {
    const { map } = tools();
    await map.mb_add.execute({ question: '求极限', difficulty: 9 });
    const sent = JSON.parse(stub.calls.find((item) => item.url.includes('/api/mistakes')).init.body);
    assert.equal(sent.difficulty, 5);
  } finally {
    stub.restore();
  }
});

test('mb_review 带变式：三个变式字段进请求体，回执报已存 #id', async () => {
  const stub = stubFetch({
    '/api/mistakes/12/review': { mistake: { next_review_at: '2026-10-30 08:00:00', stage: 2,
      variant: { id: 41, question: '求 f(x)=x^2+4x 的单调区间', duplicate: false } } },
  });
  try {
    const { map } = tools();
    const value = await map.mb_review.execute({ id: 12, rating: 'good',
      variant_question: '求 f(x)=x^2+4x 的单调区间', variant_answer: '(-2,+∞) 递增',
      variant_knowledge: '函数/单调性' });
    const sent = JSON.parse(stub.calls.find((item) => item.url.includes('/review')).init.body);
    assert.deepEqual(sent, { rating: 'good',
      variant_question: '求 f(x)=x^2+4x 的单调区间',
      variant_answer: '(-2,+∞) 递增', variant_knowledge: '函数/单调性' });
    assert.match(value.text, /已存变式：#41/);
  } finally {
    stub.restore();
  }
});

test('mb_review 变式命中去重时回执说复用', async () => {
  const stub = stubFetch({
    '/api/mistakes/12/review': { mistake: { next_review_at: '2026-10-30 08:00:00',
      variant: { id: 41, duplicate: true } } },
  });
  try {
    const { map } = tools();
    const value = await map.mb_review.execute({ id: 12, rating: 'hard', variant_question: '同一道题' });
    assert.match(value.text, /变式已在库中：#41/);
  } finally {
    stub.restore();
  }
});

test('mb_review 只给 variant_answer 不给题干时当场拒绝', async () => {
  const stub = stubFetch({});
  try {
    const { map } = tools();
    await assert.rejects(() => map.mb_review.execute({ id: 12, rating: 'good', variant_answer: 'x' }),
      /必须和 variant_question 一起提交/);
    assert.equal(stub.calls.filter((item) => item.url.includes('/review')).length, 0);
  } finally {
    stub.restore();
  }
});

test('mb_due / mb_search 的行里带变式库存', async () => {
  const stub = stubFetch({
    '/api/plan': { today_count: 1, overdue: 0, total: 1 },
    '/api/mistakes': { items: [
      { id: 7, subject: '高数', question: '求极限', status: 'reviewing', variant_count: 0 },
      { id: 8, subject: '高数', question: '求导', status: 'new', variant_count: 2 },
      { id: 9, subject: '高数', question: '老接口没这字段', status: 'new' },
    ] },
  });
  try {
    const { map } = tools();
    const due = await map.mb_due.execute({ limit: 3 });
    assert.match(due.text, /#7 \[高数\] 求极限（复习中 · 无变式）/);
    assert.match(due.text, /#8 \[高数\] 求导（待复习 · 变式 2）/);
    assert.match(due.text, /#9 \[高数\] 老接口没这字段（待复习）/);
    const search = await map.mb_search.execute({ q: '极限' });
    assert.match(search.text, /无变式/);
  } finally {
    stub.restore();
  }
});

test('mb_weak_steps：列出断点分布与固定失手模式', async () => {
  const stub = stubFetch({
    '/api/analytics': {
      by_step: [{ name: '计算', count: 3 }, { name: '审题', count: 1 }],
      step_patterns: [{ knowledge: '极限', step: '计算', count: 2 }],
    },
  });
  try {
    const { map } = tools();
    const value = await map.mb_weak_steps.execute({ days: 30, limit: 5 });
    assert.match(value.text, /最近 30 天记录了 4 次断点/);
    assert.match(value.text, /计算 3 次 · 75%/);
    assert.match(value.text, /审题 1 次 · 25%/);
    assert.match(value.text, /固定失手模式/);
    assert.match(value.text, /极限 → 计算 错了 2 次/);
    assert.match(stub.calls.find((item) => item.url.includes('/api/analytics')).url, /days=30/);
  } finally {
    stub.restore();
  }
});

test('mb_weak_steps：没有断点时给一句怎么开始', async () => {
  const stub = stubFetch({ '/api/analytics': { by_step: [], step_patterns: [] } });
  try {
    const { map } = tools();
    const value = await map.mb_weak_steps.execute({});
    assert.match(value.text, /还没有记录过「错在哪一步」/);
  } finally {
    stub.restore();
  }
});

test('mb_events：按时间列出事件，带断点与间隔', async () => {
  const stub = stubFetch({
    '/api/events': {
      total: 2,
      items: [
        { ts: '2026-10-23 08:00:00', kind: 'created', id: 12, knowledge: '极限' },
        { ts: '2026-10-23 09:00:00', kind: 'reviewed', id: 12, step: '计算', result: 'good', interval_days: 3 },
      ],
    },
  });
  try {
    const { map } = tools();
    const value = await map.mb_events.execute({ limit: 10 });
    assert.match(value.text, /最近 2 条事件（共 2 条）/);
    assert.match(value.text, /10-23 08:00 · created · #12 · 极限/);
    assert.match(value.text, /10-23 09:00 · reviewed · #12 · 断点 计算 · good · 间隔 3 天/);
  } finally {
    stub.restore();
  }
});

test('mb_events：空事件流给一句说明', async () => {
  const stub = stubFetch({ '/api/events': { total: 0, items: [] } });
  try {
    const { map } = tools();
    const value = await map.mb_events.execute({});
    assert.match(value.text, /事件流是空的/);
  } finally {
    stub.restore();
  }
});

test('mb_due 透传 sort；非法值不往后端发', async () => {
  const stub = stubFetch({
    '/api/plan': { today_count: 0, overdue: 0, total: 0 },
    '/api/mistakes': { items: [] },
  });
  try {
    const { map } = tools();
    await map.mb_due.execute({ sort: 'errors' });
    const url = stub.calls.find((item) => item.url.includes('/api/mistakes')).url;
    assert.match(url, /sort=errors/);
    stub.calls.length = 0;
    await map.mb_due.execute({ sort: '瞎写' });
    const plain = stub.calls.find((item) => item.url.includes('/api/mistakes')).url;
    assert.doesNotMatch(plain, /sort=/);
  } finally {
    stub.restore();
  }
});

test('mb_search：知识点默认含子树，nokp 查未归类，sort 透传', async () => {
  const stub = stubFetch({ '/api/mistakes': { total: 0, items: [] } });
  try {
    const { map } = tools();
    await map.mb_search.execute({ knowledge: '函数' });
    const deep = stub.calls.find((item) => item.url.includes('/api/mistakes')).url;
    assert.match(deep, /knowledge=%E5%87%BD%E6%95%B0/);
    assert.match(deep, /kdeep=1/);
    stub.calls.length = 0;
    await map.mb_search.execute({ knowledge: '函数', kdeep: false });
    assert.match(stub.calls.find((item) => item.url.includes('/api/mistakes')).url, /kdeep=0/);
    stub.calls.length = 0;
    await map.mb_search.execute({ nokp: true });
    assert.match(stub.calls.find((item) => item.url.includes('/api/mistakes')).url, /nokp=1/);
    stub.calls.length = 0;
    await map.mb_search.execute({ q: '极限', sort: 'stability' });
    assert.match(stub.calls.find((item) => item.url.includes('/api/mistakes')).url, /sort=stability/);
  } finally {
    stub.restore();
  }
});

test('mb_get 列出已有变式，没有就说暂无', async () => {
  const stub = stubFetch({
    '/api/mistakes/12': { id: 12, question: '求极限', status: 'new' },
    '/api/mistakes/12/reviews': { items: [] },
    '/api/mistakes/12/variants': { items: [
      { id: 41, question: '求 lim(x→0) sin 3x / 2x', times_used: 2 },
      { id: 42, question: '求 lim(x→0) tan 2x / x', times_used: 0 },
    ], total: 2 },
  });
  try {
    const { map } = tools();
    const withRows = await map.mb_get.execute({ id: 12 });
    assert.match(withRows.text, /已有变式（2 条）/);
    assert.match(withRows.text, /#41 求 lim\(x→0\) sin 3x \/ 2x · 练过 2 次/);
    assert.match(withRows.text, /#42 .*练过 0 次/);
  } finally {
    stub.restore();
  }
});

test('mb_get 默认不给答案与解析，reveal: true 才给（v0.38）', async () => {
  const routes = {
    '/api/mistakes/12': {
      id: 12, question: '求极限', status: 'new',
      answer: '机密答案', analysis: '机密解析', my_answer: '我算成 1',
    },
    '/api/mistakes/12/reviews': { items: [] },
  };
  const stub = stubFetch(routes);
  try {
    const { map } = tools();
    const hidden = await map.mb_get.execute({ id: 12 });
    assert.doesNotMatch(hidden.text, /机密答案/);
    assert.doesNotMatch(hidden.text, /机密解析/);
    assert.match(hidden.text, /答案与解析：已隐藏/);
    assert.match(hidden.text, /reveal: true/);
    // 题面与学生自己的错答照给，否则没法对着讲
    assert.match(hidden.text, /题目：求极限/);
    assert.match(hidden.text, /我的答案：我算成 1/);

    const shown = await map.mb_get.execute({ id: 12, reveal: true });
    assert.match(shown.text, /正确答案：机密答案/);
    assert.match(shown.text, /解析：机密解析/);
    assert.doesNotMatch(shown.text, /已隐藏/);
  } finally {
    stub.restore();
  }
});

test('mb_get：题面本来就没填答案时，不写那行「已隐藏」', async () => {
  const stub = stubFetch({
    '/api/mistakes/12': { id: 12, question: '求极限', status: 'new' },
    '/api/mistakes/12/reviews': { items: [] },
  });
  try {
    const { map } = tools();
    const value = await map.mb_get.execute({ id: 12 });
    assert.doesNotMatch(value.text, /已隐藏/);
  } finally {
    stub.restore();
  }
});

test('mb_get：老服务没有变式接口时不炸，只给一句暂无', async () => {
  const stub = stubFetch({
    '/api/mistakes/12': { id: 12, question: '求极限', status: 'new' },
    '/api/mistakes/12/reviews': { items: [] },
  });
  try {
    const { map } = tools();
    const value = await map.mb_get.execute({ id: 12 });
    assert.match(value.text, /题目：求极限/);
    assert.match(value.text, /已有变式：暂无/);
  } finally {
    stub.restore();
  }
});
