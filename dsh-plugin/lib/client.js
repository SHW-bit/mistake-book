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
      const alive = useRef(true);

      useEffect(() => () => { alive.current = false; }, []);

      const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
          const query = scope === 'due' ? '?due=1&page_size=50' : '?page_size=50';
          const [nextStats, page] = await Promise.all([
            data('/api/stats'),
            data('/api/mistakes' + query),
          ]);
          if (!alive.current) return;
          setStats(nextStats);
          const rows = (page && Array.isArray(page.items)) ? page.items : [];
          setItems(rows);
          setPicked((current) => {
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
      }, [scope]);

      useEffect(() => { void load(); }, [load]);

      useEffect(() => {
        if (!picked) { setDetail(null); return undefined; }
        let cancelled = false;
        setRevealed(false);
        setNote(null);
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
            body: JSON.stringify({ result }),
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
      }, [picked, busy, load]);

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

      const total = stats && typeof stats.total === 'number' ? stats.total : 0;
      const due = stats && typeof stats.due === 'number' ? stats.due : 0;

      const head = h('header.mb-head', null,
        h('span.mb-title', null, '错题复习'),
        h('span.mb-stats', null, '共 ' + total + ' 道 · 到期 ' + due + ' 道'),
        h('span.mb-spacer'),
        h('div.mb-seg', null,
          h('button', { className: scope === 'due' ? 'on' : '', onClick: () => setScope('due') }, '到期'),
          h('button', { className: scope === 'all' ? 'on' : '', onClick: () => setScope('all') }, '全部')),
        h('button.mb-btn', { onClick: () => void load(), disabled: loading }, loading ? '刷新中…' : '刷新'));

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
          h('div.mb-block', null,
            h('div.mb-label', null, '这次记得怎么样'),
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

      return h('div.mb', null, head, h('div.mb-body', null, list, body));
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
