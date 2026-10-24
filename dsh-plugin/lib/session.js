/* 错题本 DSH 插件 · 宿主半：「就着这道错题开一条复习会话」。
 *
 * 为什么必须由宿主半建会话：浏览器的 sessions.create 只序列化 {workspaceId, cwd, sessionId}，
 * 会把 agentPreset **静默丢掉**——面板建出来的会话不带「错题复习」预设，工具面与 persona
 * 全都不在。所以这条路由负责按预设建会话，客户端只 retain 它并渲染。
 *
 * 零依赖：只用 node:crypto 与本仓库的 api.js（同 tools.js 的口径，不 import @deepseek-ai/*）。
 *
 * 一次请求做四件事：
 *   1. 读这道错题（GET /api/mistakes/<id>，服务没起时 api.js 会自己拉起）；
 *   2. agentPresets.resolve('mistake-review') → acquireScope（钉 revision，用完就还）；
 *   3. agents.create({ sessionId, meta:{cwd, agentPreset}, agentOptions, setup: mount })
 *      —— meta.agentPreset 是落盘字段，agentOptions 必须自己带（缺了第一次请求就抛
 *      「has no provider/model」），setup 里 mount 必须先于别的 scoped 注册；
 *   4. 改标题 + 注入首条消息（题目/我的答案/正确答案/错因，让模型不用先调工具就知道在复习哪道）。
 *
 * 不 dispose AgentHandle：dispose() 会拆掉刚建好的会话，agent 归宿主 ctx 的生命周期。
 */

import { randomUUID } from 'node:crypto';

import { call, settings } from './api.js';

/** 路由路径（客户端按它 POST）。 */
export const SESSION_PATH = '/api/mistake-book/session';

/** 批量复习路由（v0.54）：一次把今天这几道交给模型。 */
export const SESSION_BATCH_PATH = '/api/mistake-book/session-batch';

/** 复习模式预设的 id（与 cordis.patch.yml 里 preset-mistake-review 的 config.id 一致）。 */
export const REVIEW_PRESET = 'mistake-review';

/** 会话标题：「错题复习 · #12 · 极限」。前缀同时是客户端认「我建的会话」的判据。 */
export const SESSION_PREFIX = '错题复习';
export const SESSION_SEP = ' · ';

/** 单行化：标题与首条消息里的字段都压成一行，避免换行把排版搞乱。 */
function oneLine(value, max) {
  const text = String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
  if (!max || text.length <= max) return text;
  return text.slice(0, max) + '…';
}

/** 拼标题：缺哪节就少写哪节，不留空分隔符。 */
export function titleForReviewSession(item) {
  const id = item && item.id ? '#' + item.id : '';
  const tail = oneLine((item && (item.knowledge || item.subject)) || '', 24);
  return [SESSION_PREFIX, id, tail].filter(Boolean).join(SESSION_SEP);
}

/** 这条标题是不是我们建的复习会话（客户端列「上一段」时用）。 */
export function isReviewSessionTitle(title) {
  if (typeof title !== 'string') return false;
  const text = title.trim();
  if (text === SESSION_PREFIX) return true;
  const head = SESSION_PREFIX + SESSION_SEP;
  return text.startsWith(head) && text.length > head.length;
}

/**
 * 首条消息：把这道题的骨架直接摆给模型。
 * 空字段整行省略——不写「我的答案：」后面跟一片空白，那会让模型以为学生交了空答案。
 */
export function kickoffText(item) {
  const lines = [];
  lines.push('【' + SESSION_PREFIX + '】请带我把这道错题过一遍。');
  lines.push('');
  const push = (label, value) => {
    const text = oneLine(value, 1200);
    if (text !== '') lines.push(label + '：' + text);
  };
  push('题目', item && item.question);
  push('我的答案', item && item.my_answer);
  // v0.37：正确答案与解析不再塞进首条消息。以前这里把答案直接摆在模型眼前，
  // 和「先出题、学生答完再对答案」的规则自相矛盾——模型很难忍住不说。
  // 需要时由模型调 mb_get 现取，那时学生已经答过了。
  const type = oneLine(item && item.mistake_type, 40);
  const reason = oneLine(item && item.error_reason, 400);
  if (type !== '' || reason !== '') {
    lines.push('错因：' + [type, reason].filter(Boolean).join(' —— '));
  }
  push('知识点', item && item.knowledge);
  push('来源', item && item.source);
  if (item && item.review_count) lines.push('已复习：' + item.review_count + ' 次');
  lines.push('');
  lines.push('按复习流程来：先让我讲我的思路，再出变式题，最后用 mb_review 回写评分。');
  lines.push('答案和解析我没贴在这里：等我答完，你用 mb_get 取，现在先别告诉我。');
  return lines.join('\n');
}

/** 从部署默认里取 agentOptions；取不到就返回 null（不退化重试，否则会话建起来也答不出一句）。 */
function agentOptionsOf(service) {
  let selection;
  try {
    selection = service && typeof service.currentSelection === 'function' ? service.currentSelection() : null;
  } catch {
    return null;
  }
  if (!selection || typeof selection !== 'object') return null;
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const provider = text(selection.provider);
  const model = text(selection.model);
  if (provider === '' || model === '') return null;
  const reasoningEffort = text(selection.reasoningEffort);
  return { provider, model, ...(reasoningEffort === '' ? {} : { reasoningEffort }) };
}

/** 造一条 UserMessage（inject 要完整消息，不是字符串）。 */
function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  };
}

/** 失败回执的统一样子（单题与批量共用）。 */
function fail(code, message, available) {
  return { ok: false, available: available !== false, error: { code, message } };
}

/**
 * 建会话的公共骨架：预设 → 模型 → 建会话 → 改标题 → 注入首条。
 *
 * 单题与批量两条路由只差「标题」与「首条消息」，其余（预设解析、模型选择、挂载、
 * 租约释放、改标题、注入）完全一样。v0.54 抽出这一层，批量会话才有地方落脚，
 * 又不必把这段最易出事的代码复制一份。
 *
 * @param {object} deps 依赖（全部可注入，测试里换成假的，不建真会话）
 * @param {{title: string, kickoff: string}} plan 标题与首条消息
 */
async function createSession(deps, plan) {
  const presets = deps.agentPresets;
  if (!presets || typeof presets.resolve !== 'function' || typeof presets.mount !== 'function') {
    return fail('preset-unavailable',
      '这个宿主没把预设注册表交给插件（agentPresets 不在）：复习会话按「错题复习」预设跑，没有它就建不出来', true);
  }
  let presetId = REVIEW_PRESET;
  try {
    const preset = await presets.resolve(REVIEW_PRESET);
    if (preset && typeof preset.id === 'string' && preset.id.trim()) presetId = preset.id.trim();
    // resolve() 会如实带出 broken（预设行在、但它的 plugins 没激活成功）。
    // 这时候会话建得出来，却没有工具与 persona——等于白建，宁可当场报清楚。
    if (preset && preset.broken !== undefined) {
      const why = preset.broken && (preset.broken.message || preset.broken.code);
      return fail('preset-broken',
        '「错题复习」预设加载失败（' + String(why || preset.broken) + '）：这条会话建出来也没有工具，先修预设', true);
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return fail('preset-unavailable',
      '读不到「错题复习」预设（' + REVIEW_PRESET + '）：' + message + '。重启 DSH 让 cordis.patch.yml 里的两条预设生效', true);
  }

  const agents = deps.agents;
  if (!agents || typeof agents.create !== 'function') {
    return fail('session-create-failed', '这个宿主没把会话服务交给插件（agents 不在）：建不出复习会话', true);
  }

  const agentOptions = agentOptionsOf(deps.agentDefaultModel);
  if (!agentOptions) {
    return fail('model-unavailable',
      '没取到部署默认模型（模型设置里选一个），没有它这条会话答不出一句', false);
  }

  const mountPreset = presets.mount.bind(presets);
  let scope = null;
  try {
    if (typeof presets.acquireScope === 'function') scope = await presets.acquireScope(presetId);
  } catch {
    scope = null; // 租不到 revision 不是致命：创建窗口里预设照样解析得动
  }

  const sessionId = (deps.createId ? deps.createId() : 'mistake-review-' + randomUUID());
  const title = plan.title;
  let handle;
  try {
    handle = await agents.create({
      sessionId,
      meta: { cwd: deps.workspace, agentPreset: presetId },
      agentOptions,
      setup: async (agentCtx) => { await mountPreset(agentCtx, presetId); },
    });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return fail('session-create-failed', '建复习会话失败：' + message, true);
  } finally {
    // acquireScope 给的是**异步可释放租约**（Symbol.asyncDispose），不是 release()。
    // 还不上不致命，但漏还会让这条预设 revision 一直有 user 挂着、永远 collect 不掉。
    try {
      if (scope && typeof scope[Symbol.asyncDispose] === 'function') await scope[Symbol.asyncDispose]();
      else if (scope && typeof scope.release === 'function') await scope.release();
    } catch { /* 还不上不致命 */ }
  }

  const live = (handle && handle.agent) || (typeof agents.get === 'function' ? agents.get(sessionId) : undefined);

  let renamed = false;
  const titleService = deps.sessionTitle;
  const session = live && live.session;
  if (session && titleService && typeof titleService.rename === 'function') {
    try {
      titleService.rename(session, title);
      renamed = true;
    } catch {
      renamed = false;
    }
  }

  let injected = false;
  if (live && typeof live.inject === 'function') {
    try {
      live.inject(userMessage(plan.kickoff));
      injected = true;
    } catch {
      injected = false;
    }
  }

  return { ok: true, sessionId, title, renamed, injected };
}

/**
 * 建一条复习会话（单题）。
 * @param {object} deps 依赖（全部可注入，测试里换成假的，不建真会话）
 * @param {object} input 请求体：{ id }
 * @returns {Promise<object>} 回执：{ ok, sessionId, title, renamed } 或 { ok:false, available, error }
 */
export async function openReviewSession(deps, input) {
  const id = Number(input && input.id);
  if (!Number.isInteger(id) || id <= 0) {
    return fail('body-invalid', '请求体要 JSON：{ "id": <错题编号> }', true);
  }

  let item;
  try {
    item = await deps.loadMistake(id);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return fail('mistake-unreadable', '读不到这道错题：' + message, true);
  }
  if (!item || typeof item !== 'object') {
    return fail('mistake-unreadable', '读不到这道错题：id=' + id, true);
  }

  return createSession(deps, { title: titleForReviewSession(item), kickoff: kickoffText(item) });
}

/** 批量复习会话一次最多带多少道（够一整天用，又不至于把首条消息撑爆）。 */
export const BATCH_MAX = 30;

/** 批量会话的标题：「错题复习 · 8 道」；只有一道时退回单题标题。 */
export function titleForBatchSession(items) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (list.length === 1) return titleForReviewSession(list[0]);
  return [SESSION_PREFIX, list.length + ' 道'].join(SESSION_SEP);
}

/**
 * 批量会话的首条消息：把今天这几道按序号摆出来，每道带学科/知识点与「为什么排它」。
 *
 * 与单题版同一条纪律：不贴答案与解析。另外每道只给题干与「我上次答了什么」，
 * 让模型有据可依地决定先问哪道，而不是把整轮复习当成一次泛泛的问答。
 *
 * @param {object[]} items 错题列表
 * @param {object} notes 可选的 { [id]: 一句话理由 }，来自简报
 */
export function kickoffBatchText(items, notes) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const lines = [];
  lines.push('【' + SESSION_PREFIX + '】今天这 ' + list.length + ' 道，请带我一起过。');
  lines.push('');
  list.forEach((item, index) => {
    const tag = [oneLine(item.subject, 20), oneLine(item.knowledge, 30)].filter(Boolean).join(' · ');
    const why = notes && typeof notes === 'object' ? oneLine(notes[String(item.id)], 120) : '';
    lines.push((index + 1) + '. #' + (item.id || '?') + (tag ? '（' + tag + '）' : '') + (why ? ' —— ' + why : ''));
    const question = oneLine(item.question, 200);
    if (question !== '') lines.push('   ' + question);
    const mine = oneLine(item.my_answer, 120);
    if (mine !== '') lines.push('   我上次答：' + mine);
  });
  lines.push('');
  lines.push('按复习流程来：一道一道走，先让我讲我的思路，再出变式题，最后用 mb_review 回写评分。');
  lines.push('答案和解析我没贴在这里：等我答完，你用 mb_get 取，现在先别告诉我。');
  return lines.join('\n');
}

/**
 * 建一条批量复习会话：一次把今天这几道交给模型。
 * @param {object} deps 依赖
 * @param {object} input 请求体：{ ids: number[], notes?: object }
 * @returns {Promise<object>} 回执
 */
export async function openBatchReviewSession(deps, input) {
  const raw = input && Array.isArray(input.ids) ? input.ids : null;
  if (!raw) {
    return fail('body-invalid', '请求体要 JSON：{ "ids": [错题编号...] }', true);
  }
  const ids = [];
  raw.forEach((value) => {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0 && ids.indexOf(id) < 0) ids.push(id);
  });
  if (!ids.length) {
    return fail('body-invalid', 'ids 里没有有效的错题编号', true);
  }
  if (ids.length > BATCH_MAX) {
    return fail('body-invalid', '一次最多带 ' + BATCH_MAX + ' 道（这次 ' + ids.length + ' 道）：拆成两轮更像复习', true);
  }

  const items = [];
  const missing = [];
  for (const id of ids) {
    try {
      const item = await deps.loadMistake(id);
      if (item && typeof item === 'object') items.push(item);
      else missing.push(id);
    } catch {
      missing.push(id);
    }
  }
  if (!items.length) {
    return fail('mistake-unreadable', '这几道都读不到：' + ids.join(', '), true);
  }

  const notes = input && input.notes && typeof input.notes === 'object' ? input.notes : null;
  return createSession(deps, {
    title: titleForBatchSession(items),
    kickoff: kickoffBatchText(items, notes),
  });
}

/** 把一条「建复习会话」路由挂上去；单题与批量共用这段样板。 */
function mountSessionRoute(ctx, config, route) {
  if (!ctx || typeof ctx.inject !== 'function') return;
  const s = settings(config);
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx && connectionCtx.connection;
    if (!connection || !connection.fetch || typeof connection.fetch.register !== 'function') return;
    if (typeof connectionCtx.effect !== 'function') return;
    connectionCtx.effect(() => connection.fetch.register({
      path: route.path,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return Response.json({
            ok: false, available: true,
            error: { code: 'body-invalid', message: '请求体要 JSON：{ "id": <错题编号> }' },
          }, { status: 400 });
        }
        try {
          const view = await route.open({
            workspace: s.home,
            loadMistake: (id) => call(s, '/api/mistakes/' + id),
            agentPresets: connectionCtx.get ? connectionCtx.get('agentPresets') : null,
            agents: connectionCtx.get ? connectionCtx.get('agents') : null,
            sessionTitle: connectionCtx.get ? connectionCtx.get('sessionTitle') : null,
            agentDefaultModel: connectionCtx.get ? connectionCtx.get('agentDefaultModel') : null,
          }, body);
          const status = view.ok ? 200 : (view.available === false ? 503 : 500);
          return Response.json(view, { status });
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          return Response.json({
            ok: false, available: true,
            error: { code: 'session-create-failed', message },
          }, { status: 500 });
        }
      },
    }), route.label);
  });
}

/**
 * 把单题复习路由挂到插件上：connection 就绪才注册，缺了就不挂（与 studymate 同一口径）。
 * @param {any} ctx 插件根上下文
 * @param {any} config 插件行 config 段（url / home / python）
 */
export function registerSessionRoute(ctx, config) {
  mountSessionRoute(ctx, config, {
    path: SESSION_PATH,
    label: '错题本: 建复习会话路由',
    open: openReviewSession,
  });
}

/**
 * 把批量复习路由挂到插件上（v0.54）。单独一条路由，不改编单题那条 ——
 * 单题入口是面板上最常用的按钮，值得零风险。
 */
export function registerBatchSessionRoute(ctx, config) {
  mountSessionRoute(ctx, config, {
    path: SESSION_BATCH_PATH,
    label: '错题本: 建批量复习会话路由',
    open: openBatchReviewSession,
  });
}
