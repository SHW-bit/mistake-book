/* 错题本 DSH 插件 · 宿主半：数据代理（面板读列表 / 读详情 / 写评分走这条）。
 *
 * 为什么要代理：面板跑在 DSH 的网页里（http://127.0.0.1:<随机端口>），错题本服务在
 * http://127.0.0.1:8000 —— 两个 origin。app.py 不发任何 CORS 头（它只服务同源的网页版），
 * 所以浏览器直连 8000 会被同源策略拦掉：GET 读不到响应体，带 JSON 的 POST 连预检都过不去。
 *
 * 给 app.py 加 CORS 也能通，但那样任何本机网页都能读走整个错题本、还能提交评分——
 * 为了一块面板把本地库敞开，不值得。改由宿主转发：浏览器只跟自己的 origin 说话，
 * 目标地址由宿主从插件行 config 里取，客户端只能指定 /api/* 相对路径。
 *
 * 这条路由和建会话路由一样，只在根行上挂一次（见 lib/plugin.js）。
 */

import { call, callRaw, settings } from './api.js';

/** 路由路径（客户端按它 GET/POST，真实路径放 ?path=）。 */
export const DATA_PATH = '/api/mistake-book/data';

/**
 * 只放行本服务的 /api/* 相对路径。
 * 不做这个检查，?path= 就能被改成任意地址（SSRF），或跳出 /api 去打别的接口。
 */
export function isAllowedPath(target) {
  if (typeof target !== 'string' || target === '') return false;
  if (!target.startsWith('/api/')) return false;
  if (target === '/api/') return false;
  if (target.includes('//') || target.includes('..') || target.includes('\\')) return false;
  return true;
}

/**
 * 把数据代理挂到插件上。
 * @param {any} ctx 插件根上下文
 * @param {any} config 插件行 config 段（url / home / python）
 */
export function registerDataRoute(ctx, config) {
  if (!ctx || typeof ctx.inject !== 'function') return;
  const s = settings(config);
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx && connectionCtx.connection;
    if (!connection || !connection.fetch || typeof connection.fetch.register !== 'function') return;
    if (typeof connectionCtx.effect !== 'function') return;
    connectionCtx.effect(() => connection.fetch.register({
      path: DATA_PATH,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let target = '';
        let raw = false;
        try {
          const query = new URL(request.url).searchParams;
          target = query.get('path') || '';
          raw = query.get('raw') === '1';
        } catch {
          target = '';
        }
        if (!isAllowedPath(target)) {
          return Response.json({
            ok: false,
            error: { code: 'path-invalid', message: 'path 参数要是本服务的 /api/* 路径' },
          }, { status: 400 });
        }
        const init = { method: request.method };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          const text = await request.text();
          if (text) init.body = text;
        }
        if (raw) {
          // 导出：把上游的字节与 Content-Disposition 原样交回浏览器，才会触发下载。
          try {
            const got = await callRaw(s, target, init);
            const headers = { 'content-type': got.contentType };
            if (got.disposition) headers['content-disposition'] = got.disposition;
            return new Response(got.bytes || got.body, { status: got.status, headers });
          } catch (error) {
            const message = error && error.message ? error.message : String(error);
            return Response.json({
              ok: false,
              error: { code: 'upstream-failed', message },
            }, { status: 502 });
          }
        }
        try {
          const data = await call(s, target, init);
          // 客户端按 {ok,data} 信封拆（与直连 app.py 时同一个形状）。
          return Response.json({ ok: true, data });
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          return Response.json({
            ok: false,
            error: { code: 'upstream-failed', message },
          }, { status: 502 });
        }
      },
    }), '错题本: 数据代理路由');
  });
}
