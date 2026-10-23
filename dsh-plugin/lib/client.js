// 错题本 DSH 插件 —— 客户端半（面板）。
//
// 注册契约（在本机 0.2.0-rc.2 上核对，与 @yunmiao/studymate 的 client.js 同一口径）：
//   · 入口由 package.json 的 exports["./client"] 指到这里，宿主从 dsh.client 声明里发现它；
//   · 本文件只做两件事：window.__ModuleLoader__.load() 登记工厂，工厂返回 { inject, apply }；
//   · 工厂体在**物化时**才执行，所以样式注入放工厂里是安全的；
//   · 模块表只有 9 个键，这里只用 react —— 按插件规范不 require 任何 Harness 客户端包。
//
// 占的座位：
//   · main（keyed/root，整块中央面板）—— 错题本本体；
//   · sidebar.panellist —— 左栏那一行入口，点它由 sidebar 调 ctx.layout.selectPanel('mistake-book')。
//
// 数据全走本机错题本服务的 /api/*（与网页版同一份接口）：
//   GET  /api/stats                        统计条
//   GET  /api/mistakes?due=1&page_size=50  到期列表（scope=all 时去掉 due）
//   GET  /api/mistakes/<id>                详情（含答案与解析）
//   POST /api/mistakes/<id>/review         四档评分，回写 FSRS
//   GET  /api/mistakes/<id>/reviews        这道题的复习历史
//   POST /api/mistakes                     面板里直接录一道新题
//   GET  /api/meta                         学科/知识点/错因分类/来源的候选值
//   GET  /api/analytics?days=N             趋势 / 保持度分桶 / 错因分布 / 薄弱知识点
//   POST /api/mistake-book/session         请**宿主半**按「错题复习」预设建一条会话
//
// 最后那条为什么必须走宿主：浏览器的 sessions.create 只序列化 {workspaceId, cwd, sessionId}，
// 会把 agentPreset 静默丢掉——面板建出来的会话不带复习预设，工具面与 persona 全都不在。
window.__ModuleLoader__.load({
  id: 'dsh-mistake-book',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useCallback, useRef } = React;

    /** 面板 id：侧栏那行的 id、main 座位的 key，都是它。 */
    const PANEL_ID = 'mistake-book';
    /** retain 用的来源标签。绝不能是 'mainView'：宿主的 ui-session / ui-layout 拿它判「谁是当前会话」。 */
    const RETAIN_SOURCE = 'mistakeBook';
    /** 请宿主建会话的路由（宿主半在 lib/session.js）。 */
    const SESSION_ENDPOINT = '/api/mistake-book/session';
    /**
     * 数据代理路由（宿主半在 lib/proxy.js）。
     * 面板与错题本服务不同源，app.py 又不发 CORS 头——浏览器直连 8000 会被同源策略拦掉，
     * 所以列表 / 详情 / 评分都走这条宿主路由，真实路径放在 ?path= 里。
     */
    const DATA_ENDPOINT = '/api/mistake-book/data';
    /** 结构化断点候选，与 app.py 的 REVIEW_STEPS 一致。 */
    const STEPS = ['审题', '建模', '计算', '检验', '表达', '记忆'];

    /**
     * hyperscript：h('div.cls', props, ...kids)。
     * 不能直接用 createElement —— 它会把 'div.cls' 整个当标签名，造出 classless 的未知元素：
     * CSS 一条都不生效、DOM 里却看着还在（踩过，排查极费劲）。
     */
    function h(sel, props, ...kids) {
      if (typeof sel !== 'string') return React.createElement(sel, props, ...kids);
      const parts = String(sel).split('.');
      const tag = parts[0] || 'div';
      const classes = parts.slice(1);
      if (!classes.length) return React.createElement(tag, props, ...kids);
      const merged = Object.assign({}, props);
      merged.className = [classes.join(' '), props && props.className].filter(Boolean).join(' ');
      return React.createElement(tag, merged, ...kids);
    }

    const CSS = [
      '.mb{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;color:inherit}',
      '.mb-head{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--mb-line,rgba(127,127,127,.22));flex:0 0 auto}',
      '.mb-title{font-weight:600;font-size:15px;letter-spacing:.2px}',
      '.mb-stats{color:var(--mb-dim,rgba(127,127,127,.95));font-size:12px}',
      '.mb-spacer{flex:1}',
      '.mb-btn{height:28px;padding:0 10px;border-radius:7px;border:1px solid var(--mb-line,rgba(127,127,127,.3));background:transparent;color:inherit;font-size:12px;cursor:pointer;font-family:inherit}',
      '.mb-btn:hover{background:var(--mb-hover,rgba(127,127,127,.12))}',
      '.mb-btn:disabled{opacity:.45;cursor:default}',
      '.mb-btn.primary{background:var(--mb-accent,#3b6ef0);border-color:transparent;color:#fff}',
      '.mb-btn.primary:hover{filter:brightness(1.06);background:var(--mb-accent,#3b6ef0)}',
      '.mb-seg{display:inline-flex;border:1px solid var(--mb-line,rgba(127,127,127,.3));border-radius:7px;overflow:hidden}',
      '.mb-seg button{height:26px;padding:0 10px;border:0;background:transparent;color:inherit;font-size:12px;cursor:pointer;font-family:inherit}',
      '.mb-seg button.on{background:var(--mb-hover,rgba(127,127,127,.18));font-weight:600}',
      '.mb-body{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);flex:1;min-height:0;overflow:hidden}',
      '.mb-list{overflow:auto;border-right:1px solid var(--mb-line,rgba(127,127,127,.22));padding:6px}',
      '.mb-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;font-family:inherit;font-size:13px;padding:9px 10px;border-radius:8px;cursor:pointer;border-left:2px solid transparent}',
      '.mb-item:hover{background:var(--mb-hover,rgba(127,127,127,.1))}',
      '.mb-item.on{background:var(--mb-hover,rgba(127,127,127,.16));border-left-color:var(--mb-accent,#3b6ef0)}',
      '.mb-q{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.45}',
      '.mb-meta{display:flex;gap:6px;align-items:center;margin-top:4px;font-size:11px;color:var(--mb-dim,rgba(127,127,127,.95));flex-wrap:wrap}',
      '.mb-dot{width:5px;height:5px;border-radius:50%;background:#e0574a;flex:0 0 auto}',
      '.mb-detail{overflow:auto;padding:16px 18px;min-width:0}',
      '.mb-empty{padding:28px 18px;color:var(--mb-dim,rgba(127,127,127,.95));text-align:center;font-size:13px;line-height:1.7}',
      '.mb-block{margin:0 0 14px}',
      '.mb-label{font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:var(--mb-dim,rgba(127,127,127,.95));margin-bottom:5px}',
      '.mb-text{white-space:pre-wrap;line-height:1.65;word-break:break-word}',
      '.mb-panel{border:1px solid var(--mb-line,rgba(127,127,127,.22));border-radius:9px;padding:12px 14px;background:var(--mb-subtle,rgba(127,127,127,.05))}',
      '.mb-reveal{display:flex;align-items:center;gap:8px;margin:6px 0 14px}',
      '.mb-step{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--mb-dim,rgba(127,127,127,.95))}',
      '.mb-step select{height:30px}',
      '.mb-rate{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:8px}',
      '.mb-rate button{height:36px;border-radius:8px;border:1px solid var(--mb-line,rgba(127,127,127,.3));background:transparent;color:inherit;font-family:inherit;font-size:12px;cursor:pointer}',
      '.mb-rate button:hover{background:var(--mb-hover,rgba(127,127,127,.12))}',
      '.mb-rate button b{display:block;font-size:13px;font-weight:600}',
      '.mb-rate button span{display:block;font-size:10px;color:var(--mb-dim,rgba(127,127,127,.95));margin-top:1px}',
      '.mb-note{margin-top:10px;font-size:12px;color:#2f9e5f}',
      '.mb-note.bad{color:#d0533f}',
      '.mb-ai{display:flex;flex-direction:column;flex:1;min-height:0}',
      '.mb-aibar{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--mb-line,rgba(127,127,127,.22));flex:0 0 auto}',
      '.mb-aititle{font-size:12px;color:var(--mb-dim,rgba(127,127,127,.95));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mb-conv{flex:1;min-height:0;overflow:auto}',
      '.mb-toolbar{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--mb-line,rgba(127,127,127,.22));flex:0 0 auto;flex-wrap:wrap}',
      '.mb-input{height:28px;border-radius:7px;border:1px solid var(--mb-line,rgba(127,127,127,.3));background:transparent;color:inherit;font-family:inherit;font-size:12px;padding:0 8px;min-width:0}',
      '.mb-input:focus{outline:2px solid var(--mb-accent,#3b6ef0);outline-offset:-1px}',
      'input.mb-input{flex:1 1 170px;min-width:120px}',
      'select.mb-input{flex:0 1 auto;max-width:150px}',
      '.mb-form{overflow:auto;padding:16px 18px;display:grid;gap:12px;align-content:start}',
      '.mb-field{display:grid;gap:5px;min-width:0}',
      '.mb-field>span{font-size:11px;letter-spacing:.3px;color:var(--mb-dim,rgba(127,127,127,.95))}',
      '.mb-form textarea,.mb-form input,.mb-form select{width:100%;box-sizing:border-box;border-radius:8px;border:1px solid var(--mb-line,rgba(127,127,127,.3));background:transparent;color:inherit;font-family:inherit;font-size:13px;padding:7px 9px;min-width:0}',
      '.mb-form textarea{resize:vertical;min-height:64px;line-height:1.55}',
      '.mb-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.mb-formfoot{display:flex;gap:8px;align-items:center;padding-top:2px;flex-wrap:wrap}',
      '.mb-chart{display:flex;align-items:flex-end;gap:2px;height:92px;padding-top:6px}',
      '.mb-col{flex:1 1 0;min-width:0;display:flex;align-items:flex-end;gap:1px;height:100%}',
      '.mb-bar{flex:1 1 0;min-width:1px;border-radius:2px 2px 0 0;background:#3b6ef0;opacity:.85}',
      '.mb-bar.r{background:#2f9e5f}',
      '.mb-axis{display:flex;justify-content:space-between;font-size:10px;color:var(--mb-dim,rgba(127,127,127,.95));margin-top:4px}',
      '.mb-legend{display:flex;gap:14px;font-size:11px;color:var(--mb-dim,rgba(127,127,127,.95));margin-top:6px}',
      '.mb-swatch{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:-1px}',
      '.mb-brow{display:grid;grid-template-columns:60px minmax(0,1fr) 34px;gap:8px;align-items:center;font-size:12px;margin-bottom:6px}',
      '.mb-track{height:8px;border-radius:4px;background:var(--mb-hover,rgba(127,127,127,.16));overflow:hidden}',
      '.mb-fill{height:100%;border-radius:4px;background:#3b6ef0}',
      '.mb-chip{display:inline-flex;gap:5px;align-items:center;border:1px solid var(--mb-line,rgba(127,127,127,.3));border-radius:999px;padding:2px 9px;font-size:11px;margin:0 6px 6px 0}',
      '.mb-hrow{display:flex;gap:8px;align-items:baseline;font-size:12px;padding:4px 0;border-bottom:1px dashed var(--mb-line,rgba(127,127,127,.18))}',
      '.mb-hrow:last-child{border-bottom:0}',
      '.mb-htime{color:var(--mb-dim,rgba(127,127,127,.95));font-size:11px;min-width:78px;flex:0 0 auto}',
      '@media(max-width:760px){.mb-row2{grid-template-columns:1fr}}',
      '@media(max-width:760px){.mb-body{grid-template-columns:minmax(0,1fr)}.mb-list{max-height:38%;border-right:0;border-bottom:1px solid var(--mb-line,rgba(127,127,127,.22))}}',
    ].join('');

    function injectStyles(css) {
      if (typeof document === 'undefined') return;
      const id = 'dsh-mistake-book-css';
      if (document.getElementById(id)) return;
      const style = document.createElement('style');
      style.id = id;
      style.textContent = css;
      document.head.appendChild(style);
    }

    /* ── 数据 ─────────────────────────────────────────────────────────── */

    /** 调一条本机接口，拆掉 {ok,data} 信封只回 data；失败抛带人话的错误。 */
    async function api(path, init) {
      let response;
      try {
        response = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, init || {}));
      } catch (error) {
        throw new Error('连不上错题本服务：' + String((error && error.message) || error));
      }
      const raw = await response.text();
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      if (!response.ok) {
        const detail = body && body.error;
        throw new Error(detail && detail.message ? detail.message : 'HTTP ' + response.status + ' ' + raw.slice(0, 200));
      }
      return body && typeof body === 'object' && 'data' in body ? body.data : body;
    }

    /** 走宿主代理读/写本机错题本服务（跨源直连会被浏览器拦掉，见 DATA_ENDPOINT 注释）。 */
    function data(path, init) {
      return api(DATA_ENDPOINT + '?path=' + encodeURIComponent(path), init);
    }

    /** 题干摘要（列表里一行两行）。 */
    function clip(text, max) {
      const value = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
      return value.length > max ? value.slice(0, max) + '…' : value;
    }

    /** 日期只留 月-日。 */
    function dayOf(stamp) {
      const text = String(stamp || '');
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
      return match ? match[2] + '-' + match[3] : text;
    }

    /* ── 宿主服务 ─────────────────────────────────────────────────────── */

    /** 只能在 apply(ctx) 里拿的宿主服务（不是 props）。取不到给 null，调用方按「这个宿主没有」处理。 */
    const hostServices = { sessions: null };

    function hostService(ctx, name) {
      try {
        if (ctx && typeof ctx.get === 'function') {
          const got = ctx.get(name);
          if (got) return got;
        }
      } catch (error) { /* 服务不在或取值就抛：走兜底 */ }
      try { return (ctx && ctx[name]) || null; } catch (error) { return null; }
    }

    /* ── 会话面板（右栏换成宿主自己的会话正文）──────────────────────────── */

    /**
     * 把宿主的一条会话嵌进面板：retain 它 → 用框架给的 SessionProvider 罩住 →
     * 渲染 conversation.content（variant:'embedded'：不带主 Header 与宽度手柄，composer 一起给）。
     * 多轮、流式、滚动、草稿、Enter 发送全归宿主；我们只管「引住哪一条」。
     */
    function AiPane(props) {
      const SessionProvider = props.SessionProvider;
      const renderFactorySlot = props.renderFactorySlot;
      const sessionId = props.sessionId;
      const title = props.title;
      const onBack = props.onBack;
      const sessions = hostServices.sessions;
      const [held, setHeld] = useState(null);
      const [error, setError] = useState('');

      useEffect(() => {
        if (!sessionId) return undefined;
        if (!sessions || typeof sessions.retain !== 'function') {
          setError('这个宿主没把会话服务交给插件（sessions 不在）：嵌不进会话');
          return undefined;
        }
        let reference = null;
        try {
          reference = sessions.retain(sessionId, { source: RETAIN_SOURCE });
        } catch (failure) {
          setError('这条会话引不住：' + String((failure && failure.message) || failure));
          return undefined;
        }
        setHeld({ id: sessionId, reference });
        return () => {
          try { if (reference && typeof reference.release === 'function') reference.release(); } catch (ignored) { /* 释放失败不值得弄崩界面 */ }
        };
      }, [sessionId, sessions]);

      const live = held && held.id === sessionId ? held : null;
      if (error) {
        return h('div.mb-ai', null,
          h('div.mb-aibar', null, h('button.mb-btn', { onClick: onBack }, '← 返回题目'), h('span.mb-aititle', null, error)),
          h('div.mb-empty', null, error));
      }
      if (!live || !SessionProvider) {
        return h('div.mb-ai', null,
          h('div.mb-aibar', null, h('button.mb-btn', { onClick: onBack }, '← 返回题目')),
          h('div.mb-empty', null, '正在接入会话…'));
      }
      return h('div.mb-ai', null,
        h('div.mb-aibar', null,
          h('button.mb-btn', { onClick: onBack }, '← 返回题目'),
          h('span.mb-aititle', null, title || '')),
        h(SessionProvider, { session: live.reference },
          h('div.mb-conv', null,
            renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }))));
    }

    /* ── 复习历史 ─────────────────────────────────────────────────────── */

    /** 这道题历次复习（点开才拉，省一次请求）。 */
    function HistoryBlock(props) {
      const id = props.id;
      const count = props.count || 0;
      const [open, setOpen] = useState(false);
      const [log, setLog] = useState(null);
      const [error, setError] = useState('');

      useEffect(() => {
        if (!open || log) return undefined;
        let cancelled = false;
        data('/api/mistakes/' + id + '/reviews')
          .then((value) => { if (!cancelled) setLog(value); })
          .catch((failure) => { if (!cancelled) setError(String((failure && failure.message) || failure)); });
        return () => { cancelled = true; };
      }, [open, id, log]);

      const labels = { again: '忘了', hard: '模糊', good: '记得', easy: '简单' };
      const summary = log && typeof log.total === 'number'
        ? '复习 ' + log.total + ' 次' + (log.accuracy === null || log.accuracy === undefined
          ? '' : ' · 正确率 ' + Math.round(log.accuracy * 100) + '%')
        : count ? '复习 ' + count + ' 次' : '还没复习过';

      return h('div.mb-block', null,
        h('div.mb-label', null, '复习历史'),
        h('div.mb-reveal', null,
          h('button.mb-btn', {
            onClick: () => setOpen(!open),
            disabled: !count && !open,
          }, (open ? '收起' : '查看') + ' · ' + summary)),
        open ? h('div', null,
          error ? h('div.mb-note.bad', null, error) :
            !log ? h('div.mb-empty', null, '读取中…') :
              !log.items.length ? h('div.mb-empty', null, '还没有复习记录') :
                log.items.map((row) => h('div.mb-hrow', { key: row.id },
                  h('span.mb-htime', null, String(row.reviewed_at || '').slice(5, 16)),
                  h('span', null, (labels[row.result] || row.result || '') +
                    (row.step ? ' · 断点 ' + row.step : '')),
                  h('span.mb-meta', { style: { marginTop: '0', marginLeft: 'auto' } },
                    row.interval_days ? h('span', null, '间隔 ' + row.interval_days + ' 天') : null,
                    row.stage ? h('span', null, '· 阶段 ' + row.stage) : null)))) : null);
    }

    /* ── 新建错题 ─────────────────────────────────────────────────────── */

    /** 面板里直接录一道（POST /api/mistakes；题干是唯一必填，其余留空即不写）。 */
    function NewForm(props) {
      const meta = props.meta || {};
      const [form, setForm] = useState({
        question: '', my_answer: '', answer: '', analysis: '',
        subject: '', knowledge: '', mistake_type: '', source: '', tags: '', difficulty: '3',
      });
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');

      const set = (key) => (event) => setForm(Object.assign({}, form, { [key]: event.target.value }));
      const choices = (id, values) => h('datalist', { id },
        (values || []).map((value) => h('option', { key: value, value })));

      const save = async () => {
        if (!String(form.question).trim()) { setError('题目不能为空'); return; }
        setBusy(true);
        setError('');
        try {
          const body = Object.assign({}, form, { difficulty: Number(form.difficulty) || 3 });
          const item = await data('/api/mistakes', { method: 'POST', body: JSON.stringify(body) });
          props.onSaved(item);
        } catch (failure) {
          setError(String((failure && failure.message) || failure));
        } finally { setBusy(false); }
      };

      return h('div.mb-form', null,
        h('div.mb-field', null, h('span', null, '题目（必填）'),
          h('textarea', { value: form.question, onChange: set('question'), rows: 4, placeholder: '粘贴题干…' })),
        h('div.mb-row2', null,
          h('div.mb-field', null, h('span', null, '我的错误答案'),
            h('textarea', { value: form.my_answer, onChange: set('my_answer'), rows: 2 })),
          h('div.mb-field', null, h('span', null, '正确答案'),
            h('textarea', { value: form.answer, onChange: set('answer'), rows: 2 }))),
        h('div.mb-field', null, h('span', null, '解析'),
          h('textarea', { value: form.analysis, onChange: set('analysis'), rows: 3 })),
        h('div.mb-row2', null,
          h('div.mb-field', null, h('span', null, '学科'),
            h('input', { value: form.subject, onChange: set('subject'), list: 'mb-dl-subject' }),
            choices('mb-dl-subject', meta.subjects)),
          h('div.mb-field', null, h('span', null, '知识点'),
            h('input', { value: form.knowledge, onChange: set('knowledge'), list: 'mb-dl-knowledge' }),
            choices('mb-dl-knowledge', meta.knowledge))),
        h('div.mb-row2', null,
          h('div.mb-field', null, h('span', null, '错因分类'),
            h('select', { value: form.mistake_type, onChange: set('mistake_type') },
              h('option', { value: '' }, '（不填）'),
              (meta.mistake_types || []).map((value) => h('option', { key: value, value }, value)))),
          h('div.mb-field', null, h('span', null, '来源'),
            h('input', { value: form.source, onChange: set('source'), list: 'mb-dl-source' }),
            choices('mb-dl-source', meta.sources))),
        h('div.mb-row2', null,
          h('div.mb-field', null, h('span', null, '标签（逗号分隔）'),
            h('input', { value: form.tags, onChange: set('tags'), placeholder: '如：极限,洛必达' })),
          h('div.mb-field', null, h('span', null, '难度'),
            h('select', { value: form.difficulty, onChange: set('difficulty') },
              [1, 2, 3, 4, 5].map((n) => h('option', { key: n, value: String(n) }, n + ' 星'))))),
        h('div.mb-formfoot', null,
          h('button.mb-btn.primary', { onClick: () => void save(), disabled: busy }, busy ? '保存中…' : '保存'),
          h('button.mb-btn', { onClick: props.onCancel, disabled: busy }, '取消'),
          error ? h('span.mb-note.bad', null, error) : null));
    }

    /* ── 学习分析 ─────────────────────────────────────────────────────── */

    /** 趋势 / 保持度预测 / 薄弱知识点 / 错因与学科分布（GET /api/analytics）。 */
    function AnalyticsView() {
      const [days, setDays] = useState(30);
      const [report, setReport] = useState(null);
      const [error, setError] = useState('');

      useEffect(() => {
        let cancelled = false;
        data('/api/analytics?days=' + days)
          .then((value) => { if (!cancelled) { setReport(value); setError(''); } })
          .catch((failure) => { if (!cancelled) setError(String((failure && failure.message) || failure)); });
        return () => { cancelled = true; };
      }, [days]);

      if (error) return h('div.mb-empty', null, error);
      if (!report) return h('div.mb-empty', null, '统计中…');

      const trend = Array.isArray(report.trend) ? report.trend : [];
      const peak = Math.max(1, ...trend.map((row) => Math.max(row.created || 0, row.reviewed || 0)));
      const totals = report.trend_totals || {};
      const retention = report.retention || { counts: [], total: 0 };
      const buckets = Array.isArray(retention.counts) ? retention.counts : [];
      const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.count || 0));
      const weak = Array.isArray(report.weak_points) ? report.weak_points : [];
      const types = Array.isArray(report.by_type) ? report.by_type : [];
      const subs = Array.isArray(report.by_subject) ? report.by_subject : [];

      return h('div.mb-detail', null,
        h('div.mb-block', null,
          h('div.mb-label', null, '统计窗口'),
          h('div.mb-seg', null,
            [7, 30, 90].map((n) => h('button', {
              key: n, className: days === n ? 'on' : '', onClick: () => setDays(n),
            }, '近 ' + n + ' 天')))),

        h('div.mb-block', null,
          h('div.mb-label', null, '录入与复习'),
          h('div.mb-panel', null,
            h('div.mb-chart', null, trend.map((row) => h('div.mb-col', {
              key: row.date,
              title: row.date + ' · 新增 ' + (row.created || 0) + ' · 复习 ' + (row.reviewed || 0),
            },
              h('div.mb-bar', { style: { height: Math.round((row.created || 0) / peak * 100) + '%' } }),
              h('div.mb-bar.r', { style: { height: Math.round((row.reviewed || 0) / peak * 100) + '%' } })))),
            h('div.mb-axis', null,
              h('span', null, trend.length ? dayOf(trend[0].date) : ''),
              h('span', null, trend.length ? dayOf(trend[trend.length - 1].date) : '')),
            h('div.mb-legend', null,
              h('span', null, h('i.mb-swatch', { style: { background: '#3b6ef0' } }), '新增 ' + (totals.created || 0)),
              h('span', null, h('i.mb-swatch', { style: { background: '#2f9e5f' } }), '复习 ' + (totals.reviewed || 0))))),

        h('div.mb-block', null,
          h('div.mb-label', null, '保持度预测 · ' + (retention.total || 0) + ' 道在复习'),
          h('div.mb-panel', null,
            buckets.map((bucket) => h('div.mb-brow', { key: bucket.key },
              h('span', null, bucket.label),
              h('div.mb-track', null,
                h('div.mb-fill', { style: { width: Math.round((bucket.count || 0) / maxBucket * 100) + '%' } })),
              h('span', { style: { textAlign: 'right' } }, String(bucket.count || 0)))),
            retention.note ? h('div.mb-axis', null, h('span', null, retention.note)) : null)),

        h('div.mb-block', null,
          h('div.mb-label', null, '最该补的知识点'),
          weak.length
            ? h('div.mb-panel', null, weak.slice(0, 8).map((point) => h('div.mb-hrow', { key: point.knowledge },
              h('span.mb-htime', null, point.knowledge),
              h('span', null, (point.mistakes || 0) + ' 道'),
              h('span.mb-meta', { style: { marginTop: '0', marginLeft: 'auto' } },
                h('span', null, point.accuracy === null || point.accuracy === undefined
                  ? '未测' : '正确率 ' + Math.round(point.accuracy * 100) + '%')))))
            : h('div.mb-empty', null, '还没有可统计的知识点')),

        h('div.mb-block', null,
          h('div.mb-label', null, '错因分布'),
          types.length
            ? h('div', null, types.map((row) => h('span.mb-chip', { key: row.name },
              row.name, h('b', null, String(row.count)))))
            : h('div.mb-empty', null, '还没有错因分类')),

        (Array.isArray(report.by_step) && report.by_step.length) ? h('div.mb-block', null,
          h('div.mb-label', null, '错在哪一步 · 共 ' + report.by_step.reduce((sum, row) => sum + (row.count || 0), 0) + ' 次断点'),
          h('div', null, report.by_step.map((row) => h('span.mb-chip', { key: row.name },
            row.name, h('b', null, String(row.count))))),
          (Array.isArray(report.step_patterns) && report.step_patterns.length)
            ? h('div.mb-panel', { style: { marginTop: '8px' } },
                report.step_patterns.map((row) => h('div.mb-hrow', { key: row.knowledge + '|' + row.step },
                  h('span.mb-htime', null, row.knowledge),
                  h('span', null, row.step),
                  h('span.mb-meta', { style: { marginTop: '0', marginLeft: 'auto' } },
                    h('span', null, '错了 ' + row.count + ' 次')))))
            : null) : null,

        h('div.mb-block', null,
          h('div.mb-label', null, '学科分布'),
          subs.length
            ? h('div', null, subs.map((row) => h('span.mb-chip', { key: row.name },
              row.name, h('b', null, String(row.count)))))
            : h('div.mb-empty', null, '还没有学科')));
    }

    /* ── 主体 ─────────────────────────────────────────────────────────── */

    function MistakeBookApp(props) {
      const SessionProvider = props.SessionProvider;
      const renderFactorySlot = props.renderFactorySlot;
      const [scope, setScope] = useState('due');
      const [stats, setStats] = useState(null);
      const [items, setItems] = useState([]);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [picked, setPicked] = useState(0);
      const [detail, setDetail] = useState(null);
      const [revealed, setRevealed] = useState(false);
      const [busy, setBusy] = useState(false);
      const [note, setNote] = useState(null);
      const [ai, setAi] = useState(null);
      const [meta, setMeta] = useState(null);
      const [view, setView] = useState('review');
      const [creating, setCreating] = useState(false);
      const [q, setQ] = useState('');
      const [qLive, setQLive] = useState('');
      const [subject, setSubject] = useState('');
      // 放在最后：渲染测试的 seed 顺序按 useState 顺序写死，新状态加到末尾就不必挪索引
      const [step, setStep] = useState('');
      const alive = useRef(true);
      const preferRef = useRef(0);

      useEffect(() => () => { alive.current = false; }, []);

      const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
          const params = [];
          if (scope === 'due') params.push('due=1');
          params.push('page_size=50');
          if (qLive) params.push('q=' + encodeURIComponent(qLive));
          if (subject) params.push('subject=' + encodeURIComponent(subject));
          const query = '?' + params.join('&');
          const [nextStats, page] = await Promise.all([
            data('/api/stats'),
            data('/api/mistakes' + query),
          ]);
          if (!alive.current) return;
          setStats(nextStats);
          const rows = (page && Array.isArray(page.items)) ? page.items : [];
          setItems(rows);
          setPicked((current) => {
            // 刚录完的那道优先选中；找不到再保持当前；都没有就选第一条
            const want = preferRef.current;
            if (want && rows.some((row) => row.id === want)) { preferRef.current = 0; return want; }
            if (current && rows.some((row) => row.id === current)) return current;
            return rows.length ? rows[0].id : 0;
          });
        } catch (failure) {
          if (!alive.current) return;
          setError(String((failure && failure.message) || failure));
          setItems([]);
          setPicked(0);
        } finally {
          if (alive.current) setLoading(false);
        }
      }, [scope, qLive, subject]);

      useEffect(() => { void load(); }, [load]);

      // 搜索框 250ms 防抖：每敲一个字就打一次接口太吵
      useEffect(() => {
        const timer = setTimeout(() => setQLive(q.trim()), 250);
        return () => clearTimeout(timer);
      }, [q]);

      useEffect(() => {
        let cancelled = false;
        data('/api/meta')
          .then((value) => { if (!cancelled) setMeta(value); })
          .catch(() => { /* 候选值拿不到不影响主流程，输入框退化成自由文本 */ });
        return () => { cancelled = true; };
      }, []);

      useEffect(() => {
        if (!picked) { setDetail(null); return undefined; }
        let cancelled = false;
        setRevealed(false);
        setNote(null);
        setStep('');
        data('/api/mistakes/' + picked)
          .then((item) => { if (!cancelled) setDetail(item); })
          .catch((failure) => { if (!cancelled) setError(String((failure && failure.message) || failure)); });
        return () => { cancelled = true; };
      }, [picked]);

      /** 四档评分：写回 FSRS，然后刷新列表（这道通常就离开了到期集合）。 */
      const rate = useCallback(async (result) => {
        if (!picked || busy) return;
        setBusy(true);
        setNote(null);
        try {
          const item = await data('/api/mistakes/' + picked + '/review', {
            method: 'POST',
            body: JSON.stringify({ result, step: step || undefined }),
          });
          const when = item && item.next_review_at ? dayOf(item.next_review_at) : '';
          setNote({ ok: true, text: when ? '已记录 · 下次 ' + when : '已记录' });
          setDetail(item);
          await load();
        } catch (failure) {
          setNote({ ok: false, text: String((failure && failure.message) || failure) });
        } finally {
          if (alive.current) setBusy(false);
        }
      }, [picked, busy, load, step]);

      /** 请宿主半按「错题复习」预设建一条会话，然后嵌进来。 */
      const startAi = useCallback(async () => {
        if (!picked || busy) return;
        setBusy(true);
        setNote(null);
        try {
          const view = await api(SESSION_ENDPOINT, {
            method: 'POST',
            body: JSON.stringify({ id: picked }),
          });
          if (!view || !view.ok) {
            const message = view && view.error ? view.error.message : '建会话失败';
            setNote({ ok: false, text: message });
            return;
          }
          setAi({ sessionId: view.sessionId, title: view.title });
        } catch (failure) {
          setNote({ ok: false, text: String((failure && failure.message) || failure) });
        } finally {
          if (alive.current) setBusy(false);
        }
      }, [picked, busy]);

      /** 新建成功：切回复习视图 + 全部范围，并让新条目被选中。 */
      const onSaved = useCallback((item) => {
        preferRef.current = item && item.id ? item.id : 0;
        setCreating(false);
        setView('review');
        setScope('all');
        setQ('');
        setQLive('');
        setSubject('');
        void load();
      }, [load]);

      const total = stats && typeof stats.total === 'number' ? stats.total : 0;
      const due = stats && typeof stats.due === 'number' ? stats.due : 0;

      const subjects = (meta && Array.isArray(meta.subjects)) ? meta.subjects : [];

      const head = h('header.mb-head', null,
        h('span.mb-title', null, '错题复习'),
        h('span.mb-stats', null, '共 ' + total + ' 道 · 到期 ' + due + ' 道'),
        h('span.mb-spacer'),
        h('button.mb-btn.primary', { onClick: () => { setAi(null); setCreating(true); } }, '＋ 新建'),
        h('div.mb-seg', null,
          h('button', { className: view === 'review' ? 'on' : '', onClick: () => { setCreating(false); setView('review'); } }, '复习'),
          h('button', { className: view === 'stats' ? 'on' : '', onClick: () => { setCreating(false); setView('stats'); } }, '分析')));

      const toolbar = h('div.mb-toolbar', null,
        h('input.mb-input', {
          type: 'search', placeholder: '搜题干 / 知识点 / 标签', value: q,
          onChange: (event) => setQ(event.target.value),
        }),
        h('select.mb-input', {
          value: subject, title: '按学科筛选',
          onChange: (event) => setSubject(event.target.value),
        },
          h('option', { value: '' }, '全部学科'),
          subjects.map((name) => h('option', { key: name, value: name }, name))),
        h('div.mb-seg', null,
          h('button', { className: scope === 'due' ? 'on' : '', onClick: () => setScope('due') }, '到期'),
          h('button', { className: scope === 'all' ? 'on' : '', onClick: () => setScope('all') }, '全部')),
        h('span.mb-spacer'),
        h('button.mb-btn', { onClick: () => void load(), disabled: loading }, loading ? '刷新中…' : '刷新'));

      if (view === 'stats') {
        return h('div.mb', null, head, h(AnalyticsView, null));
      }

      if (creating) {
        return h('div.mb', null, head,
          h(NewForm, { meta, onCancel: () => setCreating(false), onSaved }));
      }

      if (ai) {
        return h('div.mb', null, head,
          h(AiPane, {
            SessionProvider, renderFactorySlot,
            sessionId: ai.sessionId, title: ai.title,
            onBack: () => setAi(null),
          }));
      }

      const list = h('aside.mb-list', null,
        loading && !items.length ? h('div.mb-empty', null, '加载中…') :
          !items.length ? h('div.mb-empty', null, scope === 'due' ? '今天没有到期的错题' : '还没有错题') :
            items.map((item) => h('button.mb-item', {
              key: item.id,
              className: item.id === picked ? 'on' : '',
              onClick: () => setPicked(item.id),
            },
              h('div.mb-q', null, clip(item.question, 120)),
              h('div.mb-meta', null,
                item.id === picked && scope === 'due' ? h('span.mb-dot') : null,
                h('span', null, item.subject || '未分科'),
                item.knowledge ? h('span', null, '· ' + clip(item.knowledge, 18)) : null,
                item.next_review_at ? h('span', null, '· ' + dayOf(item.next_review_at)) : null))));

      let body;
      if (error) {
        body = h('div.mb-empty', null, error);
      } else if (!picked || !detail) {
        body = h('div.mb-empty', null, items.length ? '加载中…' : '从左栏选一道错题');
      } else {
        const item = detail;
        body = h('div.mb-detail', null,
          h('div.mb-block', null,
            h('div.mb-label', null, '题目'),
            h('div.mb-text', null, item.question || '')),
          item.my_answer ? h('div.mb-block', null,
            h('div.mb-label', null, '我的答案'),
            h('div.mb-panel', null, h('div.mb-text', null, item.my_answer))) : null,
          revealed ? h('div.mb-block', null,
            h('div.mb-label', null, '正确答案'),
            h('div.mb-text', null, item.answer || '（未填）'),
            item.analysis ? h('div.mb-block', { style: { marginTop: '10px' } },
              h('div.mb-label', null, '解析'),
              h('div.mb-text', null, item.analysis)) : null) :
            h('div.mb-reveal', null,
              h('button.mb-btn', { onClick: () => setRevealed(true) }, '看答案与解析')),
          (item.mistake_type || item.error_reason) ? h('div.mb-block', null,
            h('div.mb-label', null, '错因'),
            h('div.mb-text', null, [item.mistake_type, item.error_reason].filter(Boolean).join(' —— '))) : null,
          item.knowledge ? h('div.mb-block', null,
            h('div.mb-label', null, '知识点'),
            h('div.mb-text', null, item.knowledge)) : null,
          h(HistoryBlock, {
            key: item.id + ':' + (item.review_count || 0),
            id: item.id, count: item.review_count || 0,
          }),
          h('div.mb-block', null,
            h('div.mb-label', null, '这次记得怎么样'),
            h('div.mb-step', null,
              h('span', null, '错在哪一步'),
              h('select.mb-input', {
                value: step,
                disabled: busy,
                onChange: (event) => setStep(event.target.value),
              },
                h('option', { value: '' }, '不记录'),
                STEPS.map((value) => h('option', { key: value, value }, value)))),
            h('div.mb-rate', null,
              h('button', { onClick: () => void rate('again'), disabled: busy }, h('b', null, '忘了'), h('span', null, 'again')),
              h('button', { onClick: () => void rate('hard'), disabled: busy }, h('b', null, '模糊'), h('span', null, 'hard')),
              h('button', { onClick: () => void rate('good'), disabled: busy }, h('b', null, '记得'), h('span', null, 'good')),
              h('button', { onClick: () => void rate('easy'), disabled: busy }, h('b', null, '简单'), h('span', null, 'easy'))),
            note ? h('div.mb-note' + (note.ok ? '' : '.bad'), null, note.text) : null),
          h('div.mb-block', null,
            h('button.mb-btn.primary', { onClick: () => void startAi(), disabled: busy },
              busy ? '正在建会话…' : '让 AI 带我复习这道')));
      }

      return h('div.mb', null, head, toolbar, h('div.mb-body', null, list, body));
    }

    /** 侧栏图标：一本打了勾的本子。 */
    function MistakeBookIcon(props) {
      const size = (props && props.size) || 18;
      return h('svg', { width: size, height: size, viewBox: '0 0 18 18', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3.4, y: 2.6, width: 11.2, height: 12.8, rx: 2, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M6.2 9.1l1.9 1.9 3.7-3.9', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }));
    }

    injectStyles(CSS);

    return {
      // 服务名（不是包名——包名那份在 package.json 的 dsh.client.inject 里）。
      inject: ['slots', 'sessions'],
      apply(ctx) {
        if (!ctx || !ctx.slots) return; // 宿主没给 slots 就什么都不做：抛出去会连累同批别的面板
        hostServices.sessions = hostService(ctx, 'sessions');
        // 中央面板。children 里那条**非 root** 子座位不是给别人填的：框架的判据是
        // 「这颗 entry 的 children 表里有任何 scope !== 'root' 的座位」才把 SessionProvider
        // 交给组件，而右栏那条会话正文必须有它。
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID,
          children: { 'mistake-book.session': { kind: 'single', scope: 'session' } },
        }, MistakeBookApp));
        // 侧栏那一行入口：点它由 sidebar 调 ctx.layout.selectPanel('mistake-book')。
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 41, label: '错题',
        }, MistakeBookIcon));
      },
    };
  },
});
