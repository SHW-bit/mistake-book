/* 错题本 DSH 插件 · 根行宿主半。
 *
 * 这一行（cordis.patch.yml 里的 mistake-book-panel，name 是**裸包名** dsh-mistake-book）
 * 存在的唯一理由是客户端半：宿主只从**根 loader 行**发现 dsh.client，而且行名必须是裸包名
 * （dsh-client-modules 的 exactPackageSpecifier 对含 "/" 的子路径返回 undefined）。
 * 预设里那两行用的是 dsh-mistake-book/tools（工具域，按预设作用域挂），它们发现不到客户端半。
 *
 * 所以这里只挂两条路由：
 *   · POST /api/mistake-book/session —— 按「错题复习」预设建会话（lib/session.js）；
 *   · GET|POST /api/mistake-book/data —— 数据代理，把面板的 /api/* 转发给本机服务（lib/proxy.js）。
 * 第二条是因为面板与错题本服务不同源，而 app.py 不发 CORS 头（见 lib/proxy.js 开头）。
 *
 * 工具不在这儿注册——工具归 /tools 子路径，由两条预设按作用域各自挂，别在根上重复注册一份。
 */

import { registerSessionRoute } from './session.js';
import { registerDataRoute } from './proxy.js';

export const name = 'mistake-book-plugin';

/**
 * @param {any} ctx 插件根上下文
 * @param {any} config 插件行 config 段（url / home / python）
 */
export function apply(ctx, config) {
  registerSessionRoute(ctx, config);
  registerDataRoute(ctx, config);
}
