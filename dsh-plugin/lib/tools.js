/* 错题本 DSH 插件 · 工具域。
 *
 * 零依赖：不 import @deepseek-ai/dsh-tools（profile 的 pnpm 严格布局解析不到宿主类型包），
 * 直接把宿主 ctx.tools.register 认的定义形状写出来：
 *   { name, description, parameters(JSON Schema), output: { schema, render }, execute }
 * 这与 studymate 的做法一致（它同样手写 ToolDefinitionLike）。
 *
 * 约定：description 只有一句话、不含换行——参数契约不进 system prompt，
 * 详细的字段说明写在参数的 description 里，由模型按需看 schema。
 */
import { call, settings } from './api.js';

export const name = 'mistake-book-tools';
export const inject = ['tools'];

/** 所有工具共用的输出契约：一段给人读的文本。 */
const TEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { text: { type: 'string' } },
  required: ['text'],
};

function out() {
  return {
    schema: TEXT_SCHEMA,
    render: (_args, value) => [{ type: 'text', text: String(value && value.text ? value.text : '') }],
  };
}

function oneLine(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
}

function clip(value, max) {
  const text = oneLine(value);
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

const STATUS_LABEL = { new: '待复习', reviewing: '复习中', mastered: '已掌握' };

function statusLabel(status) {
  return STATUS_LABEL[status] || status || '待复习';
}

/** 一行摘要：#id [学科] 题干（状态 · 变式）。 */
function brief(item) {
  // v0.36：列表里带上变式库存。-1 / 缺字段（老接口）就当不知道，不显示；
  // 0 条要显式说「无变式」，否则 agent 列到期题时看不出谁该补题。
  const variants = typeof item.variant_count === 'number' ? item.variant_count : null;
  const tail = variants === null ? '' : (variants ? ' · 变式 ' + variants : ' · 无变式');
  return '#' + item.id + ' [' + (item.subject || '未分科') + '] '
    + clip(item.question, 60) + '（' + statusLabel(item.status) + tail + '）';
}

/** 拼查询串，跳过空值。 */
function query(params) {
  const parts = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

const MISTAKE_TYPES = ['概念不清', '计算失误', '审题错误', '方法不会', '粗心', '其他'];
// 与 app.py 的 REVIEW_STEPS 保持一致；用枚举，聚合才有意义
const REVIEW_STEPS = ['审题', '建模', '计算', '检验', '表达', '记忆'];
// 与 app.py 的 SORT_OPTIONS 同源。白名单：拼错的值不往后端发，让它走默认档。
const SORT_KEYS = ['created', 'due', 'stability', 'errors'];

/** 排序参数校验，不认识就返回空串（= 不传，用后端默认）。 */
function sortKey(value) {
  const text = String(value || '').trim().toLowerCase();
  return SORT_KEYS.indexOf(text) >= 0 ? text : '';
}

/** 今天/逾期该复习什么。 */
function dueTool(config) {
  return {
    name: 'mb_due',
    description: '列出今天该复习和已逾期的错题，带题号、学科、题干与状态。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        days: { type: 'integer', description: '往后看几天，默认 7' },
        limit: { type: 'integer', description: '最多列几道，默认 8' },
        sort: { type: 'string', enum: SORT_KEYS, description: '排序：created 最新录入 / due 最快到期 / stability 最不稳定 / errors 错得最多' },
      },
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const days = clampInt(args.days, 7, 1, 60);
      const limit = clampInt(args.limit, 8, 1, 50);
      const sort = sortKey(args.sort);
      const plan = await call(s, '/api/plan' + query({ days }));
      const list = await call(s, '/api/mistakes' + query({ due: 1, page_size: limit, sort }));
      const rows = list && Array.isArray(list.items) ? list.items : [];
      const head = '今天 ' + (plan.today_count || 0) + ' 道 · 逾期 ' + (plan.overdue || 0)
        + ' 道 · 未来 ' + days + ' 天共 ' + (plan.total || 0) + ' 道';
      const body = rows.length
        ? rows.map((item, i) => (i + 1) + '. ' + brief(item)).join('\n')
        : '当前没有到期错题。';
      return { text: head + '\n\n' + body };
    },
  };
}

/** 检索错题。 */
function searchTool(config) {
  return {
    name: 'mb_search',
    description: '按关键词、学科、知识点、标签、状态或试卷检索错题，返回题号与题干。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        q: { type: 'string', description: '关键词，匹配题干/答案/解析/知识点' },
        subject: { type: 'string', description: '学科，如 高数' },
        knowledge: { type: 'string', description: '知识点，如 函数 或 函数/单调性' },
        kdeep: { type: 'boolean', description: '知识点按子树匹配，默认 true（传 函数 也能搜到 函数/单调性）' },
        nokp: { type: 'boolean', description: '只看没填知识点的题（与 knowledge 二选一）' },
        tag: { type: 'string', description: '标签，精确匹配一个' },
        status: { type: 'string', enum: ['new', 'reviewing', 'mastered'], description: '状态' },
        mistake_type: { type: 'string', enum: MISTAKE_TYPES, description: '错因分类' },
        paper_id: { type: 'integer', description: '试卷 id，0 表示未归卷' },
        due: { type: 'boolean', description: '只看已到期的' },
        sort: { type: 'string', enum: SORT_KEYS, description: '排序：created / due / stability / errors' },
        limit: { type: 'integer', description: '每页条数，默认 10' },
        offset: { type: 'integer', description: '跳过多少条，默认 0' },
      },
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const limit = clampInt(args.limit, 10, 1, 30);
      const offset = clampInt(args.offset, 0, 0, 100000);
      const data = await call(s, '/api/mistakes' + query({
        q: args.q,
        subject: args.subject,
        knowledge: args.knowledge,
        tag: args.tag,
        status: args.status,
        type: args.mistake_type,
        paper_id: args.paper_id,
        kdeep: args.kdeep === false ? 0 : (args.knowledge ? 1 : ''),
        nokp: args.nokp ? 1 : '',
        due: args.due ? 1 : '',
        sort: sortKey(args.sort),
        page_size: limit,
        page: Math.floor(offset / limit) + 1,
      }));
      const rows = data && Array.isArray(data.items) ? data.items : [];
      const total = data && typeof data.total === 'number' ? data.total : rows.length;
      if (!rows.length) return { text: '没有匹配的错题。' };
      const tail = total > offset + rows.length
        ? '\n\n还有 ' + (total - offset - rows.length) + ' 道，用 offset=' + (offset + rows.length) + ' 继续。'
        : '';
      return {
        text: '共 ' + total + ' 道，本页 ' + rows.length + ' 道：\n'
          + rows.map((item, i) => (offset + i + 1) + '. ' + brief(item)).join('\n') + tail,
      };
    },
  };
}

/** 读一道题的全部内容与复习历史。 */
function getTool(config) {
  return {
    name: 'mb_get',
    description: '按题号读取一道错题的内容、错因与复习历史。默认不给正确答案与解析（reveal 默认 false），学生答完再传 reveal: true。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'integer', description: '错题 id' },
        reveal: { type: 'boolean', description: '是否返回正确答案与解析。默认 false：出题时别让模型先看见答案，学生答完再传 true' },
        with_reviews: { type: 'boolean', description: '是否附复习历史，默认 true' },
      },
      required: ['id'],
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const id = clampInt(args.id, 0, 1, 2147483647);
      if (!id) throw new Error('id 必须是正整数');
      const item = await call(s, '/api/mistakes/' + id);
      const lines = [
        '#' + item.id + ' [' + (item.subject || '未分科') + '] ' + statusLabel(item.status),
        '题目：' + oneLine(item.question),
      ];
      if (oneLine(item.my_answer)) lines.push('我的答案：' + oneLine(item.my_answer));
      // v0.38：默认不泄题。以前 mb_get 永远把答案与解析吐出来，于是「让学生先答」
      // 只能靠 SKILL.md 里的一句叮嘱，模型顺手 poll 一次就看见答案了。默认藏起来，
      // 判分时显式传 reveal: true —— 同一件事在 v0.37 的首条消息上已经做过一次。
      const reveal = args.reveal === true;
      if (reveal) {
        if (oneLine(item.answer)) lines.push('正确答案：' + oneLine(item.answer));
        if (oneLine(item.analysis)) lines.push('解析：' + oneLine(item.analysis));
      } else if (oneLine(item.answer) || oneLine(item.analysis)) {
        lines.push('答案与解析：已隐藏（学生答完后 mb_get(id, reveal: true) 再看）');
      }
      if (oneLine(item.error_reason)) lines.push('错因：' + oneLine(item.error_reason));
      lines.push('分类：' + (item.mistake_type || '未分类')
        + ' · 知识点 ' + (item.knowledge || '无')
        + ' · 标签 ' + (item.tags || '无')
        + ' · 难度 ' + (item.difficulty || 0)
        + ' · 来源 ' + (item.source || '无'));
      lines.push('复习：共 ' + (item.review_count || 0) + ' 次 · 阶段 ' + (item.stage || 0)
        + ' · 下次 ' + (item.next_review_at || '未排'));
      if (Array.isArray(item.images) && item.images.length) {
        lines.push('图片：' + item.images.length + ' 张');
      }
      // v0.37：把已有变式列出来。以前 agent 拿到一道题看不见它攒过哪些变式，
      // 只能从 mb_due 行的「变式 N」猜，容易重复出同一道。
      // 老服务没有这个接口就跳过，不因为附属信息打断主流程。
      let variantRows = [];
      try {
        const data = await call(s, '/api/mistakes/' + id + '/variants');
        variantRows = data && Array.isArray(data.items) ? data.items : [];
      } catch {
        variantRows = [];
      }
      if (variantRows.length) {
        lines.push('', '已有变式（' + variantRows.length + ' 条）：');
        for (const row of variantRows.slice(0, 10)) {
          lines.push('  #' + row.id + ' ' + oneLine(row.question, 80)
            + ' · 练过 ' + (row.times_used || 0) + ' 次');
        }
        if (variantRows.length > 10) lines.push('  ……还有 ' + (variantRows.length - 10) + ' 条');
      } else if (args.with_reviews !== false) {
        lines.push('已有变式：暂无（可以现场出一道同知识点的新题，用 mb_review 的 variant_question 存下来）');
      }
      if (args.with_reviews !== false) {
        const history = await call(s, '/api/mistakes/' + id + '/reviews');
        const rows = history && Array.isArray(history.items) ? history.items : [];
        lines.push('', rows.length ? '复习历史（新→旧）：' : '复习历史：暂无');
        for (const row of rows.slice(0, 10)) {
          lines.push('  ' + (row.reviewed_at || '') + ' · ' + (row.result || '') + ' · 间隔 '
            + (row.interval_days || 0) + ' 天');
        }
      }
      return { text: lines.join('\n') };
    },
  };
}

/** 录入一道新错题。 */
function addTool(config) {
  return {
    name: 'mb_add',
    description: '录入一道新错题并返回新题号，字段与网页端新增弹窗一致。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        question: { type: 'string', description: '题干，必填' },
        my_answer: { type: 'string', description: '我的错误答案' },
        answer: { type: 'string', description: '正确答案' },
        analysis: { type: 'string', description: '解析或解题步骤' },
        error_reason: { type: 'string', description: '错因的简短说明' },
        subject: { type: 'string', description: '学科，如 高数' },
        knowledge: { type: 'string', description: '知识点' },
        mistake_type: { type: 'string', enum: MISTAKE_TYPES, description: '错因分类' },
        source: { type: 'string', description: '来源，如 期中、作业' },
        tags: { type: 'string', description: '逗号分隔的标签' },
        difficulty: { type: 'integer', description: '难度 1-5' },
        paper_id: { type: 'integer', description: '归到哪份试卷，0 表示不归卷' },
      },
      required: ['question'],
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const body = {
        question: oneLine(args.question),
        my_answer: args.my_answer || '',
        answer: args.answer || '',
        analysis: args.analysis || '',
        error_reason: args.error_reason || '',
        subject: args.subject || '',
        knowledge: args.knowledge || '',
        mistake_type: args.mistake_type || '',
        source: args.source || '',
        tags: args.tags || '',
        paper_id: clampInt(args.paper_id, 0, 0, 2147483647),
      };
      // v0.37 修：difficulty 不传时以前塞 0，而服务端只收 1-5，导致「不填难度就录不进去」。
      // 不传就不发这个字段，让服务端用默认值 3。
      if (args.difficulty !== undefined && args.difficulty !== null && args.difficulty !== '') {
        body.difficulty = clampInt(args.difficulty, 3, 1, 5);
      }
      const item = await call(s, '/api/mistakes', { method: 'POST', body: JSON.stringify(body) });
      return {
        text: '已录入 #' + item.id + ' · ' + (item.subject || '未分科')
          + ' · ' + (item.mistake_type || '未分类')
          + ' · 下次复习 ' + (item.next_review_at || '未排'),
      };
    },
  };
}

/** 提交一次复习评分。 */
function reviewTool(config) {
  return {
    name: 'mb_review',
    description: '按题号提交一次复习评分（again/hard/good/easy），推进 FSRS 计划。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'integer', description: '错题 id' },
        rating: {
          type: 'string',
          enum: ['again', 'hard', 'good', 'easy'],
          description: 'again=重来 hard=困难 good=记得 easy=简单',
        },
        step: {
          type: 'string',
          enum: REVIEW_STEPS,
          description: '这次错在解题流程的哪一步（可选，用于沉淀个人易错模式）',
        },
        variant_question: {
          type: 'string',
          description: '本轮现场出的变式题题干（可选；与这次评分同一次提交入库，自动去重并计一次练习）',
        },
        variant_answer: {
          type: 'string',
          description: '变式题答案（可选，需配合 variant_question）',
        },
        variant_knowledge: {
          type: 'string',
          description: '变式题知识点（可选，留空则继承母题）',
        },
      },
      required: ['id', 'rating'],
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const id = clampInt(args.id, 0, 1, 2147483647);
      if (!id) throw new Error('id 必须是正整数');
      const rating = String(args.rating || '');
      if (['again', 'hard', 'good', 'easy'].indexOf(rating) < 0) {
        throw new Error('rating 只能是 again / hard / good / easy');
      }
      const body = { rating };
      const step = String(args.step || '').trim();
      if (step) {
        if (REVIEW_STEPS.indexOf(step) < 0) throw new Error('step 只能是 ' + REVIEW_STEPS.join(' / '));
        body.step = step;
      }
      // v0.36：变式随评分一起入库。后端 _extract_variant() 认这套字段名，
      // 与 mb.py 的 --variant-question 同源，三端写出来是同一份数据。
      const vQuestion = String(args.variant_question || '').trim();
      const vAnswer = String(args.variant_answer || '').trim();
      const vKnowledge = String(args.variant_knowledge || '').trim();
      if (!vQuestion && (vAnswer || vKnowledge)) {
        throw new Error('variant_answer / variant_knowledge 必须和 variant_question 一起提交');
      }
      if (vQuestion) {
        body.variant_question = vQuestion;
        if (vAnswer) body.variant_answer = vAnswer;
        if (vKnowledge) body.variant_knowledge = vKnowledge;
      }
      const data = await call(s, '/api/mistakes/' + id + '/review', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const row = data && data.mistake ? data.mistake : data;
      const lines = ['已记录 #' + id + ' · ' + rating + (step ? ' · 断点 ' + step : '')];
      if (row && row.next_review_at) lines.push('下次复习：' + row.next_review_at);
      if (row && typeof row.stage === 'number') lines.push('当前阶段：' + row.stage);
      if (row && typeof row.review_count === 'number') lines.push('累计复习：' + row.review_count + ' 次');
      // v0.36：把后端已经回传的变式回执透出来，agent 才知道刚才是新建还是命中去重。
      const variant = row && row.variant && typeof row.variant === 'object' ? row.variant : null;
      if (variant && typeof variant.id === 'number') {
        lines.push(variant.duplicate
          ? '变式已在库中：#' + variant.id + '（复用，已计一次练习）'
          : '已存变式：#' + variant.id);
      } else if (vQuestion) {
        lines.push('变式未入库：服务端没有回执（可能已达单题变式上限，或服务端版本过旧）');
      }
      return { text: lines.join('\n') };
    },
  };
}

/** 统计视图。 */
function statsTool(config) {
  return {
    name: 'mb_stats',
    description: '读取错题统计：总量与正确率、知识点掌握度、错因趋势或再战区。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        view: {
          type: 'string',
          enum: ['overview', 'mastery', 'trend', 'arena'],
          description: 'overview=总览 mastery=知识点 trend=趋势 arena=再战区',
        },
        days: { type: 'integer', description: '趋势窗口天数，默认 30' },
      },
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const view = args.view || 'overview';
      if (view === 'mastery') {
        const data = await call(s, '/api/mastery');
        const bands = data.band_counts || {};
        const pending = Array.isArray(data.pending) ? data.pending : [];
        const lines = [
          '知识点 ' + (data.points_total || 0) + ' 个 · 已过门禁 ' + (data.passed_total || 0) + ' 个',
          '掌握分布：' + (bands.mastered || 0) + ' 已掌握 / ' + (bands.good || 0) + ' 良好 / '
            + (bands.fair || 0) + ' 一般 / ' + (bands.weak || 0) + ' 薄弱',
          '',
          pending.length ? '还没过门禁的知识点（弱→强）：' : '所有知识点都已过门禁。',
        ];
        for (const point of pending.slice(0, 10)) {
          const band = point.band && point.band.label ? point.band.label : '薄弱';
          lines.push('  ' + (point.knowledge || '?') + ' · ' + band
            + ' · 错题 ' + (point.mistakes || 0) + ' 道 · 正确率 '
            + Math.round((point.accuracy || 0) * 100) + '%');
        }
        return { text: lines.join('\n') };
      }
      if (view === 'trend') {
        const days = clampInt(args.days, 30, 7, 365);
        const data = await call(s, '/api/analytics' + query({ days }));
        const totals = data.trend_totals || {};
        const byType = Array.isArray(data.by_type) ? data.by_type : [];
        const lines = [
          '近 ' + (data.window_days || days) + ' 天：新增 ' + (totals.created || 0)
            + ' 道 · 复习 ' + (totals.reviewed || 0) + ' 次',
          '',
          byType.length ? '错因分布：' : '错因分布：暂无数据',
        ];
        for (const row of byType) lines.push('  ' + (row.name || '?') + ' ' + (row.count || 0) + ' 道');
        return { text: lines.join('\n') };
      }
      if (view === 'arena') {
        const data = await call(s, '/api/arena');
        const counts = data.counts || {};
        const items = Array.isArray(data.items) ? data.items : [];
        const lines = [
          '再战区：在区 ' + (counts.zone || 0) + ' 道 · 已出区 ' + (counts.cleared || 0)
            + ' 道 · 规则 错 ' + ((data.rule && data.rule.min_wrong) || 0) + ' 次进区',
          '',
        ];
        if (!items.length) lines.push('再战区是空的——没有反复错的题。');
        for (const item of items.slice(0, 10)) {
          lines.push('  #' + item.id + ' [' + (item.subject || '未分科') + '] ' + clip(item.question, 50));
        }
        return { text: lines.join('\n') };
      }
      const data = await call(s, '/api/stats');
      const reviews = data.reviews || {};
      const mastery = data.mastery || {};
      const lines = [
        '错题共 ' + (data.total || 0) + ' 道：待复习 ' + (data.reviewing || 0)
          + ' · 已掌握 ' + (data.mastered || 0) + ' · 已暂停 ' + (data.suspended || 0)
          + ' · 到期 ' + (data.due || 0),
        '复习 ' + (reviews.total || 0) + ' 次 · 正确率 '
          + Math.round((reviews.accuracy || 0) * 100) + '% · 近 7 天 ' + (reviews.last_7_days || 0) + ' 次',
        '知识点 ' + (mastery.points || 0) + ' 个 · 已过门禁 ' + (mastery.passed || 0) + ' 个',
      ];
      const bySubject = Array.isArray(data.by_subject) ? data.by_subject : [];
      if (bySubject.length) {
        lines.push('', '按学科：' + bySubject.map((row) => (row.subject || '?') + ' ' + (row.count || 0)).join(' · '));
      }
      return { text: lines.join('\n') };
    },
  };
}

/** 断点分析：错在流程的哪一步最多，以及知识点 × 断点的固定失手模式。 */
function weakStepsTool(config) {
  return {
    name: 'mb_weak_steps',
    description: '看错在解题流程的哪一步最多，以及「知识点 × 哪一步」的个人易错模式。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        days: { type: 'integer', description: '窗口天数 7-90，默认 90' },
        limit: { type: 'integer', description: '最多列几个模式，默认 5' },
      },
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const days = clampInt(args.days, 90, 7, 90);
      const limit = clampInt(args.limit, 5, 1, 20);
      const data = await call(s, '/api/analytics' + query({ days }));
      const byStep = Array.isArray(data.by_step) ? data.by_step : [];
      const patterns = Array.isArray(data.step_patterns) ? data.step_patterns : [];
      if (!byStep.length) {
        return { text: '还没有记录过「错在哪一步」。复习时顺手选一下断点，这里就能看出固定失手位置。' };
      }
      const total = byStep.reduce((sum, row) => sum + (row.count || 0), 0);
      const lines = ['最近 ' + days + ' 天记录了 ' + total + ' 次断点：'];
      for (const row of byStep) {
        const pct = total ? Math.round((row.count || 0) / total * 100) : 0;
        lines.push('  ' + (row.name || '?') + ' ' + (row.count || 0) + ' 次 · ' + pct + '%');
      }
      if (patterns.length) {
        lines.push('', '固定失手模式（同一知识点同一步 ≥2 次）：');
        for (const row of patterns.slice(0, limit)) {
          lines.push('  ' + (row.knowledge || '?') + ' → ' + (row.step || '?')
            + ' 错了 ' + (row.count || 0) + ' 次');
        }
      } else {
        lines.push('', '还没有重复到 2 次以上的「知识点 × 断点」组合。');
      }
      return { text: lines.join('\n') };
    },
  };
}

/** 回放学习事件流。 */
function eventsTool(config) {
  return {
    name: 'mb_events',
    description: '回放最近的学习事件（建题 / 复习 / 掌握 / 斩题），按时间顺序。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', description: '最多几条，默认 20' },
        kind: {
          type: 'string',
          enum: ['created', 'reviewed', 'mastered', 'suspended', 'resumed'],
          description: '只看某类事件',
        },
        id: { type: 'integer', description: '只看某道错题' },
      },
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const limit = clampInt(args.limit, 20, 1, 200);
      const data = await call(s, '/api/events' + query({
        limit, kind: String(args.kind || '').trim(), id: clampInt(args.id, 0, 0, 2147483647),
      }));
      const rows = Array.isArray(data.items) ? data.items : [];
      if (!rows.length) return { text: '事件流是空的——还没有建题或复习记录。' };
      const lines = ['最近 ' + rows.length + ' 条事件（共 ' + (data.total || 0) + ' 条）：'];
      for (const ev of rows) {
        const parts = [String(ev.ts || '').slice(5, 16), ev.kind || '?'];
        if (ev.id) parts.push('#' + ev.id);
        if (ev.step) parts.push('断点 ' + ev.step);
        if (ev.result) parts.push(ev.result);
        if (ev.interval_days) parts.push('间隔 ' + ev.interval_days + ' 天');
        if (ev.knowledge) parts.push(ev.knowledge);
        lines.push('  ' + parts.join(' · '));
      }
      return { text: lines.join('\n') };
    },
  };
}

/**
 * 把 8 个工具注册到 agent 的工具面。
 * @param {any} ctx cordis 上下文，用到 tools 一个成员。
 * @param {any} config 插件行 config 段（url / home / python）。
 */
export function apply(ctx, config) {
  const builders = [dueTool, searchTool, getTool, addTool, reviewTool, statsTool,
    weakStepsTool, eventsTool];
  for (const build of builders) ctx.tools.register(build(config));
}
