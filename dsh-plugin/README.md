# dsh-mistake-book

错题本的 DSH 插件。它把「本地错题本」接进 DeepSeek Harness：15 个模型工具 + 3 条预设 + 1 个侧栏面板。

## 它给你什么

| 东西 | 内容 |
| --- | --- |
| 工具（15 个） | `mb_due` 取到期 / `mb_search` 检索 / `mb_get` 读题（默认不给答案） / `mb_add` 录入 / `mb_review` 判分回写 FSRS（可留证：作答 / 提示级数 / 判分依据） / `mb_brief` 今日简报（最该练哪几道 + 为什么） / `mb_diagnose` 一次拿全诊断（今天练什么 + 哪最弱 + 反复栽在哪） / `mb_stats` 统计 / `mb_events` 断点 / `mb_weak_steps` 错步 / `mb_batch` 批量导入 / `mb_paper` 组卷 / `mb_report` 周报 / `mb_suggest` 查脏值 / `mb_merge` 合并（知识点 / 学科 / 标签 / 来源四类） |
| 预设（3 条） | 「错题复习」走复习闭环（可一次带一整批，最多 30 道）；「错题答疑」就着一道题就地答疑；「错题录入」贴图或贴文字抽字段后预览入库 |
| 面板 | 侧栏「错题本」，六页签：列表 / 学习 / 计划 / 分析 / 打印 / 设置 |
| 录入手感 | 新建表单支持「保存并继续」（连续录同一章不用反复点「＋ 新建」）；题干与已有题「去空白 + 全半角归一」后相同时会提示「和第 #N 道几乎一样」，只提醒不拦截（v0.57） |

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
lib/tools.js     15 个 mb_* 工具
lib/client.js    侧栏面板（web 客户端）
lib/api.js       访问错题本 HTTP 服务的薄封装
lib/session.js   复习会话：建会话骨架 + 单题/批量两条路由与首条消息
lib/proxy.js     代理
skills/review    复习技能（SKILL.md）
skills/qa        答疑技能（SKILL.md）
skills/ingest    录入技能（SKILL.md，v0.51）
cordis.patch.yml 本插件的 patch：1 个面板根行 + 3 条预设
install.mjs      安装脚本（真副本，不用 link）
```

## License

MIT
