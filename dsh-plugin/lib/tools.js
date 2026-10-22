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

/** 一行摘要：#id [学科] 题干（状态）。 */
function brief(item) {
  return '#' + item.id + ' [' + (item.subject || '未分科') + '] '
    + clip(item.question, 60) + '（' + statusLabel(item.status) + '）';
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
      },
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const days = clampInt(args.days, 7, 1, 60);
      const limit = clampInt(args.limit, 8, 1, 50);
      const plan = await call(s, '/api/plan' + query({ days }));
      const list = await call(s, '/api/mistakes' + query({ due: 1, page_size: limit }));
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
        knowledge: { type: 'string', description: '知识点，如 极限' },
        tag: { type: 'string', description: '标签，精确匹配一个' },
        status: { type: 'string', enum: ['new', 'reviewing', 'mastered'], description: '状态' },
        mistake_type: { type: 'string', enum: MISTAKE_TYPES, description: '错因分类' },
        paper_id: { type: 'integer', description: '试卷 id，0 表示未归卷' },
        due: { type: 'boolean', description: '只看已到期的' },
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
        due: args.due ? 1 : '',
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
    description: '按题号读取一道错题的完整内容、错因与复习历史。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'integer', description: '错题 id' },
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
      if (oneLine(item.answer)) lines.push('正确答案：' + oneLine(item.answer));
      if (oneLine(item.analysis)) lines.push('解析：' + oneLine(item.analysis));
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
        difficulty: clampInt(args.difficulty, 0, 0, 5),
        paper_id: clampInt(args.paper_id, 0, 0, 2147483647),
      };
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
      const data = await call(s, '/api/mistakes/' + id + '/review', {
        method: 'POST',
        body: JSON.stringify({ rating }),
      });
      const row = data && data.mistake ? data.mistake : data;
      const lines = ['已记录 #' + id + ' · ' + rating];
      if (row && row.next_review_at) lines.push('下次复习：' + row.next_review_at);
      if (row && typeof row.stage === 'number') lines.push('当前阶段：' + row.stage);
      if (row && typeof row.review_count === 'number') lines.push('累计复习：' + row.review_count + ' 次');
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

/**
 * 把 6 个工具注册到 agent 的工具面。
 * @param {any} ctx cordis 上下文，用到 tools 一个成员。
 * @param {any} config 插件行 config 段（url / home / python）。
 */
export function apply(ctx, config) {
  const builders = [dueTool, searchTool, getTool, addTool, reviewTool, statsTool];
  for (const build of builders) ctx.tools.register(build(config));
}
