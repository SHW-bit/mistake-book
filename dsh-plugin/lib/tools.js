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
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
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

/** 能与服务端对上的图片类型。别的一律拒，避免把二进制当图片塞进库。 */
const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const MAX_IMAGE_FILES = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** 本地图片路径 → 服务端要的 {data, field}。题干允许为空，所以这条路是「只发图」的唯一入口。 */
function readImageFiles(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const files = [];
  for (const entry of list.slice(0, MAX_IMAGE_FILES)) {
    const path = typeof entry === 'string' ? entry : String((entry && entry.path) || '').trim();
    if (!path) continue;
    const mime = IMAGE_MIME[extname(path).toLowerCase()];
    if (!mime) throw new Error('图片类型不支持（png/jpg/webp/gif）: ' + path);
    let size = 0;
    try { size = statSync(path).size; } catch (_) { throw new Error('找不到图片: ' + path); }
    if (size > MAX_IMAGE_BYTES) throw new Error('图片超过 8MB: ' + path);
    const data = readFileSync(path).toString('base64');
    const field = entry && typeof entry === 'object' && entry.field ? String(entry.field) : 'question';
    files.push({ data: 'data:' + mime + ';base64,' + data, field });
  }
  return files;
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
  // 纯图片题没有题干：别在到期清单里留一个空标题
  const title = clip(item.question, 60) || (item.has_image ? '（图片题）' : '（空题）');
  return '#' + item.id + ' [' + (item.subject || '未分科') + '] '
    + title + '（' + statusLabel(item.status) + tail + '）';
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
        '题目：' + (oneLine(item.question) || '（纯图片题，题型见下面的图片）'),
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
      // v0.52：纯图片题光说「N 张」没用——把本地路径写出来，模型才能用 read_image 真的看题。
      if (Array.isArray(item.images) && item.images.length) {
        lines.push('图片：' + item.images.length + ' 张（本地文件，可用 read_image 打开）');
        for (const img of item.images.slice(0, 6)) {
          lines.push('  · ' + (img.field || 'question') + '：' + (img.path || img.file || ''));
        }
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
        question: { type: 'string', description: '题干（可选：只发图时留空）' },
        images: {
          type: 'array',
          description: '题目截图的本机路径，最多 6 张；只有图没有题干也能录',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: '本地图片路径（png/jpg/webp/gif）' },
              field: { type: 'string', enum: ['question', 'wrong', 'answer', 'analysis'], description: '这张图属于哪一块，默认 question' },
            },
            required: ['path'],
          },
        },
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
      required: [],
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const images = readImageFiles(args.images);
      if (!oneLine(args.question) && !images.length) {
        throw new Error('题干和图片至少给一个');
      }
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
      if (images.length) body.images = images;
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
        student_answer: {
          type: 'string',
          description: '学生这次的作答原文（可选；v0.51 起入库，供事后诊断「错在哪一步」）',
        },
        hints: {
          type: 'integer',
          description: '这次用了几级提示才做出来：0=没提示自己做对，1-3=提示级别，不传=未记录（可选）',
        },
        judgement: {
          type: 'string',
          description: '判分依据：一句话说明为什么给这个 rating（可选）',
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
      // v0.51：判分留证。以前只存一个 rating，事后没法回答「这次错和上次是同一个原因吗」。
      // 三个字段都可选，不传就不发，老服务也不会因为多字段报错（服务端只读认识的键）。
      const studentAnswer = String(args.student_answer || '').trim();
      if (studentAnswer) body.student_answer = studentAnswer;
      if (args.hints !== undefined && args.hints !== null && args.hints !== '') {
        const hints = clampInt(args.hints, -1, -1, 3);
        if (hints >= 0) body.hints = hints;
      }
      const judgement = String(args.judgement || '').trim();
      if (judgement) body.judgement = judgement;
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
      // v0.51：把「留了什么证」回显一句，agent 才知道这次判分有没有落库。
      const kept = [];
      if (studentAnswer) kept.push('作答 ' + studentAnswer.length + ' 字');
      if (typeof body.hints === 'number') kept.push(body.hints === 0 ? '零提示' : body.hints + ' 级提示');
      if (judgement) kept.push('判分依据');
      if (kept.length) lines.push('已留证：' + kept.join(' · '));
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

/* ── v0.41：把 AI 能做的事从「读 + 单题写」扩到「批量写 + 组卷 + 复盘 + 知识库整理」 ── */

/** 编辑距离（带上限，超了提前返回；只用来判相似，不需要精确值）。 */
function editDistance(a, b, limit) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > limit) return limit;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > limit) return limit;
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[n];
}

/** 归一化：层级分隔符（空格 / > · ・）统一成 /，再小写，只用于比较，不写回库。 */
function foldName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*[\/>·・]\s*/g, '/')
    .replace(/\s+/g, '/');
}

/** 两个名字有多像：0 = 不像，1 = 归一化后完全相同。 */
function similarName(a, b) {
  const fa = foldName(a);
  const fb = foldName(b);
  if (!fa || !fb) return 0;
  // 归一化后完全相同但原文不同 = 最该合并的一类（空格/分隔符写法不一致），
  // 不能因为「看起来一样」就跳过 —— 库里的 DISTINCT 保证原文不同，这里必然是两个值。
  if (fa === fb) return 1;
  if (fa.length < 2 || fb.length < 2) return 0;
  // 父子节点不算重复：「函数」和「函数/极限」是层级关系，不是同一件事写了两遍。
  // 少了这行，suggest 会把每个子节点都报成父节点的近重复（冒烟时确实如此）。
  if (fa.indexOf(fb + '/') === 0 || fb.indexOf(fa + '/') === 0) return 0;
  const longest = Math.max(fa.length, fb.length);
  const ratio = 1 - editDistance(fa, fb, 12) / longest;
  if (fa.indexOf(fb) >= 0 || fb.indexOf(fa) >= 0) return Math.max(ratio, 0.8);
  return ratio >= 0.72 ? ratio : 0;
}

/** 疑似无效值：纯数字（111 / 2）或单字符。 */
function junkName(value) {
  const text = String(value || '').trim();
  return /^\d{1,4}$/.test(text) || text.length < 2;
}

/** 从 meta 里取一类候选值，统一成 { name, count }。 */
function facetsOf(meta, kind) {
  const table = {
    knowledge: meta && meta.knowledge,
    subject: meta && meta.subject_facets,
    tag: meta && meta.tag_facets,
    source: meta && meta.source_facets,
  };
  const list = table[kind];
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ name: item.trim(), count: 0 });
      continue;
    }
    const name = item && (item.path || item.name);
    if (!name) continue;
    out.push({ name: String(name), count: typeof item.count === 'number' ? item.count : 0 });
  }
  return out;
}

/** 粗解析批量文本，只为预览：数一数几道、各道标题是什么。真正的校验在服务端。 */
function previewBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks = [];
  let cur = [];
  const flush = () => { blocks.push(cur); cur = []; };
  for (const line of lines) {
    if (line.trim() === '---') { flush(); continue; }
    cur.push(line);
  }
  flush();
  const out = [];
  for (const block of blocks) {
    const body = block.join('\n').trim();
    if (!body) continue;
    let title = '';
    for (const line of block) {
      const hit = line.match(/^\s*(题目|题干|question)\s*[:：]\s*(.+)$/i);
      if (hit) { title = hit[2].trim(); break; }
    }
    if (!title) {
      const first = block.find((line) => line.trim());
      title = first ? first.trim() : '';
    }
    out.push(title);
  }
  return out;
}

function batchTool(config) {
  return {
    name: 'mb_batch',
    description: '批量导入错题。默认只预览不写库（preview 默认 true）：先看要入几道、标题对不对，确认后传 preview:false 才真正入库。text 里每题用一行 --- 分隔，块内写 键: 值（题目/答案/解析/我的答案/错因分类/来源/知识点/标签/学科/难度）。也可以直接传 items 数组。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '多道题的纯文本，每题之间用单独一行 --- 分隔' },
        items: { type: 'array', description: '结构化数组，每项字段同单题录入（question 必填）', items: { type: 'object' } },
        preview: { type: 'boolean', description: 'true（默认）= 只解析回显、不写库；false = 真正入库' },
      },
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const items = Array.isArray(args.items) ? args.items : [];
      const text = typeof args.text === 'string' ? args.text : '';
      if (!items.length && !text.trim()) throw new Error('text 和 items 至少要给一个');
      if (args.preview !== false) {
        const titles = items.length
          ? items.map((item) => String((item && item.question) || '').trim())
          : previewBlocks(text);
        const lines = ['批量导入预览（还没写库）', '共 ' + titles.length + ' 道：'];
        titles.slice(0, 10).forEach((title, index) => {
          lines.push('  ' + (index + 1) + '. ' + (clip(title, 60) || '（没识别到题干）'));
        });
        if (titles.length > 10) lines.push('  …… 还有 ' + (titles.length - 10) + ' 道');
        lines.push('确认无误后，用同样的内容再调一次，带 preview:false 才会真正入库。');
        return { text: lines.join('\n') };
      }
      const body = items.length ? { items } : { text };
      const data = await call(s, '/api/mistakes/batch', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const created = (data && data.created) || [];
      const duplicates = (data && data.duplicates) || [];
      const errors = (data && data.errors) || [];
      const lines = ['批量导入完成：成功 ' + created.length + ' 道 · 重复跳过 ' + duplicates.length
        + ' 道 · 失败 ' + errors.length + ' 道'];
      if (created.length) {
        lines.push('新入库：' + created.map((item) => '#' + item.id).join(' '));
      }
      if (duplicates.length) {
        lines.push('判定重复（3 秒内同题干）：' + duplicates.map((item) => '#' + item.id).join(' '));
      }
      if (errors.length) {
        lines.push('失败明细：');
        errors.slice(0, 10).forEach((item) => {
          lines.push('  第 ' + (item.index + 1) + ' 条：' + oneLine(item.error));
        });
      }
      return { text: lines.join('\n') };
    },
  };
}

function paperTool(config) {
  return {
    name: 'mb_paper',
    description: '组一张错题重做卷，返回可打印的链接（浏览器打开后 Ctrl+P 就能存 PDF）。可指定题量、排序（weak 最弱优先 / random / recent / oldest）、模式（question 只出题 / answer 题目+答案 / split 题答分栏），也能按学科、知识点、错因、标签、状态筛选。',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number', description: '题量，1-100，默认 10' },
        order: { type: 'string', description: 'weak（默认，最弱优先）/ random / recent / oldest' },
        mode: { type: 'string', description: 'question（默认）/ answer / split' },
        title: { type: 'string', description: '卷面标题，默认「错题重做卷」' },
        subject: { type: 'string', description: '只出这个学科的题' },
        knowledge: { type: 'string', description: '只出这个知识点的题' },
        kdeep: { type: 'boolean', description: '知识点是否含子节点，默认 true' },
        type: { type: 'string', description: '错因分类筛选' },
        tag: { type: 'string', description: '标签筛选' },
        status: { type: 'string', description: 'new / reviewing / mastered' },
        due: { type: 'boolean', description: '只要今天到期的' },
        images: { type: 'boolean', description: '是否带上题目图片，默认 true' },
        analysis: { type: 'boolean', description: '是否带解析，默认 false' },
        blank: { type: 'number', description: '留白高度（px），默认 56' },
      },
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const params = {
        count: clampInt(args.count, 10, 1, 100),
        order: String(args.order || 'weak').trim(),
        mode: String(args.mode || 'question').trim(),
        title: typeof args.title === 'string' ? args.title.trim() : '',
        subject: typeof args.subject === 'string' ? args.subject.trim() : '',
        knowledge: typeof args.knowledge === 'string' ? args.knowledge.trim() : '',
        kdeep: args.knowledge ? (args.kdeep === false ? 0 : 1) : '',
        type: typeof args.type === 'string' ? args.type.trim() : '',
        tag: typeof args.tag === 'string' ? args.tag.trim() : '',
        status: typeof args.status === 'string' ? args.status.trim() : '',
        due: args.due ? 1 : '',
        images: args.images === false ? 0 : 1,
        analysis: args.analysis ? 1 : 0,
        blank: clampInt(args.blank, 56, 0, 400),
      };
      const data = await call(s, '/api/paper' + query(params));
      const items = (data && data.items) || [];
      const link = s.url + '/print' + query(params);
      const lines = ['已组卷：' + (data && data.count || items.length) + ' 道（'
        + (data && data.order_label || params.order) + ' · '
        + (data && data.mode_label || params.mode) + ' · 标题「'
        + (data && data.title || '错题重做卷') + '」）'];
      if (data && data.available !== undefined) {
        lines.push('题库可用 ' + data.available + ' 道，本次取了 ' + (data.count || items.length) + ' 道。');
      }
      lines.push('打印 / 存 PDF：' + link);
      if (items.length) {
        lines.push('卷面题目：');
        items.slice(0, 10).forEach((item, index) => {
          lines.push('  ' + (index + 1) + '. ' + (clip(oneLine(item.question), 60) || ''));
        });
        if (items.length > 10) lines.push('  …… 还有 ' + (items.length - 10) + ' 道');
      }
      return { text: lines.join('\n') };
    },
  };
}

function reportTool(config) {
  return {
    name: 'mb_report',
    description: '生成一份学习周报：这段时间新增多少、复习多少次、正确率、库存分布、今天该复习几道、最弱知识点、最常错的步骤、再战区情况。一次调用拉齐 stats/analytics/mastery/plan/arena 五个接口。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '统计窗口天数，1-90，默认 7' },
      },
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const days = clampInt(args.days, 7, 1, 90);
      const results = await Promise.all([
        call(s, '/api/stats'),
        call(s, '/api/analytics' + query({ days })),
        call(s, '/api/mastery'),
        call(s, '/api/plan' + query({ days: 7 })),
        call(s, '/api/arena'),
      ]);
      const stats = results[0] || {};
      const ana = results[1] || {};
      const mas = results[2] || {};
      const plan = results[3] || {};
      const arenaData = results[4] || {};
      const totals = ana.trend_totals || {};
      const reviews = stats.reviews || {};
      const accuracy = typeof reviews.accuracy === 'number'
        ? Math.round(reviews.accuracy * 100) + '%' : '—';
      const lines = ['学习周报 · 近 ' + days + ' 天'];
      lines.push('这段时间：新增 ' + (totals.created || 0) + ' 道 · 复习 '
        + (totals.reviewed || 0) + ' 次 · 正确率 ' + accuracy);
      lines.push('题库：共 ' + (stats.total || 0) + ' 道（已掌握 ' + (stats.mastered || 0)
        + ' / 复习中 ' + (stats.reviewing || 0) + ' / 到期 ' + (stats.due || 0)
        + ' / 斩题 ' + (stats.suspended || 0) + '）');
      lines.push('今天该复习 ' + (plan.today_count || 0) + ' 道（逾期 '
        + (plan.overdue || 0) + ' 道）· 未来 7 天共 ' + (plan.total || 0) + ' 道');
      if (mas.points_total) {
        lines.push('掌握门禁：' + (mas.passed_total || 0) + ' / ' + mas.points_total
          + ' 个知识点通过');
      }
      const weakest = (ana.retention && ana.retention.weakest) || [];
      if (weakest.length) {
        lines.push('最该补的知识点（按留存预测，越低越该练）：');
        weakest.slice(0, 5).forEach((item, index) => {
          const name = item.knowledge || item.subject || ('#' + item.id);
          lines.push('  ' + (index + 1) + '. ' + name + ' · R≈' + item.retention
            + ' · 稳定度 ' + item.stability + ' 天');
        });
      }
      const steps = (ana.by_step || []).slice(0, 5);
      if (steps.length) {
        lines.push('最常卡住的步骤：' + steps.map((item) => item.name + ' ' + item.count + ' 次').join(' · '));
      }
      const counts = arenaData.counts || {};
      if (counts.tracked) {
        lines.push('再战区：在区 ' + (counts.zone || 0) + ' 道 · 已清 ' + (counts.cleared || 0) + ' 道');
      }
      return { text: lines.join('\n') };
    },
  };
}

function suggestTool(config) {
  return {
    name: 'mb_suggest',
    description: '查知识点 / 学科 / 标签 / 来源里的近重复与无效值，只给建议、不改库。典型脏数据：111、2、单字、全半角或空格写法不一致（函数 单调性 vs 函数/单调性）、来源写成「4」或「期中考」。拿到建议后用 mb_merge 执行合并。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'knowledge（默认）/ subject / tag / source' },
        limit: { type: 'number', description: '最多给多少组建议，默认 20' },
      },
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const kind = String(args.kind || 'knowledge').trim().toLowerCase();
      const limit = clampInt(args.limit, 20, 1, 100);
      const meta = await call(s, '/api/meta');
      const list = facetsOf(meta, kind);
      const label = { knowledge: '知识点', subject: '学科', tag: '标签', source: '来源' }[kind] || kind;
      if (!list.length) return { text: '库里还没有任何' + label + '。' };
      const junk = list.filter((item) => junkName(item.name));
      const pairs = [];
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const score = similarName(list[i].name, list[j].name);
          if (score > 0) pairs.push({ a: list[i], b: list[j], score });
        }
      }
      pairs.sort((x, y) => y.score - x.score);
      const lines = ['「' + label + '」体检（共 ' + list.length + ' 个值，只建议不改库）'];
      if (junk.length) {
        lines.push('疑似无效值（纯数字或单字）：');
        junk.slice(0, 10).forEach((item) => {
          lines.push('  「' + item.name + '」' + item.count + ' 道 → 建议清空：mb_merge kind='
            + kind + ' sources=["' + item.name + '"] target=""');
        });
      }
      const shown = pairs.slice(0, limit);
      if (shown.length) {
        lines.push('疑似重复（归一化后很像）：');
        shown.forEach((pair) => {
          const keep = pair.a.count >= pair.b.count ? pair.a : pair.b;
          const drop = keep === pair.a ? pair.b : pair.a;
          lines.push('  「' + drop.name + '」' + drop.count + ' 道 ≈ 「' + keep.name + '」'
            + keep.count + ' 道（相似度 ' + pair.score.toFixed(2) + '）');
          lines.push('     → 建议并到「' + keep.name + '」：mb_merge kind=' + kind
            + ' sources=["' + drop.name + '"] target="' + keep.name + '"');
        });
      }
      if (!junk.length && !shown.length) lines.push('没有发现明显的重复或无效值。');
      return { text: lines.join('\n') };
    },
  };
}

/**
 * v0.51 AI 学习简报：今天最该练哪几道 + 为什么。
 * 后端 /api/brief 已经算好排序与理由，这里只负责排版成人话 ——
 * 模型拿到「逾期 3 天」「第 4 次错在计算」这类句子才讲得出诊断，拿到裸数字只能念报表。
 */
function briefTool(config) {
  return {
    name: 'mb_brief',
    description: '生成今日学习简报：今天最该练的几道题（带「为什么是它」的理由）、反复栽的断点、最弱知识点。复习开场先调它，比 mb_due 只给清单更有指导性。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        days: { type: 'integer', description: '统计窗口天数，默认 14，范围 7-90' },
        limit: { type: 'integer', description: '最多挑几道，默认 3，范围 1-10' },
      },
      required: [],
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const days = clampInt(args.days, 14, 7, 90);
      const limit = clampInt(args.limit, 3, 1, 10);
      const data = await call(s, '/api/brief' + query({ days, limit }));
      const counts = data.counts || {};
      const items = Array.isArray(data.items) ? data.items : [];
      const patterns = Array.isArray(data.patterns) ? data.patterns : [];
      const weak = Array.isArray(data.weak_points) ? data.weak_points : [];
      const lines = ['AI 学习简报 · 近 ' + (data.window_days || days) + ' 天'];

      const head = '今天到期 ' + (counts.due_today || 0) + ' 道';
      const extra = [];
      if (counts.overdue) extra.push('逾期 ' + counts.overdue + ' 道');
      extra.push('在库活跃 ' + (counts.active || 0) + ' 道');
      lines.push(head + '（' + extra.join(' · ') + '）');
      if (counts.graded_with_hints) {
        const rate = typeof counts.hint_free_correct === 'number'
          ? Math.round(counts.hint_free_correct * 100) : null;
        lines.push('零提示做对率：' + (rate === null ? '—' : rate + '%')
          + '（' + counts.graded_with_hints + ' 次有记录）');
      } else {
        lines.push('零提示做对率：还没有记录（用 mb_review 的 hints 参数记一次就有了）');
      }

      lines.push('', items.length ? '今天最该练：' : '今天没有到期题。');
      for (const item of items) {
        lines.push('  #' + item.id + ' [' + (item.subject || '未分类')
          + (item.knowledge ? ' · ' + item.knowledge : '') + '] '
          + clip(item.question, 60));
        if (item.reason) lines.push('     为什么：' + item.reason);
      }

      if (patterns.length) {
        lines.push('', '反复栽的断点：');
        for (const row of patterns) {
          lines.push('  「' + (row.knowledge || '?') + '」第 ' + (row.count || 0)
            + ' 次错在「' + (row.step || '?') + '」');
        }
      }

      if (weak.length) {
        lines.push('', '最弱的知识点：');
        for (const point of weak) {
          const accuracy = typeof point.accuracy === 'number'
            ? Math.round(point.accuracy * 100) + '%' : '—';
          lines.push('  「' + (point.knowledge || '?') + '」正确率 ' + accuracy
            + '（' + (point.mistakes || 0) + ' 道 / ' + (point.graded || 0) + ' 次）');
        }
      }

      if (data.note) lines.push('', '建议：' + data.note);
      const sample = data.sample;
      if (sample && sample.enough === false && sample.note) lines.push('（' + sample.note + '）');
      return { text: lines.join('\n') };
    },
  };
}

/** 一次性诊断：把「今天练什么 / 哪里弱 / 老栽在哪」合成一段，省掉三次往返。 */
function diagnoseTool(config) {
  return {
    name: 'mb_diagnose',
    description: '一次问清「我现在最该补什么」：今天先练哪几道（带理由）、最弱知识点、反复栽的断点、复习量与零提示做对率，末尾一句下一步。省掉分别调 mb_brief / mb_weak_steps / mb_stats。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        days: { type: 'integer', description: '统计窗口天数 7-90，默认 30' },
        limit: { type: 'integer', description: '今天先练几道，默认 3，范围 1-10' },
      },
      required: [],
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const days = clampInt(args.days, 30, 7, 90);
      const limit = clampInt(args.limit, 3, 1, 10);
      // 两个都是只读 GET，可以并发：诊断要在一次工具调用里问完，不该串成三轮
      const [head, report] = await Promise.all([
        call(s, '/api/brief' + query({ days, limit })),
        call(s, '/api/analytics' + query({ days })),
      ]);
      const counts = head.counts || {};
      const items = Array.isArray(head.items) ? head.items : [];
      const weak = Array.isArray(head.weak_points) ? head.weak_points : [];
      const patterns = Array.isArray(head.patterns) ? head.patterns : [];
      const byStep = Array.isArray(report.by_step) ? report.by_step : [];
      const sample = report.sample || head.sample || null;

      const lines = ['诊断 · 近 ' + (head.window_days || days) + ' 天'];
      const stock = ['在库活跃 ' + (counts.active || 0) + ' 道',
        '今天到期 ' + (counts.due_today || 0) + ' 道'];
      if (counts.overdue) stock.push('其中逾期 ' + counts.overdue + ' 道');
      lines.push(stock.join(' · '));

      const reviews = sample && typeof sample.reviews === 'number' ? sample.reviews : null;
      const rate = counts.graded_with_hints && typeof counts.hint_free_correct === 'number'
        ? Math.round(counts.hint_free_correct * 100) + '%（' + counts.graded_with_hints + ' 次有记录）'
        : '还没有记录';
      lines.push('复习量 ' + (reviews === null ? '—' : reviews + ' 次') + ' · 零提示做对率 ' + rate);

      if (items.length) {
        lines.push('', '今天先练：');
        for (const item of items) {
          lines.push('  #' + item.id + ' [' + (item.subject || '未分类')
            + (item.knowledge ? ' · ' + item.knowledge : '') + '] ' + clip(item.question, 50));
          if (item.reason) lines.push('     为什么：' + item.reason);
        }
      } else {
        // 空库和「今天刚好没到期」是两件事：前者该指路，后者该给自由
        lines.push('', counts.active === 0
          ? '题库还是空的 —— 先录第一道。'
          : '今天没有到期题 —— 想练就自己挑，或用 mb_search 按知识点找。');
      }

      if (weak.length) {
        lines.push('', '最弱的知识点：');
        for (const point of weak.slice(0, 3)) {
          const accuracy = typeof point.accuracy === 'number'
            ? Math.round(point.accuracy * 100) + '%' : '—';
          lines.push('  「' + (point.knowledge || '?') + '」正确率 ' + accuracy
            + '（' + (point.mistakes || 0) + ' 道 / ' + (point.graded || 0) + ' 次）');
        }
      }

      if (patterns.length) {
        lines.push('', '反复栽的断点：');
        for (const row of patterns.slice(0, 3)) {
          lines.push('  「' + (row.knowledge || '?') + '」第 ' + (row.count || 0)
            + ' 次错在「' + (row.step || '?') + '」');
        }
      } else if (byStep.length) {
        const top = byStep.slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 2);
        lines.push('', '断点分布：' + top.map((row) => (row.name || '?') + ' ' + (row.count || 0) + ' 次').join(' · '));
      }

      const advice = counts.active === 0
        ? '面板点「＋ 新建」录一道，或者把题目/截图发我，我用 mb_add 帮你录。'
        : head.note
          || (sample && sample.enough === false ? '先把量做起来：连续两周每天做完到期题，再看趋势。' : '');
      if (advice) lines.push('', '下一步：' + advice);
      // 空库时不念「样本还少」—— 一道题都没有，谈样本量没有意义
      if (counts.active !== 0 && sample && sample.enough === false && sample.note) {
        lines.push('（' + sample.note + '）');
      }
      return { text: lines.join('\n') };
    },
  };
}

function mergeTool(config) {
  return {
    name: 'mb_merge',
    description: '把若干个知识点 / 学科 / 标签 / 来源并成一个规范名（就是「合并」）。kind=knowledge 走知识点合并（会顺带登记别名，以后写错写法自动归到规范名）；kind=subject / tag / source 走扁平值合并。target 留空 = 删除这些值（知识点清空、学科变未分类、标签消失、来源清空）。不可逆，执行前先 mb_suggest 看建议。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'knowledge（默认）/ subject / tag / source' },
        sources: { type: 'array', description: '要并掉的旧名数组，例如 ["111","函数 单调性"]', items: { type: 'string' } },
        target: { type: 'string', description: '合并到的规范名；留空表示删除这些值' },
      },
      required: ['sources'],
    },
    output: out(),
    async execute(args) {
      const s = settings(config);
      const kind = String(args.kind || 'knowledge').trim().toLowerCase();
      const sources = Array.isArray(args.sources)
        ? args.sources.map((item) => String(item || '').trim()).filter(Boolean) : [];
      const target = typeof args.target === 'string' ? args.target.trim() : '';
      if (!sources.length) throw new Error('sources 必须是非空的名称数组');
      if (kind !== 'knowledge' && kind !== 'subject' && kind !== 'tag' && kind !== 'source') {
        throw new Error('kind 只能是 knowledge / subject / tag / source');
      }
      const path = kind === 'knowledge' ? '/api/knowledge/merge' : '/api/meta/merge';
      const body = kind === 'knowledge'
        ? { sources, target }
        : { kind, sources, target };
      const data = await call(s, path, { method: 'POST', body: JSON.stringify(body) });
      // 服务端 moved 是「改了多少道」的数字，题号在 ids 里 —— 别把数字当数组用。
      const movedCount = data && typeof data.moved === 'number' ? data.moved : 0;
      const movedIds = data && Array.isArray(data.ids) ? data.ids : [];
      const lines = [];
      if (target) {
        lines.push('已把 ' + sources.length + ' 个值并到「' + target + '」');
      } else {
        lines.push('已清空 ' + sources.length + ' 个值：' + sources.join('、'));
      }
      lines.push('改动题目 ' + movedCount + ' 道'
        + (data && data.aliases_added ? ' · 新登记别名 ' + data.aliases_added + ' 个' : ''));
      if (movedIds.length) lines.push('题号：' + movedIds.slice(0, 20).map((id) => '#' + id).join(' ')
        + (movedIds.length > 20 ? ' ……' : ''));
      return { text: lines.join('\n') };
    },
  };
}

/**
 * 把 13 个工具注册到 agent 的工具面。
 * @param {any} ctx cordis 上下文，用到 tools 一个成员。
 * @param {any} config 插件行 config 段（url / home / python）。
 */
export function apply(ctx, config) {
  const builders = [dueTool, searchTool, getTool, addTool, reviewTool, briefTool, diagnoseTool, statsTool,
    weakStepsTool, eventsTool, batchTool, paperTool, reportTool, suggestTool, mergeTool];
  for (const build of builders) ctx.tools.register(build(config));
}
