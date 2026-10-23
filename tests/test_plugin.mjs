// 错题本 DSH 插件 · 宿主半（lib/session.js）的单元测试。
//
// 这里不碰真会话、不碰网络：openReviewSession 的依赖全是从外面传进去的，
// 用假 agentPresets / agents / sessionTitle 就能把「按预设建会话」这条链路整个走一遍。
//
// 跑法：node --test tests/test_plugin.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_PATH, REVIEW_PRESET, SESSION_PREFIX,
  titleForReviewSession, isReviewSessionTitle, kickoffText,
  openReviewSession, registerSessionRoute,
} from '../dsh-plugin/lib/session.js';

const ITEM = {
  id: 12,
  question: '求 lim x->0 (sin x)/x',
  my_answer: '1/2',
  answer: '1',
  analysis: '等价无穷小',
  mistake_type: '概念不清',
  error_reason: '把 sin x 当成 x/2',
  knowledge: '极限',
  source: '期中',
  review_count: 2,
};

/** 造一套假依赖；each 键可以单独覆盖。 */
function deps(over) {
  const calls = { mount: [], create: [], rename: [], inject: [], disposed: 0 };
  const base = {
    workspace: 'C:/ws',
    loadMistake: async () => ITEM,
    agentPresets: {
      resolve: async (id) => ({ id }),
      mount: async (ctx, id) => { calls.mount.push([ctx, id]); },
      acquireScope: async () => ({
        key: {},
        [Symbol.asyncDispose]: async () => { calls.disposed += 1; },
      }),
    },
    agents: {
      create: async (input) => {
        calls.create.push(input);
        const live = { session: { id: input.sessionId }, inject: (m) => calls.inject.push(m) };
        return { agent: live };
      },
    },
    sessionTitle: { rename: (session, title) => calls.rename.push([session, title]) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
  };
  return { deps: Object.assign(base, over), calls };
}

test('标题：前缀 + 编号 + 知识点，缺哪节少哪节', () => {
  assert.equal(titleForReviewSession(ITEM), SESSION_PREFIX + ' · #12 · 极限');
  assert.equal(titleForReviewSession({ id: 3 }), SESSION_PREFIX + ' · #3');
  assert.equal(titleForReviewSession({}), SESSION_PREFIX);
});

test('标题判据：只认自己建的那种，别把普通会话认进来', () => {
  assert.equal(isReviewSessionTitle(SESSION_PREFIX), true);
  assert.equal(isReviewSessionTitle('错题复习 · #12 · 极限'), true);
  assert.equal(isReviewSessionTitle('错题复习'), true);
  assert.equal(isReviewSessionTitle('随便聊聊'), false);
  assert.equal(isReviewSessionTitle('错题复习中'), false);
  assert.equal(isReviewSessionTitle(undefined), false);
});

test('首条消息：空字段整行省略，不写「我的答案：」后跟空白', () => {
  const text = kickoffText({ id: 1, question: 'q', answer: 'a' });
  assert.match(text, /题目：q/);
  assert.match(text, /正确答案：a/);
  assert.doesNotMatch(text, /我的答案/);
  assert.match(text, /mb_review/);
});

test('非法 id 直接拒，不建会话', async () => {
  const { deps: d, calls } = deps();
  for (const bad of [{}, { id: 0 }, { id: -1 }, { id: 'x' }, { id: 1.5 }]) {
    const view = await openReviewSession(d, bad);
    assert.equal(view.ok, false);
    assert.equal(view.error.code, 'body-invalid');
  }
  assert.equal(calls.create.length, 0);
});

test('读不到错题：报 mistake-unreadable，不往下走', async () => {
  const { deps: d, calls } = deps({ loadMistake: async () => { throw new Error('404'); } });
  const view = await openReviewSession(d, { id: 1 });
  assert.equal(view.ok, false);
  assert.equal(view.error.code, 'mistake-unreadable');
  assert.match(view.error.message, /404/);
  assert.equal(calls.create.length, 0);
});

test('宿主没有预设注册表：报 preset-unavailable', async () => {
  const { deps: d } = deps({ agentPresets: null });
  const view = await openReviewSession(d, { id: 1 });
  assert.equal(view.ok, false);
  assert.equal(view.error.code, 'preset-unavailable');
});

test('预设解析不出来：提示重启让 cordis.patch.yml 生效', async () => {
  const { deps: d } = deps({
    agentPresets: {
      resolve: async () => { throw new Error('Unknown agent preset: mistake-review'); },
      mount: async () => {},
    },
  });
  const view = await openReviewSession(d, { id: 1 });
  assert.equal(view.ok, false);
  assert.equal(view.error.code, 'preset-unavailable');
  assert.match(view.error.message, /重启 DSH/);
});

test('预设 broken（行在、plugins 没激活）：拒绝，而不是建一条没工具的会话', async () => {
  const { deps: d, calls } = deps({
    agentPresets: {
      resolve: async (id) => ({ id, broken: { message: 'tool row failed' } }),
      mount: async () => {},
    },
  });
  const view = await openReviewSession(d, { id: 1 });
  assert.equal(view.ok, false);
  assert.equal(view.error.code, 'preset-broken');
  assert.match(view.error.message, /tool row failed/);
  assert.equal(calls.create.length, 0);
});

test('取不到默认模型：available:false，且不建会话', async () => {
  const { deps: d, calls } = deps({ agentDefaultModel: { currentSelection: () => ({ provider: '', model: '' }) } });
  const view = await openReviewSession(d, { id: 1 });
  assert.equal(view.ok, false);
  assert.equal(view.error.code, 'model-unavailable');
  assert.equal(view.available, false);
  assert.equal(calls.create.length, 0);
});

test('成功路径：带 agentPreset、带 agentOptions、先 mount、改标题、注入首条、还掉租约', async () => {
  const { deps: d, calls } = deps();
  const view = await openReviewSession(d, { id: 12 });

  assert.equal(view.ok, true);
  assert.equal(view.renamed, true);
  assert.equal(view.injected, true);
  assert.equal(view.title, '错题复习 · #12 · 极限');
  assert.match(view.sessionId, /^mistake-review-/);

  const create = calls.create[0];
  assert.equal(create.meta.agentPreset, REVIEW_PRESET, 'meta.agentPreset 必须落盘');
  assert.equal(create.meta.cwd, 'C:/ws');
  assert.deepEqual(create.agentOptions, { provider: 'deepseek', model: 'deepseek-chat' });

  // setup 是函数，调用时把 mount 走一遍
  await create.setup({});
  assert.deepEqual(calls.mount, [[{}, REVIEW_PRESET]]);

  assert.equal(calls.rename.length, 1);
  assert.equal(calls.rename[0][1], '错题复习 · #12 · 极限');

  assert.equal(calls.inject.length, 1);
  const msg = calls.inject[0];
  assert.equal(msg.role, 'user');
  assert.equal(msg.content[0].type, 'text');
  assert.match(msg.content[0].text, /求 lim/);
  assert.ok(msg.id, '消息要带 id');
  assert.deepEqual(msg.source, { kind: 'user' });

  assert.equal(calls.disposed, 1, '租约必须还掉（Symbol.asyncDispose）');
});

test('建会话抛错：报 session-create-failed，并且租约照样还', async () => {
  const { deps: d, calls } = deps({
    agents: { create: async () => { throw new Error('boom'); } },
  });
  const view = await openReviewSession(d, { id: 1 });
  assert.equal(view.ok, false);
  assert.equal(view.error.code, 'session-create-failed');
  assert.equal(calls.disposed, 1);
});

test('没有 sessionTitle 服务：如实降级 renamed:false，不抛', async () => {
  const { deps: d } = deps({ sessionTitle: null });
  const view = await openReviewSession(d, { id: 1 });
  assert.equal(view.ok, true);
  assert.equal(view.renamed, false);
});

test('路由：挂到 connection 上，路径与方法对得上', async () => {
  let registered = null;
  const ctx = {
    inject(services, cb) {
      assert.deepEqual(services, ['connection']);
      const effect = (fn) => fn();
      cb({
        connection: { fetch: { register: (route) => { registered = route; } } },
        effect,
        get: () => null,
      });
    },
  };
  registerSessionRoute(ctx, { url: 'http://127.0.0.1:8000' });
  assert.ok(registered);
  assert.equal(registered.path, SESSION_PATH);
  assert.deepEqual(registered.methods, ['POST']);
  assert.equal(registered.requestBody, 'buffered');
});

test('路由：宿主服务缺席时请求体非法给 400，模型缺席给 503', async () => {
  let registered = null;
  const ctx = {
    inject(services, cb) {
      cb({
        connection: { fetch: { register: (route) => { registered = route; } } },
        effect: (fn) => fn(),
        get: () => null,
      });
    },
  };
  registerSessionRoute(ctx, { url: 'http://127.0.0.1:8000' });

  const bad = await registered.fetch({ json: async () => { throw new Error('no body'); } });
  assert.equal(bad.status, 400);

  // 有合法 body，但宿主没给预设注册表 → 500（available:true）。
  // 这条路由里的 loadMistake 是**真去读**本机服务的：服务没起就先死在 mistake-unreadable，
  // 服务起着才走到 preset-unavailable。两种都算「没建出会话」，这里只钉结构化 500，
  // 不钉它先撞哪一关（否则测试结果会随本机 8000 端口的开合而变）。
  const req = { json: async () => ({ id: 1 }) };
  const noPreset = await registered.fetch(req);
  assert.equal(noPreset.status, 500);
  const body = await noPreset.json();
  assert.equal(body.ok, false);
  assert.ok(['mistake-unreadable', 'preset-unavailable'].includes(body.error.code), body.error.code);
});
