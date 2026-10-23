// 详情页单独渲染：只放 .mb-detail，便于在窄屏完整看清（gen.mjs 的 panel 页在 420 下详情被列表挤到折叠以下）。
// 用法：node docs/harness/detail.mjs <client.js> <输出目录>
import fs from 'node:fs';
import path from 'node:path';

const CLIENT = process.argv[2];
const OUT = process.argv[3];
if (!CLIENT || !OUT) { console.error('用法: node detail.mjs <client.js> <输出目录>'); process.exit(1); }

const src = fs.readFileSync(CLIENT, 'utf8');
const start = src.indexOf('const CSS = [');
const end = src.indexOf("].join('');", start);
const RAW = new Function('return ' + src.slice(start + 'const CSS = '.length, end + 1))();
const light = RAW.filter((r) => r.indexOf('@media (prefers-color-scheme:dark)') !== 0);
const darkVars = RAW.filter((r) => r.indexOf('@media (prefers-color-scheme:dark)') === 0)
  .map((r) => r.replace('@media (prefers-color-scheme:dark){', '').replace(/}$/, '')).join('');
const dark = RAW.map((r) => (r.indexOf('@media (prefers-color-scheme:dark)') === 0 ? darkVars : r));

const gen = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'gen.mjs'), 'utf8');
const a = gen.indexOf('const detail = [');
const b = gen.indexOf("].join('\\n');", a);
const detailHtml = new Function('return ' + gen.slice(a + 'const detail = '.length, b + 1))();

const page = (w, css, isDark) => '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">\n'
  + '<title>detail ' + w + (isDark ? ' dark' : '') + '</title>\n<style>\n'
  + 'html,body{margin:0;height:100%;background:' + (isDark ? '#1b1d21' : '#fff') + ';color:' + (isDark ? '#ecedf0' : '#1c1c19') + ';font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}\n'
  + '#stage{width:' + w + 'px;min-height:100%}\n' + css.join('\n') + '\n</style></head>\n<body><div id="stage"><div class="mb">'
  + detailHtml + '</div></div></body></html>';

fs.mkdirSync(OUT, { recursive: true });
for (const w of [420, 900, 1280]) {
  fs.writeFileSync(path.join(OUT, 'detail-' + w + '.html'), page(w, light, false), 'utf8');
  fs.writeFileSync(path.join(OUT, 'detail-' + w + '-dark.html'), page(w, dark, true), 'utf8');
}
console.log('详情页生成完毕：' + OUT);
