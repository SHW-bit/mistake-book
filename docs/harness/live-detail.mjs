// 用真实接口数据渲染详情页（含真图片），便于核对图片归位与整体版式。
// 用法：node docs/harness/live-detail.mjs <client.js> <输出目录> [mistakeId] [apiBase]
import fs from 'node:fs';
import path from 'node:path';

const CLIENT = process.argv[2];
const OUT = process.argv[3];
const MID = process.argv[4] || '13';
const BASE = process.argv[5] || 'http://127.0.0.1:8000';
if (!CLIENT || !OUT) { console.error('用法: node live-detail.mjs <client.js> <输出目录> [id] [base]'); process.exit(1); }

const src = fs.readFileSync(CLIENT, 'utf8');
const start = src.indexOf('const CSS = [');
const end = src.indexOf("].join('');", start);
const RAW = new Function('return ' + src.slice(start + 'const CSS = '.length, end + 1))();
const light = RAW.filter((r) => r.indexOf('@media (prefers-color-scheme:dark)') !== 0);
const darkVars = RAW.filter((r) => r.indexOf('@media (prefers-color-scheme:dark)') === 0)
  .map((r) => r.replace('@media (prefers-color-scheme:dark){', '').replace(/}$/, '')).join('');
const dark = RAW.map((r) => (r.indexOf('@media (prefers-color-scheme:dark)') === 0 ? darkVars : r));

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const json = await (await fetch(BASE + '/api/mistakes/' + MID)).json();
const item = json.data || json;
const images = Array.isArray(item.images) ? item.images : [];
const fieldOf = (img) => (img && img.field) || 'question';
const KNOWN = ['question', 'wrong', 'answer', 'analysis'];
const imgsFor = (f) => images.filter((i) => fieldOf(i) === f);
const srcOf = (img) => img.data || (BASE + img.url);
const imgRow = (list) => list.length ? '<div class="mb-imgs">' + list.map((img, i) =>
  '<a class="mb-thumb" href="#" target="_blank" rel="noreferrer"><img src="' + srcOf(img) + '" alt="图片 ' + (i + 1) + '"></a>').join('') + '</div>' : '';
const stars = (n) => '★★★☆☆'.slice(0, Math.max(0, Math.min(5, n || 3))) + '☆☆☆☆☆'.slice(0, 5 - Math.max(0, Math.min(5, n || 3)));

const questionImgs = imgsFor('question').concat(images.filter((i) => KNOWN.indexOf(fieldOf(i)) < 0));
const html = [
  '<div class="mb-detail">',
  '<div class="mb-card q"><div class="mb-cardhead">题目 #' + item.id + '</div>',
  '<div class="mb-qbig">' + esc(item.question) + '</div>', imgRow(questionImgs), '</div>',
  (item.my_answer || imgsFor('wrong').length) ? '<div class="mb-card"><div class="mb-cardhead">我的答案</div>' +
    (item.my_answer ? '<div class="mb-text">' + esc(item.my_answer) + '</div>' : '') + imgRow(imgsFor('wrong')) + '</div>' : '',
  '<div class="mb-card"><div class="mb-cardhead">正确答案</div><div class="mb-text">' + esc(item.answer || '（未填）') + '</div>',
  imgRow(imgsFor('answer')),
  item.analysis ? '<div style="margin-top:12px"><div class="mb-cardhead">解析</div><div class="mb-text">' + esc(item.analysis) + '</div></div>' : '',
  imgRow(imgsFor('analysis')), '</div>',
  '<div class="mb-card"><div class="mb-cardhead">属性</div>',
  '<div class="mb-attr"><span class="mb-attrlabel">错因</span><span>' + esc([item.mistake_type, item.error_reason].filter(Boolean).join(' —— ')) + '</span></div>',
  '<div class="mb-attr">' + (item.subject ? '<span class="mb-badge">' + esc(item.subject) + '</span>' : '') +
  (item.knowledge ? '<span class="mb-badge type">' + esc(item.knowledge) + '</span>' : '') +
  (item.source ? '<span class="mb-badge">' + esc(item.source) + '</span>' : '') +
  '<span class="mb-badge">难度 ' + stars(item.difficulty) + '</span>' +
  '<span class="mb-badge">复习 ' + (item.review_count || 0) + ' 次</span></div>',
  item.tags ? '<div class="mb-attr"><span class="mb-attrlabel">标签</span>' + String(item.tags).split(',').filter(Boolean).map((t) => '<span class="mb-tag">' + esc(t) + '</span>').join('') + '</div>' : '',
  '</div>',
  '<div class="mb-card"><div class="mb-cardhead">复习历史</div><div class="mb-empty compact">还没复习过</div></div>',
  '<div class="mb-card"><div class="mb-cardhead">变式题</div><div class="mb-empty compact">还没有变式题</div></div>',
  '<div class="mb-card"><div class="mb-cardhead">这次记得怎么样</div>',
  '<div class="mb-step"><span>错在哪一步</span><div class="mb-dd">不记录</div></div>',
  '<div class="mb-rate">' + ['忘了', '勉强', '记得', '很熟'].map((t) => '<button class="mb-ratebtn">' + t + '</button>').join('') + '</div></div>',
  '<div class="mb-card"><div class="mb-facts"><button class="mb-btn mini">编辑</button><button class="mb-btn mini">标记掌握</button><button class="mb-btn mini">斩题</button><button class="mb-btn mini danger">删除</button></div>',
  '<button class="mb-btn primary mb-cta2">让 AI 带我复习这道</button></div>',
  '</div>',
].join('');

const page = (w, css, isDark) => '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">\n'
  + '<title>live detail ' + w + '</title>\n<style>\n'
  + 'html,body{margin:0;height:100%;background:' + (isDark ? '#1b1d21' : '#fff') + ';color:' + (isDark ? '#ecedf0' : '#1c1c19') + ';font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}\n'
  + '#stage{width:' + w + 'px;min-height:100%}\n' + css.join('\n') + '\n</style></head>\n<body><div id="stage"><div class="mb">'
  + html + '</div></div></body></html>';

fs.mkdirSync(OUT, { recursive: true });
for (const w of [420, 1280]) {
  fs.writeFileSync(path.join(OUT, 'live-' + w + '.html'), page(w, light, false), 'utf8');
  fs.writeFileSync(path.join(OUT, 'live-' + w + '-dark.html'), page(w, dark, true), 'utf8');
}
console.log('生成完毕：' + OUT + '（题目 #' + item.id + '，图片 ' + images.length + ' 张：' + images.map((i) => fieldOf(i)).join(',') + '）');
