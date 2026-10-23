// 错题本 DSH 插件 —— 客户端半（面板）。
//
// v0.23：把网页版的功能搬进面板（除组卷打印）。视图与网页版一一对应：
//   错题（列表 + 详情 + 筛选 + 批量）/ 学习 / 计划 / 分析 / 再战 / 回收站。
//
// 注册契约（在本机 0.2.0-rc.2 上核对）：
//   · 入口由 package.json 的 exports["./client"] 指到这里；
//   · 本文件只做两件事：window.__ModuleLoader__.load() 登记工厂，工厂返回 { inject, apply }；
//   · 工厂体在物化时才执行，所以样式注入放工厂里是安全的。
//
// 数据全走本机错题本服务的 /api/*，经宿主代理（lib/proxy.js）转发：
//   面板与 app.py 不同源，app.py 不发 CORS 头，浏览器直连会被同源策略拦掉。
window.__ModuleLoader__.load({
  id: 'dsh-mistake-book',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useCallback, useRef } = React;

    const PANEL_ID = 'mistake-book';
    const RETAIN_SOURCE = 'mistakeBook';
    const SESSION_ENDPOINT = '/api/mistake-book/session';
    const DATA_ENDPOINT = '/api/mistake-book/data';
    const STEPS = ['审题', '建模', '计算', '检验', '表达', '记忆'];
    const RESULT_LABEL = { again: '又错', hard: '勉强', good: '答对', easy: '很熟', mastered: '标记掌握' };
    const RATING_LABEL = { 1: '忘了', 2: '模糊', 3: '记得', 4: '简单' };
    const REMIND_KEY = 'mb.panel.remind.dismissed';

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
      '.mb-head{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--mb-line,rgba(127,127,127,.22));flex:0 0 auto;flex-wrap:wrap}',
      '.mb-title{font-weight:600;font-size:14px;letter-spacing:.2px}',
      '.mb-stats{color:var(--mb-dim,rgba(127,127,127,.95));font-size:12px}',
      '.mb-spacer{flex:1}',
      '.mb-btn{height:26px;padding:0 9px;border-radius:7px;border:1px solid var(--mb-line,rgba(127,127,127,.3));background:transparent;color:inherit;font-size:12px;cursor:pointer;font-family:inherit}',
      '.mb-btn:hover{background:var(--mb-hover,rgba(127,127,127,.12))}',
      '.mb-btn:disabled{opacity:.45;cursor:default}',
      '.mb-btn.primary{background:var(--mb-accent,#3b6ef0);border-color:transparent;color:#fff}',
      '.mb-btn.primary:hover{filter:brightness(1.06);background:var(--mb-accent,#3b6ef0)}',
      '.mb-btn.mini{height:22px;padding:0 7px;font-size:11px}',
      '.mb-btn.on{background:var(--mb-hover,rgba(127,127,127,.2));font-weight:600}',
      '.mb-tabs{display:inline-flex;gap:2px;border:1px solid var(--mb-line,rgba(127,127,127,.3));border-radius:8px;padding:2px;flex-wrap:wrap}',
      '.mb-tabs button{height:24px;padding:0 9px;border:0;border-radius:6px;background:transparent;color:inherit;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap}',
      '.mb-tabs button.on{background:var(--mb-hover,rgba(127,127,127,.2));font-weight:600}',
      '.mb-seg{display:inline-flex;border:1px solid var(--mb-line,rgba(127,127,127,.3));border-radius:7px;overflow:hidden}',
      '.mb-seg button{height:24px;padding:0 9px;border:0;background:transparent;color:inherit;font-size:12px;cursor:pointer;font-family:inherit}',
      '.mb-seg button.on{background:var(--mb-hover,rgba(127,127,127,.18));font-weight:600}',
      '.mb-split{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);flex:1;min-height:0;overflow:hidden}',
      '.mb-left{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--mb-line,rgba(127,127,127,.22))}',
      '.mb-right{overflow:auto;min-width:0}',
      '.mb-list{overflow:auto;padding:6px;flex:1;min-height:0}',
      '.mb-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;font-family:inherit;font-size:13px;padding:8px 9px;border-radius:8px;cursor:pointer;border-left:2px solid transparent}',
      '.mb-item:hover{background:var(--mb-hover,rgba(127,127,127,.1))}',
      '.mb-item.on{background:var(--mb-hover,rgba(127,127,127,.16));border-left-color:var(--mb-accent,#3b6ef0)}',
      '.mb-row{display:flex;gap:7px;align-items:flex-start}',
      '.mb-pick{margin:2px 0 0;flex:0 0 auto}',
      '.mb-q{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.45}',
      '.mb-meta{display:flex;gap:6px;align-items:center;margin-top:4px;font-size:11px;color:var(--mb-dim,rgba(127,127,127,.95));flex-wrap:wrap}',
      '.mb-dot{width:5px;height:5px;border-radius:50%;background:#e0574a;flex:0 0 auto}',
      '.mb-badge{display:inline-block;padding:1px 6px;border-radius:5px;background:var(--mb-hover,rgba(127,127,127,.14));font-size:10px;line-height:1.5}',
      '.mb-badge.overdue{background:rgba(224,87,74,.16);color:#d0533f}',
      '.mb-badge.type{background:rgba(59,110,240,.14);color:#3b6ef0}',
      '.mb-detail{overflow:auto;padding:14px 16px;min-width:0}',
      '.mb-empty{padding:24px 16px;color:var(--mb-dim,rgba(127,127,127,.95));text-align:center;font-size:12px;line-height:1.7}',
      '.mb-block{margin:0 0 13px}',
      '.mb-label{font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:var(--mb-dim,rgba(127,127,127,.95));margin-bottom:5px}',
      '.mb-text{white-space:pre-wrap;line-height:1.65;word-break:break-word}',
      '.mb-panel{border:1px solid var(--mb-line,rgba(127,127,127,.22));border-radius:9px;padding:10px 12px;background:var(--mb-subtle,rgba(127,127,127,.05))}',
      // 浮层（「更多」菜单）必须有底色 + 同色系字：只给 background 不给 color，深色主题下会白底浅字。
      '.mb-pop{box-sizing:border-box;background:#fff;color:#1c1c19;border:1px solid rgba(127,127,127,.35);box-shadow:0 10px 26px rgba(0,0,0,.18)}',
      '.mb-pop.dark{box-sizing:border-box;background:#24262a;color:#e9e9ec;border-color:rgba(255,255,255,.16);box-shadow:0 10px 26px rgba(0,0,0,.45)}',
      '.mb-reveal{display:flex;align-items:center;gap:8px;margin:6px 0 12px;flex-wrap:wrap}',
      '.mb-step{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--mb-dim,rgba(127,127,127,.95))}',
      '.mb-rate{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:8px}',
      '.mb-rate button{height:34px;border-radius:8px;border:1px solid var(--mb-line,rgba(127,127,127,.3));background:transparent;color:inherit;font-family:inherit;font-size:12px;cursor:pointer}',
      '.mb-rate button:hover{background:var(--mb-hover,rgba(127,127,127,.12))}',
      '.mb-rate button b{display:block;font-size:12px;font-weight:600}',
      '.mb-rate button span{display:block;font-size:10px;color:var(--mb-dim,rgba(127,127,127,.95));margin-top:1px}',
      '.mb-note{margin-top:8px;font-size:12px;color:#2f9e5f}',
      '.mb-note.bad{color:#d0533f}',
      '.mb-ai{display:flex;flex-direction:column;flex:1;min-height:0}',
      '.mb-aibar{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--mb-line,rgba(127,127,127,.22));flex:0 0 auto}',
      '.mb-aititle{font-size:12px;color:var(--mb-dim,rgba(127,127,127,.95));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mb-conv{flex:1;min-height:0;overflow:auto}',
      '.mb-toolbar{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--mb-line,rgba(127,127,127,.22));flex:0 0 auto;flex-wrap:wrap}',
      '.mb-input{height:26px;border-radius:7px;border:1px solid var(--mb-line,rgba(127,127,127,.3));background:transparent;color:inherit;font-family:inherit;font-size:12px;padding:0 7px;min-width:0}',
      '.mb-input:focus{outline:2px solid var(--mb-accent,#3b6ef0);outline-offset:-1px}',
      'input.mb-input{flex:1 1 130px;min-width:100px}',
      'select.mb-input{flex:0 1 auto;max-width:132px}',
      // v0.24 自定义下拉（原生 select 没法控制弹层样式，18 处统一换成一个组件）
      '.mb-dd{position:relative;flex:0 1 auto;min-width:104px}',
      '.mb-form .mb-dd{width:100%;min-width:0}',
      '.mb-dd-btn{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;height:26px;border-radius:7px;border:1px solid var(--mb-line,rgba(127,127,127,.3));background:transparent;color:inherit;font-family:inherit;font-size:12px;padding:0 7px;cursor:pointer;text-align:left}',
      '.mb-form .mb-dd-btn{height:auto;padding:6px 8px;font-size:13px;border-radius:8px}',
      '.mb-dd-btn:hover{background:var(--mb-hover,rgba(127,127,127,.08))}',
      '.mb-dd-btn:focus-visible{outline:2px solid var(--mb-accent,#3b6ef0);outline-offset:-1px}',
      '.mb-dd-btn[disabled]{opacity:.55;cursor:not-allowed}',
      '.mb-dd-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mb-dd-caret{flex:0 0 auto;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;opacity:.55;transition:transform .12s}',
      '.mb-dd.open .mb-dd-caret{transform:rotate(180deg)}',
      // 弹层是不透明面板，必须自带前景色：面板整体用 color:inherit 跟随宿主主题，
      // 只给背景不给字色时，深色主题下会变成「浅字 + 白底」= 看不见。
      '.mb-dd-pop{box-sizing:border-box;position:absolute;z-index:60;top:calc(100% + 4px);left:0;min-width:100%;max-height:240px;overflow:auto;background:#fff;color:#1c1c19;border:1px solid rgba(127,127,127,.35);border-radius:8px;box-shadow:0 10px 26px rgba(0,0,0,.18);padding:4px;display:grid;gap:2px}',
      '.mb-dd-pop.dark{background:#24262a;color:#e9e9ec;border-color:rgba(255,255,255,.16);box-shadow:0 10px 26px rgba(0,0,0,.45)}',
      '.mb-dd-opt{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;border:0;background:transparent;color:inherit;font-family:inherit;font-size:12px;text-align:left;padding:6px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}',
      '.mb-dd-opt.active{background:rgba(127,127,127,.16)}',
      '.mb-dd-pop.dark .mb-dd-opt.active{background:rgba(255,255,255,.12)}',
      '.mb-dd-opt.on{font-weight:600}',
      '.mb-dd-opt[disabled]{opacity:.45;cursor:not-allowed}',
      '.mb-dd-tick{margin-left:auto;opacity:.75;font-size:11px}',
      '.mb-dd-empty{padding:6px 8px;font-size:12px;color:inherit;opacity:.65}',
      '.mb-hrow.pickable{width:100%;box-sizing:border-box;border:0;background:transparent;color:inherit;font-family:inherit;font-size:12px;text-align:left;cursor:pointer;border-radius:6px;padding:4px 6px}',
      '.mb-hrow.pickable:hover{background:var(--mb-hover,rgba(127,127,127,.1))}',
      '.mb-hrow.pickable:focus-visible{outline:2px solid var(--mb-accent,#3b6ef0);outline-offset:-2px}',
      '.mb-filters{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 10px;border-bottom:1px solid var(--mb-line,rgba(127,127,127,.18));background:var(--mb-subtle,rgba(127,127,127,.04))}',
      '.mb-filters .full{grid-column:1 / -1}',
      '.mb-form{overflow:auto;padding:14px 16px;display:grid;gap:10px;align-content:start}',
      '.mb-field{display:grid;gap:4px;min-width:0}',
      '.mb-field>span{font-size:11px;letter-spacing:.3px;color:var(--mb-dim,rgba(127,127,127,.95))}',
      '.mb-form textarea,.mb-form input,.mb-form select{width:100%;box-sizing:border-box;border-radius:8px;border:1px solid var(--mb-line,rgba(127,127,127,.3));background:transparent;color:inherit;font-family:inherit;font-size:13px;padding:6px 8px;min-width:0}',
      '.mb-form textarea{resize:vertical;min-height:58px;line-height:1.55}',
      '.mb-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.mb-formfoot{display:flex;gap:8px;align-items:center;padding-top:2px;flex-wrap:wrap}',
      '.mb-chart{display:flex;align-items:flex-end;gap:2px;height:86px;padding-top:6px}',
      '.mb-col{flex:1 1 0;min-width:0;display:flex;align-items:flex-end;gap:1px;height:100%}',
      '.mb-bar{flex:1 1 0;min-width:1px;border-radius:2px 2px 0 0;background:#3b6ef0;opacity:.85}',
      '.mb-bar.r{background:#2f9e5f}',
      '.mb-axis{display:flex;justify-content:space-between;font-size:10px;color:var(--mb-dim,rgba(127,127,127,.95));margin-top:4px}',
      '.mb-legend{display:flex;gap:14px;font-size:11px;color:var(--mb-dim,rgba(127,127,127,.95));margin-top:6px}',
      '.mb-swatch{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:-1px}',
      '.mb-brow{display:grid;grid-template-columns:88px minmax(0,1fr) 44px;gap:8px;align-items:center;font-size:12px;margin-bottom:6px}',
      '.mb-track{height:8px;border-radius:4px;background:var(--mb-hover,rgba(127,127,127,.16));overflow:hidden}',
      '.mb-fill{height:100%;border-radius:4px;background:#3b6ef0}',
      '.mb-fill.warn{background:#e0574a}',
      '.mb-chip{display:inline-flex;gap:5px;align-items:center;border:1px solid var(--mb-line,rgba(127,127,127,.3));border-radius:999px;padding:2px 9px;font-size:11px;margin:0 6px 6px 0}',
      '.mb-hrow{display:flex;gap:8px;align-items:baseline;font-size:12px;padding:4px 0;border-bottom:1px dashed var(--mb-line,rgba(127,127,127,.18))}',
      '.mb-hrow:last-child{border-bottom:0}',
      '.mb-htime{color:var(--mb-dim,rgba(127,127,127,.95));font-size:11px;min-width:74px;flex:0 0 auto}',
      '.mb-imgs{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}',
      '.mb-thumb{position:relative;width:96px;height:96px;border-radius:8px;overflow:hidden;border:1px solid var(--mb-line,rgba(127,127,127,.25))}',
      '.mb-thumb img{width:100%;height:100%;object-fit:cover;display:block}',
      '.mb-thumb button{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:11px;line-height:1;cursor:pointer}',
      '.mb-dayhead{display:flex;gap:8px;align-items:baseline;margin:12px 0 6px;font-size:12px;color:var(--mb-dim,rgba(127,127,127,.95))}',
      '.mb-dayhead b{color:inherit;font-size:13px}',
      '.mb-remind{display:flex;align-items:center;gap:8px;padding:6px 14px;background:rgba(224,87,74,.1);border-bottom:1px solid rgba(224,87,74,.2);font-size:12px}',
      '.mb-mask{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:60;padding:16px}',
      '.mb-dlg{background:var(--mb-surface,#fff);color:inherit;border-radius:12px;max-width:620px;width:100%;max-height:86vh;overflow:auto;padding:14px 16px;border:1px solid var(--mb-line,rgba(127,127,127,.3))}',
      '.mb-dlg h3{margin:0 0 10px;font-size:14px}',
      '.mb-bulkbar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--mb-line,rgba(127,127,127,.22));background:rgba(59,110,240,.08);font-size:12px}',
      '.mb-notice{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 8px;padding:8px 10px;border-radius:8px;font-size:12px;line-height:18px;background:rgba(168,113,42,.12);border:1px solid rgba(168,113,42,.35);color:inherit}',
      '.mb-pager{display:flex;align-items:center;gap:8px;justify-content:center;padding:8px;font-size:12px;color:var(--mb-dim,rgba(127,127,127,.95))}',
      '@media(max-width:760px){.mb-row2{grid-template-columns:1fr}.mb-split{grid-template-columns:minmax(0,1fr)}.mb-left{border-right:0;max-height:44%;border-bottom:1px solid var(--mb-line,rgba(127,127,127,.22))}.mb-filters{grid-template-columns:1fr}}',
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

    function data(path, init) {
      return api(DATA_ENDPOINT + '?path=' + encodeURIComponent(path), init);
    }

    /** 导出/下载类接口走 raw=1：代理把上游响应体原样吐出，浏览器才会当文件下载。 */
    function rawUrl(path) {
      return DATA_ENDPOINT + '?raw=1&path=' + encodeURIComponent(path);
    }

    function clip(text, max) {
      const value = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
      return value.length > max ? value.slice(0, max) + '…' : value;
    }

    function dayOf(stamp) {
      const text = String(stamp || '');
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
      return match ? match[2] + '-' + match[3] : text;
    }

    /** 到期日 → 人话；新建题的 next_review_at 就是现在，按自然日比较才算得准。 */
    function dueDays(item) {
      if (!item || !item.next_review_at || item.status === 'mastered') return null;
      const t = Date.parse(String(item.next_review_at).replace(' ', 'T'));
      if (isNaN(t)) return null;
      const d = new Date(t); d.setHours(0, 0, 0, 0);
      const n = new Date(); n.setHours(0, 0, 0, 0);
      return Math.round((d - n) / 86400000);
    }

    function dueText(item) {
      const days = dueDays(item);
      if (days === null) return '';
      if (days < 0) return '逾期 ' + (-days) + ' 天';
      if (days === 0) return '今天到期';
      if (days === 1) return '明天到期';
      if (days <= 7) return days + ' 天后';
      return String(item.next_review_at).slice(5, 10);
    }

    function stars(n) {
      const k = Math.max(0, Math.min(5, Number(n) || 0));
      return '★★★★★'.slice(0, k) + '☆☆☆☆☆'.slice(0, 5 - k);
    }

    function errText(failure) {
      return String((failure && failure.message) || failure);
    }

    /* ── 公式渲染（KaTeX，按需加载） ───────────────────────────────────── */

    // 面板跑在 DSH 的 origin 里，KaTeX 在错题本服务里。跨源直接 <script src> 会被同源策略拦掉，
    // 所以经宿主代理的 ?raw=1 取回：浏览器只跟自己的 origin 说话，app.py 不用加 CORS，
    // 宿主半（lib/proxy.js，改完要重启 DSH）也不用加路由——只加了 app.py 的 /api/asset。
    const KATEX_ASSET = '/vendor/katex/katex.min.js';
    let katexState = 0;   // 0 未开始 / 1 加载中 / 2 就绪 / 3 失败
    const katexWaiters = new Set();

    function katexUrl() {
      return DATA_ENDPOINT + '?raw=1&path=' + encodeURIComponent('/api/asset?path=' + KATEX_ASSET);
    }

    function ensureKatex() {
      if (katexState) return;
      if (typeof document === 'undefined' || !document.createElement || !document.head) { katexState = 3; return; }
      katexState = 1;
      const script = document.createElement('script');
      script.src = katexUrl();
      script.async = true;
      const settle = (ok) => {
        katexState = ok && typeof window !== 'undefined' && window.katex ? 2 : 3;
        katexWaiters.forEach((notify) => notify(katexState));
        katexWaiters.clear();
      };
      script.onload = () => settle(true);
      script.onerror = () => settle(false);
      document.head.appendChild(script);
    }

    /** 订阅 KaTeX 就绪：没就绪先显示原文，加载完自动重渲染一次。 */
    function useKatex() {
      const [state, setState] = useState(katexState);
      useEffect(() => {
        ensureKatex();
        if (katexState === 2 || katexState === 3) { setState(katexState); return undefined; }
        katexWaiters.add(setState);
        return () => { katexWaiters.delete(setState); };
      });
      return state;
    }

    function escHtml(text) {
      return String(text).replace(/[&<>"']/g, (ch) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
      ));
    }

    function texOf(source, display) {
      const raw = display ? '$$' + source + '$$' : '$' + source + '$';
      const katex = typeof window !== 'undefined' ? window.katex : null;
      if (!katex) return escHtml(raw);
      try {
        // output:'mathml' 只用浏览器原生 MathML：不带 KaTeX 的 CSS 与字体，
        // 正好绕开「字体是二进制、而代理的 raw 通道只传文本」这个问题。
        return katex.renderToString(source, {
          displayMode: display, throwOnError: false, strict: 'ignore', output: 'mathml',
        });
      } catch (error) { return escHtml(raw); }
    }

    /** 纯文本 → HTML：`$…$` 行内、`$$…$$` 独立成行；不配对的 `$` 当普通字符。 */
    function mathHtml(text) {
      const source = String(text === null || text === undefined ? '' : text);
      if (source.indexOf('$') < 0) return escHtml(source);
      let out = '';
      let i = 0;
      while (i < source.length) {
        const at = source.indexOf('$', i);
        if (at < 0) { out += escHtml(source.slice(i)); break; }
        out += escHtml(source.slice(i, at));
        if (source.substr(at, 2) === '$$') {
          const end = source.indexOf('$$', at + 2);
          if (end > at + 2) { out += texOf(source.slice(at + 2, end), true); i = end + 2; continue; }
          out += escHtml('$$'); i = at + 2; continue;
        }
        const close = source.indexOf('$', at + 1);
        if (close > at + 1) { out += texOf(source.slice(at + 1, close), false); i = close + 1; continue; }
        out += escHtml('$'); i = at + 1;
      }
      return out;
    }

    /**
     * 文本块：先按纯文本渲染（首屏与测试都简单），挂载后再就地换成公式。
     * 用「渲染完再改写 DOM」而不是 dangerouslySetInnerHTML，是为了保住文本节点上的
     * 选中/复制，也让既有渲染测试仍然看到文字。
     */
    function MathText(props) {
      const ref = useRef(null);
      useKatex();
      const stamp = useRef('');
      useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const text = String(props.text === null || props.text === undefined ? '' : props.text);
        const mark = text + '\u0000' + katexState;
        if (stamp.current === mark) return;
        stamp.current = mark;
        if (katexState === 2 && text.indexOf('$') >= 0) el.innerHTML = mathHtml(text);
        else el.textContent = text;
      });
      return h('div', {
        ref,
        className: props.className || 'mb-text',
        style: props.style,
      }, props.text);
    }

    /* ── 宿主服务 ─────────────────────────────────────────────────────── */

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

    /* ── 会话面板 ─────────────────────────────────────────────────────── */

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
          setError('这条会话引不住：' + errText(failure));
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
          h('div.mb-aibar', null, h('button.mb-btn', { type: 'button', onClick: onBack }, '← 返回题目'), h('span.mb-aititle', null, error)),
          h('div.mb-empty', null, error));
      }
      if (!live || !SessionProvider) {
        return h('div.mb-ai', null,
          h('div.mb-aibar', null, h('button.mb-btn', { type: 'button', onClick: onBack }, '← 返回题目')),
          h('div.mb-empty', null, '正在接入会话…'));
      }
      return h('div.mb-ai', null,
        h('div.mb-aibar', null,
          h('button.mb-btn', { type: 'button', onClick: onBack }, '← 返回题目'),
          h('span.mb-aititle', null, title || '')),
        h(SessionProvider, { session: live.reference },
          h('div.mb-conv', null,
            renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }))));
    }

    /* ── 详情里的三块小面板 ───────────────────────────────────────────── */

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
          .catch((failure) => { if (!cancelled) setError(errText(failure)); });
        return () => { cancelled = true; };
      }, [open, id, log]);

      const summary = log && typeof log.total === 'number'
        ? '复习 ' + log.total + ' 次' + (log.accuracy === null || log.accuracy === undefined
          ? '' : ' · 正确率 ' + Math.round(log.accuracy * 100) + '%')
        : count ? '复习 ' + count + ' 次' : '还没复习过';

      return h('div.mb-block', null,
        h('div.mb-label', null, '复习历史'),
        h('div.mb-reveal', null,
          h('button.mb-btn', {
            type: 'button',
            onClick: () => setOpen(!open),
            disabled: !count && !open,
          }, (open ? '收起' : '查看') + ' · ' + summary)),
        open ? h('div', null,
          error ? h('div.mb-note.bad', null, error) :
            !log ? h('div.mb-empty', null, '读取中…') :
              !log.items.length ? h('div.mb-empty', null, '还没有复习记录') :
                log.items.map((row) => h('div.mb-hrow', { key: row.id },
                  h('span.mb-htime', null, String(row.reviewed_at || '').slice(5, 16)),
                  h('span', null, (row.rating ? RATING_LABEL[row.rating] : (RESULT_LABEL[row.result] || row.result || '')) +
                    (row.step ? ' · 断点 ' + row.step : '')),
                  h('span.mb-meta', { style: { marginTop: '0', marginLeft: 'auto' } },
                    row.interval_days ? h('span', null, '间隔 ' + row.interval_days + ' 天') : null,
                    row.stage ? h('span', null, '· 阶段 ' + row.stage) : null)))) : null);
    }

    function VariantsBlock(props) {
      const id = props.id;
      const [rows, setRows] = useState(null);
      const [error, setError] = useState('');
      const [question, setQuestion] = useState('');
      const [answer, setAnswer] = useState('');
      const [busy, setBusy] = useState(false);
      const [version, setVersion] = useState(0);

      useEffect(() => {
        let cancelled = false;
        setRows(null);
        data('/api/mistakes/' + id + '/variants')
          .then((value) => { if (!cancelled) setRows(value); })
          .catch((failure) => { if (!cancelled) setError(errText(failure)); });
        return () => { cancelled = true; };
      }, [id, version]);

      const add = async () => {
        if (!question.trim()) return;
        setBusy(true);
        try {
          await data('/api/mistakes/' + id + '/variants', {
            method: 'POST', body: JSON.stringify({ question, answer }),
          });
          setQuestion(''); setAnswer(''); setVersion(version + 1);
        } catch (failure) { setError(errText(failure)); } finally { setBusy(false); }
      };

      const drop = async (vid) => {
        try {
          await data('/api/variants/' + vid, { method: 'DELETE' });
          setVersion(version + 1);
        } catch (failure) { setError(errText(failure)); }
      };

      const used = async (vid) => {
        try {
          await data('/api/variants/' + vid + '/use', { method: 'POST' });
          setVersion(version + 1);
        } catch (failure) { setError(errText(failure)); }
      };

      const items = rows && Array.isArray(rows.items) ? rows.items : [];
      return h('div.mb-block', null,
        h('div.mb-label', null, '变式题' + (rows && rows.total ? ' · ' + rows.total + ' 条' : '')),
        error ? h('div.mb-note.bad', null, error) : null,
        !rows ? h('div.mb-empty', null, '读取中…') : !items.length
          ? h('div.mb-empty', null, '还没有变式。加一条同知识点的新题，练习时就会轮换到它。')
          : h('div.mb-panel', null, items.map((row) => h('div.mb-hrow', { key: row.id },
              h(MathText, { className: 'mb-q', style: { flex: '1 1 auto', minWidth: '0' }, text: clip(row.question, 60) }),
              h('span.mb-htime', null, '练过 ' + (row.times_used || 0) + ' 次'),
              h('button.mb-btn.mini', { type: 'button', onClick: () => void used(row.id) }, '练过'),
              h('button.mb-btn.mini', { type: 'button', onClick: () => void drop(row.id) }, '删')))),
        h('div.mb-row2', { style: { marginTop: '8px' } },
          h('input.mb-input', { placeholder: '加一条变式题干…', value: question, onChange: (e) => setQuestion(e.target.value) }),
          h('input.mb-input', { placeholder: '答案（可空）', value: answer, onChange: (e) => setAnswer(e.target.value) })),
        h('div.mb-formfoot', null,
          h('button.mb-btn', { type: 'button', onClick: () => void add(), disabled: busy || !question.trim() }, '加变式')));
    }

    /* ── 新建 / 编辑表单 ─────────────────────────────────────────────── */

    function emptyForm(initial) {
      const it = initial || {};
      return {
        subject: it.subject || '', question: it.question || '', my_answer: it.my_answer || '',
        answer: it.answer || '', analysis: it.analysis || '', error_reason: it.error_reason || '',
        mistake_type: it.mistake_type || '', source: it.source || '', knowledge: it.knowledge || '',
        tags: it.tags || '', difficulty: String(it.difficulty || 3), status: it.status || 'new',
      };
    }

    function ItemForm(props) {
      const { meta, initial, onSave, onCancel, busy, error, submitLabel } = props;
      const [form, setForm] = useState(() => emptyForm(initial));
      const [images, setImages] = useState(() => (initial && Array.isArray(initial.images)
        ? initial.images.map((img) => ({ src: img.url, file: img.file })) : []));
      const [dirty, setDirty] = useState(false);
      const [imgError, setImgError] = useState('');
      const fileRef = useRef(null);

      const set = (key) => (event) => setForm(Object.assign({}, form, { [key]: event.target.value }));
      const setValue = (key) => (value) => setForm(Object.assign({}, form, { [key]: value }));

      const addFile = useCallback((file) => {
        if (!file || !/^image\//.test(String(file.type || ''))) return;
        if (file.size > 2 * 1024 * 1024) { setImgError('图片要小于 2MB'); return; }
        const reader = new FileReader();
        reader.onload = () => {
          setImages((current) => current.concat([{ src: String(reader.result), data: String(reader.result) }]));
          setDirty(true);
          setImgError('');
        };
        reader.readAsDataURL(file);
      }, []);

      useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const onPaste = (event) => {
          const items = event.clipboardData && event.clipboardData.items;
          if (!items) return;
          for (let i = 0; i < items.length; i += 1) {
            if (String(items[i].type || '').indexOf('image/') === 0) {
              addFile(items[i].getAsFile());
              event.preventDefault();
              break;
            }
          }
        };
        document.addEventListener('paste', onPaste);
        return () => document.removeEventListener('paste', onPaste);
      }, [addFile]);

      const removeImage = (index) => {
        setImages(images.filter((img, i) => i !== index));
        setDirty(true);
      };

      const submit = () => {
        if (!String(form.question).trim()) return;
        const body = Object.assign({}, form, { difficulty: Number(form.difficulty) || 3 });
        if (dirty) body.images = images.map((img) => img.data || img.file);
        onSave(body);
      };

      const choices = (id, values) => h('datalist', { id },
        (values || []).map((value) => h('option', { key: value, value })));

      return h('div.mb-form', null,
        h('div.mb-field', null, h('span', null, '题目（必填）'),
          h('textarea', { value: form.question, onChange: set('question'), rows: 4, placeholder: '粘贴题干…（截图可直接 Ctrl+V）' })),
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
            choices('mb-dl-subject', meta && meta.subjects)),
          h('div.mb-field', null, h('span', null, '知识点'),
            h('input', { value: form.knowledge, onChange: set('knowledge'), list: 'mb-dl-knowledge' }),
            choices('mb-dl-knowledge', meta && meta.knowledge))),
        h('div.mb-row2', null,
          h('div.mb-field', null, h('span', null, '错因分类'),
            h(Dropdown, {
              value: form.mistake_type, placeholder: '（不填）',
              options: [{ value: '', label: '（不填）' }].concat(
                ((meta && meta.mistake_types) || []).map((value) => ({ value, label: value }))),
              onChange: setValue('mistake_type'),
            })),
          h('div.mb-field', null, h('span', null, '来源'),
            h('input', { value: form.source, onChange: set('source'), list: 'mb-dl-source' }),
            choices('mb-dl-source', meta && meta.sources))),
        h('div.mb-row2', null,
          h('div.mb-field', null, h('span', null, '错因详细描述'),
            h('input', { value: form.error_reason, onChange: set('error_reason') })),
          h('div.mb-field', null, h('span', null, '标签（逗号分隔）'),
            h('input', { value: form.tags, onChange: set('tags'), placeholder: '如：极限,洛必达' }))),
        h('div.mb-row2', null,
          h('div.mb-field', null, h('span', null, '难度'),
            h(Dropdown, {
              value: form.difficulty,
              options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n + ' 星' })),
              onChange: setValue('difficulty'),
            })),
          h('div.mb-field', null, h('span', null, '状态'),
            h(Dropdown, {
              value: form.status,
              options: [['new', '未复习'], ['reviewing', '复习中'], ['mastered', '已掌握']]
                .map((pair) => ({ value: pair[0], label: pair[1] })),
              onChange: setValue('status'),
            }))),
        h('div.mb-block', null,
          h('div.mb-field', null, h('span', null, '题目图片（≤2MB，可多张，截图后 Ctrl+V 粘贴）'),
            h('input', { ref: fileRef, type: 'file', accept: 'image/*', onChange: (e) => {
              const file = e.target.files && e.target.files[0];
              if (file) addFile(file);
              e.target.value = '';
            } })),
          imgError ? h('div.mb-note.bad', null, imgError) : null,
          h('div.mb-imgs', null, images.map((img, index) => h('div.mb-thumb', { key: index },
            h('img', { src: img.src, alt: '题目图片 ' + (index + 1) }),
            h('button', { type: 'button', onClick: () => removeImage(index), 'aria-label': '移除这张图' }, '×'))))),
        h('div.mb-formfoot', null,
          h('button.mb-btn.primary', { type: 'button', onClick: submit, disabled: busy || !String(form.question).trim() },
            busy ? '保存中…' : (submitLabel || '保存')),
          h('button.mb-btn', { type: 'button', onClick: onCancel, disabled: busy }, '取消'),
          error ? h('span.mb-note.bad', null, error) : null));
    }

    /* ── 详情 ─────────────────────────────────────────────────────────── */

    function DetailPane(props) {
      const { id, mode, meta, onChanged, SessionProvider, renderFactorySlot } = props;
      const [item, setItem] = useState(null);
      const [error, setError] = useState('');
      const [revealed, setRevealed] = useState(mode === 'edit');
      const [editing, setEditing] = useState(mode === 'edit');
      const [busy, setBusy] = useState(false);
      const [note, setNote] = useState(null);
      const [step, setStep] = useState('');
      const [preview, setPreview] = useState(null);
      const [ai, setAi] = useState(null);

      useEffect(() => {
        let cancelled = false;
        setItem(null); setError(''); setNote(null); setStep(''); setPreview(null);
        setEditing(mode === 'edit');
        setRevealed(mode === 'edit');
        data('/api/mistakes/' + id)
          .then((value) => { if (!cancelled) setItem(value); })
          .catch((failure) => { if (!cancelled) setError(errText(failure)); });
        return () => { cancelled = true; };
      }, [id, mode]);

      useEffect(() => {
        let cancelled = false;
        data('/api/mistakes/' + id + '/preview')
          .then((value) => { if (!cancelled) setPreview(value); })
          .catch(() => { /* 预览拿不到不影响评分 */ });
        return () => { cancelled = true; };
      }, [id, item && item.review_count]);

      const rate = async (result) => {
        if (busy) return;
        setBusy(true);
        setNote(null);
        try {
          const next = await data('/api/mistakes/' + id + '/review', {
            method: 'POST',
            body: JSON.stringify({ result, step: step || undefined }),
          });
          const when = next && next.next_review_at ? dayOf(next.next_review_at) : '';
          setNote({ ok: true, text: when ? '已记录 · 下次 ' + when : '已记录' });
          setItem(next);
          onChanged();
        } catch (failure) {
          setNote({ ok: false, text: errText(failure) });
        } finally { setBusy(false); }
      };

      const toggleSuspend = async () => {
        setBusy(true);
        try {
          const next = await data('/api/mistakes/' + id + '/' + (item.suspended ? 'resume' : 'suspend'), { method: 'POST' });
          setItem(next);
          onChanged();
        } catch (failure) { setNote({ ok: false, text: errText(failure) }); } finally { setBusy(false); }
      };

      const remove = async () => {
        setBusy(true);
        try {
          await data('/api/mistakes/' + id, { method: 'DELETE' });
          onChanged();
        } catch (failure) { setNote({ ok: false, text: errText(failure) }); } finally { setBusy(false); }
      };

      const save = async (body) => {
        setBusy(true);
        setNote(null);
        try {
          const next = await data('/api/mistakes/' + id, { method: 'PUT', body: JSON.stringify(body) });
          setItem(next);
          setEditing(false);
          onChanged();
        } catch (failure) { setNote({ ok: false, text: errText(failure) }); } finally { setBusy(false); }
      };

      const startAi = async () => {
        setBusy(true);
        setNote(null);
        try {
          const view = await api(SESSION_ENDPOINT, { method: 'POST', body: JSON.stringify({ id }) });
          if (!view || !view.ok) {
            setNote({ ok: false, text: view && view.error ? view.error.message : '建会话失败' });
            return;
          }
          setAi({ sessionId: view.sessionId, title: view.title });
        } catch (failure) {
          setNote({ ok: false, text: errText(failure) });
        } finally { setBusy(false); }
      };

      // 从「计划」页点进来的详情：给一个回程入口，不然用户只能自己切页签找回去
      const backBar = props.onBack
        ? h('div.mb-toolbar', { style: { padding: '0 0 8px', borderBottom: '0' } },
          h('button.mb-btn.mini', { type: 'button', onClick: props.onBack }, '← 返回计划'))
        : null;
      const missing = /不存在/.test(String(error)) ? '这道题已被删除或不存在（id=' + id + '）' : error;

      if (ai) {
        return h(AiPane, {
          SessionProvider, renderFactorySlot,
          sessionId: ai.sessionId, title: ai.title,
          onBack: () => setAi(null),
        });
      }
      if (error) return h('div', null, backBar, h('div.mb-empty', null, missing));
      if (!item) return h('div', null, backBar, h('div.mb-empty', null, '加载中…'));
      if (editing) {
        return h(ItemForm, {
          key: 'edit:' + id,
          meta, initial: item, onSave: save, onCancel: () => setEditing(false),
          busy, error: note && !note.ok ? note.text : '', submitLabel: '保存修改',
        });
      }

      const images = Array.isArray(item.images) ? item.images : [];
      return h('div.mb-detail', null,
        backBar,
        h('div.mb-block', null,
          h('div.mb-label', null, '题目 #' + item.id),
          h(MathText, { text: item.question || '' })),
        item.my_answer ? h('div.mb-block', null,
          h('div.mb-label', null, '我的答案'),
          h('div.mb-panel', null, h(MathText, { text: item.my_answer }))) : null,
        images.length ? h('div.mb-block', null,
          h('div.mb-label', null, '题目图片'),
          h('div.mb-imgs', null, images.map((img, index) =>
            h('a.mb-thumb', { key: index, href: rawUrl('/api/images/' + encodeURIComponent(img.file)), target: '_blank', rel: 'noreferrer' },
              h('img', { src: rawUrl('/api/images/' + encodeURIComponent(img.file)), alt: '题目图片 ' + (index + 1) }))))) : null,
        revealed ? h('div.mb-block', null,
          h('div.mb-label', null, '正确答案'),
          h(MathText, { text: item.answer || '（未填）' }),
          item.analysis ? h('div.mb-block', { style: { marginTop: '10px' } },
            h('div.mb-label', null, '解析'),
            h(MathText, { text: item.analysis })) : null) :
          h('div.mb-reveal', null,
            h('button.mb-btn', { type: 'button', onClick: () => setRevealed(true) }, '看答案与解析')),
        (item.mistake_type || item.error_reason) ? h('div.mb-block', null,
          h('div.mb-label', null, '错因'),
          h('div.mb-text', null, [item.mistake_type, item.error_reason].filter(Boolean).join(' —— '))) : null,
        h('div.mb-block', null,
          h('div.mb-meta', null,
            item.subject ? h('span.mb-badge', null, item.subject) : null,
            item.knowledge ? h('span.mb-badge.type', null, item.knowledge) : null,
            item.source ? h('span.mb-badge', null, item.source) : null,
            h('span.mb-badge', null, '难度 ' + stars(item.difficulty)),
            h('span.mb-badge', null, '复习 ' + (item.review_count || 0) + ' 次'),
            dueText(item) ? h('span.mb-badge.overdue', null, dueText(item)) : null,
            item.suspended ? h('span.mb-badge.overdue', null, '已斩题') : null)),
        item.tags ? h('div.mb-block', null,
          h('div.mb-label', null, '标签'),
          h('div', null, String(item.tags).split(',').filter(Boolean).map((tag) =>
            h('span.mb-chip', { key: tag }, tag)))) : null,
        h(HistoryBlock, {
          key: item.id + ':' + (item.review_count || 0),
          id: item.id, count: item.review_count || 0,
        }),
        h(VariantsBlock, { key: 'var:' + item.id, id: item.id }),
        h('div.mb-block', null,
          h('div.mb-label', null, '这次记得怎么样'),
          h('div.mb-step', null,
            h('span', null, '错在哪一步'),
            h(Dropdown, {
              value: step, disabled: busy, placeholder: '不记录',
              options: [{ value: '', label: '不记录' }].concat(STEPS.map((value) => ({ value, label: value }))),
              onChange: (value) => setStep(value),
            })),
          h('div.mb-rate', null,
            [['again', '忘了'], ['hard', '模糊'], ['good', '记得'], ['easy', '简单']].map((pair) =>
              h('button', { key: pair[0], type: 'button', onClick: () => void rate(pair[0]), disabled: busy },
                h('b', null, pair[1]),
                h('span', null, pair[0] + (preview && preview.preview && preview.preview[pair[0]]
                  ? ' · ' + preview.preview[pair[0]] + '天' : ''))))),
          note ? h('div.mb-note' + (note.ok ? '' : '.bad'), null, note.text) : null),
        h('div.mb-block', null,
          h('div.mb-formfoot', null,
            h('button.mb-btn', { type: 'button', onClick: () => setEditing(true), disabled: busy }, '编辑'),
            h('button.mb-btn', { type: 'button', onClick: () => void rate('mastered'), disabled: busy }, '标记掌握'),
            h('button.mb-btn', { type: 'button', onClick: () => void toggleSuspend(), disabled: busy },
              item.suspended ? '恢复复习' : '斩题'),
            h('button.mb-btn', { type: 'button', onClick: () => void remove(), disabled: busy }, '删除'),
            h('button.mb-btn.primary', { type: 'button', onClick: () => void startAi(), disabled: busy },
              busy ? '正在建会话…' : '让 AI 带我复习这道'))));
    }

    /* ── 自定义下拉（v0.24）────────────────────────────────────────────── */

    // 宿主是深色还是浅色主题：面板整体 color:inherit，只能从算出来的文字颜色反推。
    // 文字偏亮（>0.55 相对亮度）说明是深色主题，弹层要用深底浅字。
    function isLightColor(color) {
      const found = /rgba?\(([^)]+)\)/.exec(String(color || ''));
      if (!found) return false;
      const rgb = found[1].split(',').map((part) => parseFloat(part));
      if (rgb.length < 3 || rgb.slice(0, 3).some((num) => !isFinite(num))) return false;
      const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
      return lum > 0.55;
    }

    // 弹层定位（下拉与「更多」菜单共用一套，避免两处算法漂移）：
    // ① 用 fixed 而不是 absolute —— 详情区、表单区都是 overflow:auto，absolute 会被裁掉；
    // ② 下方放不下就向上翻，左右夹在视口内；
    // ③ 顺便按触发按钮的文字亮度决定深/浅配色（面板整体 color:inherit，深色主题会继承到浅字）。
    function usePopupAnchor(open, ref, selector, minWidth) {
      const [pos, setPos] = useState(null);
      const [dark, setDark] = useState(false);
      useEffect(() => {
        if (!open) { setPos(null); return undefined; }   // 收起时清掉旧坐标，避免下次展开闪一帧
        if (typeof window === 'undefined') return undefined;
        const place = () => {
          const node = ref.current;
          const btn = !node ? null : (selector ? (node.querySelector ? node.querySelector(selector) : null) : node);
          if (!btn || !btn.getBoundingClientRect) return;
          const rect = btn.getBoundingClientRect();
          const gap = 4;
          const vh = window.innerHeight || 800;
          const vw = window.innerWidth || 800;
          const below = vh - rect.bottom - gap - 8;
          const above = rect.top - gap - 8;
          const openUp = below < 140 && above > below;
          const height = Math.max(80, Math.min(240, openUp ? above : below));
          const width = Math.max(rect.width, minWidth || 120);
          const left = Math.max(8, Math.min(rect.left, vw - width - 8));
          setPos({
            top: openUp ? Math.max(8, rect.top - gap - height) : rect.bottom + gap,
            left,
            width,
            // 自然宽度可能比按钮宽（选项文案长），只夹 left 会顶出右边界，所以再给一个上限
            maxWidth: Math.max(80, vw - left - 8),
            maxHeight: height,
          });
          try { setDark(isLightColor(window.getComputedStyle(btn).color)); } catch (err) { setDark(false); }
        };
        place();
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        return () => {
          window.removeEventListener('scroll', place, true);
          window.removeEventListener('resize', place);
        };
      }, [open]);
      return { pos, dark };
    }

    // 原生 select 的弹层没法用 CSS 管，长选项会被系统截断；这里用按钮 + 弹层自己实现。
    // 键盘：↑↓ 移动、Enter/Space 选中、Esc 关闭；点外部关闭；禁用项跳过。
    function Dropdown(props) {
      const list = props.options || [];
      const cur = props.value == null ? '' : String(props.value);
      const [open, setOpen] = useState(false);
      const [active, setActive] = useState(-1);
      const rootRef = useRef(null);
      const { pos, dark } = usePopupAnchor(open, rootRef, '.mb-dd-btn', 120);

      const currentIndex = list.findIndex((opt) => String(opt.value) === cur);
      const currentLabel = currentIndex >= 0 ? list[currentIndex].label : (props.placeholder || '请选择');

      useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined;
        const onDown = (event) => {
          const node = rootRef.current;
          if (node && node.contains && node.contains(event.target)) return;
          setOpen(false);
        };
        document.addEventListener('mousedown', onDown, true);
        return () => document.removeEventListener('mousedown', onDown, true);
      }, [open]);


      const pick = (opt) => {
        if (!opt || opt.disabled) return;
        setOpen(false);
        setActive(-1);
        if (String(opt.value) !== cur && props.onChange) props.onChange(opt.value);
      };

      const move = (delta) => {
        if (!list.length) return;
        let next = active;
        for (let i = 0; i < list.length; i += 1) {
          next = (next + delta + list.length) % list.length;
          if (!list[next].disabled) break;
        }
        setActive(next);
      };

      const onKeyDown = (event) => {
        const key = event.key;
        if (key === 'ArrowDown' || key === 'ArrowUp') {
          event.preventDefault();
          if (!open) { setOpen(true); setActive(currentIndex); return; }
          move(key === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (key === 'Enter' || key === ' ') {
          event.preventDefault();
          if (!open) { setOpen(true); setActive(currentIndex); return; }
          if (active >= 0 && list[active]) pick(list[active]);
          return;
        }
        if (key === 'Escape' && open) { event.preventDefault(); setOpen(false); }
      };

      return h('div', {
        className: 'mb-dd' + (open ? ' open' : '') + (props.className ? ' ' + props.className : ''),
        ref: rootRef, title: props.title,
      },
        h('button.mb-dd-btn', {
          type: 'button', disabled: !!props.disabled,
          'aria-haspopup': 'listbox', 'aria-expanded': open ? 'true' : 'false',
          onClick: () => { if (!props.disabled) { setOpen(!open); setActive(currentIndex); } },
          onKeyDown,
        },
          h('span.mb-dd-label', null, currentLabel),
          h('span.mb-dd-caret', { 'aria-hidden': 'true' })),
        open ? h(dark ? 'div.mb-dd-pop.dark' : 'div.mb-dd-pop', {
          role: 'listbox',
          style: pos ? {
            position: 'fixed', top: pos.top + 'px', left: pos.left + 'px',
            minWidth: pos.width + 'px', maxWidth: pos.maxWidth + 'px', maxHeight: pos.maxHeight + 'px',
          } : null,
        },
          list.length ? list.map((opt, index) => h(
            'button.mb-dd-opt' + (index === active ? '.active' : '') + (String(opt.value) === cur ? '.on' : ''),
            {
              key: String(opt.value) + ':' + index, type: 'button', role: 'option',
              'aria-selected': String(opt.value) === cur ? 'true' : 'false',
              disabled: !!opt.disabled,
              onClick: () => pick(opt),
              onMouseEnter: () => setActive(index),
            },
            h('span', null, opt.label),
            String(opt.value) === cur ? h('span.mb-dd-tick', { 'aria-hidden': 'true' }, '✓') : null)) :
          h('div.mb-dd-empty', null, '无可选项')) : null);
    }

    /* ── 错题列表（列表 + 筛选 + 批量）────────────────────────────────── */

    function ListTab(props) {
      const { meta, onOpen, pickedId, onStats, reloadKey, initialScope } = props;
      const [filters, setFilters] = useState({
        q: '', subject: '', status: '', mistake_type: '', range: '', knowledge: '', tag: '',
        scopeQ: false, suspended: false, due: initialScope === 'due', page: 1, pageSize: 20,
      });
      const [items, setItems] = useState([]);
      const [total, setTotal] = useState(0);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [picked, setPicked] = useState({});
      const [bulkOpen, setBulkOpen] = useState(false);
      const [importOpen, setImportOpen] = useState(false);
      const [moreOpen, setMoreOpen] = useState(false);
      const [showFilters, setShowFilters] = useState(false);
      const [qLive, setQLive] = useState('');
      const [notice, setNotice] = useState(null);
      const moreBtnRef = useRef(null);
      const morePop = usePopupAnchor(moreOpen, moreBtnRef, null, 150);   // 「更多」菜单同样 fixed 定位

      // 点外部收起（原来只能再点一次按钮，或点菜单项）
      useEffect(() => {
        if (!moreOpen || typeof document === 'undefined') return undefined;
        const onDown = (event) => {
          const btn = moreBtnRef.current;
          const box = btn && btn.parentNode;
          if (box && box.contains && box.contains(event.target)) return;
          setMoreOpen(false);
        };
        document.addEventListener('mousedown', onDown, true);
        return () => document.removeEventListener('mousedown', onDown, true);
      }, [moreOpen]);

      const patch = (next) => setFilters((current) => Object.assign({}, current, next, { page: 1 }));

      useEffect(() => {
        const timer = setTimeout(() => {
          setQLive(filters.q.trim());
          setFilters((current) => (current.page === 1 ? current : Object.assign({}, current, { page: 1 })));
        }, 250);
        return () => clearTimeout(timer);
      }, [filters.q]);

      const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
          const params = ['page=' + filters.page, 'page_size=' + filters.pageSize, 'thumbs=1'];
          if (qLive) params.push('q=' + encodeURIComponent(qLive));
          if (filters.subject) params.push('subject=' + encodeURIComponent(filters.subject));
          if (filters.status) params.push('status=' + encodeURIComponent(filters.status));
          if (filters.mistake_type) params.push('mistake_type=' + encodeURIComponent(filters.mistake_type));
          if (filters.range) params.push('range=' + encodeURIComponent(filters.range));
          if (filters.knowledge) params.push('knowledge=' + encodeURIComponent(filters.knowledge));
          if (filters.tag) params.push('tag=' + encodeURIComponent(filters.tag.trim()));
          if (filters.due) params.push('due=1');
          if (filters.scopeQ) params.push('scope=question');
          if (filters.suspended) params.push('suspended=all');
          const [page, stats] = await Promise.all([
            data('/api/mistakes?' + params.join('&')),
            data('/api/stats'),
          ]);
          setItems(page && Array.isArray(page.items) ? page.items : []);
          setTotal(page && typeof page.total === 'number' ? page.total : 0);
          if (onStats) onStats(stats);
        } catch (failure) {
          setError(errText(failure));
          setItems([]);
          setTotal(0);
        } finally { setLoading(false); }
      }, [filters, qLive, onStats]);

      useEffect(() => { void load(); }, [load, reloadKey]);

      const pickedIds = Object.keys(picked).map(Number);
      const togglePick = (id) => {
        const next = Object.assign({}, picked);
        if (next[id]) delete next[id]; else next[id] = true;
        setPicked(next);
      };
      const allPicked = items.length > 0 && items.every((item) => picked[item.id]);

      const pages = Math.max(1, Math.ceil(total / filters.pageSize));

      const chips = [];
      if (filters.subject) chips.push(['subject', '学科：' + filters.subject]);
      if (filters.status) chips.push(['status', '状态：' + (filters.status === 'new' ? '未复习' : filters.status === 'reviewing' ? '复习中' : '已掌握')]);
      if (filters.mistake_type) chips.push(['mistake_type', '错因：' + filters.mistake_type]);
      if (filters.knowledge) chips.push(['knowledge', '知识点：' + filters.knowledge]);
      if (filters.tag) chips.push(['tag', '标签：' + filters.tag]);
      if (filters.range) chips.push(['range', '时间：' + (filters.range === 'week' ? '近一周' : '近一月')]);
      if (filters.due) chips.push(['due', '仅到期']);
      if (filters.scopeQ) chips.push(['scopeQ', '只搜题干']);
      if (filters.suspended) chips.push(['suspended', '含已斩题']);

      const clearChip = (key) => {
        const patchObj = {};
        patchObj[key] = (key === 'due' || key === 'scopeQ' || key === 'suspended') ? false : '';
        patch(patchObj);
      };

      // 斩题后默认列表里就看不到它了，必须给个去处，否则用户以为题没了
      const suspendItem = async (item) => {
        const action = item.suspended ? 'resume' : 'suspend';
        try {
          await data('/api/mistakes/' + item.id + '/' + action, { method: 'POST' });
          setNotice(action === 'suspend'
            ? { id: item.id, text: '已斩题 #' + item.id + '：它已移出复习池，默认列表里不再显示。', canView: true, canUndo: true }
            : { id: item.id, text: '已恢复 #' + item.id + ' 的复习。', canView: false, canUndo: false });
          void load();
        } catch (failure) { setError(errText(failure)); }
      };
      const undo = async (id) => {
        try {
          await data('/api/mistakes/' + id + '/resume', { method: 'POST' });
          setNotice(null);
          void load();
        } catch (failure) { setError(errText(failure)); }
      };

      const row = (item) => h('div.mb-item' + (item.id === pickedId ? '.on' : ''), { key: item.id },
        h('div.mb-row', null,
          h('input.mb-pick', {
            type: 'checkbox', checked: !!picked[item.id],
            onChange: (event) => { event.stopPropagation(); togglePick(item.id); },
            onClick: (event) => event.stopPropagation(),
          }),
          h('div', { style: { flex: '1 1 auto', minWidth: '0' }, onClick: () => onOpen(item.id, 'review') },
            h(MathText, { className: 'mb-q', text: clip(item.question, 120) }),
            h('div.mb-meta', null,
              item.id === pickedId && filters.due ? h('span.mb-dot') : null,
              h('span', null, item.subject || '未分科'),
              item.knowledge ? h('span', null, '· ' + clip(item.knowledge, 16)) : null,
              dueText(item) ? h('span.mb-badge.overdue', null, dueText(item)) : null,
              item.review_count ? h('span', null, '复习 ' + item.review_count) : null),
            h('div.mb-meta', null,
              h('button.mb-btn.mini', { type: 'button', onClick: (e) => { e.stopPropagation(); onOpen(item.id, 'review'); } }, '复习'),
              h('button.mb-btn.mini', { type: 'button', onClick: (e) => { e.stopPropagation(); onOpen(item.id, 'edit'); } }, '编辑'),
              h('button.mb-btn.mini', { type: 'button', onClick: (e) => { e.stopPropagation(); void suspendItem(item); } }, item.suspended ? '恢复' : '斩题')))));

      return h('div.mb-left', null,
        h('div.mb-toolbar', null,
          h('input.mb-input', {
            type: 'search', placeholder: '搜题干 / 知识点 / 标签', value: filters.q,
            onChange: (event) => setFilters(Object.assign({}, filters, { q: event.target.value, page: 1 })),
          }),
          h('button.mb-btn' + (showFilters ? '.on' : ''), { type: 'button', onClick: () => setShowFilters(!showFilters) },
            '筛选' + (chips.length ? ' ' + chips.length : '')),
          h('div.mb-seg', null,
            h('button', { className: filters.due ? 'on' : '', onClick: () => patch({ due: true }) }, '到期'),
            h('button', { className: filters.due ? '' : 'on', onClick: () => patch({ due: false }) }, '全部')),
          h('span.mb-spacer'),
          h('div', { style: { position: 'relative' } },
            h('button.mb-btn', {
              type: 'button', ref: moreBtnRef,
              'aria-haspopup': 'menu', 'aria-expanded': moreOpen ? 'true' : 'false',
              onClick: (event) => { event.stopPropagation(); setMoreOpen(!moreOpen); },
            }, '更多 ▾'),
            moreOpen ? h(morePop.dark ? 'div.mb-panel.mb-pop.dark' : 'div.mb-panel.mb-pop', {
              role: 'menu',
              // 面板宽度只有 340px 左右，按钮常被挤到第二行左端；right:0 会让 150px 的菜单跑到视口外，
              // 所以跟下拉一样用 fixed + 坐标夹取。
              style: morePop.pos ? {
                position: 'fixed', top: morePop.pos.top + 'px', left: morePop.pos.left + 'px',
                minWidth: Math.max(morePop.pos.width, 150) + 'px', maxWidth: morePop.pos.maxWidth + 'px', maxHeight: morePop.pos.maxHeight + 'px',
                overflow: 'auto', zIndex: '30', display: 'grid', gap: '4px',
              } : { position: 'absolute', right: '0', top: '30px', zIndex: '30', minWidth: '150px', display: 'grid', gap: '4px' },
            },
              h('button.mb-btn', { type: 'button', onClick: () => { setImportOpen(true); setMoreOpen(false); } }, '批量导入'),
              h('a.mb-btn', { href: rawUrl('/api/export.csv'), target: '_blank', rel: 'noreferrer', onClick: () => setMoreOpen(false), style: { display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' } }, '导出 CSV'),
              h('a.mb-btn', { href: rawUrl('/api/export.json'), target: '_blank', rel: 'noreferrer', onClick: () => setMoreOpen(false), style: { display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' } }, '备份 JSON')) : null)),

        showFilters ? h('div.mb-filters', null,
          h(Dropdown, {
            value: filters.subject, placeholder: '全部学科',
            options: [{ value: '', label: '全部学科' }].concat(
              ((meta && meta.subjects) || []).map((name) => ({ value: name, label: name }))),
            onChange: (value) => patch({ subject: value }),
          }),
          h(Dropdown, {
            value: filters.status, placeholder: '全部状态',
            options: [{ value: '', label: '全部状态' }, { value: 'new', label: '未复习' },
              { value: 'reviewing', label: '复习中' }, { value: 'mastered', label: '已掌握' }],
            onChange: (value) => patch({ status: value }),
          }),
          h(Dropdown, {
            value: filters.mistake_type, placeholder: '全部错因',
            options: [{ value: '', label: '全部错因' }].concat(
              ((meta && meta.mistake_types) || []).map((name) => ({ value: name, label: name }))),
            onChange: (value) => patch({ mistake_type: value }),
          }),
          h(Dropdown, {
            value: filters.range, placeholder: '不限时间',
            options: [{ value: '', label: '不限时间' }, { value: 'week', label: '近一周' },
              { value: 'month', label: '近一月' }],
            onChange: (value) => patch({ range: value }),
          }),
          h(Dropdown, {
            value: filters.knowledge, placeholder: '全部知识点',
            options: [{ value: '', label: '全部知识点' }].concat(
              ((meta && meta.knowledge) || []).map((name) => ({ value: name, label: name }))),
            onChange: (value) => patch({ knowledge: value }),
          }),
          h('input.mb-input', { placeholder: '标签（精确匹配）', value: filters.tag, onChange: (event) => patch({ tag: event.target.value }) }),
          h('label.mb-meta.full', { style: { gap: '12px', marginTop: '2px' } },
            h('label', null, h('input', { type: 'checkbox', checked: filters.scopeQ, onChange: (e) => patch({ scopeQ: e.target.checked }) }), ' 只搜题干'),
            h('label', null, h('input', { type: 'checkbox', checked: filters.suspended, onChange: (e) => patch({ suspended: e.target.checked }) }), ' 含已斩题'))) : null,

        chips.length ? h('div.mb-toolbar', { style: { paddingTop: '4px', paddingBottom: '4px' } },
          chips.map(([key, label]) => h('span.mb-chip', { key },
            label,
            h('button', { type: 'button', style: { border: '0', background: 'transparent', cursor: 'pointer', color: 'inherit' }, onClick: () => clearChip(key) }, '×')))) : null,

        pickedIds.length ? h('div.mb-bulkbar', null,
          h('span', null, '已选 ' + pickedIds.length + ' 道'),
          h('button.mb-btn.mini', { type: 'button', onClick: () => setPicked({}) }, '取消选择'),
          h('span.mb-spacer'),
          h('button.mb-btn.mini', { type: 'button', onClick: () => setBulkOpen(true) }, '批量修改'),
          h('button.mb-btn.mini', { type: 'button', onClick: async () => {
            try {
              await data('/api/mistakes/batch-delete', { method: 'POST', body: JSON.stringify({ ids: pickedIds }) });
              setPicked({});
              void load();
            } catch (failure) { setError(errText(failure)); }
          } }, '批量删除')) : null,

        notice ? h('div.mb-notice', null,
          h('span', { style: { flex: '1 1 auto' } }, notice.text),
          notice.canView ? h('button.mb-btn.mini', { type: 'button', onClick: () => { setNotice(null); patch({ suspended: true }); } }, '查看已斩题') : null,
          notice.canUndo ? h('button.mb-btn.mini', { type: 'button', onClick: () => void undo(notice.id) }, '撤销') : null,
          h('button.mb-btn.mini', { type: 'button', onClick: () => setNotice(null) }, '知道了')) : null,

        h('div.mb-list', null,
          loading && !items.length ? h('div.mb-empty', null, '加载中…') :
            error ? h('div.mb-empty', null, error) :
              !items.length ? h('div.mb-empty', null, filters.due ? '今天没有到期的错题' : '还没有错题') :
                items.map(row)),

        h('div.mb-pager', null,
          h('span', null, '共 ' + total + ' 道 · 第 ' + filters.page + '/' + pages + ' 页'),
          h('button.mb-btn.mini', { type: 'button', disabled: filters.page <= 1, onClick: () => setFilters(Object.assign({}, filters, { page: filters.page - 1 })) }, '上一页'),
          h('button.mb-btn.mini', { type: 'button', disabled: filters.page >= pages, onClick: () => setFilters(Object.assign({}, filters, { page: filters.page + 1 })) }, '下一页'),
          h('label.mb-meta', { style: { marginTop: '0' } },
            h('input', { type: 'checkbox', checked: allPicked, onChange: () => {
              if (allPicked) setPicked({});
              else { const next = {}; items.forEach((item) => { next[item.id] = true; }); setPicked(next); }
            } }), ' 全选')),

        bulkOpen ? h(BulkDialog, {
          ids: pickedIds, meta,
          onClose: () => setBulkOpen(false),
          onDone: () => { setBulkOpen(false); setPicked({}); void load(); },
        }) : null,
        importOpen ? h(ImportDialog, {
          onClose: () => setImportOpen(false),
          onDone: () => { setImportOpen(false); void load(); },
        }) : null);
    }

    /* ── 批量修改 / 批量导入 ─────────────────────────────────────────── */

    function BulkDialog(props) {
      const { ids, meta, onClose, onDone } = props;
      const [fields, setFields] = useState({ status: '', subject: '', mistake_type: '', knowledge: '', difficulty: '', source: '', paper_id: '', tags: '', tagsMode: 'add' });
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');

      const apply = async () => {
        const body = {};
        if (fields.status) body.status = fields.status;
        if (fields.subject.trim()) body.subject = fields.subject.trim();
        if (fields.mistake_type) body.mistake_type = fields.mistake_type;
        if (fields.knowledge.trim()) body.knowledge = fields.knowledge.trim();
        if (fields.source.trim()) body.source = fields.source.trim();
        if (fields.paper_id) body.paper_id = Number(fields.paper_id);
        if (fields.difficulty) body.difficulty = Number(fields.difficulty);
        if (fields.tags.trim()) { body.tags = fields.tags.trim(); body.tags_mode = fields.tagsMode; }
        if (!Object.keys(body).length) { setError('至少选一项要改的内容'); return; }
        setBusy(true);
        try {
          await data('/api/mistakes/bulk-update', { method: 'POST', body: JSON.stringify({ ids, fields: body }) });
          onDone();
        } catch (failure) { setError(errText(failure)); } finally { setBusy(false); }
      };

      return h('div.mb-mask', { onClick: onClose },
        h('div.mb-dlg', { onClick: (e) => e.stopPropagation() },
          h('h3', null, '批量修改 · ' + ids.length + ' 道'),
          h('div.mb-form', { style: { padding: '0' } },
            h('div.mb-row2', null,
              h('div.mb-field', null, h('span', null, '状态'),
                h(Dropdown, {
                  value: fields.status, placeholder: '不改',
                  options: [{ value: '', label: '不改' }, { value: 'new', label: '未复习' },
                    { value: 'reviewing', label: '复习中' }, { value: 'mastered', label: '已掌握' }],
                  onChange: (value) => setFields(Object.assign({}, fields, { status: value })),
                })),
              h('div.mb-field', null, h('span', null, '学科'),
                h('input', { value: fields.subject, onChange: (e) => setFields(Object.assign({}, fields, { subject: e.target.value })) }))),
            h('div.mb-row2', null,
              h('div.mb-field', null, h('span', null, '错因分类'),
                h(Dropdown, {
                  value: fields.mistake_type, placeholder: '不改',
                  options: [{ value: '', label: '不改' }].concat(
                    ((meta && meta.mistake_types) || []).map((name) => ({ value: name, label: name }))),
                  onChange: (value) => setFields(Object.assign({}, fields, { mistake_type: value })),
                })),
              h('div.mb-field', null, h('span', null, '知识点'),
                h('input', { value: fields.knowledge, onChange: (e) => setFields(Object.assign({}, fields, { knowledge: e.target.value })) }))),
            h('div.mb-row2', null,
              h('div.mb-field', null, h('span', null, '难度'),
                h(Dropdown, {
                  value: fields.difficulty, placeholder: '不改',
                  options: [{ value: '', label: '不改' }].concat(
                    [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n + ' 星' }))),
                  onChange: (value) => setFields(Object.assign({}, fields, { difficulty: value })),
                })),
              h('div.mb-field', null, h('span', null, '标签'),
                h('input', { value: fields.tags, onChange: (e) => setFields(Object.assign({}, fields, { tags: e.target.value })), placeholder: '逗号分隔' }))),
            h('div.mb-row2', null,
              h('div.mb-field', null, h('span', null, '来源'),
                h('input', { value: fields.source, onChange: (e) => setFields(Object.assign({}, fields, { source: e.target.value })), placeholder: '如 期中、练习册' })),
              h('div.mb-field', null, h('span', null, '试卷'),
                h(Dropdown, {
                  value: fields.paper_id, placeholder: '不改',
                  options: [{ value: '', label: '不改' }].concat(
                    ((meta && meta.papers) || []).map((paper) => ({ value: String(paper.id), label: paper.name || ('#' + paper.id) }))),
                  onChange: (value) => setFields(Object.assign({}, fields, { paper_id: value })),
                }))),
            h('div.mb-field', null, h('span', null, '标签方式'),
              h(Dropdown, {
                value: fields.tagsMode,
                options: [{ value: 'add', label: '追加到原有' }, { value: 'set', label: '替换原有' }, { value: 'remove', label: '从原有移除' }],
                onChange: (value) => setFields(Object.assign({}, fields, { tagsMode: value })),
              })),
            error ? h('div.mb-note.bad', null, error) : null,
            h('div.mb-formfoot', null,
              h('button.mb-btn.primary', { type: 'button', onClick: () => void apply(), disabled: busy }, busy ? '修改中…' : '应用'),
              h('button.mb-btn', { type: 'button', onClick: onClose, disabled: busy }, '取消')))));
    }

    function ImportDialog(props) {
      const { onClose, onDone } = props;
      const [text, setText] = useState('');
      const [report, setReport] = useState(null);
      const [busy, setBusy] = useState(false);

      // 导入成功就返回 onDone（关窗 + 刷新列表）；没导入过直接关
      const close = () => (report && report.created ? onDone() : onClose());

      const submit = async () => {
        if (!text.trim()) return;
        setBusy(true);
        try {
          const r = await data('/api/mistakes/batch', { method: 'POST', body: JSON.stringify({ text }) });
          const created = r.created_count || 0;
          const dup = r.duplicate_count || 0;
          const bad = r.error_count || 0;
          const lines = [];
          if (!created && !dup && !bad) {
            lines.push('没解析出任何错题：每段请以「题目:」开头，段与段之间用一行 --- 或空行分开。');
          }
          (r.errors || []).forEach((x) => lines.push('第 ' + (x.index + 1) + ' 段没导入：' + x.error));
          (r.duplicates || []).forEach((x) => lines.push('第 ' + (x.index + 1) + ' 段与已有错题重复，已跳过（#' + x.id + '）'));
          setReport({ created, dup, bad, lines });
        } catch (failure) {
          setReport({ created: 0, dup: 0, bad: 0, lines: ['导入失败：' + errText(failure)] });
        } finally { setBusy(false); }
      };

      const again = () => { setText(''); setReport(null); };

      return h('div.mb-mask', { onClick: close },
        h('div.mb-dlg', { onClick: (e) => e.stopPropagation() },
          h('h3', null, '批量导入'),
          h('div.mb-empty', { style: { textAlign: 'left', padding: '0 0 8px' } },
            '一条错题一段：段与段之间用一行 --- 或空行分开（下一段以「题目:」开头即可）。',
            '字段写成「题目: …」「答案: …」「知识点: …」，不带键名的行接在上一条后面。'),
          h('textarea', {
            value: text, rows: 12, style: { width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: '12px', borderRadius: '8px', border: '1px solid var(--mb-line,rgba(127,127,127,.3))', background: 'transparent', color: 'inherit', padding: '8px' },
            placeholder: '题目: 求 lim x→0 sinx/x\n我的答案: 0\n答案: 1\n知识点: 极限\n错因: 概念不清\n---\n题目: 第二题\n答案: 2',
            onChange: (e) => setText(e.target.value),
          }),
          report ? h('div', { style: { marginTop: '8px' } },
            h('div.mb-note', null, '成功 ' + report.created + ' 条'
              + (report.dup ? '，重复跳过 ' + report.dup + ' 条' : '')
              + (report.bad ? '，失败 ' + report.bad + ' 条' : '')),
            report.lines.length ? h('div.mb-note.bad', { style: { whiteSpace: 'pre-wrap', marginTop: '4px' } }, report.lines.join('\n')) : null) : null,
          h('div.mb-formfoot', { style: { marginTop: '8px' } },
            report && (report.created || report.dup || report.bad)
              ? h('button.mb-btn', { type: 'button', onClick: again }, '继续导入')
              : h('button.mb-btn.primary', { type: 'button', onClick: () => void submit(), disabled: busy || !text.trim() }, busy ? '导入中…' : '导入'),
            h('button.mb-btn' + (report && report.created ? '.primary' : ''), { type: 'button', onClick: close, disabled: busy },
              report && report.created ? '完成' : '关闭'))));
    }

    /* ── 学习页：知识点画像 + 树 + 别名 + 变式缺口 ───────────────────── */

    function StudyView(props) {
      const meta = props.meta || {};
      const [subject, setSubject] = useState('');
      const [mastery, setMastery] = useState(null);
      const [tree, setTree] = useState(null);
      const [aliases, setAliases] = useState(null);
      const [gaps, setGaps] = useState(null);
      const [error, setError] = useState('');
      const [alias, setAlias] = useState('');
      const [canonical, setCanonical] = useState('');
      const [version, setVersion] = useState(0);

      useEffect(() => {
        let cancelled = false;
        const qs = subject ? '?subject=' + encodeURIComponent(subject) : '';
        setError('');
        Promise.all([
          data('/api/mastery' + qs),
          data('/api/knowledge/tree' + qs),
          data('/api/knowledge/aliases'),
          data('/api/variants/gaps?limit=8' + (subject ? '&subject=' + encodeURIComponent(subject) : '')),
        ]).then(([m, t, a, g]) => {
          if (cancelled) return;
          setMastery(m); setTree(t); setAliases(a); setGaps(g);
        }).catch((failure) => { if (!cancelled) setError(errText(failure)); });
        return () => { cancelled = true; };
      }, [subject, version]);

      const addAlias = async () => {
        if (!alias.trim() || !canonical.trim()) return;
        try {
          await data('/api/knowledge/aliases', { method: 'POST', body: JSON.stringify({ alias: alias.trim(), canonical: canonical.trim() }) });
          setAlias(''); setCanonical(''); setVersion(version + 1);
        } catch (failure) { setError(errText(failure)); }
      };

      const dropAlias = async (name) => {
        try {
          await data('/api/knowledge/aliases/' + encodeURIComponent(name), { method: 'DELETE' });
          setVersion(version + 1);
        } catch (failure) { setError(errText(failure)); }
      };

      const renderTree = (nodes, depth) => (nodes || []).map((node) => h('div', { key: node.path, style: { marginLeft: (depth * 16) + 'px' } },
        h('div.mb-hrow', null,
          h('span', { style: { flex: '1 1 auto' } }, node.name),
          h('span.mb-badge', null, (node.stats && node.stats.mistakes || 0) + ' 题'),
          node.stats && node.stats.due ? h('span.mb-badge.overdue', null, node.stats.due + ' 到期') : null,
          node.stats && node.stats.accuracy !== null && node.stats.accuracy !== undefined
            ? h('span.mb-badge.type', null, '正确率 ' + Math.round(node.stats.accuracy * 100) + '%') : null,
          h('span.mb-badge', null, (node.stats && node.stats.band && node.stats.band.label) || '薄弱'),
          node.stats && node.stats.mastered_gate ? h('span.mb-note', null, '✓ 过门禁') : null),
        renderTree(node.children, depth + 1)));

      if (error) return h('div.mb-empty', null, error);
      if (!mastery || !tree) return h('div.mb-empty', null, '加载中…');

      const bands = mastery.band_counts || {};
      const points = (mastery.pending || []).concat(mastery.passed || []);
      const thresholds = mastery.thresholds || {};

      return h('div.mb-detail', null,
        h('div.mb-toolbar', { style: { padding: '0 0 10px', borderBottom: '0' } },
          h(Dropdown, {
            value: subject, placeholder: '全部学科',
            options: [{ value: '', label: '全部学科' }].concat(
              (meta.subjects || []).map((name) => ({ value: name, label: name }))),
            onChange: (value) => setSubject(value),
          }),
          h('span.mb-spacer'),
          h('span.mb-stats', null, '知识点 ' + mastery.points_total + ' 个 · 已过门禁 ' + mastery.passed_total + ' 个')),

        h('div.mb-block', null,
          h('div.mb-panel', null,
            h('div.mb-meta', { style: { gap: '14px', marginTop: '0' } },
              h('span', null, '🟥 薄弱 ', h('b', null, String(bands.weak || 0))),
              h('span', null, '🟨 一般 ', h('b', null, String(bands.fair || 0))),
              h('span', null, '🟩 良好 ', h('b', null, String(bands.good || 0))),
              h('span', null, '🟦 已牢固 ', h('b', null, String(bands.mastered || 0)))),
            h('div.mb-axis', null, h('span', null, '门禁：≥' + thresholds.min_mistakes + ' 道题 / 连续答对 ≥' + thresholds.min_stage + ' 次 / 稳定性 ≥' + thresholds.min_stability + ' 天')))),

        h('div.mb-block', null,
          h('div.mb-label', null, '知识点画像'),
          points.length ? h('div', null, points.map((point) => h('div.mb-panel', { key: point.knowledge, style: { marginBottom: '8px' } },
            h('div.mb-meta', { style: { marginTop: '0' } },
              h('b', null, point.knowledge),
              h('span.mb-badge', null, (point.band && point.band.label) || '薄弱'),
              h('span.mb-badge', null, point.mistakes + ' 道题'),
              point.due ? h('span.mb-badge.overdue', null, point.due + ' 道待复习') : null,
              point.mastered_gate ? h('span.mb-note', null, '✓ 已过门禁') : h('span.mb-badge', null, '未过：' + (point.gate_reasons || []).join('；'))),
            h('div.mb-meta', { style: { marginTop: '4px' } },
              h('span', null, '正确率 ', h('b', null, point.accuracy === null || point.accuracy === undefined ? '—' : Math.round(point.accuracy * 100) + '%')),
              h('span', null, '稳定性 ', h('b', null, String(point.avg_stability)), ' 天'),
              h('span', null, '最低 ', h('b', null, String(point.min_stability)), ' 天'),
              h('span', null, '连对 ', h('b', null, String(point.min_stage))),
              h('span', null, '遗忘 ', h('b', null, String(point.lapses))),
              h('span', null, '复习 ', h('b', null, String(point.reviews)))))))
            : h('div.mb-empty', null, '还没有带知识点的错题。录入时填「知识点」，这里就会按知识点聚合出你的薄弱项。')),

        h('div.mb-block', null,
          h('div.mb-label', null, '知识点树 · 叶子 ' + tree.leaf_total + ' · 最深 ' + tree.depth_max + ' 层 · 未归类 ' + tree.unclassified + ' 道'),
          tree.roots && tree.roots.length
            ? h('div.mb-panel', null, renderTree(tree.roots, 0))
            : h('div.mb-empty', null, '还没有分层知识点。录入时把知识点写成「函数/单调性」这样的路径，这里就会长出树。')),

        h('div.mb-block', null,
          h('div.mb-label', null, '知识点别名'),
          aliases && aliases.items && aliases.items.length
            ? h('div.mb-panel', null, aliases.items.map((row) => h('div.mb-hrow', { key: row.alias },
                h('span', { style: { flex: '1 1 auto' } }, row.alias + ' → ' + row.canonical),
                h('button.mb-btn.mini', { type: 'button', onClick: () => void dropAlias(row.alias) }, '删'))))
            : h('div.mb-empty', null, '还没有别名。同一知识点写成「函数单调性」和「函数/单调性」时，登记一次就能合并统计。'),
          h('div.mb-row2', { style: { marginTop: '8px' } },
            h('input.mb-input', { placeholder: '别名', value: alias, onChange: (e) => setAlias(e.target.value) }),
            h('input.mb-input', { placeholder: '指向的标准知识点', value: canonical, onChange: (e) => setCanonical(e.target.value) })),
          h('div.mb-formfoot', null,
            h('button.mb-btn', { type: 'button', onClick: () => void addAlias(), disabled: !alias.trim() || !canonical.trim() }, '登记别名'))),

        h('div.mb-block', null,
          h('div.mb-label', null, '变式缺口（错得多但没变式）'),
          gaps && gaps.items && gaps.items.length
            ? h('div.mb-panel', null, gaps.items.map((row) => h('div.mb-hrow', { key: row.id },
                h(MathText, { className: 'mb-q', style: { flex: '1 1 auto' }, text: clip(row.question, 70) }),
                h('span.mb-htime', null, (row.variant_count ? '变式 ' + row.variant_count + ' 条' : '无变式') + ' · 错 ' + row.wrong + ' 次'))))
            : h('div.mb-empty', null, '暂时没有缺口。')));
    }

    /* ── 计划页 ───────────────────────────────────────────────────────── */

    function PlanView(props) {
      const meta = props.meta || {};
      const onOpen = props.onOpen;
      const settings = meta.settings || {};
      const savedLimit = String(settings.daily_limit || 20);
      const [days, setDays] = useState('7');
      const [limit, setLimit] = useState(savedLimit);
      const [subject, setSubject] = useState('');
      const [report, setReport] = useState(null);
      const [error, setError] = useState('');
      const [limitNote, setLimitNote] = useState('');
      const [limitDraft, setLimitDraft] = useState(savedLimit);

      useEffect(() => {
        let cancelled = false;
        const params = '?days=' + days + '&limit=' + limit + (subject ? '&subject=' + encodeURIComponent(subject) : '');
        data('/api/plan' + params)
          .then((value) => { if (!cancelled) { setReport(value); setError(''); } })
          .catch((failure) => { if (!cancelled) setError(errText(failure)); });
        return () => { cancelled = true; };
      }, [days, limit, subject]);

      // meta 是异步来的：等它到了（或别处改了 settings 后刷新）再把上限同步过来
      useEffect(() => {
        const next = String((meta.settings || {}).daily_limit || 20);
        setLimit(next);
        setLimitDraft(next);
      }, [(meta.settings || {}).daily_limit]);

      // 每日上限：改一次就写进后端 settings，下次打开还是这个数（范围 1–200，与后端一致）
      const applyLimit = async (raw) => {
        const text = String(raw == null ? '' : raw).trim();
        const num = Number(text);
        if (!text || !Number.isFinite(num) || Math.round(num) !== num || num < 1 || num > 200) {
          setLimitNote('请输入 1–200 的整数');
          setLimitDraft(String(limit));
          return;
        }
        setLimitNote('');
        setLimitDraft(String(num));
        setLimit(String(num));
        try {
          await data('/api/settings', { method: 'PUT', body: JSON.stringify({ daily_limit: num }) });
          if (props.onSettingsSaved) props.onSettingsSaved();
        } catch (failure) { setLimitNote(errText(failure)); }
      };

      if (error) return h('div.mb-empty', null, error);
      if (!report) return h('div.mb-empty', null, '排期中…');

      return h('div.mb-detail', null,
        h('div.mb-toolbar', { style: { padding: '0 0 10px', borderBottom: '0', alignItems: 'center' } },
          h(Dropdown, {
            value: days, placeholder: '未来 7 天',
            options: [{ value: '7', label: '未来 7 天' }, { value: '14', label: '未来 14 天' },
              { value: '30', label: '未来 30 天' }],
            onChange: (value) => setDays(value),
          }),
          h('label.mb-meta', { style: { gap: '6px', marginTop: '0' } },
            h('span', null, '每天'),
            h('input.mb-input', {
              type: 'number', min: '1', max: '200', step: '1', value: limitDraft,
              style: { width: '76px', flex: '0 0 auto', minWidth: '0' },
              title: '每日复习上限 1-200',
              onChange: (event) => setLimitDraft(event.target.value),
              onBlur: (event) => void applyLimit(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') { event.preventDefault(); void applyLimit(event.target.value); }
              },
            }),
            h('span', null, '道')),
          h(Dropdown, {
            value: subject, placeholder: '全部学科',
            options: [{ value: '', label: '全部学科' }].concat(
              (meta.subjects || []).map((name) => ({ value: name, label: name }))),
            onChange: (value) => setSubject(value),
          }),
          limitNote ? h('span.mb-note.bad', null, limitNote) : null),
        h('div.mb-block', null,
          h('div.mb-panel', null,
            h('div.mb-meta', { style: { gap: '14px', marginTop: '0' } },
              h('span', null, '今天要做 ', h('b', null, String(report.today_count)), ' 道'),
              h('span', null, '逾期 ', h('b', null, String(report.overdue)), ' 道'),
              h('span', null, '窗口内 ', h('b', null, String(report.total)), ' 道'),
              h('span', null, '每日上限 ', h('b', null, String(report.daily_limit))),
              report.overflow ? h('span.mb-note.bad', null, '排不下 ' + report.overflow + ' 道，加大上限或延长天数') : null))),
        !report.total ? h('div.mb-empty', null, '未来 ' + report.window_days + ' 天没有要复习的题。去录几道，或把状态改成「复习中」。') :
          (report.days || []).filter((day) => day.count).map((day) => h('div.mb-block', { key: day.date },
            h('div.mb-dayhead', null, h('b', null, day.label), h('span', null, day.date), h('span.mb-badge', null, day.count + ' 道')),
            h('div.mb-panel', null, day.items.map((item) => h('button.mb-hrow.pickable', {
              key: item.id, type: 'button', title: onOpen ? '在「错题」页打开这道题' : '',
              onClick: () => { if (onOpen) onOpen(item.id); },
            },
              h(MathText, { className: 'mb-q', style: { flex: '1 1 auto' }, text: clip(item.question, 70) }),
              h('span.mb-badge', null, item.subject || '未分科'),
              dueText(item) ? h('span.mb-badge.overdue', null, dueText(item)) : null))))));
    }

    /* ── 分析页 ───────────────────────────────────────────────────────── */

    function hbars(items, opts) {
      const options = opts || {};
      if (!items || !items.length) return h('div.mb-empty', null, '暂无数据');
      const max = Math.max.apply(null, items.map((row) => row.count || 0)) || 1;
      return h('div', null, items.map((row) => h('div.mb-brow', { key: row.name },
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: row.name }, row.name || '未分类'),
        h('div.mb-track', null, h('div.mb-fill' + (options.warn ? '.warn' : ''), { style: { width: Math.round((row.count || 0) / max * 100) + '%' } })),
        h('b', { style: { textAlign: 'right' } }, options.percent ? Math.round(row.count || 0) + '%' : String(row.count || 0)))));
    }

    function AnalyticsView() {
      const [days, setDays] = useState(30);
      const [report, setReport] = useState(null);
      const [error, setError] = useState('');

      useEffect(() => {
        let cancelled = false;
        data('/api/analytics?days=' + days)
          .then((value) => { if (!cancelled) { setReport(value); setError(''); } })
          .catch((failure) => { if (!cancelled) setError(errText(failure)); });
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
      const weakest = Array.isArray(retention.weakest) ? retention.weakest : [];

      return h('div.mb-detail', null,
        h('div.mb-block', null,
          h('div.mb-label', null, '统计窗口'),
          h('div.mb-seg', null,
            [7, 30, 90].map((n) => h('button', { key: n, className: days === n ? 'on' : '', onClick: () => setDays(n) }, '近 ' + n + ' 天')))),

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
              h('div.mb-track', null, h('div.mb-fill', { style: { width: Math.round((bucket.count || 0) / maxBucket * 100) + '%' } })),
              h('span', { style: { textAlign: 'right' } }, String(bucket.count || 0)))),
            retention.note ? h('div.mb-axis', null, h('span', null, retention.note)) : null)),

        weakest.length ? h('div.mb-block', null,
          h('div.mb-label', null, '最快会忘的题'),
          h('div.mb-panel', null, weakest.map((row) => h('div.mb-brow', { key: row.id },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: row.knowledge }, row.knowledge || ('#' + row.id)),
            h('div.mb-track', null, h('div.mb-fill.warn', { style: { width: Math.round((row.retention || 0) * 100) + '%' } })),
            h('b', { style: { textAlign: 'right' } }, Math.round((row.retention || 0) * 100) + '%'))))) : null,

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

        h('div.mb-block', null, h('div.mb-label', null, '错因分布'), hbars(types)),
        h('div.mb-block', null, h('div.mb-label', null, '学科分布'), hbars(subs)),

        (Array.isArray(report.by_step) && report.by_step.length) ? h('div.mb-block', null,
          h('div.mb-label', null, '错在哪一步 · 共 ' + report.by_step.reduce((sum, row) => sum + (row.count || 0), 0) + ' 次断点'),
          h('div', null, report.by_step.map((row) => h('span.mb-chip', { key: row.name }, row.name, h('b', null, String(row.count))))),
          (Array.isArray(report.step_patterns) && report.step_patterns.length)
            ? h('div.mb-panel', { style: { marginTop: '8px' } },
                report.step_patterns.map((row) => h('div.mb-hrow', { key: row.knowledge + '|' + row.step },
                  h('span.mb-htime', null, row.knowledge),
                  h('span', null, row.step),
                  h('span.mb-meta', { style: { marginTop: '0', marginLeft: 'auto' } }, h('span', null, '错了 ' + row.count + ' 次')))))
            : null) : null);
    }

    /* ── 再战区 ───────────────────────────────────────────────────────── */

    function ArenaView(props) {
      const meta = props.meta || {};
      const [show, setShow] = useState('zone');
      const [subject, setSubject] = useState('');
      const [report, setReport] = useState(null);
      const [error, setError] = useState('');
      const [version, setVersion] = useState(0);

      useEffect(() => {
        let cancelled = false;
        data('/api/arena?limit=100&show=' + show + (subject ? '&subject=' + encodeURIComponent(subject) : ''))
          .then((value) => { if (!cancelled) { setReport(value); setError(''); } })
          .catch((failure) => { if (!cancelled) setError(errText(failure)); });
        return () => { cancelled = true; };
      }, [show, subject, version]);

      const suspend = async (id) => {
        try {
          await data('/api/mistakes/' + id + '/suspend', { method: 'POST' });
          setVersion(version + 1);
        } catch (failure) { setError(errText(failure)); }
      };

      if (error) return h('div.mb-empty', null, error);
      if (!report) return h('div.mb-empty', null, '加载中…');
      const counts = report.counts || {};

      return h('div.mb-detail', null,
        h('div.mb-toolbar', { style: { padding: '0 0 10px', borderBottom: '0' } },
          h('div.mb-seg', null,
            h('button', { className: show === 'zone' ? 'on' : '', onClick: () => setShow('zone') }, '在战区'),
            h('button', { className: show === 'cleared' ? 'on' : '', onClick: () => setShow('cleared') }, '已出区')),
          h(Dropdown, {
            value: subject, placeholder: '全部学科',
            options: [{ value: '', label: '全部学科' }].concat(
              (meta.subjects || []).map((name) => ({ value: name, label: name }))),
            onChange: (value) => setSubject(value),
          })),
        h('div.mb-block', null,
          h('div.mb-panel', null,
            h('div.mb-meta', { style: { gap: '14px', marginTop: '0' } },
              h('span', null, '在战区 ', h('b', null, String(counts.zone || 0)), ' 道'),
              h('span', null, '已出区 ', h('b', null, String(counts.cleared || 0)), ' 道'),
              h('span', null, '已斩 ', h('b', null, String(counts.suspended || 0)), ' 道'),
              h('span', null, '进区条件：错满 ', h('b', null, String((report.rule || {}).min_wrong || 0)), ' 次')))),
        !report.items || !report.items.length
          ? h('div.mb-empty', null, show === 'cleared'
            ? '还没有题出区。上次答错之后连对 ' + ((report.rule || {}).clear_streak || 0) + ' 次就会出区。'
            : '再战区是空的。同一道题错满 ' + ((report.rule || {}).min_wrong || 0) + ' 次就会自动进来。')
          : h('div', null, report.items.map((item) => h('div.mb-panel', { key: item.id, style: { marginBottom: '8px' } },
              h('div.mb-meta', { style: { marginTop: '0' } },
                h('span.mb-badge.overdue', null, '错 ' + item.wrong_count + ' 次'),
                h('span.mb-badge', null, item.subject || '未分科'),
                item.knowledge ? h('span.mb-badge.type', null, item.knowledge) : null,
                h('span.mb-badge', null, '连对 ' + item.correct_streak + '/' + item.need_streak),
                h('span.mb-badge', null, '正确率 ' + (item.accuracy === null || item.accuracy === undefined ? '—' : Math.round(item.accuracy * 100) + '%')),
                h('button.mb-btn.mini', { type: 'button', onClick: () => void suspend(item.id) }, '斩题')),
              h(MathText, { style: { marginTop: '6px' }, text: clip(item.question, 160) }),
              h('div.mb-meta', null,
                h('span', null, '上次：' + (RESULT_LABEL[item.last_result] || '未复习')),
                item.last_reviewed_at ? h('span', null, String(item.last_reviewed_at).slice(0, 10)) : null,
                item.next_review_at ? h('span', null, '下次 ' + String(item.next_review_at).slice(0, 10)) : null,
                h('span', null, '复习 ' + item.review_count + ' 次'))))),
        report.truncated ? h('div.mb-empty', null, '只显示前 ' + report.limit + ' 道，先清一批再来') : null);
    }

    /* ── 回收站 ───────────────────────────────────────────────────────── */

    function TrashView() {
      const [report, setReport] = useState(null);
      const [error, setError] = useState('');
      const [version, setVersion] = useState(0);

      useEffect(() => {
        let cancelled = false;
        data('/api/trash?limit=100')
          .then((value) => { if (!cancelled) { setReport(value); setError(''); } })
          .catch((failure) => { if (!cancelled) setError(errText(failure)); });
        return () => { cancelled = true; };
      }, [version]);

      const act = async (id, restore) => {
        try {
          if (restore) await data('/api/trash/' + id + '/restore', { method: 'POST' });
          else await data('/api/trash/' + id, { method: 'DELETE' });
          setVersion(version + 1);
        } catch (failure) { setError(errText(failure)); }
      };

      const purgeAll = async () => {
        try {
          await data('/api/trash/purge', { method: 'POST' });
          setVersion(version + 1);
        } catch (failure) { setError(errText(failure)); }
      };

      if (error) return h('div.mb-empty', null, error);
      if (!report) return h('div.mb-empty', null, '加载中…');

      return h('div.mb-detail', null,
        h('div.mb-toolbar', { style: { padding: '0 0 10px', borderBottom: '0' } },
          h('span.mb-stats', null, report.total ? '共 ' + report.total + ' 条，可恢复' : '回收站是空的'),
          h('span.mb-spacer'),
          report.total ? h('button.mb-btn', { type: 'button', onClick: () => void purgeAll() }, '清空回收站') : null),
        !report.total
          ? h('div.mb-empty', null, '回收站是空的。删除错题后会先放到这里，可随时恢复。')
          : h('div', null, report.items.map((item) => h('div.mb-panel', { key: item.id, style: { marginBottom: '8px' } },
              h('div.mb-meta', { style: { marginTop: '0' } },
                h('span.mb-badge', null, item.subject || '未分类'),
                h('span', null, '删除于 ' + item.deleted_at),
                item.log_count ? h('span', null, '复习记录 ' + item.log_count + ' 条') : null,
                h('span.mb-spacer'),
                h('button.mb-btn.mini', { type: 'button', onClick: () => void act(item.id, true) }, '恢复'),
                h('button.mb-btn.mini', { type: 'button', onClick: () => void act(item.id, false) }, '彻底删除')),
              h(MathText, { style: { marginTop: '6px' }, text: clip(item.question, 160) }))),
            report.total > report.items.length
              ? h('div.mb-empty', null, '共 ' + report.total + ' 条，只显示最近 ' + report.items.length + ' 条') : null));
    }

    /* ── 主体 ─────────────────────────────────────────────────────────── */

    const TABS = [
      ['list', '错题'], ['study', '学习'], ['plan', '计划'],
      ['an', '分析'], ['arena', '再战'], ['trash', '回收站'],
    ];

    function MistakeBookApp(props) {
      const SessionProvider = props.SessionProvider;
      const renderFactorySlot = props.renderFactorySlot;
      const [tab, setTab] = useState('list');
      const [stats, setStats] = useState(null);
      const [meta, setMeta] = useState(null);
      const [detailId, setDetailId] = useState(0);
      const [detailMode, setDetailMode] = useState('review');
      const [creating, setCreating] = useState(false);
      const [reloadKey, setReloadKey] = useState(0);
      const [remind, setRemind] = useState(null);
      const [formBusy, setFormBusy] = useState(false);
      const [formError, setFormError] = useState('');
      const [fromPlan, setFromPlan] = useState(false);   // 详情是否从「计划」页跳过来

      useEffect(() => {
        let cancelled = false;
        data('/api/meta')
          .then((value) => { if (!cancelled) setMeta(value); })
          .catch(() => { /* 候选值拿不到不影响主流程，输入框退化成自由文本 */ });
        return () => { cancelled = true; };
      }, []);

      useEffect(() => {
        let cancelled = false;
        data('/api/reminders')
          .then((value) => { if (!cancelled) setRemind(value); })
          .catch(() => { /* 提醒失败不值得弄崩面板 */ });
        return () => { cancelled = true; };
      }, [reloadKey]);

      const total = stats && typeof stats.total === 'number' ? stats.total : 0;
      const due = stats && typeof stats.due === 'number' ? stats.due : 0;

      const reload = useCallback(() => setReloadKey((key) => key + 1), []);

      const open = useCallback((id, mode) => {
        setCreating(false);
        setFromPlan(false);
        setDetailId(id);
        setDetailMode(mode === 'edit' ? 'edit' : 'review');
      }, []);

      // 计划页点某道题 → 切到错题页并打开它的详情；返回时回到计划页
      const openFromPlan = useCallback((id) => {
        setCreating(false);
        setFromPlan(true);
        setDetailId(id);
        setDetailMode('review');
        setTab('list');
      }, []);

      const backToPlan = useCallback(() => {
        setFromPlan(false);
        setDetailId(0);
        setTab('plan');
      }, []);

      // 设置改完要让 meta 里的 settings 跟上，否则下次进计划页会拿旧上限
      const refreshMeta = useCallback(() => {
        data('/api/meta').then((value) => setMeta(value)).catch(() => { /* 拿不到就沿用旧值 */ });
      }, []);

      const create = async (body) => {
        setFormBusy(true);
        setFormError('');
        try {
          const item = await data('/api/mistakes', { method: 'POST', body: JSON.stringify(body) });
          setCreating(false);
          if (item && item.id) { setDetailId(item.id); setDetailMode('review'); }
          reload();
        } catch (failure) {
          setFormError(errText(failure));
        } finally { setFormBusy(false); }
      };

      const showRemind = remind && remind.should_notify &&
        (typeof localStorage === 'undefined' || localStorage.getItem(REMIND_KEY) !== String(remind.now || '').slice(0, 10));

      return h('div.mb', null,
        h('header.mb-head', null,
          h('span.mb-title', null, '错题本'),
          h('span.mb-stats', null, '共 ' + total + ' 道 · 到期 ' + due + ' 道'),
          h('div.mb-tabs', null, TABS.map((pair) => h('button', {
            key: pair[0], type: 'button', className: tab === pair[0] ? 'on' : '',
            onClick: () => { setTab(pair[0]); setCreating(false); setFromPlan(false); },
          }, pair[1]))),
          h('span.mb-spacer'),
          h('button.mb-btn.primary', { type: 'button', onClick: () => { setCreating(true); setDetailId(0); setTab('list'); } }, '＋ 新建')),

        showRemind ? h('div.mb-remind', null,
          h('span', { style: { flex: '1 1 auto' } }, '📌 ' + remind.message),
          h('button.mb-btn.mini', { type: 'button', onClick: () => {
            try { localStorage.setItem(REMIND_KEY, String(remind.now || '').slice(0, 10)); } catch (ignored) { /* 隐私模式下写不进去 */ }
            setRemind(null);
          } }, '知道了')) : null,

        tab === 'list' ? h('div.mb-split', null,
          h(ListTab, { meta, onOpen: open, pickedId: detailId, onStats: setStats, reloadKey, initialScope: 'all' }),
          h('div.mb-right', null,
            creating ? h(ItemForm, {
              key: 'new', meta, initial: null, onSave: create,
              onCancel: () => setCreating(false), busy: formBusy, error: formError, submitLabel: '保存',
            }) :
              detailId ? h(DetailPane, {
                key: detailId + ':' + detailMode,
                id: detailId, mode: detailMode, meta,
                onChanged: reload, SessionProvider, renderFactorySlot,
                onBack: fromPlan ? backToPlan : null,
              }) :
                h('div.mb-empty', null, '从左栏选一道错题，或点「＋ 新建」'))) :
          tab === 'study' ? h(StudyView, { meta }) :
            tab === 'plan' ? h(PlanView, { meta, onOpen: openFromPlan, onSettingsSaved: refreshMeta }) :
              tab === 'an' ? h(AnalyticsView, null) :
                tab === 'arena' ? h(ArenaView, { meta }) :
                  h(TrashView, null));
    }

    function MistakeBookIcon(props) {
      const size = (props && props.size) || 18;
      return h('svg', { width: size, height: size, viewBox: '0 0 18 18', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3.4, y: 2.6, width: 11.2, height: 12.8, rx: 2, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M6.2 9.1l1.9 1.9 3.7-3.9', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }));
    }

    injectStyles(CSS);

    return {
      inject: ['slots', 'sessions'],
      apply(ctx) {
        if (!ctx || !ctx.slots) return;
        hostServices.sessions = hostService(ctx, 'sessions');
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID,
          children: { 'mistake-book.session': { kind: 'single', scope: 'session' } },
        }, MistakeBookApp));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 41, label: '错题',
        }, MistakeBookIcon));
      },
      // 只给测试用：组件没导出，渲染测试要单独渲染它们（见 tests/test_client_render.mjs）。
      // 宿主只读 inject / apply，多这一个键没有副作用。
      __test__: {
        MistakeBookApp, ListTab, DetailPane, ItemForm, HistoryBlock, VariantsBlock,
        StudyView, PlanView, AnalyticsView, ArenaView, TrashView, BulkDialog, ImportDialog,
        Dropdown, isLightColor, MathText,
      },
    };
  },
});
