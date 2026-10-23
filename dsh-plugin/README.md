# dsh-mistake-book

错题本的 DSH 插件。它把「本地错题本」接进 DeepSeek Harness：8 个模型工具 + 2 条预设 + 1 个侧栏面板。

## 它给你什么

| 东西 | 内容 |
| --- | --- |
| 工具（8 个） | `mb_due` 取到期 / `mb_search` 检索 / `mb_get` 读题（默认不给答案） / `mb_add` 录入 / `mb_review` 判分回写 FSRS / `mb_stats` 统计 / `mb_events` 断点 / `mb_weak_steps` 错步 |
| 预设（2 条） | 「错题复习」走复习闭环；「错题答疑」就着一道题就地答疑 |
| 面板 | 侧栏「错题本」，六页签：列表 / 学习 / 计划 / 分析 / 打印 / 设置 |

## 前置：错题本服务

插件本身不含数据，它连本机的错题本 HTTP 服务：

```
cd mistake-book
python app.py --port 8000
```

默认地址 `http://127.0.0.1:8000`，可在 `cordis.patch.yml` 的 `config.url` 改。

## 安装

**不要用 pnpm 装**。pnpm 对本地路径一律建 junction，而 DSH 桌面端的插件管理读不到 junction 形态的包（表现：装上了但界面里看不见）。

```
node install.mjs --check    # 只看会做什么，不落盘
node install.mjs            # 真实拷贝进 profile
node install.mjs --uninstall
```

装完**重启 DSH**（不是刷新网页）。

## 目录

```
lib/plugin.js    根行：建复习会话的路由
lib/tools.js     8 个 mb_* 工具
lib/client.js    侧栏面板（web 客户端）
lib/api.js       访问错题本 HTTP 服务的薄封装
lib/session.js   复习会话的首条消息
lib/proxy.js     代理
skills/review    复习技能（SKILL.md）
skills/qa        答疑技能（SKILL.md）
cordis.patch.yml 本插件的 patch：1 个面板根行 + 2 条预设
install.mjs      安装脚本（真副本，不用 link）
```

## License

MIT
