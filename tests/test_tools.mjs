// 错题本 DSH 插件 · 工具域（lib/tools.js）的单元测试。
//
// 不碰真服务：把 globalThis.fetch 换成路由表，health 一律通（否则 ensureServer 会去
// spawn python），其余按路径回 {ok:true,data}。这样能钉住「工具发出去的请求长什么样」。
//
// 跑法：node --test tests/test_tools.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply } from '../dsh-plugin/lib/tools.js';

// 真 1x1 PNG：mb_add 会把图片文件原样读成 data URL 发出去
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

test('注册 14 个工具，名字不重复', () => {
  const { list } = tools();
  const names = list.map((item) => item.name).sort();
  assert.equal(names.length, 14);
  assert.deepEqual(names, ['mb_add', 'mb_batch', 'mb_brief', 'mb_due', 'mb_events', 'mb_get',
    'mb_merge', 'mb_paper', 'mb_report', 'mb_review', 'mb_search', 'mb_stats',
    'mb_suggest', 'mb_weak_steps']);
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

test('mb_add 只发图：本地图片读成 data URL 发出去，题干可以为空', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mb-img-'));
  const file = join(dir, 'q.png');
  writeFileSync(file, Buffer.from(PNG_1PX, 'base64'));
  const stub = stubFetch({ '/api/mistakes': { id: 7, subject: '高数', next_review_at: '2026-11-01 08:00:00' } });
  try {
    const { map } = tools();
    await map.mb_add.execute({ images: [{ path: file, field: 'answer' }] });
    const sent = JSON.parse(stub.calls.find((item) => item.url.includes('/api/mistakes')).init.body);
    assert.equal(sent.question, '');
    assert.equal(sent.images.length, 1);
    assert.equal(sent.images[0].field, 'answer');
    assert.match(sent.images[0].data, /^data:image\/png;base64,/);
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mb_add 题干和图片都没有：直接报错，不发请求', async () => {
  const stub = stubFetch({});
  try {
    const { map } = tools();
    await assert.rejects(() => map.mb_add.execute({}), /题干和图片至少给一个/);
    assert.equal(stub.calls.filter((item) => item.url.includes('/api/mistakes')).length, 0);
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

test('mb_batch 默认只预览，一个请求都不发', async () => {
  const stub = stubFetch({});
  try {
    const { map } = tools();
    const value = await map.mb_batch.execute({
      text: '题目: 求极限 A\n答案: 1\n---\n题目: 求极限 B\n答案: 2',
    });
    assert.match(value.text, /预览/);
    assert.match(value.text, /共 2 道/);
    assert.match(value.text, /求极限 A/);
    assert.match(value.text, /preview:false/);
    assert.equal(stub.calls.filter((item) => item.url.includes('/batch')).length, 0);
  } finally {
    stub.restore();
  }
});

test('mb_batch preview:false 才 POST，回执分开报成功/重复/失败', async () => {
  const stub = stubFetch({
    '/api/mistakes/batch': {
      created: [{ index: 0, id: 7 }, { index: 1, id: 8 }],
      duplicates: [{ index: 2, id: 9 }],
      errors: [{ index: 3, error: '题目不能为空' }],
      created_count: 2, duplicate_count: 1, error_count: 1,
    },
  });
  try {
    const { map } = tools();
    const value = await map.mb_batch.execute({ text: '题目: 甲\n---\n题目: 乙', preview: false });
    const sent = JSON.parse(stub.calls.find((item) => item.url.includes('/batch')).init.body);
    assert.equal(sent.text, '题目: 甲\n---\n题目: 乙');
    assert.match(value.text, /成功 2 道 · 重复跳过 1 道 · 失败 1 道/);
    assert.match(value.text, /新入库：#7 #8/);
    assert.match(value.text, /第 4 条：题目不能为空/);
  } finally {
    stub.restore();
  }
});

test('mb_paper 透传筛选参数，并给出 /print 链接', async () => {
  const stub = stubFetch({
    '/api/paper': {
      title: '错题重做卷', mode: 'question', mode_label: '题目卷',
      order: 'weak', order_label: '最弱优先', count: 2, available: 9,
      items: [{ id: 1, question: '求极限 1' }, { id: 2, question: '求极限 2' }],
    },
  });
  try {
    const { map } = tools();
    const value = await map.mb_paper.execute({ count: 2, knowledge: '函数', subject: '高数' });
    const url = stub.calls.find((item) => item.url.includes('/api/paper')).url;
    assert.match(url, /count=2/);
    assert.match(url, /knowledge=%E5%87%BD%E6%95%B0/);
    assert.match(url, /kdeep=1/);
    assert.match(url, /subject=%E9%AB%98%E6%95%B0/);
    assert.match(value.text, /已组卷：2 道/);
    assert.match(value.text, /打印 \/ 存 PDF：http:\/\/127\.0\.0\.1:9\/print\?/);
    assert.match(value.text, /1\. 求极限 1/);
  } finally {
    stub.restore();
  }
});

test('mb_report 一次拉齐五个接口并汇总', async () => {
  const stub = stubFetch({
    '/api/stats': { total: 58, mastered: 9, reviewing: 31, due: 4, suspended: 3,
      reviews: { total: 40, graded: 34, correct: 26, accuracy: 0.765 } },
    '/api/analytics': { trend_totals: { created: 12, reviewed: 34 },
      retention: { weakest: [{ id: 5, knowledge: '函数/单调性', retention: 0.62, stability: 4.1 }] },
      by_step: [{ name: '计算', count: 8 }, { name: '审题', count: 5 }] },
    '/api/mastery': { points_total: 23, passed_total: 9 },
    '/api/plan': { today_count: 4, overdue: 2, total: 18 },
    '/api/arena': { counts: { zone: 2, cleared: 5, suspended: 3, tracked: 7 } },
  });
  try {
    const { map } = tools();
    const value = await map.mb_report.execute({ days: 7 });
    assert.equal(stub.calls.filter((item) => item.url.includes('/api/stats')).length, 1);
    assert.match(value.text, /近 7 天/);
    assert.match(value.text, /新增 12 道 · 复习 34 次 · 正确率 77%/);
    assert.match(value.text, /共 58 道/);
    assert.match(value.text, /今天该复习 4 道（逾期 2 道）/);
    assert.match(value.text, /9 \/ 23 个知识点通过/);
    assert.match(value.text, /函数\/单调性 · R≈0\.62 · 稳定度 4\.1 天/);
    assert.match(value.text, /计算 8 次 · 审题 5 次/);
    assert.match(value.text, /在区 2 道 · 已清 5 道/);
  } finally {
    stub.restore();
  }
});

test('mb_suggest 揪出无效值与近重复，且不改库', async () => {
  const stub = stubFetch({
    '/api/meta': {
      knowledge: [
        { path: '函数 单调性', count: 5, depth: 0, parent: '' },
        { path: '函数/单调性', count: 3, depth: 0, parent: '' },
        { path: '111', count: 1, depth: 0, parent: '' },
      ],
    },
  });
  try {
    const { map } = tools();
    const value = await map.mb_suggest.execute({ kind: 'knowledge' });
    assert.match(value.text, /「111」1 道 → 建议清空/);
    assert.match(value.text, /相似度/);
    assert.match(value.text, /mb_merge kind=knowledge/);
    // 建议工具只读：不该出现任何 POST
    assert.equal(stub.calls.filter((item) => item.init && item.init.method === 'POST').length, 0);
  } finally {
    stub.restore();
  }
});

test('mb_merge：知识点走 /api/knowledge/merge，学科走 /api/meta/merge', async () => {
  const stub = stubFetch({
    // 服务端 moved 是数字、题号在 ids 里（v0.41 冒烟时发现把数字当数组用会打印 undefined）
    '/api/knowledge/merge': { target: '函数/单调性', sources: ['函数 单调性'], merged: 1,
      moved: 3, ids: [1, 2, 3], aliases_added: 1, cleared: false },
    '/api/meta/merge': { target: '高数', sources: ['高等数学'], merged: 1,
      moved: 2, ids: [4, 5], aliases_added: 0, cleared: false },
  });
  try {
    const { map } = tools();
    const kp = await map.mb_merge.execute({ sources: ['函数 单调性'], target: '函数/单调性' });
    const kpBody = JSON.parse(stub.calls.find((item) => item.url.includes('/knowledge/merge')).init.body);
    assert.deepEqual(kpBody, { sources: ['函数 单调性'], target: '函数/单调性' });
    assert.match(kp.text, /已把 1 个值并到「函数\/单调性」/);
    assert.match(kp.text, /改动题目 3 道 · 新登记别名 1 个/);

    const sub = await map.mb_merge.execute({ kind: 'subject', sources: ['高等数学'], target: '高数' });
    const subBody = JSON.parse(stub.calls.find((item) => item.url.includes('/api/meta/merge')).init.body);
    assert.deepEqual(subBody, { kind: 'subject', sources: ['高等数学'], target: '高数' });
    assert.match(sub.text, /改动题目 2 道/);
    assert.match(kp.text, /题号：#1 #2 #3/);

    // v0.43：来源也是扁平值，走 /api/meta/merge，kind=source
    const src = await map.mb_merge.execute({ kind: 'source', sources: ['4'], target: '作业' });
    const srcBody = JSON.parse(stub.calls.filter((item) => item.url.includes('/api/meta/merge')).pop().init.body);
    assert.deepEqual(srcBody, { kind: 'source', sources: ['4'], target: '作业' });
    assert.match(src.text, /改动题目 2 道/);
  } finally {
    stub.restore();
  }
});

test('mb_suggest：来源里的纯数字也会被揪出来（v0.43）', async () => {
  const stub = stubFetch({
    '/api/meta': {
      knowledge: [], subject_facets: [], tag_facets: [],
      source_facets: [{ name: '4', count: 1, system: false },
        { name: '期中考', count: 2, system: false },
        { name: '期中', count: 3, system: true }],
    },
  });
  try {
    const { map } = tools();
    const value = await map.mb_suggest.execute({ kind: 'source' });
    assert.match(value.text, /「来源」体检/);
    assert.match(value.text, /「4」1 道 → 建议清空/);
    assert.match(value.text, /mb_merge kind=source/);
    assert.equal(stub.calls.filter((item) => item.init && item.init.method === 'POST').length, 0);
  } finally {
    stub.restore();
  }
});

test('mb_merge：sources 为空当场拒绝，不发请求', async () => {
  const stub = stubFetch({});
  try {
    const { map } = tools();
    await assert.rejects(() => map.mb_merge.execute({ sources: [] }), /sources 必须是非空的名称数组/);
    assert.equal(stub.calls.filter((item) => item.url.includes('/merge')).length, 0);
  } finally {
    stub.restore();
  }
});

test('mb_suggest：父子节点不算重复，只有写法不一致才算', async () => {
  const stub = stubFetch({
    '/api/meta': {
      knowledge: [
        { path: '函数', count: 6, depth: 0, parent: '' },
        { path: '函数/极限', count: 4, depth: 1, parent: '函数' },
        { path: '函数/单调性', count: 2, depth: 1, parent: '函数' },
        { path: '函数 极限', count: 1, depth: 0, parent: '' },
      ],
    },
  });
  try {
    const { map } = tools();
    const value = await map.mb_suggest.execute({ kind: 'knowledge' });
    // 子节点与父节点是层级关系，不该被建议合并
    assert.doesNotMatch(value.text, /「函数\/极限」4 道 ≈ 「函数」/);
    assert.doesNotMatch(value.text, /「函数\/单调性」2 道 ≈ 「函数」/);
    // 「函数 极限」与「函数/极限」只是分隔符写法不同，必须报出来
    assert.match(value.text, /「函数 极限」1 道 ≈ 「函数\/极限」4 道/);
  } finally {
    stub.restore();
  }
});

test('mb_review 留证：student_answer / hints / judgement 三个字段透传后端', async () => {
  const stub = stubFetch({
    '/api/mistakes/12/review': { mistake: { next_review_at: '2026-11-02 08:00:00', review_count: 4 } },
  });
  try {
    const { map } = tools();
    const value = await map.mb_review.execute({
      id: 12, rating: 'again', step: '计算',
      student_answer: '我算成了 2', hints: 1, judgement: '公式对，最后一步符号错',
    });
    const sent = JSON.parse(stub.calls.find((item) => item.url.includes('/review')).init.body);
    assert.equal(sent.student_answer, '我算成了 2');
    assert.equal(sent.hints, 1);
    assert.equal(sent.judgement, '公式对，最后一步符号错');
    assert.match(value.text, /已留证：作答 6 字 · 1 级提示 · 判分依据/);
  } finally {
    stub.restore();
  }
});

test('mb_review 不传留证字段时一个都不发（老服务不受影响）', async () => {
  const stub = stubFetch({
    '/api/mistakes/12/review': { mistake: { next_review_at: '2026-11-02 08:00:00' } },
  });
  try {
    const { map } = tools();
    const value = await map.mb_review.execute({ id: 12, rating: 'good' });
    const sent = JSON.parse(stub.calls.find((item) => item.url.includes('/review')).init.body);
    assert.deepEqual(sent, { rating: 'good' });
    assert.doesNotMatch(value.text, /已留证/);
  } finally {
    stub.restore();
  }
});

test('mb_review 的 hints 超出 0-3 时夹回范围，不会把 9 发出去', async () => {
  const stub = stubFetch({
    '/api/mistakes/12/review': { mistake: { next_review_at: '2026-11-02 08:00:00' } },
  });
  try {
    const { map } = tools();
    await map.mb_review.execute({ id: 12, rating: 'good', hints: 9 });
    const sent = JSON.parse(stub.calls.find((item) => item.url.includes('/review')).init.body);
    assert.equal(sent.hints, 3);
  } finally {
    stub.restore();
  }
});

test('mb_brief：把到期题、理由、断点、最弱点排成人话', async () => {
  const stub = stubFetch({
    '/api/brief': {
      generated_at: '2026-10-24 16:00:00',
      window_days: 14,
      counts: { due_today: 3, overdue: 1, active: 5, graded_with_hints: 4, hint_free_correct: 0.5 },
      items: [
        { id: 14, subject: '数据结构', knowledge: '排序', question: '快排最坏时间复杂度是多少', due: '2026-10-22 08:00:00', reason: '逾期 2 天；这个知识点正确率 40%（3 道 / 5 次）' },
        { id: 12, subject: '高数', knowledge: '极限', question: '求 lim(x→0) tan2x/x', due: '2026-10-24 08:00:00', reason: '在这个点上第 3 次错在「计算」' },
      ],
      patterns: [{ knowledge: '极限', step: '计算', count: 3 }],
      weak_points: [{ knowledge: '极限', mistakes: 3, graded: 5, accuracy: 0.4 }],
      note: '今天 3 道到期，其中「极限」反复栽在「计算」（3 次），先拿这一类开刀。',
      sample: { mistakes: 5, reviews: 4, enough: false, need_reviews: 20, note: '样本还少：已复习 4 次，至少 20 次才看得出趋势，下面的比例先当参考。' },
    },
  });
  try {
    const { map } = tools();
    const value = await map.mb_brief.execute({});
    const text = value.text;
    assert.match(text, /AI 学习简报 · 近 14 天/);
    assert.match(text, /今天到期 3 道（逾期 1 道 · 在库活跃 5 道）/);
    assert.match(text, /零提示做对率：50%（4 次有记录）/);
    assert.match(text, /#14 \[数据结构 · 排序\] 快排最坏时间复杂度是多少/);
    assert.match(text, /为什么：逾期 2 天/);
    assert.match(text, /「极限」第 3 次错在「计算」/);
    assert.match(text, /「极限」正确率 40%（3 道 \/ 5 次）/);
    assert.match(text, /建议：今天 3 道到期/);
    assert.match(text, /样本还少/);
  } finally {
    stub.restore();
  }
});

test('mb_brief：没有留证记录时说清怎么开始记，不冒充 0%', async () => {
  const stub = stubFetch({
    '/api/brief': {
      window_days: 7,
      counts: { due_today: 0, overdue: 0, active: 2, graded_with_hints: 0, hint_free_correct: null },
      items: [], patterns: [], weak_points: [],
      note: '今天没有到期题。可以挑一道最久没复习的，或者让我出几道变式。',
      sample: { enough: true },
    },
  });
  try {
    const { map } = tools();
    const value = await map.mb_brief.execute({ days: 7, limit: 2 });
    assert.match(value.text, /零提示做对率：还没有记录/);
    assert.match(value.text, /今天没有到期题。/);
    assert.doesNotMatch(value.text, /样本还少/);
    const url = stub.calls.find((item) => item.url.includes('/api/brief')).url;
    assert.match(url, /days=7/);
    assert.match(url, /limit=2/);
  } finally {
    stub.restore();
  }
});
