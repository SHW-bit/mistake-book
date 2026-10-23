/* 错题本 DSH 插件 · 与本机错题本服务通信的最小客户端。
 *
 * 零依赖：只用 Node 内置的 fetch / child_process。不 import 任何 @deepseek-ai/*，
 * 因为 profile 的 pnpm 严格布局下解析不到宿主类型包（studymate 也是同一口径）。
 *
 * 职责有二：
 *   1. 把插件配置（url / home / python）归一化成 settings；
 *   2. 服务没起时自动拉起 python app.py，并等它健康——这样模型调工具不需要
 *      用户先手动开一个终端。拉起失败不抛，让真正的请求去报错。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * 错题本仓库的默认位置：优先取环境变量 MISTAKE_BOOK_HOME，
 * 否则按插件文件自身位置往上两级（dsh-plugin/lib -> 仓库根），
 * 这样 clone 到任何目录都不用改代码。插件行仍可用 config.home 覆盖。
 */
export const DEFAULT_HOME = process.env.MISTAKE_BOOK_HOME
  || fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
/** 默认服务地址；只绑本机回环，与 app.py 的默认 --host 一致。 */
export const DEFAULT_URL = 'http://127.0.0.1:8000';
/**
 * 兜底解释器：优先 MISTAKE_BOOK_PYTHON，其次 Windows 上的 py 启动器，
 * 最后交给 PATH 里的 python（不硬编码某个人的安装路径）。
 */
export const DEFAULT_PYTHON = process.env.MISTAKE_BOOK_PYTHON
  || (process.platform === 'win32' ? 'py' : 'python3');

/**
 * 归一化插件配置。
 * @param {unknown} config 插件行的 config 段。
 * @returns {{url: string, home: string, python: string}} 去尾斜杠后的设置。
 */
export function settings(config) {
  const cfg = config && typeof config === 'object' ? config : {};
  const url = String(cfg.url || DEFAULT_URL).replace(/\/+$/, '');
  return {
    url,
    home: String(cfg.home || DEFAULT_HOME),
    python: cfg.python ? String(cfg.python) : '',
  };
}

/** 一次健康探测；不抛异常，只回答「通不通」。 */
async function probe(url, timeoutMs = 1200) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url + '/api/health', { signal });
    return res.ok;
  } catch {
    return false;
  }
}

/** 每个进程只拉起一次，避免并发工具调用各起一个服务。 */
let starting = null;

/**
 * 确保服务在跑。已经在跑就直接返回；否则 spawn 一个 detached 的 python，
 * 然后最多等 12 秒健康。
 * @param {{url: string, home: string, python: string}} s 归一化设置。
 * @returns {Promise<boolean>} 探测结束时服务是否可用。
 */
export async function ensureServer(s) {
  if (await probe(s.url)) return true;
  if (!starting) {
    starting = (async () => {
      let port = '8000';
      try {
        port = new URL(s.url).port || '80';
      } catch {
        return false;
      }
      const candidates = s.python ? [s.python] : ['python', DEFAULT_PYTHON];
      for (const exe of candidates) {
        try {
          const child = spawn(exe, ['app.py', '--port', port], {
            cwd: s.home,
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });
          child.on('error', () => {});
          child.unref();
        } catch {
          continue;
        }
        for (let i = 0; i < 48; i++) {
          await new Promise((r) => setTimeout(r, 250));
          if (await probe(s.url, 800)) return true;
        }
      }
      return false;
    })().finally(() => { starting = null; });
  }
  return starting;
}

/**
 * 调一个 API，拆掉 {ok, data} 信封只回 data。
 * @param {{url: string, home: string, python: string}} s 归一化设置。
 * @param {string} path 以 / 开头的路径与查询串。
 * @param {RequestInit} [init] fetch 选项。
 * @returns {Promise<any>} 响应里的 data（没有信封时是原 body）。
 */
export async function call(s, path, init) {
  await ensureServer(s);
  let res;
  try {
    res = await fetch(s.url + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init && init.headers) },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error('连不上错题本服务（' + s.url + '）：' + (err && err.message ? err.message : String(err))
      + '。服务没起来时插件会自动拉起，仍失败请手动在 ' + s.home + ' 里跑 python app.py');
  }
  const raw = await res.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const detail = body && (body.error || body.message);
    throw new Error(typeof detail === 'string' && detail
      ? detail
      : 'HTTP ' + res.status + ' ' + raw.slice(0, 300));
  }
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

/**
 * 原样取回响应（导出 CSV / 备份 JSON 用）。与 call 的区别是**不解析**也不拆信封：
 * 导出接口回的是文件流，解析成 JSON 就废了。
 * @param {{url: string, home: string, python: string}} s 归一化设置。
 * @param {string} path 以 / 开头的路径与查询串。
 * @param {RequestInit} [init] fetch 选项。
 * @returns {Promise<{status: number, contentType: string, disposition: string, body: string}>}
 */
export async function callRaw(s, path, init) {
  await ensureServer(s);
  let res;
  try {
    res = await fetch(s.url + path, {
      ...init,
      headers: { ...(init && init.headers) },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error('连不上错题本服务（' + s.url + '）：' + (err && err.message ? err.message : String(err)));
  }
  // v0.32：先取字节再解码文本。原来直接 res.text() 会把二进制（图片）当 UTF-8 解码，
  // 字节被替换成 U+FFFD，前端拿到的永远是坏图。body 保留文本形态给 CSV 用，
  // bytes 给 raw 通道原样回吐。
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || 'application/octet-stream',
    disposition: res.headers.get('content-disposition') || '',
    body: bytes.toString('utf8'),
    bytes,
  };
}
