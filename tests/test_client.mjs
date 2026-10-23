// 错题本 DSH 插件 · 客户端半（lib/client.js）的装载测试。
//
// 不启浏览器：在 vm 里造一个最小的 window.__ModuleLoader__ 与 document，把文件跑一遍，
// 拿到工厂 → 物化成 { inject, apply } → 用一个假 ctx 调 apply，检查它到底注册了哪两个座位。
// 这样能抓住「注册名写错 / children 少一条 / inject 列表漏服务」这类只有真启动才暴露的错。
//
// 跑法：node --test tests/test_client.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(here, '..', 'dsh-plugin', 'lib', 'client.js');

/** 最小 React 替身：装载期只用到 createElement 与几个 hooks 的引用，不渲染。 */
function fakeReact() {
  return {
    createElement: (type, props, ...kids) => ({ type, props, kids }),
    useState: (v) => [v, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: (v) => ({ current: v }),
  };
}

/** 造一个假的浏览器环境，跑一遍 client.js，返回它登记的东西。 */
function loadClient() {
  const registered = [];
  const styles = [];
  const document = {
    getElementById: () => null,
    createElement: () => ({ set textContent(v) { styles.push(v); }, id: '' }),
    head: { appendChild: () => {} },
  };
  const sandbox = {
    window: { __ModuleLoader__: { load: (entry) => registered.push(entry) } },
    document,
    fetch: async () => { throw new Error('not in this test'); },
    console,
    Promise,
    JSON,
    String,
    Number,
    Array,
    Object,
    Error,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CLIENT, 'utf8'), sandbox, { filename: CLIENT });
  return { registered, styles };
}

test('装载：登记一个模块，id 就是包名，工厂物化出 { inject, apply }', () => {
  const { registered } = loadClient();
  assert.equal(registered.length, 1);
  const entry = registered[0];
  assert.equal(entry.id, 'dsh-mistake-book');
  assert.equal(typeof entry.factory, 'function');

  const plugin = entry.factory((name) => {
    assert.equal(name, 'react');
    return fakeReact();
  });
  assert.equal(JSON.stringify(plugin.inject), JSON.stringify(['slots', 'sessions']));
  assert.equal(typeof plugin.apply, 'function');
});

test('物化工厂时就把样式注进 head（副作用只在工厂里，不在文件顶层）', () => {
  const { registered, styles } = loadClient();
  assert.equal(styles.length, 0, '文件跑完不该注入任何东西');
  registered[0].factory(() => fakeReact());
  assert.equal(styles.length, 1);
  assert.match(styles[0], /\.mb-body/);
});

test('apply：注册 main 座位（带 session 子座位）与 sidebar.panellist 入口', () => {
  const { registered } = loadClient();
  const plugin = registered[0].factory(() => fakeReact());

  const slots = [];
  const ctx = {
    get: () => null,
    slots: {
      inject: (name, cb) => { assert.ok(typeof cb === 'function'); cb(); },
      register: (definition, component) => { slots.push({ definition, component }); },
    },
  };
  plugin.apply(ctx);

  assert.equal(slots.length, 2);

  const main = slots.find((s) => s.definition.name === 'main');
  assert.ok(main, '必须注册 main 座位');
  assert.equal(main.definition.key, 'mistake-book');
  // 这条子座位是承重的：框架靠「children 里有非 root 座位」才把 SessionProvider 发下来
  // 用 JSON 比而不是 deepEqual：对象来自 vm 的另一个 realm，原型不同，deepStrictEqual 会假失败
  assert.equal(JSON.stringify(main.definition.children),
    JSON.stringify({ 'mistake-book.session': { kind: 'single', scope: 'session' } }));
  assert.equal(typeof main.component, 'function');

  const side = slots.find((s) => s.definition.name === 'sidebar.panellist');
  assert.ok(side, '必须注册侧栏入口');
  assert.equal(side.definition.id, 'mistake-book');
  assert.equal(side.definition.label, '错题');
  assert.equal(typeof side.component, 'function');
});

test('apply：宿主没给 slots 时不炸（缺服务就安静退出由宿主负责）', () => {
  const { registered } = loadClient();
  const plugin = registered[0].factory(() => fakeReact());
  // 真实宿主一定会给 slots；这里只确认没有对 undefined 的硬解引用
  assert.doesNotThrow(() => plugin.apply({ get: () => null }));
});
