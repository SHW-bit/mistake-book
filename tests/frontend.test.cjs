/*
 * 前端纯函数测试（v0.15）
 *
 * 用 Node 自带的 node:test，不需要装任何依赖：
 *   node --test tests/frontend.test.cjs
 * 也可以用 python -m unittest discover -s tests 一起跑（见 test_frontend.py）。
 */
const test = require('node:test');
const assert = require('node:assert');
const MB = require('../static/lib.js');

test('esc 转义 HTML 特殊字符', () => {
  assert.strictEqual(MB.esc('<script>'), '&lt;script&gt;');
  assert.strictEqual(MB.esc('a & b'), 'a &amp; b');
  assert.strictEqual(MB.esc('"x"'), '&quot;x&quot;');
  assert.strictEqual(MB.esc("it's"), 'it&#39;s');
});

test('esc 对空值返回空串', () => {
  assert.strictEqual(MB.esc(null), '');
  assert.strictEqual(MB.esc(undefined), '');
  assert.strictEqual(MB.esc(0), '0');
});

test('stars 生成 5 个星，实心按难度', () => {
  assert.strictEqual(MB.stars(0), '☆☆☆☆☆');
  assert.strictEqual(MB.stars(3), '★★★☆☆');
  assert.strictEqual(MB.stars(5), '★★★★★');
});

test('localStamp 用本地时间并补零', () => {
  const d = new Date(2026, 0, 2, 3, 4, 5);
  assert.strictEqual(MB.localStamp(d), '2026-01-02 03:04:05');
});

test('isOverdue 只看到期且未掌握', () => {
  const past = '2000-01-01 00:00:00';
  const future = '2999-01-01 00:00:00';
  assert.strictEqual(MB.isOverdue({ next_review_at: past, status: 'new' }), true);
  assert.strictEqual(MB.isOverdue({ next_review_at: future, status: 'new' }), false);
  assert.strictEqual(MB.isOverdue({ next_review_at: past, status: 'mastered' }), false);
  assert.strictEqual(MB.isOverdue({ next_review_at: null, status: 'new' }), false);
  assert.strictEqual(MB.isOverdue(null), false);
});
