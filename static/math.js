/* 公式渲染（v0.20）：把文本里的 $...$ / $$...$$ 交给本地 KaTeX。
   没有网络、没有构建步骤；KaTeX 不可用时原样显示，不影响读题。 */
(function (global) {
  'use strict';

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function tex(src, display) {
    if (!global.katex) { return esc(display ? '$$' + src + '$$' : '$' + src + '$'); }
    try {
      return global.katex.renderToString(src, {
        displayMode: display, throwOnError: false, strict: 'ignore', output: 'html'
      });
    } catch (err) {
      return esc(display ? '$$' + src + '$$' : '$' + src + '$');
    }
  }

  // 把一段纯文本转成 HTML：普通字符转义，$...$ 里的公式渲染。
  // 不配对的 $ 当普通字符，避免一道题里出现价格符号就把后半段全吞了。
  function render(text) {
    var src = String(text == null ? '' : text);
    if (src.indexOf('$') < 0) { return esc(src); }
    var out = '';
    var i = 0;
    while (i < src.length) {
      var at = src.indexOf('$', i);
      if (at < 0) { out += esc(src.slice(i)); break; }
      out += esc(src.slice(i, at));
      if (src.substr(at, 2) === '$$') {
        var end = src.indexOf('$$', at + 2);
        if (end > at + 2) { out += tex(src.slice(at + 2, end), true); i = end + 2; continue; }
        out += esc('$$'); i = at + 2; continue;
      }
      var close = src.indexOf('$', at + 1);
      if (close > at + 1) { out += tex(src.slice(at + 1, close), false); i = close + 1; continue; }
      out += esc('$'); i = at + 1;
    }
    return out;
  }

  // 已经渲染进 DOM 的纯文本（比如服务端生成的打印页）就地替换。
  function apply(root) {
    if (!root || !global.katex) { return; }
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) { nodes.push(walker.currentNode); }
    nodes.forEach(function (node) {
      var value = node.nodeValue;
      if (!value || value.indexOf('$') < 0) { return; }
      var parent = node.parentNode;
      if (!parent || parent.closest('.katex')) { return; }
      var holder = document.createElement('span');
      holder.innerHTML = render(value);
      while (holder.firstChild) { parent.insertBefore(holder.firstChild, node); }
      parent.removeChild(node);
    });
  }

  global.mbMath = { render: render, apply: apply, esc: esc };
})(window);
