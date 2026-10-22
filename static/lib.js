/*
 * 错题本前端纯函数（v0.15）
 *
 * 这些函数不碰 DOM、不碰网络，抽出来是为了能用 node --test 直接测。
 * 浏览器里挂到 window.MB，Node 里走 module.exports。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.MB = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function stars(n) {
    var out = '';
    for (var i = 1; i <= 5; i++) { out += i <= n ? '★' : '☆'; }
    return out;
  }

  // 本地时间戳，格式与服务端一致（不能用 toISOString，那是 UTC）
  function localStamp(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function isOverdue(it) {
    if (!it || !it.next_review_at || it.status === 'mastered') { return false; }
    return it.next_review_at <= localStamp(new Date());
  }

  return { esc: esc, stars: stars, localStamp: localStamp, isOverdue: isOverdue };
});
