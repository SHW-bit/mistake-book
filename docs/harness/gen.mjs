// 面板视觉 harness：把 dsh-plugin/lib/client.js 里的 CSS 抽出来，拼成静态 HTML，
// 用于 vision_html_screenshot 渲染 / 浏览器目视 / CDP 量尺寸。
// 用法：node docs/harness/gen.mjs <client.js 路径> <输出目录>
import fs from 'node:fs';
import path from 'node:path';

const CLIENT = process.argv[2];
const OUT = process.argv[3];
if (!CLIENT || !OUT) {
  console.error('用法: node gen.mjs <dsh-plugin/lib/client.js> <输出目录>');
  process.exit(1);
}
const src = fs.readFileSync(CLIENT, 'utf8');
const start = src.indexOf('const CSS = [');
const end = src.indexOf("].join('');", start);
const body = src.slice(start + 'const CSS = '.length, end + 1);
const RAW = new Function('return ' + body)();

// 浅色版：去掉 dark 媒体查询；深色版：把 dark 里的变量声明展开到 .mb 上
const light = RAW.filter((r) => r.indexOf('@media (prefers-color-scheme:dark)') !== 0);
const darkVars = RAW.filter((r) => r.indexOf('@media (prefers-color-scheme:dark)') === 0)
  .map((r) => r.replace('@media (prefers-color-scheme:dark){', '').replace(/}$/, ''))
  .join('');
const dark = RAW.map((r) => (r.indexOf('@media (prefers-color-scheme:dark)') === 0 ? darkVars : r));

const thumb = '<img class="mb-listthumb" alt="" src="data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2284%22 height=%2284%22%3E%3Crect width=%2284%22 height=%2284%22 fill=%22%23dfe3e8%22/%3E%3Cpath d=%22M14 60 L32 34 L46 52 L56 40 L70 60 Z%22 fill=%22%23b9c0c9%22/%3E%3C/svg%3E">';

const item = (cls, q, chips, withThumb) => [
  '<div class="mb-item ' + cls + '">',
  '  <div class="mb-row">',
  '    <input class="mb-pick" type="checkbox">',
  '    <div class="mb-main">',
  '      <div class="mb-q">' + q + '</div>',
  '      <div class="mb-tags">' + chips + '</div>',
  '    </div>',
  withThumb ? '    <div class="mb-thumbwrap">' + thumb + '</div>' : '',
  '  </div>',
  '  <div class="mb-rowacts"><button class="mb-act">复习</button><button class="mb-act">编辑</button><button class="mb-act">斩题</button></div>',
  '</div>',
].filter(Boolean).join('\n');

const items = [
  item('st-overdue', '求极限 $\\lim_{x\\to 0}\\frac{\\sin 3x}{\\tan 5x}$ 的值，并说明等价无穷小替换的条件。', '<span class="mb-badge overdue">逾期 2 天</span><span class="mb-tag">高数</span><span class="mb-tag k">极限</span><span class="mb-tag">概念不清</span><span class="mb-tag n">复习 3</span>'),
  item('st-new', '设函数 $f(x)=x^3-3x+1$，求其单调区间与极值点。', '<span class="mb-tag">高数</span><span class="mb-tag k">导数</span><span class="mb-tag n">复习 0</span>', true),
  item('st-reviewing', '计算二重积分 $\\iint_D (x+y)\\,dxdy$，其中 $D$ 由 $y=x^2$ 与 $y=x$ 围成。', '<span class="mb-badge overdue">今天</span><span class="mb-tag">高数</span><span class="mb-tag k">重积分</span><span class="mb-tag n">复习 2</span>'),
  item('st-mastered', '判断级数 $\\sum_{n=1}^{\\infty}\\frac{(-1)^n}{\\sqrt{n}}$ 的敛散性。', '<span class="mb-tag">高数</span><span class="mb-tag k">级数</span><span class="mb-tag n">复习 5</span>'),
  item('st-reviewing', '已知 $A$ 为三阶矩阵，$|A|=2$，求 $|2A^{-1}|$。', '<span class="mb-tag">线代</span><span class="mb-tag k">行列式</span><span class="mb-tag n">复习 1</span>'),
  item('st-suspended', '求曲线 $y=\\ln x$ 在点 $(1,0)$ 处的切线方程。', '<span class="mb-tag">高数</span><span class="mb-tag k">导数</span><span class="mb-tag n">复习 4</span>'),
];
const listHtml = items.join('\n').replace('class="mb-item st-overdue"', 'class="mb-item st-overdue on"');

const detail = [
  '<div class="mb-detail">',
  '  <div class="mb-card q"><div class="mb-cardhead">题目 #128</div>',
  '    <div class="mb-qbig">求极限 $\\lim_{x\\to 0}\\frac{\\sin 3x}{\\tan 5x}$ 的值，并说明等价无穷小替换的条件。</div></div>',
  '  <div class="mb-card"><div class="mb-cardhead">我的答案</div>',
  '    <div class="mb-text">直接用 sin3x ~ 3x，tan5x ~ 5x，得 3/5。</div></div>',
  '  <div class="mb-reveal"><button class="mb-btn primary mb-cta">看答案与解析</button></div>',
  '  <div class="mb-card"><div class="mb-cardhead">属性</div>',
  '    <div class="mb-attr"><span class="mb-attrlabel">错因</span><span>概念不清 —— 等价替换只在乘除因子下成立，这里是整体比值</span></div>',
  '    <div class="mb-attr"><span class="mb-badge">高数</span><span class="mb-badge type">极限</span><span class="mb-badge">作业</span><span class="mb-badge">难度 ★★★</span><span class="mb-badge">复习 3 次</span><span class="mb-badge overdue">逾期 2 天</span></div>',
  '    <div class="mb-attr"><span class="mb-attrlabel">标签</span><span class="mb-tag">等价无穷小</span><span class="mb-tag">极限</span></div></div>',
  '  <div class="mb-card"><div class="mb-cardhead">复习历史</div>',
  '    <div class="mb-reveal"><button class="mb-btn">查看 · 复习 3 次 · 正确率 67%</button></div></div>',
  '  <div class="mb-card"><div class="mb-cardhead">变式题</div>',
  '    <div class="mb-empty compact">还没有变式。加一条同知识点的新题，练习时就会轮换到它。</div></div>',
  '  <div class="mb-card"><div class="mb-cardhead">这次记得怎么样</div>',
  '    <div class="mb-step"><span>错在哪一步</span><span class="mb-badge">不记录</span></div>',
  '    <div class="mb-rate">',
  '      <button><b>忘了</b><span>again · 1天</span></button>',
  '      <button><b>模糊</b><span>hard · 3天</span></button>',
  '      <button><b>记得</b><span>good · 7天</span></button>',
  '      <button><b>简单</b><span>easy · 21天</span></button>',
  '    </div></div>',
  '  <div class="mb-card"><div class="mb-facts"><button class="mb-btn">编辑</button><button class="mb-btn">标记掌握</button><button class="mb-btn">斩题</button><button class="mb-btn danger">删除</button></div><button class="mb-btn primary mb-cta2">让 AI 带我复习这道</button></div>',
  '</div>',
].join('\n');

const page = (w, css, isDark) => '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">\n<title>panel harness ' + w + (isDark ? ' dark' : '') + '</title>\n<style>\n'
  + 'html,body{margin:0;height:100%;background:' + (isDark ? '#1b1d21' : '#fff') + ';color:' + (isDark ? '#ecedf0' : '#1c1c19') + ';font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}\n'
  + '#stage{height:100%;width:' + w + 'px;overflow:hidden}\n' + css.join('\n') + '\n</style></head>\n<body><div id="stage"><div class="mb">\n'
  + '<header class="mb-head"><div class="mb-headtop">'
  + '<span class="mb-title">错题本</span><span class="mb-stats">共 <b>128</b> 道 · 到期 <b>7</b> 道</span>'
  + '<span class="mb-spacer"></span><button class="mb-btn primary">＋ 新建</button></div>'
  + '<div class="mb-tabs"><button class="on">错题</button><button>学习</button><button>计划</button><button>分析</button><button>再战</button><button>回收站</button></div>'
  + '</header>\n<div class="mb-split"><div class="mb-left">'
  + '<div class="mb-toolbar"><input class="mb-input" type="search" placeholder="搜题干 / 知识点 / 标签">'
  + '<button class="mb-btn on">筛选 2</button><div class="mb-seg"><button>到期</button><button class="on">全部</button></div>'
  + '<span class="mb-spacer"></span><button class="mb-btn">更多 ▾</button></div>'
  + '<div class="mb-list">\n' + listHtml + '\n</div>'
  + '<div class="mb-pager"><button class="mb-btn mini">上一页</button><span>共 128 道 · 第 1/7 页</span><button class="mb-btn mini">下一页</button></div>'
  + '</div><div class="mb-right">\n' + detail + '\n</div></div>\n</div></div></body></html>';

fs.mkdirSync(OUT, { recursive: true });
for (const w of [420, 900, 1280]) {
  fs.writeFileSync(path.join(OUT, 'panel-' + w + '.html'), page(w, light, false), 'utf8');
  fs.writeFileSync(path.join(OUT, 'panel-' + w + '-dark.html'), page(w, dark, true), 'utf8');
}
console.log('生成完毕：' + OUT + '（420 / 900 / 1280，浅色 + 深色）');

/* ── 录入表单页（v0.29 双栏 + 图片导入区） ─────────────────────────── */
const field = (label, control) => '<div class="mb-field"><span>' + label + '</span>' + control + '</div>';
const input = (ph) => '<input placeholder="' + (ph || '') + '">';
const sel = (txt) => '<select><option>' + txt + '</option></select>';

const THUMB = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" fill="#dde3f5"/></svg>');

const formHtml = [
  '<div class="mb-form mb-form2">',
  '  <div class="mb-fmain">',
  '  <div class="mb-fb top">',
  '    <div class="mb-fbhead"><span class="mb-fblabel">题目（必填）</span><button class="mb-fbact" type="button">＋ 图片</button><span class="mb-fbtip">拖入 · Ctrl+V</span></div>',
  '    <textarea rows="6" placeholder="粘贴题干…（截图可直接 Ctrl+V）"></textarea>',
  '  </div>',
  '  <div class="mb-fb me">',
  '    <div class="mb-fbhead"><span class="mb-fblabel">我的错误答案</span><button class="mb-fbact" type="button">＋ 图片</button><span class="mb-fbtip">拖入 · Ctrl+V</span></div>',
  '    <textarea rows="5" placeholder="当时是怎么想的…"></textarea>',
  '  </div>',
  '  <div class="mb-fb ok">',
  '    <div class="mb-fbhead"><span class="mb-fblabel">正确答案</span><button class="mb-fbact" type="button">＋ 图片</button><span class="mb-fbtip">拖入 · Ctrl+V</span></div>',
  '    <textarea rows="5" placeholder="标准答案…"></textarea>',
  '    <div class="mb-fbimgs">',
  '      <div class="mb-fbthumb"><img src="' + THUMB + '" alt="附图"><button type="button">×</button></div>',
  '      <div class="mb-fbthumb"><img src="' + THUMB + '" alt="附图"><button type="button">×</button></div>',
  '    </div>',
  '  </div>',
  '  <div class="mb-fb">',
  '    <div class="mb-fbhead"><span class="mb-fblabel">解析</span><button class="mb-fbact" type="button">＋ 图片</button><span class="mb-fbtip">拖入 · Ctrl+V</span></div>',
  '    <textarea rows="5" placeholder="关键步骤、易错点…"></textarea>',
  '  </div>',
  '  </div>',
  '  <div class="mb-fside">',
  '    <label class="mb-field"><span>学科</span><input value="数学"></label>',
  '    <label class="mb-field"><span>知识点</span><input value="导数"></label>',
  '    <label class="mb-field"><span>错因分类</span><input value="概念不清"></label>',
  '    <label class="mb-field"><span>来源</span><input value="月考"></label>',
  '    <label class="mb-field"><span>标签（逗号分隔）</span><input value="极值"></label>',
  '    <label class="mb-field"><span>难度</span><input value="3"></label>',
  '    <label class="mb-field"><span>状态</span><input value="待复习"></label>',
  '    <label class="mb-field"><span>错因详细描述</span><textarea rows="3"></textarea></label>',
  '  </div>',
  '  <div class="mb-formfoot"><button class="mb-btn primary">保存</button><button class="mb-btn">取消</button></div>',
  '</div>',].join('\n');

const formPage = (w, css, isDark) => '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">\n<title>form ' + w + '</title>\n<style>\n'
  + 'html,body{margin:0;height:100%;background:' + (isDark ? '#1b1d21' : '#f4f4f2') + ';color:' + (isDark ? '#ecedf0' : '#1c1c19') + ';font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}\n'
  + '#stage{height:100%;width:' + w + 'px;overflow:auto;background:' + (isDark ? '#232529' : '#fff') + ';box-sizing:border-box}\n' + css.join('\n') + '\n</style></head>\n<body><div id="stage"><div class="mb">\n'
  + formHtml + '\n</div></div></body></html>';

const pageHtml = (w, css, isDark) => '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">\n<title>page ' + w + '</title>\n<style>\n'
  + 'html,body{margin:0;height:100%;background:' + (isDark ? '#1b1d21' : '#f4f4f2') + ';color:' + (isDark ? '#ecedf0' : '#1c1c19') + ';font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}\n'
  + '#stage{height:100%;width:' + w + 'px;overflow:auto;background:' + (isDark ? '#232529' : '#fff') + ';box-sizing:border-box}\n' + css.join('\n') + '\n</style></head>\n<body><div id="stage"><div class="mb">'
  + '<div class="mb-detail mb-page"><div class="mb-toolbar" style="padding:0 0 10px;border-bottom:0"><button class="mb-btn mini" type="button">← 返回错题</button><span class="mb-pagetitle">新建错题</span></div>'
  + formHtml + '</div></div></div></body></html>';

for (const w of [420, 900, 1280]) {
  fs.writeFileSync(path.join(OUT, 'form-' + w + '.html'), formPage(w, light, false), 'utf8');
  fs.writeFileSync(path.join(OUT, 'form-' + w + '-dark.html'), formPage(w, dark, true), 'utf8');
  fs.writeFileSync(path.join(OUT, 'page-' + w + '.html'), pageHtml(w, light, false), 'utf8');
  fs.writeFileSync(path.join(OUT, 'page-' + w + '-dark.html'), pageHtml(w, dark, true), 'utf8');
}
console.log('表单页生成完毕');
