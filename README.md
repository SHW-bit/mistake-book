# 错题本 · Mistake Book

零第三方依赖的本地错题本：Python 标准库 + SQLite + 原生 HTML/JS。
一条命令启动，浏览器打开即用。

```bash
cd mistake-book
python app.py
# 打开 http://127.0.0.1:8000
```

**当前状态**：v0.24.1，最小闭环已跑通并通过 **142 个端到端测试 + 54 个 node 测试** —— 录入（单条 + 批量粘贴解析）→ 存储 → 检索 → FSRS 复习调度 → 复习历史 → 变式题库 → 学习画像 / 掌握门禁 → **知识点树** → 今日复习计划 → 斩题（挂起）→ 学习分析 → 组卷打印 → 再战区 → **到期提醒** → 统计 → 导出。v0.7 从 GitHub 同类项目里挑了三个零依赖的功能补上：按天排的复习计划、把已会但不舍得删的题移出复习池、录入/复习趋势与遗忘风险分析。v0.8 补上组卷打印：复用列表筛选条件抽题，服务端渲染 A4 试卷页，浏览器 Ctrl+P 存 PDF。v0.9 补上再战区：错两次的题自动进区、上次答错后连对两次自动出区，与「斩题 / 恢复」直接配对。v0.10 补上三件事：**到期提醒**（页面横幅 + 桌面通知 + CLI 发邮件）、**知识点树**（知识点用 / 分层自动成树，别名把不同写法合并）、**变式题自动积累**（复习回写时一并提交变式就入库，并按缺口排优先级）。v0.11 补上**自动备份**（启动时自动留快照、按份数轮转、`mb.py backup` 手动备）与**手机端适配**（导航横滑、输入框 16px 防 iOS 缩放、弹窗全屏、操作区吸底）。v0.12 补上两件事：**独立解析字段**（`analysis` 与 `answer` 分开存，自测/打印时不再等于开卷）与**再战区阈值可配**（进区、出区门槛在网页上直接改，存 `settings` 表）。v0.13 补上三件事：**回收站**（删除不再是物理消失，整条题目 + 复习历史快照进回收站，可原样恢复，只保留最近 200 条）、**`mb.py restore`**（从备份文件恢复整个库，覆盖前自动留一份安全快照）、**错因详细描述换成多行输入框**（长文本不再只能横着滚）。v0.14 做了一轮**性能优化**（只改查询与索引，不动 API 语义）：5 万题规模下首屏 972ms → 77ms、统计 931ms → 90ms、组卷 523ms → 59ms，详见 5.9 节。v0.14.1 修了 `one()` 只认 HTTP 列表参数的 bug：此前 CLI 传标量会被截成首字（`mb.py list --q 极限` 只搜「极」、`--limit 20` 只取 2 条），网页端不受影响。v0.15 把三件"会随题量变疼"的事处理了：**图片改为落盘**（内容寻址存 `data/images/`，库里只留文件名，老库启动时自动迁移）、**导出改流式**（`/api/export.json` 与 CSV 边生成边写，2 万题峰值内存 139MB → 1.1MB）、**前端有了单元测试**（纯函数抽到 `static/lib.js`，`node --test` 跑，由 Python 测试统一入口驱动）。v0.16 把界面按参考项目（今知错题本 Electron 版）的排版体系重做了一遍：13px 正文、6px 卡片圆角、发丝分隔线、克制的单一蓝色强调、30px 紧凑控件，**只改视觉层**，接口、数据结构与交互逻辑未动，详见 5.11 节。v0.17 重做了列表卡片：左侧 3px 状态轨按复习状态着色、题面升到 14px/500、知识点 chip 加重、到期改成相对时间、缩略图进列表、「斩题」改为悬停显示，详见 5.12 节。v0.18 补上「**复习先遮答案**」：打开已有错题时答案与解析默认折叠，逼学生先自己重做一遍，点「看答案与解析」才展开，详见 5.13 节。v0.19 起把界面按「纸面」方向整体重做（暖白画布、墨绿强调、14px 正文、32px 控件、左侧栏 + 手机底部 tabbar），分 5 批推进，**批 1（设计系统 + 壳层）、批 2（错题列表页）、批 3（弹窗）、批 4（学习 / 计划 / 分析 / 回收站 / 再战区）已完成**，详见 5.14 节。v0.20 补上四项：**公式输入（LaTeX，KaTeX 本地内置、无 CDN）**、**一道题多张图（≤6 张，内容寻址去重）**、**试卷维度**（题目归卷、按卷筛选、卷内题数统计）、**批量改状态 / 学科 / 错因 / 知识点 / 来源 / 试卷 / 难度 / 标签**，详见 5.15 节。v0.21 把错题本接进 DSH：两条预设（错题复习 / 错题答疑）+ 8 个专用工具（`mb_due` / `mb_search` / `mb_get` / `mb_add` / `mb_review` / `mb_stats` / `mb_weak_steps` / `mb_events`），模型直接调、不过 shell，详见 5.16 节。阶段二把复习界面塞进 DSH 侧栏：一个「错题」面板，左列错题、右侧看题与四档评分，点「让 AI 带我复习这道」由宿主按「错题复习」预设建会话并嵌进右栏，详见 5.17 节。v0.22 是阶段三：面板补全（面板里直接新建、搜索、按学科筛选、翻复习历史）、统计增强（录入/复习趋势柱、保持度分桶、最该补的知识点、错因与学科分布）、AI 闭环（评分时顺手记「错在哪一步」，`mb_weak_steps` 与 `mb_events` 把断点分布与事件流交给模型），详见 5.18 节。v0.23 把网页版的全部功能（组卷打印除外）搬进了 DSH 面板：六个页签（错题 / 学习 / 计划 / 分析 / 再战 / 回收站）、筛选抽屉与条件 chips、批量修改与批量删除、全字段编辑弹窗（含多图与 Ctrl+V 粘贴）、变式题、复习历史、导出 CSV/JSON、到期提醒横幅；代理层同时放开 PUT/DELETE/PATCH 并支持 `raw=1` 原样回传文件流，详见 5.19 节。v0.24 收了一轮交互细节：**18 处原生 `<select>` 换成同一套自定义下拉**（点击/键盘/点外部关闭，选中项打勾）、**计划页每日上限改成数字输入并存进 settings**（`daily_limit`，1–200，默认 20，`/api/plan` 不传就跟随它）、**计划里的题能直接点进错题详情**并带「← 返回计划」，详见 5.20 节。v0.24.1 修了自定义下拉在深色主题下「白底 + 继承来的浅色字」看不清的问题（弹层现在按宿主文字亮度选深/浅配色，并加了对比度回归测试），详见 5.20.6。

v0.3 换掉了固定复习阶梯，改用 **FSRS-6**（Anki 现用的开源记忆调度算法），并提供 `mb.py` 命令行 + [SKILL.md](SKILL.md)，让 DSH 里的 AI agent 能直接驱动「取题 → 出变式 → 判分 → 回写」。

---

## 1. 需求假设（未确认项均在此显式标注）

原始需求中有 6 项信息缺失。下表是当前实现采用的默认值，全部为**假设**，改动时只需替换对应模块。

| 待确认项 | 状态 | 当前取值 | 理由 |
|---|---|---|---|
| 目标平台与运行形态 | ✅ 已确认 | 本地 Web，浏览器访问 `127.0.0.1` | 零安装；将来包桌面壳（pywebview/Tauri）或部署服务器时前端不用改 |
| 技术栈与版本 | ✅ 已确认 | Python 3.9+ 标准库、SQLite、原生 HTML/JS | 无 `pip install`、无构建步骤，评审与交接成本最低 |
| 目标用户与场景 | ✅ 已确认 | 学生个人自用，单人单机 | 错题本的高频场景；教师班级版涉及多租户与权限，属另一条产品线 |
| 核心功能范围 | (待补充) | **假设 MVP**：录入（含图片）、错因分类、来源、检索、复习调度与历史、统计、CSV/JSON 导出、批量删除 | 覆盖"记录 → 找得到 → 会复习 → 能复盘"；组卷、AI 归类延后 |
| 存储 / 同步 / 账号 | (待补充) | **假设**：单机 SQLite 文件，无账号、无同步 | 先闭环；API 与前端已分离，加同步只需换服务端存储层 |
| 设计稿 / 接口 / 历史代码 | (待补充) | **假设**：无，全新实现 | — |

> **已确认**（2026-10-22）：平台形态、技术栈、目标用户三项按上表执行。
>
> **冲突点**：暂无。若后续要求"多端同步"与"无账号单机"同时成立，需先确认账号体系 —— 二者冲突，不应自行取舍。

## 2. 功能清单与代码映射

> 代码位置以**函数/常量名**为准，不写行号 —— 行号会随每次改动漂移，函数名不会。在 `app.py` 里搜名字即可定位。

| 功能 | MVP | 实现位置 |
|---|---|---|
| 错题录入（文本 + 图片，支持截图 Ctrl+V 粘贴） | ✅ | [app.py](app.py) `create_mistake()`；前端表单 [index.html](static/index.html) |
| **公式输入**（`$...$` / `$$...$$` 走 KaTeX 渲染，列表、弹窗、打印页统一） | ✅ | [static/math.js](static/math.js) `mbMath.render()/apply()`；[index.html](static/index.html) `renderList()`；[app.py](app.py) `_paper_html()` |
| **一道题多张图**（≤6 张，可多选/多张粘贴，缩略图可单删） | ✅ | [app.py](app.py) `mistake_images` 表 + `_apply_images()` / `images_of()`；[index.html](static/index.html) `renderImages()` / `useImageFile()` |
| **试卷维度**（建卷/改名/删除、按卷筛选、卷内题数；删卷不删题） | ✅ | [app.py](app.py) `papers` 表 + `create_paper()` / `list_papers()` / `delete_paper()`；[index.html](static/index.html) `#dlg-papers` |
| **批量编辑**（勾选后一次改状态/学科/错因/知识点/来源/试卷/难度；标签可追加/覆盖/移除） | ✅ | [app.py](app.py) `bulk_update()`、`POST /api/mistakes/bulk-update`；[index.html](static/index.html) `#dlg-bulk` |
| **批量导入**（粘贴文本按 `---` 分题，中文键名解析） | ✅ | [app.py](app.py) `parse_batch_text()` / `create_mistakes()`；`POST /api/mistakes/batch`；前端「批量导入」弹窗；CLI `mb.py import` |
| 重复提交防护（3 秒窗口） | ✅ | [app.py](app.py) `_find_recent_duplicate()`、[app.py](app.py) `DEDUP_WINDOW_SEC` |
| 编辑 / 删除（删除进回收站） | ✅ | [app.py](app.py) `update_mistake()`、[app.py](app.py) `delete_mistake()`、[app.py](app.py) `_push_trash()` |
| 批量删除（逐条进回收站） | ✅ | [app.py](app.py) `delete_mistakes()` |
| 列表 + 分页 | ✅ | [app.py](app.py) `query_mistakes()` |
| **错题卡片**（状态轨、相对到期、知识点 chip、缩略图、悬停斩题） | ✅ | [index.html](static/index.html) `renderList()`、`dueDays()`、`isLate()`；样式 `#list .card` |
| 检索筛选（关键词/学科/知识点/标签/状态/错因/来源/时间范围/待复习/含已斩题） | ✅ | [app.py](app.py) `build_filters()` |
| **检索范围开关**（只搜题干/知识点/标签，不搜答案区） | ✅ | [app.py](app.py) `build_filters()` 的 `scope=question`；前端「只搜题干」勾选框 |
| **今日复习计划**（未来 N 天按天分桶，每日题量上限，逾期优先） | ✅ | [app.py](app.py) `plan()`、`GET /api/plan`；网页「计划」页 |
| **斩题 / 恢复**（移出复习池，不删数据，不参与排期与掌握度） | ✅ | [app.py](app.py) `set_suspended()`、`POST /api/mistakes/{id}/suspend|resume`；列表卡片与弹窗按钮 |
| **学习分析**（录入/复习趋势、记忆保持度分布、最快会忘的题、错因与学科分布、最薄弱知识点） | ✅ | [app.py](app.py) `analytics()`、`GET /api/analytics`；网页「分析」页 |
| 结构化错因分类 | ✅ | [app.py](app.py) `MISTAKE_TYPES`、[app.py](app.py) `normalize()` |
| 题目来源（期中/月考/练习册…） | ✅ | [app.py](app.py) `SOURCE_HINTS` |
| 复习调度（FSRS-6 四档评分） | ✅ | [app.py](app.py) `review_mistake()`、[fsrs.py](fsrs.py) `schedule()` |
| 四档间隔预览 | ✅ | [app.py](app.py) `preview_review()`、`GET /api/mistakes/{id}/preview` |
| 复习历史与正确率 | ✅ | [app.py](app.py) `get_reviews()`、`review_logs` 表 [app.py](app.py) |
| 统计（状态/学科/错因/复习正确率/掌握度） | ✅ | [app.py](app.py) `stats()` |
| **变式题库**（同知识点练习，按用得最少轮换） | ✅ | [app.py](app.py) `create_variant()`、[app.py](app.py) `pick_variant()`；网页端在错题弹窗内管理 |
| **学习画像**（按知识点聚合，每条结论附 `review_log` 证据） | ✅ | [app.py](app.py) `profile()`、`GET /api/profile`；网页「学习」页 |
| **掌握门禁**（≥3 道题、连续 ≥2 次答对、S ≥ 21 天） | ✅ | [app.py](app.py) `_gate()`、[app.py](app.py) `mastery()`；网页「学习」页 |
| 命令行给 AI 用（due/list/show/add/review/variant/profile/mastery/plan/analytics/suspend/stats/export） | ✅ | [mb.py](mb.py) |
| **CLI 最小权限**（`--read-only` 拒绝写操作） | ✅ | [mb.py](mb.py) `WRITE_COMMANDS` |
| AI 学习闭环（DSH skill） | ✅ | [SKILL.md](SKILL.md) |
| CSV 导出（按当前筛选） | ✅ | [app.py](app.py) `_csv()` |
| JSON 全量备份（复习历史、变式、别名、试卷、题目图片，version 5；图片以文件名引用） | ✅ | [app.py](app.py) `export_all()`（内存版）/ `iter_export()`（流式） |
| **图片落盘**（内容寻址 `data/images/<sha256前32位>.<ext>`，同图自动去重） | ✅ | [app.py](app.py) `save_image()` / `_decode_image()` / `migrate_images()`；`GET /api/images/{name}` |
| **流式导出**（JSON/CSV 边查边写，不整串进内存） | ✅ | [app.py](app.py) `iter_export()`、`AppHandler._stream()`、`_csv()` |
| 学科 / 标签 / 知识点 / 来源候选 | ✅ | [app.py](app.py) `meta()` |
| 老库自动升级（加列/建表不丢数据） | ✅ | [app.py](app.py) `MIGRATIONS`、[app.py](app.py) `init_db()` |
| **组卷打印**（按筛选抽题，三种版式：只题目 / 题目+答案 / 答案分页） | ✅ | [app.py](app.py) `build_paper()`、[app.py](app.py) `_paper_html()`；`GET /api/paper`、`GET /print`；网页「组卷打印」弹窗 |
| **薄弱优先排序**（按复习正确率升序，未做过的按 0.5，再看稳定性） | ✅ | [app.py](app.py) `build_paper()` 的 `order=weak` |
| **A4 试卷页**（姓名/班级/日期栏、答题留白、题目图片、答案分页） | ✅ | [app.py](app.py) `PAPER_CSS`、[app.py](app.py) `_print_page()` |
| **再战区**（错 N 次自动进区、连对 M 次自动出区，N/M 可配（默认 2/2），与斩题/恢复联动） | ✅ | [app.py](app.py) `arena()`、`GET /api/arena`；网页「再战」页；CLI `mb.py arena` |
| **到期提醒**（页面横幅 + 桌面通知，每 5 分钟轮询，可按日静默） | ✅ | app.py 的 reminders()、GET /api/reminders；网页顶部 #remind 横幅 |
| **邮件提醒**（SMTP，digest 正文） | ✅ | notify.py 的 send()；mb.py remind --email |
| **知识点树**（知识点用 / 分层，父节点汇总整棵子树） | ✅ | app.py 的 knowledge_tree()、GET /api/knowledge/tree；学习页「切换树视图」 |
| **知识点别名**（不同写法合并到规范名，最多 5 跳、拒绝成环） | ✅ | app.py 的 normalize_knowledge_path() / resolve_knowledge() / set_alias()；GET 和 POST /api/knowledge/aliases、DELETE /api/knowledge/aliases/{alias} |
| **变式题自动积累**（复习回写时带变式一起入库，去重计数） | ✅ | app.py 的 _extract_variant()、create_variant(dedup=True)；mb.py review --variant-question |
| **变式缺口提示**（谁最该补变式：变式少优先，其次错得多） | ✅ | app.py 的 variant_gaps()、GET /api/variants/gaps；学习页「缺少变式题」列表 |
| **自动备份**（启动时距上次 ≥20 小时自动留快照，保留最近 14 份） | ✅ | [app.py](app.py) `backup_db()` / `auto_backup()`、`_prune_backups()`；`python app.py --no-backup` 可关 |
| **手动备份** | ✅ | [mb.py](mb.py) `mb.py backup [--dir] [--keep]` |
| **回收站**（删除进回收站，可恢复；只留最近 200 条） | ✅ | [app.py](app.py) `list_trash()` / `restore_trash()` / `purge_trash()`；`GET /api/trash`、`POST /api/trash/{id}/restore`、`DELETE /api/trash/{id}`、`POST /api/trash/purge`；网页「回收站」页 |
| **从备份恢复**（`mb.py restore --from`，覆盖前自动留安全快照） | ✅ | [app.py](app.py) `restore_from_backup()`；[mb.py](mb.py) `restore` |
| **手机端适配**（导航横滑、输入 16px 防缩放、弹窗全屏、操作区吸底） | ✅ | [index.html](static/index.html) 的 `@media(max-width:640px)` / `@media(max-width:380px)` |
| **DSH 插件**（两条预设 + 6 个 `mb_*` 工具，模型直接调） | ✅ | [dsh-plugin/](dsh-plugin) `lib/tools.js`（工具注册）、`lib/api.js`（HTTP + 服务自动拉起） |
| AI 错因归类 / OCR 识题 | ⏳ 延后 | — |
| 多端同步 / 账号 | ⏳ 延后 | — |
| 微信 / 其他推送通道提醒 | ⏳ 延后 | — |

**页面划分**（当前为单页应用，顶部「错题 / 学习 / 计划 / 再战 / 分析 / 回收站」六个标签切换）：
- **P1 错题页**：统计条 + 搜索/筛选栏 + 批量操作条 + 卡片列表 + 分页
- **P2 编辑弹窗**：新增与编辑共用，含删除、四档复习评分（各档显示排定间隔）、复习历史与 FSRS 状态、**变式题管理**（列表 / 练过 / 删除 / 新增）
- **P3 学习页**：掌握概览（知识点数、已过门禁、四档徽章分布）+ 学科筛选 + 按知识点聚合的卡片（徽章、题量、正确率、平均/最低稳定性、连续答对、遗忘次数、待复习数、门禁是否通过及差在哪）；点卡片跳回错题页并按该知识点筛选。**「切换树视图」**按 / 分层的知识点树渲染（父节点汇总子树，缩进表示层级）；下方两个折叠区：**知识点别名**（登记/删除，把不同写法合并）与**缺少变式题的错题**（点一条直接打开该题去补）
- **P4 再战区**：学科筛选 + 在战区/已出区切换，概览（在战区/已出区/已斩/进区条件），卡片显示「错 N 次」徽章、连对 x/M（M 为出区门槛）、正确率、上次结果、下次复习，行内可直接「斩题」
- **P5 计划页**：学科 + 窗口天数 + 每日上限（数字输入框，改完自动存进 settings），概览（今天要做/逾期/窗口内/排不下），按天分组的待复习卡片；点卡片直接打开该题复习
- **P6 分析页**：窗口天数筛选，概览（新增/复习次数/有记忆数据的题数），录入复习趋势柱图、记忆保持度四档分布、最快会忘的题（含距上次复习天数与稳定性）、错因分布、学科分布、最薄弱知识点
- **P7 组卷打印弹窗**：卷面标题、题量（10–100）、抽题顺序、三种版式、答题留白高度、是否含图片、是否显示学科/知识点/错因/难度；打开时实时显示「当前筛选下共 N 题可用」，提交后新标签页打开 `/print`
- **P8 回收站页**：按删除时间倒序的卡片列表（学科、原题号、复习记录条数、删除时间），每条可「恢复」或「彻底删除」，顶部可一键清空；只保留最近 200 条

## 3. 快速开始

### 环境要求

- Python **3.9+**（仅标准库，无需安装任何包）
- 现代浏览器

### 运行

```bash
cd mistake-book
python app.py
```

输出：

```
错题本已启动: http://127.0.0.1:8000
数据库文件: .../mistake-book/data/mistakes.db
按 Ctrl+C 停止
```

可选参数：

| 参数 / 变量 | 默认值 | 说明 |
|---|---|---|
| `--host` | `127.0.0.1` | 监听地址；改成 `0.0.0.0` 可局域网访问（无鉴权，慎用） |
| `--port` | `8000` | 端口，也可用环境变量 `PORT` |
| `--db` | `data/mistakes.db` | 数据库路径，也可用环境变量 `MISTAKE_DB` |

### 手机访问（v0.11）

界面已经做了手机适配（窄屏单列、弹窗全屏、按钮吸底、输入框 16px 防 iOS 自动放大），但**默认只绑 `127.0.0.1`，手机连不上**。要让手机能用，两步：

```bash
python app.py --host 0.0.0.0 --port 8000
```

1. 电脑和手机连同一个 Wi-Fi；
2. 手机浏览器打开 `http://<电脑的局域网IP>:8000`（Windows 上用 `ipconfig` 查 IPv4 地址）。

> **安全提醒**：这个服务**没有任何鉴权**，绑 `0.0.0.0` 等于同网段任何人都能读写你的错题本。只在家庭/个人热点等可信网络里用，用完 Ctrl+C 关掉；公司、学校、咖啡厅这类公共 Wi-Fi 不要这么开。

### 命令行（给 AI / 脚本用）

不起 HTTP 服务也能读写同一份数据库：

```bash
python mb.py due --limit 5                    # 到期待复习
python mb.py list --subject 高数 --tag 极限    # 检索
python mb.py show 12                          # 详情 + 历史 + 四档间隔
python mb.py review 12 --rating good          # 记录一次复习
python mb.py add --question "求 lim..." --answer "1/2" --subject 高数
python mb.py stats                            # 统计
python mb.py export --out backup.json         # 导出全量 JSON
python mb.py backup                           # 数据库快照 → data/backups/
python mb.py backup --keep 7 --dir D:\bk       # 指定保留份数与目录
```

默认输出 JSON；加 `--text` 输出人读格式；`--db` 指定别的库文件。

### 批量导入

一次粘贴多道题，不用一条条填表。网页端点「批量导入」，或：

```bash
python mb.py import --file 错题.txt
# 也可以直接管道：pbpaste | python mb.py import
```

格式：用单独一行 `---` 分隔每道题；块内用 `键: 值` 写字段，键名可以是中文也可以是英文。

```
题目: 求 lim x→0 sin x / x
答案: 1
我的答案: 0
错因分类: 概念不清
知识点: 极限
标签: 高数,期中
来源: 期中
---
题目: 判断 f(x)=x^2 在 [0,1] 上的单调性
答案: 单调递增
```

- 支持的键：`题目/题干/question`、`答案/正确答案/answer`、`我的答案/错答/my_answer`、`错因/错因描述/error_reason`、`错因分类/类型/mistake_type`、`来源/source`、`知识点/knowledge`、`标签/tags`、`学科/subject`、`难度/difficulty`、`状态/status`
- 不带键名的行会**接在上一条字段后面**（保留换行），适合多行题干或解析
- 整块一个键名都没有时，整块当作题干
- 逐条校验：合法的入库，非法的跳过并**报告是第几条、错在哪**（不会因为一条错误丢掉整批）
- 单次上限 **200 条**

配合 [SKILL.md](SKILL.md) 可让 DSH 里的 agent 直接完成「取题 → 出变式 → 判分 → 回写」的循环。
### 测试

```bash
cd mistake-book
python -m unittest discover -s tests -v
```

测试会真实启动 HTTP 服务（随机端口）并走完整 API，覆盖：健康检查、增删改查、检索与各维度筛选、错因分类、来源、重复提交防护、批量删除、批量导入（文本/items/多行/上限）、FSRS 复习与历史（含四档间隔、数字评分、跨天增长、掌握后停止调度）、复习级联删除、时间范围、统计、今日计划（分桶/上限/溢出/逾期）、斩题与恢复（联动待复习数与计划）、检索范围、分析（趋势/保持度/分布/空库）、再战区（进区/出区/出区又错回区/斩题与恢复联动/排序与学科筛选/空库/CLI）、组卷打印（三种版式/空库/拒绝 POST）、CSV/JSON 导出、参数校验、404。v0.10 新增：到期提醒（空库 / 到期与逾期计数 / 跳过已掌握 / CLI remind）、知识点树（路径归一 / 别名解析与环拒绝 / 别名增删 / 父节点汇总 / kdeep 深度过滤 / CLI ktree）、变式（复习回写捕获变式 / 去重计数 / 缺口排序 / CLI review 带变式）、导出 version 4。v0.11 新增：数据库备份（快照可读 / 保留份数轮转 / 同秒不覆盖 / 自动备份去重跳过 / CLI backup）。v0.12 新增：独立解析字段（读写往返 / 可被全文检索且 `scope=question` 不搜解析 / 批量导入 `解析:` 键 / CSV 含解析列 / 打印可开关），可调阈值（默认值与 meta / 改进区门槛 / 改出区门槛 / 校验与越界 / CLI settings 与只读拒绝），v0.13 新增：回收站（删除进站 / 原 id 恢复 / 复习历史一并恢复 / id 被占用时重映射 / 单条与整站清空 / 保留上限）、`mb.py restore`（正常恢复并留安全快照 / 拒绝非数据库文件 / 只读拒绝）、错因多行输入框（静态断言），v0.14.1 新增：`one()` 同时接受标量与列表、`build_filters` 直传标量、CLI 双字关键词/`--limit`/`due --limit` 不再被截断。v0.15 新增：图片落盘（库里不存 base64 / 回源带缓存头 / 同图去重 / 拒 SVG 与 magic 不符 / 不改图保留 / 空串删图）、流式导出（含 `image_url` 无 `image_data` / `chunk=1` 仍输出合法 JSON / 与内存版输出等价）、备份恢复连图片一起、`lib.js` 被服务且被页面引用，共 **111 个测试**。v0.20 新增 21 个：一题多图（多图建/顺序/URL、同图只存一份、换图与清空、不带 images 时保留、老 image_data 兼容、上限 7 张、非法图名）、试卷（CRUD、按卷筛选、删卷解绑不删题、卷名必填/过长、paper_id 必须存在、meta 含 papers、导出含 papers）、批量编辑（改字段、tags 三种模式、空 ids/空 fields/非法状态/超 500 条校验、未知字段忽略）、LaTeX（math.js 与 katex 可服务、打印页含 katex 与 `mbMath.apply`、打印页尊重 paper_id 筛选），共 **132 个测试**。

前端纯函数（`esc` / `stars` / `localStamp` / `isOverdue`）有独立单元测试，用 Node 内置 test runner：

```bash
node --test tests/frontend.test.cjs
```

没装 Node 时 `tests/test_frontend.py` 会自动 skip，不影响上面那条 Python 命令。

### 目录结构

```
mistake-book/
├── app.py              # 服务端：HTTP 路由 + 业务 + SQLite
├── fsrs.py             # FSRS-6 调度算法（纯函数，无依赖）
├── mb.py               # 命令行入口，给 DSH 里的 AI agent 用
├── notify.py           # 邮件提醒（标准库 smtplib，可选）
├── bench.py            # 性能基准（造数 + 逐接口计时，开发用）
├── SKILL.md            # DSH skill：AI 学习闭环流程
├── static/
│   ├── index.html      # 单页前端（原生 JS，无构建）
│   ├── lib.js          # 纯函数（转义/星级/时间/逾期），浏览器与 Node 共用
│   ├── math.js         # LaTeX 渲染（mbMath.render / apply，v0.20）
│   └── vendor/katex/   # KaTeX 0.16.11 本地内置（js + css + 20 个 woff2）
├── tests/
│   ├── test_api.py     # 132 个端到端测试（含前端测试的 Python 入口）
│   ├── test_frontend.py# 调 node --test 跑前端用例；无 node 则 skip
│   └── frontend.test.cjs # 前端纯函数用例（node:test）
├── data/               # 运行时自动生成
│   ├── mistakes.db     #   主库
│   ├── images/         #   题目图片（内容寻址，v0.15）
│   └── backups/        #   自动备份快照（mistakes-*.db）+ images/ 镜像
└── README.md
```

## 4. 数据模型

### 4.1 `mistakes`（[app.py](app.py)）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增主键 |
| `subject` | TEXT NOT NULL DEFAULT '未分类' | 学科 |
| `question` | TEXT NOT NULL | 题干（唯一必填项） |
| `answer` | TEXT DEFAULT '' | 正确答案（只放答案；解析见 `analysis`） |
| `analysis` | TEXT DEFAULT '' | 解析 / 解题过程（v0.12 起独立字段） |
| `my_answer` | TEXT DEFAULT '' | 我的错误答案 |
| `error_reason` | TEXT DEFAULT '' | 错因（自由文本，写细节） |
| `mistake_type` | TEXT DEFAULT '' | 错因分类（结构化枚举，可统计） |
| `source` | TEXT DEFAULT '' | 题目来源：作业 / 期中 / 月考… |
| `knowledge` | TEXT DEFAULT '' | 知识点 |
| `tags` | TEXT DEFAULT '' | 逗号分隔标签 |
| `difficulty` | INTEGER DEFAULT 3 | 难度 1–5 |
| `status` | TEXT DEFAULT 'new' | `new` / `reviewing` / `mastered` |
| `image_file` | TEXT DEFAULT '' | 题目图片文件名（`<sha256前32位>.<ext>`，实际文件在 `data/images/`；v0.15） |
| `image_data` | TEXT DEFAULT '' | **v0.15 起不再写入**，仅供老库迁移（启动时搬到 `data/images/` 并清空） |
| `paper_id` | INTEGER DEFAULT 0 | 所属试卷 id（v0.20）；`0` = 未归卷。删卷时归零，不删题 |
| `review_count` | INTEGER DEFAULT 0 | **累计**复习次数（只增） |
| `stage` | INTEGER DEFAULT 0 | **连续答对**次数（展示用）；答错归零 |
| `fsrs_stability` | REAL DEFAULT 0 | FSRS 记忆稳定性 S（天）：记忆能保持多久 |
| `fsrs_difficulty` | REAL DEFAULT 0 | FSRS 难度 D（1–10）：这题对你多难 |
| `fsrs_reps` | INTEGER DEFAULT 0 | FSRS 累计复习次数 |
| `fsrs_lapses` | INTEGER DEFAULT 0 | FSRS 遗忘次数（评分 1 时 +1） |
| `last_reviewed_at` | TEXT NULL | 上次复习时间 |
| `next_review_at` | TEXT NULL | 下次复习时间；`NULL` 表示已掌握、停止调度 |
| `created_at` / `updated_at` | TEXT NOT NULL | 时间戳 |

索引：`subject`、`status`、`next_review_at`、`created_at DESC`、`knowledge`、`source`。

### 4.2 `review_logs`（复习历史，[app.py](app.py)）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增主键 |
| `mistake_id` | INTEGER NOT NULL | 关联 `mistakes.id`（删除错题时级联清理） |
| `result` | TEXT NOT NULL | `again` / `hard` / `good` / `easy` / `mastered` |
| `rating` | INTEGER | FSRS 评分 1–4；`mastered` 记为 0（不计入正确率） |
| `stage` | INTEGER | 本次复习后的连续答对次数 |
| `interval_days` | INTEGER | 本次排定的间隔天数 |
| `fsrs_stability` | REAL | 本次复习后的稳定性快照 |
| `fsrs_difficulty` | REAL | 本次复习后的难度快照 |
| `reviewed_at` | TEXT NOT NULL | 复习时间 |

索引：`(mistake_id, reviewed_at)`。

**关系**：`mistakes 1 — N review_logs`、`mistakes 1 — N variants`。主表存当前状态，日志表存历史，变式表存同知识点的练习题。

**为什么拆表**：把"当前复习状态"和"历史轨迹"分开，统计正确率、看进步曲线、将来做遗忘曲线都不用改主表；主表保持窄，列表查询快。

### 4.3 `variants`（变式题库，[app.py](app.py)）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增主键 |
| `parent_id` | INTEGER NOT NULL | 母题 `mistakes.id`（删除母题时级联清理） |
| `question` | TEXT NOT NULL | 变式题干 |
| `answer` | TEXT DEFAULT '' | 参考答案 |
| `knowledge` | TEXT DEFAULT '' | 知识点；新增时不传则**继承母题** |
| `source` | TEXT DEFAULT '' | 来源，如「AI 生成」 |
| `times_used` | INTEGER DEFAULT 0 | 被练过几次（`next` 按它升序轮换） |
| `last_used_at` | TEXT NULL | 上次练的时间 |
| `created_at` | TEXT NOT NULL | 创建时间 |

索引：`(parent_id, times_used)`。单题上限 50 条（`MAX_VARIANTS_PER_MISTAKE`），防止 AI 灌爆。

**为什么单独存变式**：变式题的价值是「同一知识点换个问法再练一次」，它不该混进错题列表污染统计，也不该被当成新错题重复排期。挂在母题下、按使用次数轮换，既复用了母题的知识点标签，又不会让题量失控。

### 4.4 `knowledge_aliases`（知识点别名，v0.10）

| 字段 | 类型 | 说明 |
|---|---|---|
| `alias` | TEXT PK | 别名写法，已按 `/` 归一 |
| `canonical` | TEXT NOT NULL | 规范名（可再指向另一条别名，解析时最多 5 跳） |
| `created_at` | TEXT NOT NULL | 创建时间 |

**为什么用别名表而不是树表**：知识点本来就是一个字符串字段，用户写成「函数/单调性」就已经是层级。再引入 `knowledge_points(id, parent_id)` 邻接表，等于要求录入时先建节点、再挂题，多一步操作还容易产生孤立节点。别名表只解决唯一真正的痛点——**同一个点写成不同名字**（「函数单调性」vs「函数/单调性」），用一张两列表就能合并统计，不需要改 `mistakes.knowledge` 的语义。

### 4.5 `settings`（键值配置，v0.12）

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | TEXT PK | 配置项名：`arena_min_wrong` / `arena_clear_streak`（1–20）/ `daily_limit`（1–200，v0.24） |
| `value` | TEXT NOT NULL | 存成字符串，读取时转 int 并夹到合法区间 |

**为什么用键值表而不是加列 / 改常量**：可配项会随需求增加，每加一个就 ALTER TABLE 一次不划算；而写死在代码里的常量改一次要重启进程。一张两列表 + `INSERT … ON CONFLICT DO UPDATE` 是最小可用的「运行时可改」方案，缺省值仍由代码里的 `DEFAULT_SETTINGS` 兜底——表里没有记录时行为与以前完全一致。

### 4.6 `trash`（回收站，v0.13）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 回收站条目 id |
| `mistake_id` | INTEGER NOT NULL | 被删题目的原 id（恢复时优先沿用它） |
| `subject` | TEXT DEFAULT '' | 学科，列表页直接显示，不用解析 payload |
| `question` | TEXT DEFAULT '' | 题干，列表页直接显示 |
| `payload` | TEXT NOT NULL | 被删那一刻整行 `mistakes` 的 JSON 快照 |
| `logs` | TEXT DEFAULT '[]' | 被删那一刻该题 `review_logs` 的 JSON 数组 |
| `deleted_at` | TEXT NOT NULL | 删除时间 |

**为什么是「快照进 trash + 物理删」而不是给 `mistakes` 加 `deleted_at` 软删除**：软删除要求列表、统计、计划、再战区、画像、导出、组卷**每一条查询**都记得加 `deleted_at IS NULL`，漏一处已删的题就会悄悄回到统计或再战区里——这是最容易埋、也最难发现的 bug。快照法把「回收站」彻底隔离成一张独立表，主表语义与所有既有查询一行都不用改。代价是恢复时要处理「原 id 已被新题占用」：空闲就沿用原 id，被占用就分配新 id 并把复习日志重映射过去。

### 4.7 `papers`（试卷，v0.20）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增主键 |
| `name` | TEXT NOT NULL | 试卷名（≤120 字，必填） |
| `subject` | TEXT DEFAULT '' | 学科（可空） |
| `exam_date` | TEXT DEFAULT '' | 考试日期 `YYYY-MM-DD`（可空，用于排序） |
| `note` | TEXT DEFAULT '' | 备注 |
| `created_at` / `updated_at` | TEXT NOT NULL | 时间戳 |

索引：`exam_date`。列表按 `exam_date` 倒序，同日期按 id 倒序，并带一个 `count` 子查询给出卷内题数。

**为什么删卷不删题**：卷子是题目的「归属」，不是容器。删掉一张卷，题还在你脑子里也还在库里，只是回到「未归卷」；级联删题会让一次误操作抹掉几十道题和它们的复习历史。接口返回 `{deleted, detached}`，前端提示「已删除，N 道题回到未归卷」。

### 4.8 `mistake_images`（题目多图，v0.20）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增主键 |
| `mistake_id` | INTEGER NOT NULL | 所属题目 |
| `file` | TEXT NOT NULL | 文件名（`<sha256前32位>.<ext>`，实际文件在 `data/images/`） |
| `sort` | INTEGER DEFAULT 0 | 展示顺序（从 0 起） |
| `created_at` | TEXT NOT NULL | 时间戳 |

索引：`mistake_id`。**兼容**：老库的 `mistakes.image_file` 单图在启动时由 `migrate_image_table()` 搬进本表；没有本表行的题仍回落读 `image_file`，所以老数据与老导出不受影响。上限 `MAX_IMAGES = 6`。

## 5. API 一览

统一返回 `{"ok": true, "data": ...}`；错误返回 `{"ok": false, "error": {"code", "message"}}`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/meta` | 学科、知识点、标签、来源候选、错因分类 |
| GET | `/api/stats` | 总数、各状态数、待复习数、错因分布、复习正确率 |
| GET | `/api/mistakes` | 列表；参数 `q, scope, subject, knowledge, tag, status, mistake_type, source, range, due, suspended, page, page_size` |
| POST | `/api/mistakes` | 新增，返回 201；3 秒内重复题目返回 200 + `duplicate: true` |
| GET | `/api/mistakes/{id}` | 详情（含图片） |
| PUT | `/api/mistakes/{id}` | 更新（未提供的字段保持不变） |
| DELETE | `/api/mistakes/{id}` | 删除：整条题 + 复习历史快照进回收站，再物理删除 |
| POST | `/api/mistakes/batch-delete` | 批量删除（逐条进回收站）；body `{"ids": [1,2,3]}`，返回真实 `deleted` 条数 |
| POST | `/api/mistakes/batch` | 批量导入；body `{"text": "题目: ...\n---\n..."}` 或 `{"items": [{...}]}`，上限 200 条，返回 created/duplicate/error 三个计数 |
| POST | `/api/mistakes/bulk-update` | 批量编辑；body `{"ids": [1,2], "fields": {"status": "reviewing", "tags": "..."}}`，上限 500 条；未知字段静默忽略，返回 `{updated, ids, fields}` |
| GET | `/api/papers?subject=` | 试卷列表：`items`（含 `count` 卷内题数）+ `total`（v0.20） |
| POST | `/api/papers` | 新建试卷；body `{"name", "subject", "exam_date", "note"}`，空名 400、超 120 字 400 |
| GET | `/api/papers/{id}` | 试卷详情 |
| PUT / PATCH | `/api/papers/{id}` | 修改试卷（未提供的字段保持不变） |
| DELETE | `/api/papers/{id}` | 删除试卷，卷内题目 `paper_id` 归零（不删题），返回 `{deleted, detached}` |
| POST | `/api/mistakes/{id}/review` | 复习；body `{"rating": 1-4}` 或 `{"result": "again"\|"hard"\|"good"\|"easy"\|"mastered"}` |
| GET | `/api/mistakes/{id}/reviews` | 复习历史 + 正确率（只统计 1–4 分的记录） |
| GET | `/api/mistakes/{id}/preview` | 四档评分各自会排到多少天后 + 当前可提取率 |
| GET | `/api/mistakes/{id}/variants` | 该题的变式列表 |
| POST | `/api/mistakes/{id}/variants` | 新增变式；body `{"question", "answer", "knowledge", "source"}` |
| GET | `/api/mistakes/{id}/variants/next` | 取下一道该练的变式（用得最少的）；无则 `next: null` + `hint` |
| POST | `/api/variants/{id}/use` | 标记练过一次（`times_used + 1`） |
| DELETE | `/api/variants/{id}` | 删除变式 |
| GET | `/api/profile?subject=&limit=` | 学习画像：按知识点聚合的题量/正确率/稳定性/证据 |
| GET | `/api/mastery?subject=` | 掌握门禁：哪些知识点真的过了线、未过线的差在哪 |
| GET | `/api/plan?days=&limit=&subject=` | 今日复习计划：未来 N 天（1–30）按天分桶，每天最多 `limit`（1–200）道，逾期优先；**不传 `limit` 时跟随 settings 的 `daily_limit`**；返回 `days/today_count/overdue/total/overflow/daily_limit` |
| GET | `/api/analytics?days=` | 学习分析：7–90 天的录入/复习趋势、保持度四档分布与最快会忘的题、错因/学科分布、最薄弱知识点 |
| GET | `/api/arena?subject=&limit=&show=` | 再战区：`show=zone`（默认，在战区）或 `cleared`（已出区）；返回 `rule/counts/total/items`，每条带 `wrong_count/correct_streak/need_streak/accuracy/last_result` |
| GET | `/api/settings` | 再战区阈值：`values/labels/bounds`（v0.12） |
| PUT / POST | `/api/settings` | 保存阈值，body `{"arena_min_wrong": 3, "arena_clear_streak": 2, "daily_limit": 20}`；前两个 1–20，`daily_limit` 1–200 |
| GET | `/api/trash?limit=` | 回收站列表：`items`（`id/mistake_id/subject/question/log_count/deleted_at`）+ `total`，默认 50 条 |
| POST | `/api/trash/{id}/restore` | 从回收站恢复；原 id 空闲则沿用，被占用则分配新 id 并重映射复习日志 |
| DELETE | `/api/trash/{id}` | 彻底删除一条回收站记录 |
| POST | `/api/trash/purge` | 清空回收站 |
| POST | `/api/mistakes/{id}/suspend` | 斩题：移出复习池（`suspended=1`），不删数据、不参与排期与掌握度 |
| POST | `/api/mistakes/{id}/resume` | 恢复被斩的题 |
| GET | `/api/paper?count=&order=&mode=&images=&meta=&blank=&title=&seed=&analysis=` | 组卷数据（JSON）：复用列表筛选参数；`order` 取 `weak/random/recent/oldest`，`mode` 取 `question/answer/split`，上限 100 题 |
| GET | `/print?...` | A4 试卷 HTML 页（非 `/api/` 前缀）：同样参数，浏览器 Ctrl+P 存 PDF |
| GET | `/api/reminders` | 到期提醒：`now/due/overdue/today/next_at/top/should_notify/message`；只算未斩且未掌握的题 |
| GET | `/api/knowledge/tree?subject=` | 知识点树：按 `/` 分层，父节点汇总子树（题量/到期/正确率/稳定性/门禁）；返回 `roots/points_total/leaf_total/depth_max/unclassified` |
| GET | `/api/knowledge/aliases` | 别名列表 |
| POST | `/api/knowledge/aliases` | 登记别名，body `{"alias", "canonical"}`；成环或自我指向返回 400 |
| DELETE | `/api/knowledge/aliases/{alias}` | 删除别名（alias 需 URL 编码） |
| GET | `/api/variants/gaps?limit=&subject=` | 最该补变式的题：变式数升序、错次数降序；每条带 `variant_count/wrong/right/hint` |
| GET | `/api/export.csv` | 按当前筛选导出 CSV（流式，边查边写） |
| GET | `/api/export.json` | 全量备份（复习历史、变式、别名、试卷、题目图片；version 5；图片只给 `image_url` 不给 base64；流式） |
| GET | `/api/images/{name}` | 题目图片回源（只认 `[0-9a-f]{32}.ext`，长缓存 + `nosniff`；v0.15） |

**复习规则**（[app.py](app.py) `review_mistake()` + [fsrs.py](fsrs.py)）：

| 评分 | 含义 | FSRS 处理 |
|---|---|---|
| 1 `again` | 忘了 / 答错 | 走遗忘公式，稳定性大跌、难度上升，`lapses + 1`，`stage = 0` |
| 2 `hard` | 答对但吃力 | 走回忆公式但折扣（w15），间隔增长最少 |
| 3 `good` | 独立答对 | 标准回忆公式，间隔正常增长 |
| 4 `easy` | 秒答 | 回忆公式加成（w16），间隔增长最多 |
| `mastered` | 已掌握 | **不是记忆评分**：不更新 FSRS，只置状态并清空 `next_review_at` |

- 每次复习写一条 `review_logs`，`review_count` 累加
- 复习后按新稳定性算间隔：`I = S / FACTOR * (r^(1/DECAY) - 1)`，`r = 0.9`
- 错题本场景把间隔封顶 **365 天**（`fsrs.MAX_INTERVAL`），避免单题排到几年后

## 5.5 复习算法：FSRS-6

v0.2 用的是固定阶梯（1/2/4/7/15/30/60 天），问题很直接：**它不认识你**。同一道题，学霸和学困生排期一样；答得轻松和答得勉强，下一步也走同一格。

v0.3 换成 [FSRS-6](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm)（Free Spaced Repetition Scheduler，Anki 当前默认算法），实现在 [fsrs.py](fsrs.py)，纯函数、零依赖、约 180 行。

### 它维护三个量

| 量 | 含义 | 范围 |
|---|---|---|
| 稳定性 S | 记忆能保持多久（天） | ≥ 0.1 |
| 难度 D | 这题对你有多难 | 1–10 |
| 可提取率 R | 此刻还记得的概率 | 0–1 |

R 随时间是幂律衰减，不是指数：

```
R(t, S) = (1 + FACTOR * t / S) ^ DECAY
FACTOR  = 0.9^(1/DECAY) - 1 = 0.980346
DECAY   = -w20 = -0.1542
```

反解出「想让 R 掉到 0.9 时该等几天」：

```
I(S) = S / FACTOR * (0.9^(1/DECAY) - 1) = S
```

即**稳定性数值就是 90% 保持率下的间隔天数**——这也是它好解释的原因。

### 四档评分怎么改变 S 和 D

- **首次**：`S0 = w[G-1]`（忘了 0.212 / 困难 1.293 / 记得 2.307 / 简单 8.296 天），`D0 = w4 - e^(w5*(G-1)) + 1`
- **答对**：`S' = S * (1 + e^w8 * (11-D) * S^-w9 * (e^(w10*(1-R)) - 1) * 修正)`，困难 ×w15、简单 ×w16
- **忘了**：`S' = w11 * D^-w12 * ((S+1)^w13 - 1) * e^(w14*(1-R))`，稳定性大幅回落
- **难度**：`D' = D - w6*(G-3)`，再向均值 1 和 10 的两端收缩；同时受「初始难度」锚定（w7）

参数用 FSRS-6 官方默认值（21 个 w），**不做个人训练**——错题本量级（几百到几千条）拟合不出 21 个参数，默认值在公开基准上已经很强。

### 实测行为

```
新题，四档预览：      忘了 1 天 / 困难 1 天 / 记得 2 天 / 简单 8 天
连续答「记得」：      2 → 11 → 46 → 163 → 497 天（指数拉开）
S=30、逾期 30 天后：  忘了 2 天 / 困难 54 天 / 记得 85 天 / 简单 162 天
答错一次：            S=30 → 2.25（记忆几乎重置，但难度保留）
```

「逾期越久、答对后间隔给得越保守」是 FSRS 的自然结果：逾期意味着 R 已经很低，回忆成功说明记忆其实比模型估计的更牢，但难度信号也会推高 D。

## 5.6 在 DSH 里用 AI 学习

参照 [StudyMate](https://github.com/)（DSH 插件）的思路，但**不重写一个插件**——它需要 cordis patch 与 client bundle，与「零依赖、一条命令跑通」的定位冲突，而且功能上会与 StudyMate 重复。

改为三层：**SQLite 数据层 → `mb.py` CLI → DSH skill**，让 agent 在对话里驱动整个学习循环。

```
用户：练几道错题
  ↓
agent: python mb.py due --limit 3        # 取到期错题
  ↓
agent: python mb.py show 12              # 读题 + 我的错答 + 知识点 + 四档预览
  ↓
agent: 出一道同知识点的变式题（不给答案）
  ↓
用户作答
  ↓
agent: 判分 → python mb.py review 12 --rating hard
  ↓
FSRS 重算 S/D/下次日期 → agent 告诉学生下次什么时候再练
```

### `mb.py` 命令

| 命令 | 作用 |
|---|---|
| `due --limit N` | 到期待复习的错题 |
| `list [--q/--subject/--tag/--status/--mistake-type/--range/--due]` | 检索 |
| `show <id>` | 单题详情 + 复习历史 + 四档间隔（自动剔除 base64 图片，避免塞爆上下文） |
| `add --question ... [--answer/--subject/--mistake-type/--knowledge/--tags]` | 新增 |
| `import [--file F]` | 批量导入；`--file` 省略或为 `-` 时读 stdin |
| `review <id> --rating again\|hard\|good\|easy\|mastered [--step 审题\|建模\|计算\|检验\|表达\|记忆] [--variant-question ... --variant-answer ... --variant-knowledge ...]` | 记录复习；`--step` 顺手记「错在哪一步」；带变式参数时一并入库（自动去重） |
| `variant add <id> --question ... [--answer] [--knowledge]` | 给母题加一道变式 |
| `variant list <id>` | 该题的变式列表 |
| `variant next <id>` | 取下一道该练的变式（用得最少的） |
| `variant use <vid>` | 标记练过一次 |
| `variant gaps [--limit N] [--subject]` | 最该补变式的题（变式少优先） |
| `remind [--email]` | 到期提醒摘要；加 `--email` 走 SMTP 发信（配置见 `data/notify.json`） |
| `ktree [--subject]` | 知识点树（父节点汇总子树） |
| `alias add <别名> <规范名>` / `alias rm <别名>` / `alias list` | 知识点别名管理 |
| `profile [--subject] [--limit N]` | 学习画像：薄弱知识点 + 证据 |
| `mastery [--subject]` | 掌握门禁：过线 / 未过线及原因 |
| `plan [--days N] [--limit N] [--subject]` | 今日复习计划：未来 N 天按天分桶、每天上限 |
| `analytics [--days N]` | 学习分析：趋势 / 保持度分布 / 错因与学科分布 / 最薄弱知识点 / 断点分布（`by_step`、`step_patterns`） |
| `arena [--subject] [--limit N] [--show zone\|cleared]` | 再战区：满足进区门槛的题（默认错 2 次以上），按错题次数排序 |
| `settings [--arena-min-wrong N] [--arena-clear-streak N]` | 查看 / 修改再战区阈值（不带参数即查看） |
| `suspend <id> [--resume]` | 斩题（移出复习池）或恢复 |
| `restore --from <path> [--dir D:\backup]` | 从备份文件恢复整个库；覆盖前自动留安全快照 |
| `stats` | 总量 / 到期 / 正确率 / 掌握度 |
| `export --out backup.json` | 全量备份 |
| `stream [--limit N] [--kind K] [--id N] [--ndjson]` | 事件流水（建题 / 评分 / 斩题 / 恢复）；`--ndjson` 一行一条，适合管道 |

默认输出 JSON（agent 直接解析）。加 `--text` 可把 `list` / `due` 这类列表结果渲染成人读格式（其余命令仍输出 JSON——agent 解析更稳）。

**最小权限**：加 `--read-only` 后 `add` / `review` / `import` / `suspend` / `restore` 会被拒绝并返回退出码 2（[mb.py](mb.py) `WRITE_COMMANDS`）。给只读分析场景的 agent 用，避免它"顺手"改了数据。注意 `mb.py` **本来就没有 `delete` 子命令**——删除只留在网页端，这是刻意的：agent 不该有删除权。

### 学习画像与掌握门禁（v0.4）

v0.3 的 `mastered` 是一键拍板：点一下就算会了，统计里看不出来"是不是真的会"。v0.4 把"会了"拆成可验证的三个条件（[app.py](app.py)–[app.py](app.py)）：

| 门禁 | 阈值 | 理由 |
|---|---|---|
| 题目数 | ≥ 3 道不同题 | 同一道题刷三遍不叫掌握 |
| 连续答对 | 每道 ≥ 2 次 | 单次答对可能是蒙的 |
| 稳定性 S | 每道 ≥ 21 天 | FSRS 认为你能记三周，才算真的进长期记忆 |

三者同时满足，该知识点才算 `mastered_gate = true`。不满足时 `gate_reasons` 会逐条说差在哪（例如「题目不足 3 道（现有 2 道）」）。

`profile` 按知识点聚合，每条结论都带 `evidence_review_ids`——**能追到具体哪几次复习**，而不是给一个说不清来由的分数。这是从 [open-notebook](https://github.com/lfnovo/open-notebook) 借的「答案要有引用」。

```bash
python mb.py profile --subject 高数
python mb.py mastery
```

[SKILL.md](SKILL.md) 定义了完整流程与判分标准（什么算 hard、什么算 easy），把它复制到 `~/.dsh/skills/` 即可被会话自动发现——**我没有替你装**，安装命令在文件末尾。

> v0.21 起还有更彻底的一条路：把错题本做成 DSH 插件（预设 + 6 个专用工具，模型直接调、不过 shell），见 **5.16** 节。

## 5.7 到期提醒（v0.10）

提醒有三个出口，都不需要额外依赖：

### 1. 网页横幅 + 桌面通知

打开网页后每 5 分钟轮询 `/api/reminders`，有到期题就在顶部显示横幅：

> 📌 今天有 3 道错题到期，其中 1 道已逾期

- 点「去复习」跳到错题页并勾上「只看待复习」
- 点「开启桌面提醒」申请浏览器通知权限，之后到期会弹系统通知（每天每设备只弹一次）
- 点 × 表示「今天不再提示」，日期记在 localStorage，明天自动恢复

### 2. 邮件摘要

```bash
python mb.py remind            # 只看摘要（JSON）
python mb.py remind --email    # 走 SMTP 发出去
```

首次发信前需要配置，默认读 `data/notify.json`（也可用环境变量 `MISTAKE_NOTIFY_CONFIG` 指向别处）：

```json
{
  "smtp_host": "smtp.qq.com",
  "smtp_port": 465,
  "username": "you@qq.com",
  "password": "授权码不是登录密码",
  "from": "you@qq.com",
  "to": "you@qq.com",
  "use_ssl": true
}
```

- `smtp_port` 465 走 `SMTP_SSL`；587 走 `STARTTLS`
- `password` 多数邮箱要填**授权码**
- 缺文件时会直接打印上面这份模板，照着填即可

### 3. 定时（cron / 计划任务）

程序自己不驻留定时器，交给系统：

```bash
# 每天 20:00 发一次提醒邮件
0 20 * * * cd /path/to/mistake-book && python mb.py remind --email
```

Windows 用「任务计划程序」建一个每日任务，操作填 `python mb.py remind --email`，起始于项目目录。

**为什么不做内置调度**：常驻定时器要求进程一直活着，与「用完就关」的本地工具形态冲突；cron/计划任务已经解决了这件事，而且用户能看到、能改、能停。

## 5.8 备份与恢复（v0.11；整库恢复 v0.13）

本地单文件数据库最怕两件事：误删和硬盘坏。备份解决前者，快照另存到别的盘解决后者。

### 自动备份

`python app.py` 启动时检查一次：如果 `data/backups/` 里最新一份距今 **≥ 20 小时**，就自动留一份快照；不足 20 小时直接跳过（每天最多一份，不会刷屏）。

- 文件名带时间戳：`mistakes-20261022-203203.db`，同一秒内连备两次会自动加 `-2`、`-3` 后缀，不会互相覆盖
- 默认保留最近 **14 份**，超出的按修改时间从旧到新删（不按文件名字符串排，否则同秒生成的 `x-2.db` 会被排错顺序，误删最新那份）
- 首次启动（库还不存在）不备份，避免产生一堆空库快照
- 备份失败只打印一行警告，**不影响服务启动**
- v0.15 起图片文件也一起镜像（`backups/images/`），否则恢复出来会是一堆没有图的题
- 不想要就加 `--no-backup`

### 手动备份

```bash
python mb.py backup                      # → data/backups/
python mb.py backup --dir D:\backup      # 备份到另一块盘（推荐）
python mb.py backup --keep 7             # 只留最近 7 份
```

备份会同时把 `data/images/` 镜像到 `<备份目录>/images/`（按文件名增量拷贝，已有的不重复拷），返回里的 `images_copied` 是本次新增张数。所以**只拷 `mistakes.db` 会丢图**，备份请走这条命令。

### 从备份恢复（v0.13）

推荐用 CLI，一条命令搞定，并且**覆盖前会自动给当前库留一份安全快照**：

```bash
python mb.py restore --from data/backups/mistakes-20261022-203203.db
python mb.py restore --from D:\backup\mistakes-20261022-203203.db --dir D:\backup
```

- 返回里的 `safety_backup` 是覆盖前自动留的那份快照路径——恢复错了还能再回来
- 会校验源文件：不存在、就是当前库本身、不是 SQLite、或缺 `mistakes` 表，都直接报错退出（退出码 1），不会把库写坏
- 写回走 SQLite 的 `backup()` API，并自动清掉 `-wal` / `-shm`，避免旧 WAL 与快照打架
- `--read-only` 下拒绝执行（`restore` 属写操作）

**手动兜底**（不用 CLI 时）：先停服务，再 `Copy-Item` 快照覆盖 `data/mistakes.db`，并删掉 `data/mistakes.db-wal` 和 `data/mistakes.db-shm`。手动方式**不会**自动留安全快照。

### 为什么用 sqlite3 的 backup API 而不是 copy 文件

库开的是 WAL 模式，`.db` 旁边还有 `-wal` / `-shm`。直接 `Copy-Item` 只拷主文件，可能拿到一份**还没合并 WAL 的半截数据**。
`conn.backup()` 走 SQLite 自己的页级复制，会等写锁、逐页搬运，得到的是**一致快照**，而且备份过程中不影响正在读写的进程。

### 为什么备份是「启动时检查」而不是后台定时器

和 5.7 的理由一样：常驻定时器要求进程一直活着，而这是个用完就关的本地工具。
挂在启动路径上的副作用是「你得打开它才会备份」——对每天都会看一眼错题的人来说足够；长期不打开的场景，建议直接用系统计划任务跑 `python mb.py backup --dir D:\backup`。

## 5.9 性能（v0.14）

优化目标：5 万道题 + 12.7 万条复习记录下页面不卡。改的是**查询与索引**；API 形状、返回字段、数据语义一律不变（`available` 改由 `COUNT(*)` 得出，值与原实现一致）。

### 做了什么

| # | 位置 | 改动 | 效果（50k，函数级中位） |
|---|---|---|---|
| 1 | `_knowledge_points()` | 原来 `mistakes LEFT JOIN review_logs` 把每行日志拉进 Python 去重；改成三条 SQL：题目聚合（`GROUP_CONCAT(id)` 出 `mistake_ids`）、日志按知识点聚合、证据每点取最近 5 条 | 864 → ~100 ms |
| 2 | `stats()` | 不再为「知识点数 / 过关数」跑全量知识点聚合，改成一条子查询计数 | 921.7 → 71.7 ms |
| 3 | `arena()` | 4 个逐行相关子查询改成 CTE 预聚合 + SQL 过滤 `wrong_count >= ?`；`last_result` 只在切片后按 id 补 | 494.6 → 110.6 ms |
| 4 | `build_paper()` | 全量取行 + Python 排序改成 `LEFT JOIN` 聚合出 graded/correct + `ORDER BY … LIMIT ?`；`random` 保留 `seed` 可复现，但只洗 id | 501.1 → 47.6 ms |
| 5 | `reminders()` | 三次全表 `COUNT` 合成一次 `SUM(CASE …)` | 45.0 → 7.7 ms |
| 6 | `connect()` | 加 `cache_size=64MB`、`temp_store=MEMORY`、`mmap_size=256MB` | 全接口小幅 |
| 7 | `SCHEMA` | 新增 `idx_mistakes_created(created_at DESC, id DESC)`、`idx_mistakes_knowledge`、`idx_mistakes_source`、`idx_logs_rating(mistake_id, rating)` | 列表 21.8 → 3.5 ms；`idx_logs_rating` 是覆盖索引，再战区/组卷/知识点统计都只读两列 |

### 50k 实测（HTTP，ms）

| 接口 | 优化前 | 优化后 | 倍数 |
|---|---|---|---|
| 首屏（4 请求并发） | 972.0 | 76.9 | 12.6× |
| stats | 931.4 | 89.5 | 10.4× |
| knowledge/tree | 899.1 | 73.5 | 12.2× |
| profile | 889.0 | 100.0 | 8.9× |
| mastery | 868.1 | 76.4 | 11.4× |
| paper(30) | 523.3 | 58.6 | 8.9× |
| arena | 480.8 | 116.0 | 4.1× |
| analytics | 1164.5 | 321.4 | 3.6× |
| meta | 83.5 | 46.4 | 1.8× |
| plan | 156.1 | 140.8 | 1.1× |
| export.json | 1092.2 | 1102.6 | 本轮未动；v0.15 已改流式（见 5.10） |

### 怎么复现

```bash
python bench.py --rows 50000     # 生成临时库并逐接口计时，不碰 data/mistakes.db
```

### 注意

- 新增索引会在**下次启动**时对已有库自动创建（`CREATE INDEX IF NOT EXISTS`）。5 万行库首次建索引约几秒，之后无感；库越大这次等待越久。
- 老库不会自动 `ANALYZE`；数据量变化很大后建议手动 `sqlite3 data/mistakes.db "ANALYZE"`，让查询计划更准。
- `export.json/csv` 的全量进内存问题已在 v0.15 解决（见 5.10）。
- `plan()` 仍把到期行整行取回 Python 分桶（约 140ms），是下一个可优化点。

## 5.10 图片落盘、流式导出与前端测试（v0.15）

### 图片不再进数据库

以前图片以 Data URL 存在 `mistakes.image_data` 里，一条带图记录能让整行膨胀几百 KB，备份文件和 `export.json` 一起变大。

现在：上传时解码校验（只认 png/jpeg/gif/webp/bmp，查 magic bytes，拒绝 SVG —— 它能内嵌脚本，回源有 XSS 风险），按内容哈希命名写到 `data/images/<sha256前32位>.<ext>`，库里只存 `image_file` 文件名。

- **内容寻址**：同一张图重复上传只占一份；备份时按文件名增量拷贝即可，天然幂等。
- **写入原子**：先写 `.tmp` 再 `os.replace`，不会留下半张图。
- **老库自动迁移**：`init_db()` 末尾调 `migrate_images()`，把 `image_data` 搬到文件并清空该列，坏图跳过不阻塞启动。
- **回源**：`GET /api/images/{name}`，文件名用正则白名单校验（防目录穿越），响应带 `Cache-Control: immutable`，所以图片不会重复下载。

### 导出改流式

`iter_export()` 是生成器，逐行吐 JSON 片段；HTTP 端用 `_stream()` 边写边发，并显式 `Connection: close`（不设 `Content-Length`，走 chunked）。CSV 同理。

2 万题实测（`tests/_tmp/perf20k.db`）：

| 写法 | 耗时（3 次中位） | 峰值内存 | 输出 |
|---|---|---|---|
| 整串 dumps（旧） | 405.3 ms | 138.9 MB | 29.7 MB |
| 流式（新） | 453.7 ms | **1.1 MB** | 23.6 MB |

峰值内存降了约 126 倍，代价是慢 12%（每行一次 `json.dumps`，且没有 `indent=2` 的空白）。耗时用 `time.perf_counter` 单独测，峰值内存用 `tracemalloc` 测（它会把耗时抬高好几倍，所以两者分开跑）。**所以两条路径都留着**：`export_all()` 仍是内存版给 `mb.py export`（不带 `--out`）和测试用，输出与流式版逐字段等价（有测试断言）。

> 图片本身不在 JSON 里，导出文件只带 `image_url`。要连图片一起备份请用 `mb.py backup`（会把 `images/` 一起镜像到备份目录），恢复时一并补回。

### 前端单元测试

`esc / stars / localStamp / isOverdue` 抽到 `static/lib.js`（UMD：浏览器挂 `window.MB`，Node 走 `module.exports`），页面用 `<script src="/lib.js">` 引入。测试用 Node 内置 `node:test`，Python 侧 `tests/test_frontend.py` 起 `node --test` 包一层，所以 `python -m unittest discover -s tests` 依旧是唯一入口。

## 5.11 界面风格（v0.16）

参照 `D:\jinzhi-correction-electron`（今知错题本，React + Ant Design 5 + Vite，只有打包产物、无源码）的 `dist/renderer` 样式表，把它的**排版体系**搬到本项目的前端。只取视觉规则，不引入 React、Ant Design 或任何依赖 —— `static/index.html` 仍是原生 JS 单页。

### 设计令牌

原 `--bg/--card/--ink/--muted/--line/--brand/--brand-soft/--ok/--danger/--radius` 名称保留（内联样式引用了 `var(--muted)`），只换取值，并补充间距/尺寸类令牌：

| 类别 | 变量 | 值 | 用途 |
| --- | --- | --- | --- |
| 画布 | `--bg` | `#f3f4f6` | 页面底色 |
| 表面 | `--card` / `--subtle` / `--hover` / `--active` | `#fff` / `#f7f8fa` / `#f0f1f3` / `#e8ebef` | 卡片、浅底块、悬停、按下 |
| 文字 | `--ink` / `--muted` / `--ink-3` | `#20242b` / `#66707e` / `#929aa6` | 主/次/三级文字 |
| 描边 | `--line` / `--line-strong` | `#dfe2e7` / `#cfd4db` | 分隔线、悬停描边 |
| 强调 | `--brand` / `--brand-hover` / `--brand-soft` | `#3478f6` / `#2468df` / `rgba(52,120,246,.09)` | 主按钮、选中态、柔和底 |
| 语义 | `--ok` / `--warn` / `--danger` 及各自 `-soft` | `#2b8a52` / `#c87820` / `#d83b42` | 成功/警示/危险 |
| 圆角 | `--radius` / `--radius-sm` / `--radius-xs` | `6px` / `5px` / `4px` | 卡片 / 控件 / 徽标 |
| 尺寸 | `--ctl` / `--ctl-sm` | `30px` / `26px` | 常规控件 / 紧凑控件 |
| 阴影 | `--shadow-sm` / `--shadow-md` | `0 1px 2px rgba(20,24,31,.06)` / `0 8px 24px rgba(20,24,31,.12)` | 悬停 / 弹窗 |

### 排版规则

- **正文 13px / 行高 1.5**，系统字体栈（`-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, Microsoft YaHei`），开启 `-webkit-font-smoothing:antialiased`。原先是 15px/1.6。
- **字号层级**：h1 15px/650 → 卡片标题 13px/600 → 正文 13px → 辅助 12px → 徽标与元信息 11px。参考项目的字号频次就是 12px 最多、13px 次之、11px 再次。
- **控件统一 30px 高**（紧凑处 26px），圆角 5px，聚焦时 `border-color:var(--brand)` + `0 0 0 2px rgba(52,120,246,.14)` 光晕，不再用 `outline`。
- **主列表改成白色连续列表**：`#list` 是一块白底 + 1px 描边 + 6px 圆角的容器，行与行之间只留一条 `1px var(--line)` 发丝线，行悬停 `#f2f5fa`（对应参考项目的 `.mistake-item` 形态）。其他列表仍是独立卡片，避免知识点卡片被套进同一个容器。
- **徽标/状态片 11px、圆角 4px、内边距 1px 6px**，用各语义色的 8%~10% 透明底（`--danger-soft` 等），不再用 999px 胶囊。
- **导航从实心蓝胶囊改成柔和选中态**：选中项 `background:var(--brand-soft)` + `color:var(--brand)` + 600 字重，与参考项目侧栏选中态一致；未选中悬停给 `--hover` 底。
- **弹窗 8px 圆角 + `--shadow-md`**，遮罩 `rgba(20,24,31,.45)`，表单内边距 18px 22px，底部操作区上方加一条发丝分隔线。
- **图表与进度条收敛**：柱状图 110px 高、6px 圆角；进度条轨道 6px 高、3px 圆角，已复习用 `--brand`，新建用 30% 透明蓝。
- **滚动条统一 8px / 拇指 4px 圆角**（参考项目是 6px，桌面端 8px 更好点中）。
- **新增 `.hint` 类**：原先多处 `class="hint"` 没有对应样式（靠继承），现在统一为 12px 三级文字，行内 `<code>` 用浅灰底 + 3px 圆角。

### 保持不变

- HTML 结构、元素 id、`data-*` 属性、所有事件绑定与 API 调用**零改动**：本次只替换 `<style>` 块，页面脚本与接口语义未动。
- 移动端媒体查询保留并按新令牌重算：正文 14px、输入框仍 16px（防 iOS 自动放大）、控件 36px、主列表贴边全宽、弹窗全屏、操作区吸底。
- 打印页（`/print`）的样式由 `app.py` 里的 `PAPER_CSS` 独立生成，本次未改，仍是 A4 试卷排版。

## 5.12 错题卡片（v0.17）

列表卡片重做。目标：一屏扫下来就知道「哪道该现在复习」和「它考什么」，不用逐条读标签。

### 卡片结构

一行一道题，`article.card.<status>`：

| 区块 | 元素 | 内容 |
| --- | --- | --- |
| 选择 | `input.pick` | 批量操作复选框 |
| 头部 | `.chead` | 学科 · 状态点 · 到期文案 |
| 题面 | `p.q-text` | 14px / 500，两行截断 |
| 元信息 | `.cmeta` | 知识点 chip / 错因 / 来源 / 难度星 / 复习次数 |
| 缩略图 | `img.thumb` | 56×56（移动端 48），仅当题目有图 |
| 操作 | `button.mini` | 「斩题」，默认透明，悬停或聚焦时出现 |

### 状态轨（核心设计）

卡片左侧 3px 竖条由 `::before` 画，颜色即状态：

| 状态 | 颜色 |
| --- | --- |
| 新建 `new` | `rgba(200,120,32,.5)` |
| 复习中 `reviewing` | `rgba(52,120,246,.45)` |
| 已掌握 `mastered` | `rgba(43,138,82,.45)` |
| 逾期 `overdue` | `rgb(216,59,66)` |
| 已斩 `suspended` | `rgb(207,212,219)` |
| 选中 `picked` | 覆盖为 `--brand` |

理由：一屏几十张卡片时，颜色是比文字快得多的扫视通道；把「该复习了」从**需要阅读的标签**变成**不需要阅读的色条**，扫视成本才降得下来。

### 其余决策

- **只有状态轨和「逾期」用颜色**，其余全部中性灰。否则一屏颜色互相打架，状态轨就失去了唯一性。
- **到期文案用相对时间**（逾期 3 天 / 今天到期 / 5 天后），比「该复习了」更可执行 —— 它直接回答「还剩几天」。
- **知识点 chip 加重**（`.chip.kp`：`--ink` 色 + 500 字重），比错因、来源 chip 更醒目。判断「这题考什么」比判断「这题哪来的」更常用。
- **「斩题」改为悬停显示**：低频、且用户感知里偏不可逆，常驻按钮既占每行右侧空间又容易误点。`≤640px` 常驻 —— 触屏没有 hover。
- **缩略图进列表**（`thumbs=1`）：题干是纯文字时，图片往往才是关键条件；56px 够判断「有没有图、是不是那道」，看细节点开弹窗。

### 后端配合

`GET /api/mistakes?thumbs=1` 时 `query_mistakes()` 多查一列 `image_file`，`row_to_dict(r, include_image=True)` 才输出 `image_url`。**默认不带** —— 保持 v0.15 契约，避免列表响应变大；测试 `test_list_thumbs_is_opt_in` 守着这条边界（默认响应无 `image_url`、`thumbs=1` 才有、内部字段 `image_file` 不外泄）。

### 修复的 bug

新建题的 `next_review_at` 就是「现在」，原先用 `isOverdue()`（`<=`）判断，结果**每道新题的卡片都显示红色逾期轨**。改为按自然日比较：`dueDays(it)` 返回相差天数，只有 `< 0` 才算逾期（`isLate()`），今天到期用 `--warn` 色的「今天到期」。`isOverdue()` 保留给提醒横幅等旧逻辑。

## 5.13 复习先遮答案（v0.18）

错题弹窗此前是一个完整编辑表单：点开卡片，答案、解析、错因全在眼前。这等于**开卷复习** —— 看到正确答案的瞬间会产生「我会了」的错觉（fluency illusion），实际并没有完成一次提取。

### 改法

| 位置 | 改动 |
| --- | --- |
| [static/index.html](static/index.html) 表单 | 「我的错误答案 / 正确答案 / 解析」包进 `<div class="answerbox" id="answer-box">`，前面插一条 `<div class="revealbar" id="reveal-bar">` |
| 同上 | 提示文案「先别急着看答案 —— 自己重做一遍，再对照。」+ 按钮「看答案与解析」（`#btn-reveal`） |
| 样式 | `.revealbar` 复用 `--subtle` / `--line` / `--radius-sm`；`.answerbox[hidden]{display:none}` 保证 `hidden` 不被 `display:grid` 覆盖 |
| 逻辑 | `setRevealed(on)`：切换答案块与提示条，并让评分条只在「已展开 + 正在看已有题」时出现 |
| 触发 | `fillForm(it)` 末尾 `setRevealed(!it)` —— **新建直接展开，编辑/复习一律折叠** |

### 决策

- **遮的是「答案 + 解析 + 我的错误答案」，不是整张表单** —— 题干、知识点、错因分类仍然可见：它们是「这题考什么」的线索，不是解法本身。看得到题面，才谈得上重做。
- **折叠而不是另做一套复习页** —— 弹窗本来就是唯一入口，另起复习视图会把「编辑」和「复习」拆成两条维护路径；折叠只多一个 `hidden` 状态，交互完全不变。
- **评分条跟着答案一起出现** —— 没看答案就自评「记得 / 忘了」是没有依据的评分，会直接污染 FSRS 的 S/D。所以展开前 `#rate` 隐藏。
- **新建题不遮** —— 录入时用户手上就是答案，遮起来只是多点一次。
- **评完分 `review()` 会重填表单、答案重新折叠** —— 正好符合「下一轮复习也要先自己想」的节奏，无需额外处理。

### 验证

前端 DOM 没有单测（项目的前端测试只覆盖 `static/lib.js` 纯函数），本功能用 **Edge headless + CDP** 断言：折叠态 `#answer-box` 的 computed `display:none`、`#reveal-bar` 为 `flex`、`#rate` hidden、答案文本已填入；点击 `#btn-reveal` 后三者反转（`grid` / `none` / 可见）；点 `#btn-new` 新建时答案可见、提示条隐藏；全程无 JS 异常、无横向溢出。

## 5.14 UI 重做（v0.19）

v0.19 把界面按**方向 A「纸面」**整体重做：暖白画布、纯白卡片、墨色文字、墨绿强调、几乎不用阴影，靠描边与留白分层。分 5 批推进，**批 1（设计系统 + 壳层）、批 2（错题列表页）、批 3（弹窗）、批 4（其余 5 个视图）、批 5（移动端 + 打印页）已完成**。

### 批 1 改了什么

| 层 | 改动 |
| --- | --- |
| 令牌 | `--bg:#f6f6f3` `--card:#fff` `--ink:#1c1c19` `--brand:#2f6f4f`（墨绿）`--muted:#5e5e55` `--line:#e3e3da`；圆角 `10/8/6`；控件 `--ctl:32px` `--ctl-sm:28px` |
| 排版 | 正文 13px → **14px**，行高 1.5 → **1.55**；题面 14px → 15px；标题 15px → 16px；控件高度 30px → **32px** |
| 壳层 | `<header>` 顶部横排 → `<aside class="side">` 左侧栏（208px，含品牌、6 项导航、底部统计） |
| 导航 | 同一份 `nav.tabs` DOM 竖向排列，桌面 36px 行高；**手机端用媒体查询翻成底部 tabbar**（46px，含 safe-area） |
| 主区 | 新增 `.main` 包裹层，`main` 最大宽度 1120px → 1040px，内边距 24/28px |
| 断点 | ≥1024 侧栏 208px；768–1023 收窄到 168px；<768 底部 tabbar + 主区内边距 84px 避让 |

**零 JS 改动**：`switchView()` 依赖 `document.querySelectorAll('nav.tabs button')` 与 `data-view`，批 1 保留了这两者，只换容器与样式，所以六个视图切换、统计渲染、提醒横幅全部沿用原逻辑。

### 批 1 验证

Edge headless + CDP 断言（本模型读不了图，故用 `getComputedStyle` 数值代替看图）：

| 项 | 桌面 1250px | 平板 900px | 手机 375px |
| --- | --- | --- | --- |
| `--brand` / `--bg` | #2f6f4f / #f6f6f3 | 同 | 同 |
| body 字号 / 行高 | 14px / 21.7px | 同 | 同 |
| 侧栏宽度 / 定位 | 208px / sticky | 168px / sticky | 375px / **fixed 底部** |
| 导航按钮高 | 36px | 36px | 46px |
| 搜索框 / 主按钮高 | 32 / 32px | 32 / 32px | 38 / 38px |
| 横向溢出 | 无 | 无 | 无 |

- 六个视图逐个点击：每次只有对应 `main` 可见、`.on` 恰好 1 个。
- 弹窗回归：`#dlg` 760px / 圆角 10px / 标题「编辑错题 #3」；v0.18 遮答案行为不变（折叠 → 展开）；`#dlg-import` 与 `#dlg-paper` 均能打开。
- 全程无 JS 异常。
- `python -m unittest discover -s tests` → **Ran 112 tests / OK**。
- 截图：`docs/ui-v019-b1-desktop.png`、`docs/ui-v019-b1-dialog.png`、`docs/ui-v019-b1-mobile.png`。

### 批 2 改了什么（错题列表页）

列表页从「一排 11 个控件 + 卡片」改成「页头 + 筛选条 + 行式列表」。

| 区块 | 改动 |
| --- | --- |
| 页头 | 新增 `.pagehead`：左「错题」标题 + `#list-sub`（「共 N 道 · 第 1/1 页」），右「+ 新增错题」+「更多」 |
| 更多菜单 | 批量导入 / 组卷打印 / 导出 CSV / 备份 JSON / 最近删除 收进 `#more-menu`，点外部或 Esc 关闭 |
| 筛选条 | 搜索常驻 + 「筛选」按钮（带 `#filter-count` 计数徽标）；11 个控件收进 `#filter-panel` 抽屉（3 列网格 + 3 个复选 + 重置/完成） |
| 条件回显 | `#active-chips`：每个生效条件一枚 `.chipx`，点 × 直接清掉该项并重新查询 |
| 行式列表 | 保留 3px 状态轨；右侧新增 `.rowacts`：**复习**常驻，**编辑 / 斩题**悬停才出现（触屏与 ≤767px 常显） |
| 交互 | **点整行 = 进复习**（先遮答案）；编辑改走行内按钮，直接展开答案与字段 |

配套 JS：

| 函数 | 位置 | 作用 |
| --- | --- | --- |
| `renderList(data)` | `static/index.html` | 生成行式卡片 + `#list-sub` 文案 |
| `renderChips()` | 同上 | 由 `FILTER_DEFS` 读当前控件值渲染 chip 与计数 |
| `clearFilter(key)` | 同上 | 清单项筛选并重查 |
| `openEdit(id, mode)` | 同上 | `mode='review'`（默认，遮答案）/ `'edit'`（展开可改） |
| `setRevealed(on)` | 同上 | 编辑模式下不显示评分条 |

**为什么把「编辑」藏起来**：这个页面的主任务是复习，不是维护数据；编辑是低频动作，藏进悬停既减少噪音又不丢入口。

**为什么点整行改成复习而不是编辑**：误点一行时，「看一眼题目」比「打开编辑表单」代价低得多，也符合「复习=重做」的产品主张。

### 批 2 验证

Edge headless + CDP 断言（3 条种子题，桌面 1250px / 手机 375px）：

| 断言 | 实测 |
| --- | --- |
| `.pagehead` 存在、旧 `.toolbar` 已移除 | true / true |
| `#list-sub` | 「共 3 道 · 第 1/1 页」 |
| 每行 `.rowacts .go` / 编辑 / 斩题 | 3 / 3 / 3 |
| 编辑按钮静息透明度（桌面） | 0（悬停才现） |
| 「更多」菜单 | 点开 `hidden=false`、5 项、`aria-expanded=true`，点外部自动关闭 |
| 筛选抽屉 | `hidden` true→false、`aria-expanded=true`、`.fgrid` 三列（296px ×3） |
| 选「状态=待复习」 | chip 1 枚（「状态：待复习×」）、计数 1、列表 3→1 行 |
| 点 chip × | chip 归零、`#status` 复位、列表回到 3 行 |
| 点「复习」 | 弹窗标题「复习错题 #6」、答案折叠、揭示条可见；点「看答案」后展开 |
| 点「编辑」 | 标题「编辑错题 #6」、答案已展开、评分条隐藏 |
| 点整行 | 标题「复习错题 #6」、答案折叠 |
| 手机 375px | `.fgrid` 单列、编辑按钮常显（opacity 1）、无横向溢出 |
| JS 异常 / 横向溢出 | 0 / 无 |

- `python -m unittest discover -s tests` → **Ran 112 tests / OK**。
- 截图：`docs/ui-v019-b2-desktop.png`、`docs/ui-v019-b2-mobile.png`。

### 批 3 改了什么（弹窗重做）

弹窗从「单列长表单」改成「左 60% 题面 / 右 40% 评分侧栏」，评分不再压在表单最底部。

| 区块 | 改动 |
| --- | --- |
| 外壳 | `dialog` 宽度 `min(760px,94vw)` → `min(1120px,96vw)`；`.form` 改成三行网格 `auto / minmax(0,1fr) / auto`（头 / 身 / 脚），只有中间 `.dlgbody` 滚动 |
| 弹窗头 | 新增 `.dlghead`：标题 + 右上角 `#btn-dlg-close`（×），替代原来只有「取消」一个出口 |
| 左栏 `.main-col` | 题目（rows 3→6）、题目图片、折叠提示条、答案区（我的答案 / 正确答案 / 解析 rows 3→4）—— 复习时注意力全在这里 |
| 右栏 `.side-col` | 评分条 `#rate`（2×2 评分板）、复习历史 `#hist`、学科 / 难度、错因分类 / 来源、知识点 / 标签、状态、错因详细、变式题 `#var-box` |
| 断点 | 新增 `@media(max-width:900px)`：单列、弹窗全屏、左栏底部分隔线；767px 块里删掉重复的 `dialog` / `.form` 规则，改成 `.dlghead` / `.main-col,.side-col` / `.actions` 各自的内边距 |

**为什么是 60/40 而不是 50/50**：左栏放题面与解析，是长文本，需要横向空间；右栏全是短字段与按钮，400px 出头就够。50/50 会让右栏空一半、左栏答案频繁换行。

**为什么评分放右栏顶部而不是底部**：评分是复习的终点动作，但学生的视线在题面上；放在右栏顶部，展开答案后不用滚动就能点到，也符合「读完解析 → 立刻自评」的顺序。

**为什么加 × 关闭按钮**：原来只能点「取消」，在 1120px 宽的弹窗里要横跨整个屏幕才找得到；× 是弹窗的通用约定。

### 批 3 顺手修的两个老 bug

| Bug | 现象 | 原因 | 修法 |
| --- | --- | --- | --- |
| 隐藏面板没真隐藏 | 新增错题时，「这次答得怎样？」评分条与空的「变式题」框一直显示 | `.rate{display:flex}` / `.varbox{display:grid}` 是作者样式，优先级高于 UA 的 `[hidden]{display:none}`，`el.hidden = true` 无效 | 补 `.rate[hidden],.varbox[hidden]{display:none}` |
| 变式题输入行撑破侧栏 | 桌面侧栏与手机整列被撑到 517px（容器只有 375px），横向溢出 | `.varadd` 两个 input + 按钮不换行，min-content 463px，把 grid 轨道 `1fr` 的 auto 最小值顶开 | `.varadd{flex-wrap:wrap}` + input `flex:1 1 130px`；移动端轨道改 `minmax(0,1fr)` 并给两栏 `min-width:0` |

### 批 3 验证

Edge headless + CDP 数值断言（3 条种子题，桌面 1280px / 手机 375px）：

| 断言 | 实测 |
| --- | --- |
| `.dlgbody` 两栏比例 | `664.797px 443.203px` = 60% / 40% |
| 弹窗宽度 | 1120px |
| `.dlghead` / `#btn-dlg-close` 存在 | true / true |
| `#f-question`、`#answer-box` 在左栏 | true / true |
| `#rate`、`#f-type`、`#var-box` 在右栏 | true / true / true |
| 新增模式：`#rate` / `#var-box` 计算样式 | `display:none` / `display:none`（修复后） |
| 复习模式揭示前 / 后 `#rate` | `none` → `grid` |
| 评分板列宽 / 按钮宽 | `186.594px 186.609px` / 4×187px |
| 点 × 关闭 | `#dlg.open` → false |
| 点「记得」 | 复习历史刷新（「累计复习 1 次 · 连续答对 1 次 · 下次 …」）、弹窗保持打开 |
| 桌面 `.dlgbody` / `.side-col` 横向溢出 | 0 / 0 |
| 手机 375px `.dlgbody` 列 | `375px` 单列 |
| 手机变式题 `.varadd` 高度 | 64px（自动折成两行），溢出 0 |
| 手机整页横向溢出 | 0 |
| JS 异常 | 0 |

- `python -m unittest discover -s tests` → **Ran 112 tests / OK**。
- 截图：`docs/ui-v019-b3-desktop.png`、`docs/ui-v019-b3-mobile.png`。

### 批 4 改了什么（其余 5 个视图）

批 2 把「错题列表页」改成 `.pagehead` + `.filterbar` + 行式卡片后，另外 5 个视图还留着 v0.16 的 `.toolbar`（一行 flex，把下拉、按钮、说明文字全挤在一起，没有页面标题）。批 4 把它们统一到同一套页头：

| 视图 | 改前 | 改后 |
| --- | --- | --- |
| 学习 `#view-study` | `.toolbar` 里 学科下拉 + 刷新 + 树视图 + 门禁说明挤成一行 | `.pagehead`：标题「学习」+ 副标题 `#st-sub`（知识点 N 个 · 已过门禁 N 个）；`.ph-r` 放学科 / 切换树视图 / 刷新；门禁阈值说明降级成 `.viewnote#st-note` |
| 计划 `#view-plan` | `.toolbar` 4 个控件 + 一段 hint | 副标题 `#pl-sub` = 今天 N 道 · 逾期 N 道 · 未来 N 天共 N 道；4 个控件全进 `.ph-r` |
| 分析 `#view-an` | `.toolbar` 天数下拉 + 刷新 + 公式说明 | 副标题 `#an-sub` = 近 N 天 · 新增 N 道 · 复习 N 次；保持度公式说明移到 `.viewnote` |
| 回收站 `#view-trash` | `.toolbar` 刷新 + 清空 + 保留策略说明 | 副标题 `#tr-sub` = 共 N 条，可恢复；「清空回收站」保留 `.danger` 放页头右侧 |
| 再战区 `#view-arena` | `.toolbar` 里塞了学科 / 在区·出区 / 刷新 + 两个 number 输入 + 保存按钮 | 阈值配置收进 `details.panel#ar-cfg`（默认折叠）；页头只留 学科 / 在区·出区 / 刷新 |

配套改动：

- 5 个 `.psub` 全部由各自的 loader 写入（`#st-sub` / `#pl-sub` / `#an-sub` / `#tr-sub` / `#ar-sub`），数字随筛选条件实时变；请求失败时不改副标题，保留默认文案。
- 新增 CSS：`.ph-r select{height:var(--ctl-sm);font-size:13px}`、`.ph-r .ghost{...}`、`.viewnote{margin:-2px 0 14px;font-size:12px;color:var(--ink-3)}`、`.viewnote:empty{display:none}`、`.cfgrow{display:flex;gap:16px;align-items:center;flex-wrap:wrap}`、`.cfgrow input{width:64px;height:var(--ctl-sm)}`。
- 移动端（≤767px）新增：`.ph-r{width:100%;flex-wrap:wrap}`、`.ph-r select,.ph-r .ghost{flex:1 1 auto;min-width:0;height:38px}`、`.viewnote{margin-top:-4px}`。
- 所有 `#st-refresh` / `#pl-refresh` / `#an-refresh` / `#tr-refresh` / `#ar-refresh` / `#st-mode` / `#set-min-wrong` / `#set-clear-streak` / `#set-save` 的 id 与事件绑定原样保留，只挪了位置，JS 无需改选择器。

**为什么这么做**：

- **「进出区规则」收进折叠面板**：它是设置项，不是日常操作。之前两个 number 输入和「在战区 / 已出区」筛选挤在同一行，看不出主次，手机上还要横向滚。收进 `<details>` 后页头只剩 3 个筛选控件。
- **副标题放数字，而不是再加一排 `.overview`**：`.overview` 保留（它是主指标卡，带边框），副标题只做一句话摘要。两者的分工是「一眼知道这页有没有内容」vs「点进去看细分」。
- **保留「刷新」按钮**：这些视图没有自动轮询，另一个标签页录入后需要手动同步；直接删掉会让人以为页面卡住。样式降到 `ghost` + 28px，不抢视觉。

### 批 4 验证

Edge headless + CDP 数值断言（3 条种子题 + 2 次「又错」评分，桌面 1280px / 手机 375px）：

| 断言 | 实测 |
| --- | --- |
| 5 个视图旧 `.toolbar` 残留 | 全部 0 |
| 学习页标题 / 副标题 | 「学习」/「知识点 3 个 · 已过门禁 0 个」 |
| 计划页副标题 | 「今天 2 道 · 逾期 2 道 · 未来 7 天共 3 道」 |
| 计划页切到 14 天 | 「… · 未来 14 天共 3 道」（副标题随筛选变） |
| 分析页副标题 | 「近 30 天 · 新增 3 道 · 复习 2 次」 |
| 回收站（删 1 条后） | 「共 1 条，可恢复」，列表 1 行 |
| 再战区副标题 / 行数 | 「在战区 1 道 · 已出区 0 道」/ 1 行 |
| 再战区 `#ar-cfg` 默认状态 | `open=false`，`#set-min-wrong` 已从 settings 回填 = 2 |
| 学习页「切换树视图」 | `#st-tree.hidden=false`、`#st-list` display=none、按钮文案变「切换卡片视图」 |
| 5 个视图横向溢出 | 0 / 0 / -10 / 0 / 0（负数=无溢出） |
| 手机 375px `.ph-r` 宽 / 高 | 347px / 84px（自动折成两行），整页溢出 0 |
| JS 异常 | 0 |

- `python -m unittest discover -s tests` → **Ran 112 tests / OK**。
- 截图：`docs/ui-v019-b4-study.png`、`docs/ui-v019-b4-arena.png`、`docs/ui-v019-b4-mobile.png`。

### 批 5 改了什么（移动端细化 + 打印页）

批 5 收尾三件事：把「组卷打印」弹窗拉进批 3 的弹窗外壳体系、把打印页从「蓝色技术文档」改成「纸面试卷」、把 ≤767px 的零碎体验补齐。

#### 5.1 组卷打印弹窗（`#dlg-paper`）

改前它是个独立 `<form>`，没有弹窗头、没有关闭按钮、字段平铺。改后与 `#dlg` 同构：

```
header.dlghead   h2#p-dlg-title「组卷打印」 + button.xclose#btn-paper-close
div.dlgbody
  section.main-col   p.hint#p-hint + .grid2（题卷标题 / 题数 / 排序 / 版式 / 留白行数）
  aside.side-col     label.ck 包 #p-images、「当前筛选下共 N 题」#p-meta + 两段说明
footer.actions       取消 + 提交「打开打印页」
```

- `#dlg-paper{width:min(860px,96vw)}`，比错题弹窗（1120px）窄——它只有 5 个字段，不需要右侧评分栏那么宽。
- `.main-col` 保留 `border-right`，`.side-col` 沿用批 3 的 `background:var(--subtle)`，两个弹窗视觉一致。
- 新增 `#btn-paper-close` 的 `click → close()`；原来只有「取消」能退出，右上角没有出口。

#### 5.2 打印页（`PAPER_CSS` + `_paper_html`）

整块重写，从「蓝色 `#2b6cb0` 技术文档」换成纸面：

| 元素 | 改前 | 改后 |
| --- | --- | --- |
| 画布 / 纸张 | 灰底 + 白纸 + 硬阴影 | `#f6f6f3` 暖白画布 + `#fff` `.sheet`，`border:1px solid #e3e3da` + `0 2px 18px rgba(28,28,25,.07)` 柔和阴影 |
| 字体 | 系统无衬线 | 中文宋体栈 `"Songti SC","SimSun","PingFang SC","Microsoft YaHei",serif` |
| 题号 `.qno` | 蓝色方块 | 墨绿 `#2f6f4f` **圆形**徽标（`border-radius:50%`） |
| 答案区 `.ans` | 蓝色左边框 + 浅蓝底 | `3px solid #2f6f4f` 左边框 + `#f7f7f2` 底 |
| 作答横线 `.blank` | 实线 | `1px dashed #cfcfc3` |
| 分页 `.q` | 无控制 | `orphans:3;widows:3`（避免题干被撕成两页） |
| 顶栏 `.bar` | `#111` 深色底 + 白字 | 白底 + 墨绿主按钮 + 描边次要按钮 |
| 打印 | 无 | `print-color-adjust:exact`（保住底色不被浏览器抹掉） |

顶栏还加了两段文案：`.bar .meta`（版式说明）与 `.bar .tip`（`Ctrl+P / ⌘P → 另存为 PDF`），后者放在 `<span class="sp"></span>` 之后靠右。

**为什么用宋体而不是无衬线**：错题本打印出来是给学生手写用的纸。宋体在 A4 上 12pt 时的字面更小、行距更松，留白多，写完不挤；屏幕上的无衬线在纸上会显得笨重。这是打印介质与屏幕介质的差别，不是审美偏好。

**为什么留白线用 dashed 而不是实线**：实线在打印后和正文分隔线混在一起，学生分不清「该写字的地方」和「版块边界」；虚线明确是「填空位」。

#### 5.3 移动端细化（≤767px）

批 2~4 主要修的是结构，批 5 补的是触控尺寸与全出血：

| 项 | 改动 |
| --- | --- |
| 筛选抽屉 | `.fpanel` 改全出血（`margin:0 -14px`、去左右边框与圆角），`.facts` 吸底（`position:sticky;bottom:0`），两个按钮 `flex:1 1 0` 各占一半 |
| 批量操作条 | `.bulkbar` `position:sticky;top:0;z-index:12` + 全出血；按钮 `min-height:36px` |
| 搜索框 | `.searchbox{flex:1 1 100%}`，筛选按钮独占下一行 |
| 行内操作 | `.rowacts .go` 34px、`.mini` 32px（批 2 是 28px，触控偏小） |
| 分页 | `.pager button` 34px |
| 弹窗 | `overscroll-behavior:contain`（滚到底不带动页面）；`#dlg-paper` 满宽单列 |
| 文字 | `-webkit-text-size-adjust:100%`（横屏不被自动放大） |

### 批 5 验证

Edge headless + CDP 数值断言（6 条种子题，桌面 1280px / 手机 375px）：

| 断言 | 实测 |
| --- | --- |
| 打印页 `.qno` 背景 / 圆角 | `rgb(47, 111, 79)` / `50%` |
| 打印页 `.ans` 左边框色 | `rgb(47, 111, 79)` |
| 打印页 `.blank` 下边框样式 | `dashed` |
| 打印页 body 字体 | `"Songti SC", SimSun, "PingFang SC", "Microsoft YaHei", serif` |
| 打印页 `.sheet` 宽 | 820px |
| 打印页题目 / 答案块 / 分页符 | `.q` 5 个、`.ablock` 5 个、`.pagebreak` 存在 |
| 打印页顶栏底色 | `rgb(255, 255, 255)`（旧深底已移除） |
| 打印页残留旧蓝 | `#93c5fd` / `#2b6cb0` 均无 |
| 打印页横向溢出 | -15（无溢出） |
| `#dlg-paper` 弹窗头 / 关闭按钮 | `.dlghead` true、`#btn-paper-close` true |
| `#dlg-paper` 两列宽 | `514.797px 343.203px`（= 60/40），弹窗宽 860px |
| `#dlg-paper` 关闭 | 点 × 后 `open=false` |
| 手机 `.fpanel` 左边界 / 宽 | 0 / 375px（全出血） |
| 手机 `.facts` position | `sticky` |
| 手机按钮高度 | `.go` 34 / `.mini` 32 / `.pager button` 34 |
| 手机整页横向溢出 | 0 |
| 手机 `#dlg-paper` 列宽 / 尺寸 | `375px` 单列 / 375×812 满屏 |
| JS 异常 | 0 |

- `python -m unittest discover -s tests` → **Ran 112 tests / OK**。
- 截图：`docs/ui-v019-b5-print.png`、`docs/ui-v019-b5-paper-dialog.png`、`docs/ui-v019-b5-mobile.png`、`docs/ui-v019-b5-paper-mobile.png`。

### 后续批次

| 批次 | 范围 | 状态 |
| --- | --- | --- |
| 批 1 | 设计系统 + 壳层 | ✅ 完成 |
| 批 2 | 错题列表页（FilterBar、筛选抽屉、行式列表、点卡片=复习） | ✅ 完成 |
| 批 3 | 弹窗重做（左题面 / 右评分侧栏） | ✅ 完成 |
| 批 4 | 学习 / 计划 / 再战 / 分析 / 回收站 重排 | ✅ 完成 |
| 批 5 | 移动端细化 + 打印页 + 文档 | ✅ 完成 |
| v0.20 | 公式（LaTeX）/ 一题多图 / 试卷维度 / 批量编辑 | ✅ 完成 |

## 5.15 公式、多图、试卷、批量编辑（v0.20）

四项功能，一条共同约束：**不引入 pip 依赖、不引入构建步骤**。

### 5.15.1 公式输入（LaTeX）

- 输入：题干 / 答案 / 解析里写 `$行内$` 或 `$$独立成行$$`，其余字符原样保留。
- 渲染：`static/math.js` 的 `mbMath.render(text)` —— 先 `esc()` 转义 HTML，再把公式片段交给 KaTeX；`mbMath.apply(root)` 用 TreeWalker 就地替换文本节点（打印页用，跳过已渲染的 `.katex`）。
- 位置：列表卡片题面、弹窗题面、打印页全部走同一套；KaTeX 从 `/vendor/katex/` 本地服务，**不走 CDN**（离线也能用，符合「一条命令跑通」）。
- 容错：`throwOnError:false`、`strict:'ignore'`，写错宏不会让整页白屏；不配对的 `$` 原样输出。

**为什么把 KaTeX 拷进仓库（约 560KB）而不是走 CDN**：这是本地单机应用，断网是常态；CDN 一挂，所有题面变成一行行 `$\lim...`。代价是仓库变大，但换来了零网络依赖与确定的渲染结果。

### 5.15.2 一道题多张图

- 表 `mistake_images`（见 4.8），每题最多 **6 张**，按 `sort` 顺序展示。
- 录入：`useImageFile()` 支持一次选多张 / 一次粘贴多张；每张 ≤2MB；`#img-list` 里逐张显示缩略图 + `×` 单删。
- 存储：仍然是内容寻址（`data/images/<sha256前32位>.<ext>`），**同一张图在两道题里只存一份**。
- 兼容：老单图 `image_file` 启动时自动迁进本表；接口返回 `images: [{file, url}]`，同时保留 `image_url`（第一张）给老前端。

**为什么上限是 6 张**：一道题通常「题干 + 图形 + 草稿」三张就够；6 张已经覆盖「多小问各一张图」。不设上限会让 Data URL 上传把单次请求撑到几十 MB，而错题本的价值不在存图。

### 5.15.3 试卷维度

- 建卷：更多菜单 →「试卷管理」→ 填名字（必填）/学科/考试日期，也可在题目弹窗里直接「+ 新建试卷」。
- 归卷：题目弹窗的「试卷」下拉；列表筛选抽屉的「试卷」下拉（含「未归卷」）。
- 统计：每张卷带 `count`（卷内题数）；删卷只解绑，不删题。

**为什么用「试卷」而不是再加一层「来源」**：`source`（作业/期中/月考）回答「这是什么类型的题」，`paper` 回答「这是哪一张具体的卷子」。一次期中考试可能同时有选择题、填空题、大题三份卷，来源相同但卷子不同；反过来同一张卷也可能横跨两个学科。两者正交，不能合并。

### 5.15.4 批量编辑

- 勾选若干题 → 底部 `#bulkbar` 出现「批量编辑」→ 弹窗里每个字段都有「不改」选项，只有填了的字段才会写。
- 字段：状态、学科、错因、知识点、来源、试卷、难度、标签。
- 标签特殊：支持三种模式 —— **追加**（并集）/ **覆盖**（整体替换）/ **移除**（差集），由 `#b-tags-mode` 选择。
- 上限 500 条/次；空 `ids` 或空 `fields` 返回 400。

**为什么标签要三种模式**：批量改状态是「覆盖」语义（都要变成 reviewing），批量加标签是「追加」语义（都补一个「易错」），批量删标签是「移除」语义（都去掉「已订正」）。一个 `set` 语义满足不了后两种，硬用覆盖会把别人已有的标签冲掉。

### 5.15.5 验证

- `python -m unittest discover -s tests` → **Ran 132 tests / OK**。
- Edge headless + CDP（27 条结构断言全过、JS 异常 0）：只有一个 `main` 可见、题面含 `.katex`、`#paper` 选项数正确、`#img-list` 空态文案、`#dlg-bulk` 的 `#b-type` 7 项、`#dlg-papers` 行数与卷内题数、按卷筛选后 chip 文案「试卷：… ×」、打印页含 `.katex` 且引了 `/math.js`、375px 横向溢出 0。
- 截图：`docs/ui-v020-list.png`、`ui-v020-dialog.png`、`ui-v020-papers.png`、`ui-v020-bulk.png`、`ui-v020-print.png`、`ui-v020-mobile-dialog.png`。

## 5.16 DSH 插件：预设 + 工具（v0.21 阶段一）

5.6 那条路是「让 agent 跑 `python mb.py`」——能用，但每步都要过 shell，且工具面是全量的（bash、文件读写、子 agent 全都在）。v0.21 起补上 StudyMate 那套做法的第一层：**把错题本变成 DSH 里的一条预设 + 一组专用工具**，模型直接调，不过 shell。

三层结构（照 StudyMate 的 ADR 拆的）：

| 层 | 内容 | 本仓库状态 |
|---|---|---|
| ① 预设 = 身份 + 工具面 | 两条 cordis 预设行，各挂 4 个子插件 | ✅ 阶段一 |
| ② 面板 = 嵌宿主会话 | Client 插件，把复习界面塞进 DSH 侧栏 | ✅ 阶段二（见 5.17） |
| ③ 数据 = 按需取 | `app.py` 的 30 多个 `/api/*` | ✅ 已有 |

### 5.16.1 两条预设

| preset id | 名称 | order | 技能 | 工具 |
|---|---|---|---|---|
| `mistake-review` | 错题复习 | 40 | `mistake-review-loop` | 6 个 `mb_*` |
| `mistake-qa` | 错题答疑 | 41 | `mistake-qa` | 6 个 `mb_*` |

两条预设的子插件行完全同构，只有 persona 与技能目录不同：

```yaml
- id: persona                    # 身份：复习教练 / 就地答疑
  name: "@deepseek-ai/dsh-persona"
- id: skill-filesystem           # 只挂一个技能目录，不扫默认根
  name: "@deepseek-ai/dsh-skill-filesystem"
- id: tool-skill                 # 让模型能 skill 加载
  name: "@deepseek-ai/dsh-tool-skill"
- id: mistake-book-tools         # 6 个 mb_* 工具
  name: "dsh-mistake-book/tools"
```

**没有** bash / 文件读写 / 搜索 / web / 子 agent / plan / todo ——删行才是配置层的保证，不是提示词祈祷。

### 5.16.2 八个工具

| 工具 | 参数 | 打哪个端点 |
|---|---|---|
| `mb_due` | `days`(7) `limit`(8) | `/api/plan` + `/api/mistakes?due=1` |
| `mb_search` | `q` `subject` `knowledge` `tag` `status` `mistake_type` `paper_id` `due` `limit`(≤30) `offset` | `/api/mistakes` |
| `mb_get` | `id`(必填) `with_reviews`(true) | `/api/mistakes/{id}` + `/reviews` |
| `mb_add` | `question`(必填) + 10 个可选 | `POST /api/mistakes` |
| `mb_review` | `id`(必填) `rating`(again/hard/good/easy) `step`(可选六档) | `POST /api/mistakes/{id}/review` |
| `mb_stats` | `view`(overview/mastery/trend/arena) `days`(30) | 四个统计端点 |
| `mb_weak_steps` | `days`(90) `limit`(5) | `/api/analytics` 的 `by_step` / `step_patterns` |
| `mb_events` | `limit`(20) `kind` `id` | `/api/events` |

工具返回的是**给模型读的纯文本**，不是 JSON —— `mb_due` 直接吐「今天 4 道 · 逾期 3 道 · 未来 7 天共 6 道」加编号列表，省一轮解析。

### 5.16.3 文件与装配

```
dsh-plugin/
├── package.json          # type: module，exports 出 . / ./tools / ./api / ./client
├── lib/api.js            # 零依赖 HTTP 客户端 + 服务自动拉起
├── lib/tools.js          # 6 个工具注册（export name/inject/apply）
├── skills/review/SKILL.md
├── skills/qa/SKILL.md
└── cordis.patch.yml      # 参考副本（阶段二加了根行，见 5.17.4）
```

装配两步（已在本机做完）：

1. 把包链进 profile：`mklink /J %USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-mistake-book <仓库>\mistake-book\dsh-plugin`
2. 把 `cordis.patch.yml` 里**整个 `- insert:` 块（连同外层那一行）**追加到 `~\.dsh\profiles\desktop\cordis.patch.yml`

改完 **需要重启 DSH** 才生效（`.plugin-manager` 没有 watcher）。

### 5.16.4 验证

- 假 ctx（`{tools:{register}}`）直接 `import()` → 注册 6 个，description 全 ≤ 120 码点、无换行。
- 真打 `127.0.0.1:8000`：`mb_due`/`mb_search`/`mb_get`/`mb_stats` 四视图输出正确；`mb_add` 建 #8 → `mb_review` 回「下次复习 2026-10-25 · 阶段 1」→ `mb_get` 历史正确 → 删除并清空回收站。
- 顺手修掉一个**时间相关的脆弱测试**：`test_plan_buckets_due_into_days` 用 SQLite 的 `datetime('now','+3 days')`（UTC）造数据，而 `plan()` 按本地时间分桶。UTC+8 下当地 0:00~8:00 之间两者差一天，测试会莫名报 `0 != 1`。已改为在 Python 里按本地时间生成戳（`_stamp()`）。
- 期间修掉两个字段名 bug：`/api/stats` 的 `by_subject` 元素键是 `subject` 不是 `name`；`/api/mastery` 的 `pending` 元素键是 `knowledge` 不是 `point`。

### 5.16.5 为什么这么做

- **零依赖**：profile 的 `node_modules/@deepseek-ai` 下只有 `cosmokit`/`schemastery`，pnpm 严格布局解析不到 `dsh-tools`。所以工具定义手写裸对象（`parameters` 用裸 JSON Schema），不 import 任何 `@deepseek-ai/*`——StudyMate 的 `lib/tools/define.ts` 是同一口径。
- **工具行写在预设里，不写全局**：全局挂会让工具出现在所有会话里，模型在写代码时也可能去调 `mb_add`。写进预设 = 只有选了这条预设的会话才有这 6 个工具。
- **服务没起就自动拉起**：`ensureServer()` 先探 `/api/health`，不通就 detached spawn `python app.py` 再轮询 12 秒。用户不必先开终端；拉起失败也不抛，让真正的请求去报错。
- **不做 iframe 嵌页面**：iframe 只能「看」，不能把错题喂给模型。阶段二要的是面板里嵌宿主自己的会话（StudyMate 的 `conversation.content` + `SessionProvider`），那是另一件事。

### 5.16.6 已知限制

- 改完 patch 必须重启 DSH；没有热重载（`dsh-app-boot` 里没有任何 watcher）。
- **裸行加不进新条目**：profile 的 `cordis.patch.yml` 是「补丁」不是「条目表」。`- id: xxx` 这种裸行只用来**覆盖已存在**的同 id 行；基础树里没有这个 id 时，`@deepseek-ai/cordis-plugin-include` 的 `applyEntryPatches` 会 warn 一句 `patch: entry "xxx" not found` 然后**静默丢弃**，不报错、不中断启动。新增必须写成 `- insert:` + 缩进 4 格的条目列表。本机踩过一次：两条预设裸行追加后重启，选择器里空空如也；同文件里 `dsh-context`、`dsh-font-adjust` 两行也是这么死的（基础 bundle 里已没有这两个 id）。
- **怎么自查**：不必重启也能验。用 `@deepseek-ai/dsh-app-boot` 的 `loadProfileDirectory("dsh", <profile目录>, "<安装目录>/package.json", {userLayer:true})` 拿到 `layers` 与 `patches`，再 `composeEntries([layers.flatMap(l=>l.patches), patches], warn)`，warn 里出现 `entry "xxx" not found` 就是死行。
- **折行 plain 标量会让 StudyMate 整个跳过原生加载**：某些 YAML 序列化器会把长描述按 ~80 列折成两行（`descriptionEn: ... native` + 缩进续行 `multimodal model`）。这在 YAML 里合法、宿主解析没问题，但 `@yunmiao/studymate` 启动时用自带严格解析器读**整份** `cordis.patch.yml`，遇到多行 plain 标量就抛 `缩进比同级多了 2 个空格：同级键必须对齐（多行 plain 标量也不支持）`，然后 `已跳过原生加载` —— 结果是「学习模式」「答疑模式」两条预设**一起消失**，看起来像被删了。修法：把续行拼回上一行（语义等价），`node tools/fix-cordis-patch-fold.mjs` 幂等处理（块标量 `>-` / `|` 的内容不动）。定位方法：`node` 里 import 插件的 `bin/dsh-plugin.mjs`，用假 ctx（`get` 返回 `{name:'desktop',home}`、`agentPresets.register` 收集）跑 `apply()`，`console.warn` 里就有真实报错。
- 只有选中「错题复习」或「错题答疑」预设的会话才有这 6 个工具。
- 阶段一没有界面：复习仍然在对话里进行，没有侧栏面板。
- `mb_add` 不接受图片（Data URL 太长，不适合走工具参数），要加图还是用网页。

## 5.17 DSH 面板：把复习界面塞进侧栏（v0.21 阶段二）

阶段一给了模型工具面，但「看错题、点开一道、评分」还是得开浏览器。阶段二补的是 5.16 那张表里的第 ② 层：**一条 DSH 客户端插件**，在侧栏加一个「错题」入口，面板里左边列出错题、右边看题与评分，需要时把宿主的会话正文嵌进右栏让 AI 带着复习。

### 5.17.1 为什么拆成「根行 + 预设行」

客户端插件的发现机制很窄，读 `dsh-client-modules/lib/index.js` 得到三条硬约束：

| 约束 | 源码位置 | 后果 |
|---|---|---|
| 只扫**根 loader 行** | `resolveSource(entry)` 遍历 `this.ctx.loader.entries()` | 预设里动态 mount 的行（`dsh-mistake-book/tools`）永远发现不到客户端半 |
| 行名必须是**裸包名** | `locatePkgJson` → `exactPackageSpecifier` 对含 `/` 的子路径返回 `undefined` | 根行写成 `dsh-mistake-book/tools` 会被**静默跳过**，不报错 |
| 必须有 `exports["./client"]` 且 `dsh.client.platform === "web"` | `parseDshClient` / `clientExportOf` | 缺一个就整条不加载 |

所以本包的形态是：**同一个 npm 包，挂两次**。

| 行 | 行名 | 导出 | 干什么 |
|---|---|---|---|
| 根行 `mistake-book-panel` | `dsh-mistake-book`（裸名） | `exports["."]` → `lib/plugin.js` | 只挂「建复习会话」路由；客户端半也随这一行被发现 |
| 预设行 `mistake-book-tools` | `dsh-mistake-book/tools` | `exports["./tools"]` → `lib/tools.js` | 6 个 `mb_*` 工具，按预设作用域挂 |

**为什么工具不写在根行**：根行是全局的，工具挂上去就会出现在所有会话里（写代码时模型也可能去调 `mb_add`）。工具面必须跟着预设走——这是阶段一定下的规矩，阶段二不改它。

### 5.17.2 面板做了什么

> v0.23 起这个面板已补齐网页版除组卷打印外的全部视图（六个页签），5.17.2 描述的「左列 + 右栏」是阶段二的形态，最新结构见 **5.19** 节。

`lib/client.js`（阶段二时约 420 行，无构建步骤，纯 `window.__ModuleLoader__.load()` 登记）：

- **两个座位**：`main`（keyed 面板，`key: 'mistake-book'`）与 `sidebar.panellist`（`id: 'mistake-book'`、`order: 41`、`label: '错题'`）。点侧栏那行由宿主调 `ctx.layout.selectPanel('mistake-book')`。
- **左栏列表**：`GET /api/mistakes?due=1&page_size=50`（「全部」分段去掉 `due`），题面两行截断，元信息显示学科 / 知识点 / 下次复习日。
- **右栏详情**：题目 → 我的答案 → 「看答案与解析」折叠 → 错因 → 知识点 → 四档评分（忘了 / 模糊 / 记得 / 简单）→「让 AI 带我复习这道」。
- **评分**：`POST /api/mistakes/<id>/review`，回执里带 `next_review_at`，就地显示「已记录 · 下次 10-24」并刷新列表（这道通常就离开了到期集合）。
- **样式**：全部用 `--mb-*` 变量并带兜底值，跟随宿主的明暗主题；`<style>` 在工厂物化时注入一次（`id="dsh-mistake-book-css"` 去重）。

**为什么组件不用 `React.createElement('div.cls')`**：`createElement` 会把 `'div.cls'` 整个当标签名，造出一个没有 class 的未知元素——CSS 一条都不生效，DOM 里却看着还在。所以文件顶部有个 20 行的 `h(sel, props, ...kids)` 自己拆 `tag.class`。

### 5.17.3 数据为什么也要过宿主（CORS）

面板跑在 DSH 的网页里（`http://127.0.0.1:<随机端口>`），错题本服务在 `http://127.0.0.1:8000` —— **两个 origin**。而 `app.py` 不发任何 CORS 头（它只服务同源的网页版），于是浏览器直连 8000 会被同源策略拦掉：GET 读不到响应体，带 `content-type: application/json` 的 POST 连预检都过不去。

**给 `app.py` 加 CORS 也能通，但没这么干**：那样任何本机网页都能读走整个错题本、还能提交评分。为了一块面板把本地库敞开，不值得。所以数据也由宿主转发：

```
面板 ──fetch('/api/mistake-book/data?path=%2Fapi%2Fstats')──▶ DSH 宿主（同源）
                                                              │ 取插件行 config.url
                                                              ▼
                                                        app.py :8000
```

- 路由：`GET|POST /api/mistake-book/data`，真实路径放 `?path=`（`encodeURIComponent` 过）。
- **只放行本服务的 `/api/*` 相对路径**（`isAllowedPath`）：绝对地址、`//`、`..`、裸 `/api/` 一律 400。不做这个检查，`?path=` 就是个 SSRF 口子。
- 上游报错包成 `502 + {code:'upstream-failed', message}`，面板把这句话原样显示。
- 客户端只多一层 `data(path, init)`（`api(DATA_ENDPOINT + '?path=' + encodeURIComponent(path), init)`），四处调用点换成它；`SESSION_ENDPOINT` 那条仍是相对路径直呼宿主，不过代理。

### 5.17.4 建会话为什么必须走宿主

浏览器的 `sessions.create` 只序列化 `{ workspaceId, cwd, sessionId }`，会把 `agentPreset` **静默丢掉**。面板自己建的会话不带「错题复习」预设，工具面与 persona 全都不在——看起来能用，实际是个裸会话。

所以 `lib/session.js` 在宿主侧开了一条路由 `POST /api/mistake-book/session`，一次请求做五件事：

1. `GET /api/mistakes/<id>` 读这道题（服务没起时 `api.js` 会自己拉起）；
2. `agentPresets.resolve('mistake-review')` —— 顺带检查 `broken`：预设行在但 plugins 没激活成功时**当场拒绝**，而不是建一条没有工具的会话；
3. `agents.create({ sessionId, meta: { cwd, agentPreset }, agentOptions, setup })` —— `meta.agentPreset` 是落盘字段；`agentOptions` 必须自己带（取 `agentDefaultModel.currentSelection()`，缺了第一次请求就抛 `has no provider/model`）；`setup` 里先 `mount` 预设再让别的 scoped 注册；
4. `sessionTitle.rename()` 改标题为 `错题复习 · #12 · 极限`（服务没挂就如实降级 `renamed:false`）；
5. `agent.inject()` 注入首条消息：题目 / 我的答案 / 正确答案 / 解析 / 错因 / 知识点 / 已复习次数，让模型不用先调工具就知道在复习哪道。

两个容易踩的点：

- **不 dispose `AgentHandle`**：`dispose()` 会拆掉刚建好的会话，agent 归宿主 ctx 的生命周期。
- **`acquireScope` 给的是 `Symbol.asyncDispose` 租约，不是 `release()`**。漏还不会报错，但这条预设 revision 会一直有 user 挂着、永远 collect 不掉。第一版就写错成 `scope.release()`，被 `catch` 吞了，靠读 `dsh-agent-preset-registry` 源码才发现。

客户端拿到 `sessionId` 后只做一件事：`sessions.retain(sessionId, { source: 'mistakeBook' })`，用框架给的 `SessionProvider` 罩住，渲染 `renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false })`。多轮、流式、滚动、草稿、Enter 发送全归宿主。

**`source` 绝不能写 `'mainView'`**：宿主的 ui-session / ui-layout 拿它判「谁是当前会话」，写错会把面板里的会话顶成主视图。

### 5.17.5 文件与装配

`@
dsh-plugin/
├── package.json          # exports: "." → plugin.js、"./tools"、"./api"、"./client"；dsh.client
├── lib/plugin.js         # 根行宿主半：registerSessionRoute() + registerDataRoute()
├── lib/session.js        # 建复习会话（五步）
├── lib/proxy.js          # 数据代理：/api/* 转发给本机服务（跨源绕不开 CORS）
├── lib/client.js         # 客户端面板（两个座位 + 嵌会话）
├── lib/tools.js          # 6 个 mb_* 工具（阶段一）
├── lib/api.js            # 零依赖 HTTP 客户端 + 服务自动拉起
├── skills/review/SKILL.md
├── skills/qa/SKILL.md
└── cordis.patch.yml      # 三条 insert 的参考副本（根行 + 两条预设）
`@

装配在阶段一的两步之后多一步：把 `cordis.patch.yml` 里**第一个** `- insert:` 块（根行 `mistake-book-panel`）也追加进 profile 的 `cordis.patch.yml`。三块都要**连外层 `- insert:` 一起**粘，裸行加不进新条目（见 5.16.6）。

改完**重启 DSH**（补丁在启动时读，没有热重载）。

### 5.17.6 验证

| 层 | 怎么验 | 结果 |
|---|---|---|
| 宿主半（建会话 + 数据代理） | `node --test tests/test_plugin.mjs`（假 `agentPresets` / `agents`，不建真会话；代理用假 `globalThis.fetch` 顶掉上游） | **20 / 20** |
| 客户端半（装载与注册） | `node --test tests/test_client.mjs`（`vm` 里造最小 `__ModuleLoader__` 与 `document`，把文件跑一遍再调 `apply`） | **4 / 4** |
| 服务端 | `python -m unittest discover -s tests` | **132 / 132** |
| 代理端到端 | 真起 `app.py`，用 `lib/proxy.js` 的路由打真服务（stats / 建题 / 列表 / 详情 / 评分 / 上游 404） | **7 / 7** |
| 补丁 | `yaml` 解析 profile 的 `cordis.patch.yml`，取 `insert` 平铺后按 id 找行 | 0 error、15 个顶层块、根行与两条预设 config 完整 |

客户端测试专门钉住三件只有真启动才会暴露的错：模块 `id` 等于包名、`apply` 注册的两个座位名与 `children` 表（框架靠「children 里有非 root 座位」才发 `SessionProvider`）、样式只在工厂里注入而不在文件顶层。

### 5.17.7 已知限制

- **面板只在根行加载成功时出现**：行名写成子路径、`exports["./client"]` 缺失、`dsh.client.platform` 不是 `web`，三者任一都会**静默不发现**——不报错、不提示，只是侧栏没有「错题」。
- **建会话依赖宿主服务**：`agentPresets` / `agents` / `agentDefaultModel` 任一缺席，路由返回结构化错误（`preset-unavailable` / `session-create-failed` / `model-unavailable`），面板把这句话原样显示在按钮下面。
- **面板不写题**：录入仍在网页 / CLI / 工具里做。面板只做「挑一道 → 看 → 评分 → 要 AI 带」。
- **代理只放行 `/api/*`**：将来面板要下载导出文件（`/api/export.csv` 这种要落盘的），得另开一条路由，不能顺手塞进 `?path=`。
- **上游状态码会被抹平**：代理一律回 200（成功）或 502（失败），原始 404 / 409 只出现在 message 里。面板只按「成功/失败 + 人话」处理，够用。
- **一次只嵌一条会话**：换一道题再点「让 AI 带我复习」会新建一条；旧的仍在会话列表里，标题以 `错题复习` 开头，可据此辨认。


## 5.18 阶段三：面板补全 + 统计 + AI 闭环（v0.22）

阶段二的面板只能看、只能评分。阶段三补三块：**A 面板补全**、**C 统计增强**、**B AI 闭环**（按这个顺序做：A/C 是纯客户端改动，B 要动表结构与工具面）。

### 5.18.1 A：面板能录、能搜、能翻历史

| 能力 | 位置（[dsh-plugin/lib/client.js](dsh-plugin/lib/client.js)） | 说明 |
| --- | --- | --- |
| 面板内新建 | `NewForm` | `POST /api/mistakes`；题干是唯一必填，其余留空即不写；保存后切回「全部」并选中新条目 |
| 搜索 | `MistakeBookApp` 的 `toolbar` | 输入 250ms 防抖 → `?q=`；后端走 `LIKE`，命中题干 / 知识点 / 标签 |
| 按学科筛选 | 同上 | `?subject=`，候选来自 `GET /api/meta` |
| 到期 / 全部 | 同上 `mb-seg` | `?due=1` 与不传 |
| 复习历史 | `HistoryBlock` | 点「查看」才拉 `/api/mistakes/<id>/reviews`，省一次请求 |
| 分析视图 | `AnalyticsView` | 见 5.18.2 |

### 5.18.2 C：统计画在面板里

`GET /api/analytics?days=7|30|90` 一次拿全，前端只做布局：

| 区块 | 数据 | 画法 |
| --- | --- | --- |
| 录入与复习 | `trend` / `trend_totals` | 逐日双柱（新增 / 复习），柱高按窗口内峰值归一 |
| 保持度预测 | `retention.counts` | 四档横条（稳固 / 尚可 / 在遗忘 / 已遗忘），`R = 0.9 ** (距上次复习天数 / 稳定性)` |
| 最该补的知识点 | `weak_points` | 按正确率升序，未测的显示「未测」 |
| 错因 / 学科 / 断点 | `by_type` / `by_subject` / `by_step` | chip 计数 |
| 固定失手模式 | `step_patterns` | 「知识点 → 哪一步」错 ≥2 次才列出 |

**为什么不引图表库**：面板跑在宿主页面里，多一个依赖就要打进客户端 bundle；纯 `div` 柱状图零依赖，趋势一眼能认就够。

### 5.18.3 B：结构化断点 + 事件流

**断点（`step`）**：评分时可选记「错在哪一步」，枚举 `审题 / 建模 / 计算 / 检验 / 表达 / 记忆`（[app.py](app.py) 的 `REVIEW_STEPS`）。

- **为什么是枚举不是自由文本**：只有固定词表才能聚合出「这个人在计算上反复失手」；自由文本每次写法不同，统计等于零。
- **落库**：`review_logs.step TEXT NOT NULL DEFAULT ''`，走 `MIGRATIONS` 自动补列；空串 = 不记录，老库无痛升级。
- **校验**：`_parse_step` 不在词表就 `VALIDATION_ERROR` 400，且**在变式入库之前**校验——坏请求不留垃圾。
- **聚合**：`analytics()` 出 `by_step`（哪一步错得最多）与 `step_patterns`（`知识点 × 步` 组合 ≥2 次，`LIMIT 10`）。
- **工具面**：`mb_weak_steps(days, limit)` 直接把这分布说给模型听。

**事件流（`events.ndjson`）**：建题 / 评分 / 斩题 / 恢复各写一行。

- **位置**：跟 `--db` 走——`PRAGMA database_list` 取主库目录，写同目录 `events.ndjson`。
- **为什么旁路不进表**：事件是「给模型和脚本看的流水」，不需要事务与索引；写失败 `except OSError: pass`，绝不拖垮建题 / 评分主流程。
- **读**：`GET /api/events?limit&kind&id`（取尾部 limit 条，坏行跳过）；`mb.py stream --ndjson` 直接吐行给管道。
- **工具面**：`mb_events(limit, kind, id)`。

### 5.18.4 验证

| 层 | 内容 | 结果 |
| --- | --- | --- |
| Python | `python -m unittest discover -s tests`（新增 9 个断点 / 事件用例） | **141 / 141** |
| 宿主半 | `node --test tests/test_plugin.mjs tests/test_client.mjs` | **24 / 24** |
| 客户端渲染 | `tests/test_client_render.mjs`（自带 60 行假 React，钉住 useState 顺序） | **5 / 5** |
| 工具 | `tests/test_tools.mjs`（`stubFetch` 顶掉 `fetch`） | **8 / 8** |
| 网页端 | 真起服务：建题 → `POST review {step:'计算'}` → `GET reviews` 回 `step='计算'`；坏 step 回 400 `VALIDATION_ERROR` | 通过 |

### 5.18.5 已知限制

- 断点只有 6 档，粒度高不成「第几步 / 哪个公式」；要更细得换自由文本 + 人工归纳，统计能力会掉。
- `events.ndjson` 只追加不轮转，长期跑会变大（个人量级可忽略，万级再说）。
- 事件流没进面板，目前只有工具与 CLI 能读。


## 5.19 面板补齐网页版功能（v0.23）

阶段二（5.17）的面板只有「左列错题 + 右栏详情 + 四档评分」；网页版（`static/index.html`）有的筛选、批量、学习画像、计划、分析、再战区、回收站、导入导出，面板里一样都没有。v0.23 把这些**除组卷打印外**全部搬进来，面板成为网页版的功能等价物。

### 5.19.1 功能对照

| 网页版 | 面板实现 | 位置 |
| --- | --- | --- |
| 六个视图（列表 / 学习 / 计划 / 分析 / 再战 / 回收站） | 顶部 `TABS` 六页签，切换只改 `tab` 状态，各视图组件常驻挂载一次 | `client.js` `TABS` / `MistakeBookApp` |
| 搜索 + 筛选抽屉 + 条件 chips | `ListTab` 的 `filters` 状态：学科 / 状态 / 错因 / 时间范围 / 知识点 / 标签 / 到期 / 只搜题干 / 含已斩；每个生效条件渲染一枚可单独清除的 chip | `ListTab` |
| 分页 | `page` / `page_size` 走 `GET /api/mistakes`，底部「共 N 道 · 第 x/y 页」 | `ListTab` |
| 行内卡片（勾选 / 复习 / 编辑 / 斩题） | 卡片内 `.mb-rowacts`：复习（打开详情并遮答案）、编辑（直接进编辑态）、斩题/恢复 | `ListTab` |
| 批量条（批量修改 / 批量删除） | 勾选后浮出批量条，两个按钮分别开 `BulkDialog` 或调 `batch-delete` | `BulkDialog` |
| 更多菜单（批量导入 / 导出 CSV / 备份 JSON） | `moreOpen` 下拉：`ImportDialog`、`rawUrl('/api/export.csv')`、`rawUrl('/api/export.json')` | `ListTab` / `rawUrl` |
| 详情弹窗全字段编辑 | `DetailPane` 的 `editing` 态复用 `ItemForm`：学科 / 题目 / 我的答案 / 正确答案 / 解析 / 错因 / 来源 / 知识点 / 标签 / 难度 / 状态 / 图片 | `DetailPane` / `ItemForm` |
| 多图 + Ctrl+V 粘贴 | `ItemForm` 内 `images` 数组，`paste` 监听取剪贴板里的 `image/*`，≤2MB 转 Data URL | `ItemForm` |
| 变式题（加 / 删 / 练过） | `VariantsBlock`：`GET/POST /api/mistakes/<id>/variants`、`DELETE /api/variants/<id>`、`POST /api/variants/<id>/use` | `VariantsBlock` |
| 复习历史 | `HistoryBlock`：`GET /api/mistakes/<id>/reviews`，含四档结果、间隔、断点 | `HistoryBlock` |
| 四档评分 + 标记掌握 + 斩题 + 删除 | `DetailPane` 底部按钮组；评分带可选 `step`（六档断点） | `DetailPane` |
| 复习间隔预览 | `GET /api/mistakes/<id>/preview` 显示 again/hard/good/easy 各自的下次间隔 | `DetailPane` |
| 学习页（画像 + 知识树 + 别名 + 变式缺口） | `StudyView`：`/api/mastery`、`/api/knowledge/tree`、`/api/knowledge/aliases`、`/api/variants/gaps` | `StudyView` |
| 计划页 | `PlanView`：`/api/plan?days&limit&subject`，按天分组 + 今日数 / 上限 / 溢出 / 逾期 | `PlanView` |
| 分析页 | `AnalyticsView`：趋势、保持度分桶、最该补的知识点、错因/学科分布、断点分布与固定失手模式 | `AnalyticsView` |
| 再战区 | `ArenaView`：`/api/arena?show=zone|cleared`，进出区规则与计数 | `ArenaView` |
| 回收站 | `TrashView`：`/api/trash`、`restore`、单条彻底删除、清空 | `TrashView` |
| 到期提醒横幅 | `MistakeBookApp` 启动拉 `/api/reminders`，`should_notify` 时显示横幅，dismiss 记在 `localStorage['mb.panel.remind.dismissed']` | `MistakeBookApp` |
| 组卷打印 | **未搬**（按需求排除） | — |

### 5.19.2 代理层必须一起改

面板的请求都经宿主的 `/api/mistake-book/data` 转发（原因见 5.17.3）。原代理只放行 `GET`/`POST`，于是编辑（`PUT`）、删除（`DELETE`）、恢复（`POST`）里前两个直接 405。

- `proxy.js`：`methods` 扩到 `['GET','POST','PUT','DELETE','PATCH']`；非 GET/HEAD 时把请求体原样带给上游；`init.method` 透传。
- `?raw=1`：导出 CSV/JSON 回的是文件流而不是 `{ok,data}` 信封。新增 `api.js` 的 `callRaw()` —— 不解析 JSON、不拆信封，原样取 `{status, contentType, disposition, body}`，代理再把 `content-type` / `content-disposition` 回给浏览器，下载才会带文件名。
- `isAllowedPath` 没放宽：仍要求 `/api/` 开头、不含 `//`、`..`、`\`。

**为什么不在 `app.py` 里加 CORS 头**：那等于给「任意网页都能读写你的错题本」开口子；代理是白名单（只放本服务 `/api/*`），且复用宿主已有的鉴权与连接管理。

### 5.19.3 客户端结构

`lib/client.js` 从 766 行 / 43KB 长到 1515 行 / 85KB，仍是零构建、纯 `window.__ModuleLoader__.load()` 登记。组件按「一个视图一个函数」拆，共享的只有 `h()`、`api()`/`data()`、`rawUrl()` 和几个常量表：

| 组件 | 职责 | useState 数 |
| --- | --- | --- |
| `MistakeBookApp` | 页签、统计、元数据、当前详情、提醒横幅 | 10 |
| `ListTab` | 筛选、分页、勾选、批量、更多菜单 | 11 |
| `DetailPane` | 详情、折叠答案、编辑态、评分、斩题、删除 | 9 |
| `ItemForm` | 新建/编辑共用表单，多图与粘贴 | 4 |
| `VariantsBlock` / `HistoryBlock` | 变式题、复习历史 | 6 / 3 |
| `StudyView` | 画像、知识树、别名、变式缺口 | 9 |
| `PlanView` / `AnalyticsView` / `ArenaView` / `TrashView` | 四个只读视图 | 5 / 3 / 5 / 3 |
| `BulkDialog` / `ImportDialog` | 批量修改、批量导入 | 3 / 3 |

**为什么把 `__test__` 挂在工厂返回值上**：宿主只读 `inject` 与 `apply`，多一个键无副作用；但渲染测试需要拿到组件本身才能逐个渲染（整棵 App 一次渲染的写法，每加一个 `useState` 就要挪 seed 下标，改一次界面全红）。

### 5.19.4 验证

| 层 | 内容 | 结果 |
| --- | --- | --- |
| 宿主半 | `node --test tests/test_plugin.mjs tests/test_tools.mjs tests/test_client.mjs tests/test_client_render.mjs` | **49 / 49** |
| 路由契约 | 真起服务，按面板实际调用的 45 条路径逐条打（含 PUT 改题、DELETE 斩题、`/api/trash/<id>/restore`、`/api/variants/<id>/use`、`/api/mistakes/bulk-update`、`/api/export.csv`） | **45 / 45 通过** |
| 字段契约 | 抓 `/api/stats`、`/api/plan`、`/api/analytics`、`/api/mastery`、`/api/arena`、`/api/trash`、`/api/knowledge/tree` 等 16 个响应的键，逐一对上面板读取的字段（如 `mastery.pending`、`tree.leaf_total`、`report.step_patterns`） | 全部对齐 |
| Python | `python -m unittest discover -s tests` | **141 / 141** |

**没验到的**：真实 DSH 网页里的点击（宿主 GUI 需要 `dsh web` 打印的带 token 的地址，自动化进不去）。面板的渲染用假 React 逐组件覆盖，数据用真实服务验契约，剩下的只有「宿主把面板挂到座位上」这一步——那部分代码（`inject` / `apply`）本次没动。

### 5.19.5 已知限制

- 面板没有打印/组卷，需要出卷仍回网页版。
- 图片在面板里存成 Data URL 提交，单张 ≤2MB；网页版同限制。
- 六个页签是**条件渲染**（切走就卸载），每次切回都会重新拉一次数据；没有缓存，数据量大时来回切页签会有等待感。
- 列表默认「全部」（v0.23 起对齐网页版；阶段二默认是「到期」，会让人以为题没录进来）。
- 面板没有键盘快捷键，也没有网页版的「更多」里的试卷管理。


## 5.20 交互细节：统一下拉、每日上限、计划跳转（v0.24）

v0.23 把网页版搬进面板之后，用起来最硌手的是三件事：下拉框是浏览器原生的（在 DSH 侧栏里配色和字号都不跟、选项一多就溢出屏幕）、计划页的每日上限只有 10/20/50 三档、计划里的题点了没反应。这一版把这三处收掉。

### 5.20.1 18 处原生下拉 → 同一个 `Dropdown`

面板里原来有 18 个 `<select>`：新建/编辑表单 3 个（错因、难度、状态）、详情页断点 1 个、列表筛选抽屉 5 个（学科、状态、错因、时间、知识点）、批量修改 4 个（状态、错因、难度、标签方式）、学习页 1 个（学科）、再战区 1 个（学科）、计划页 2 个（窗口天数、学科）。

全部换成 `function Dropdown(props)`（`dsh-plugin/lib/client.js`），props 与原生 select 一一对应：

```js
h(Dropdown, {
  value, options: [{ value, label, disabled }],
  onChange, placeholder, disabled, title, className,
})
```

- **关闭态只渲染当前项**，弹层打开才挂 `role="listbox"`；选项 `role="option"` + `aria-selected`，选中项右侧打 `✓`。
- **键盘可达**：↑↓ 移动、Enter / Space 选中、Esc 关闭、点外部（document `mousedown` capture）关闭。
- 支持 `disabled` 选项（比如批量修改里当前筛选为空时的占位项）。

**为什么自己写而不是引组件库**：面板是纯 `h()` 渲染、零构建、零依赖，引一个 UI 库要连带打包器和样式体系；而「一个带键盘操作的下拉」总共不到 80 行，自己写反而更好控样式（要跟 DSH 侧栏的深浅色变量对齐）。

### 5.20.2 每日上限变成可存数字

原来是 `/api/plan?limit=10` 写死三档。现在：

- 后端 `settings` 新增键 `daily_limit`（`app.py` 的 `DEFAULT_SETTINGS` / `SETTING_BOUNDS` / `SETTING_LABELS`），范围 **1–200**，默认 **20**。
- `plan(conn, days=7, limit=None, subject="")`：`limit is None` 时读 settings；显式传值仍然优先（网页版「临时看一眼」、CLI `--limit` 都不受影响）。
- 面板计划页：数字输入框（`min=1 max=200`），失焦或回车提交，非法输入提示「请输入 1–200 的整数」并回滚；保存成功后刷新 `/api/meta`，切页签回来不会拿到旧上限。
- 网页版计划页同样换成数字输入框（`#pl-limit`），改完 PUT `/api/settings` 再重载计划；加载时用返回的 `daily_limit` 对齐输入框（没填/填错时能看到后端实际生效值）。
- CLI：`python mb.py settings --daily-limit 30`。

**为什么存后端而不是存 localStorage**：网页版与 DSH 面板是两个前端，localStorage 各存各的；存进 settings 后两边、CLI 看到的是同一个上限。

### 5.20.3 计划里的题可以点进去

计划页每行原来是纯 `div`。现在：

- 面板：`h('button.mb-hrow.pickable', { onClick: () => onOpen(item.id) })` → 切到「错题」页签、按 id 打开详情、详情顶部出现「← 返回计划」；点它回到计划页。
- 题目已被删除：详情页显示「这道题已被删除或不存在（id=N）」，而不是空白（`DetailPane` 里按 `/不存在/` 判 `error` 文案）。
- 题目不在当前筛选结果里：详情照常按 id 加载（详情是独立请求，不受列表筛选影响）。
- 网页版：计划卡片本来就是 `.card[data-id]`，点整行 `openEdit(id)` 进复习，行为不变。

**为什么用按钮而不是给 div 加 onClick**：`<button>` 自带键盘焦点与 Enter/Space 激活，不用自己补 `tabindex` 与 `role`。

### 5.20.4 验证

| 层 | 命令 | 结果 |
|---|---|---|
| 面板渲染 | `node --test tests/test_plugin.mjs tests/test_tools.mjs tests/test_client.mjs tests/test_client_render.mjs` | **52 / 52** |
| 后端 | `python -m unittest discover -s tests` | **142 / 142** |
| 网页冒烟 | 起临时服务：`/` 含 `id="pl-limit" min="1" max="200"`、旧 `<select id="pl-limit">` 已消失；PUT `{"daily_limit":3}` → `/api/plan` 不传 limit 返回 `daily_limit=3`；`/api/meta` 的 settings 同步 | 全部通过 |

新增的 Python 用例 `test_settings_daily_limit_used_by_plan`：3 道到期题 + 上限调到 1 → `today_count=1`、其余顺延到明天（`total=3`、`overflow=0`）；显式 `limit=3` 仍覆盖 settings；`0/201/"x"` 三种非法值都 400 且不改动已存值；CLI `--daily-limit` 生效。

### 5.20.5 没做的

- 网页版的下拉仍是原生 `<select>`（面板才换了 `Dropdown`）；两边视觉不统一，但网页版本来就是浏览器默认控件风格。
- 每日上限只在计划页能改，没有进「设置」面板（设置面板目前是再战区的折叠区）。

### 5.20.6 v0.24.1 修复：深色主题下弹层看不清字

**现象**：面板是深色主题时，下拉展开后选项几乎看不见。

**原因**：面板所有样式都用 `color:inherit` 跟随宿主主题，`--mb-*` 变量宿主并没有定义。弹层 `.mb-dd-pop` 写了 `background:#fff`（不透明白底），但没写 `color`，于是继承了宿主的浅色字 → 白底浅字，对比度约 1.1:1。原生 `<select>` 由浏览器自己画，所以换自定义组件之前没暴露这个问题。

**修法**：

- `.mb-dd-pop` 显式给 `background:#fff; color:#1c1c19`；新增 `.mb-dd-pop.dark{background:#24262a; color:#e9e9ec}`。
- 组件展开时读一次触发按钮的 computed color，`isLightColor()` 按相对亮度判断（>0.55 视为深色主题），决定加不加 `.dark`。拿不到颜色就按浅色兜底。
- 顺带把 `.mb-dd-empty` 也显式 `color:inherit`，避免占位文案同样看不清。

**回归测试**（`tests/test_client_render.mjs`，2 条）：`isLightColor` 对 `rgb(221,221,221)`/`rgba(255,255,255,.92)` 判真、对 `rgb(28,28,25)`/空串判假；再从 `client.js` 里正则取出 `.mb-dd-pop` 与 `.mb-dd-pop.dark` 的背景/前景色，按 WCAG 公式算对比度，要求都 ≥ 4.5:1（防止以后有人把 `color` 改回 `inherit`）。

## 6. 关键设计决策

- **零第三方依赖** —— 骨架阶段最大的成本是让人跑起来；`python app.py` 即可，无需虚拟环境与安装步骤。
- **SQLite 而非 JSON 文件** —— 事务、索引、SQL 过滤都是白送的；并发写安全，单文件便于备份。
- **`LIKE` 而非 FTS5** —— FTS5 默认分词器对中文按整段切分，检索基本失效；个人量级（万条内）`LIKE` 足够，数据量大再换 jieba + FTS5。
- **图片先存 Data URL 进库，v0.15 改为落盘** —— 早期选 Data URL 是为了省掉文件管理与路径失效（备份、恢复、导出一个文件全带走）。代价是行变大、备份和导出被图片拖累，题量上来后不可接受，所以 v0.15 改成内容寻址落盘 + 库里存文件名：去重、增量备份、列表不扫大字段都拿到了，代价是备份/恢复要连 `images/` 目录一起处理（`backup_db()` 已封装）。
- **FSRS-6 而非固定阶梯 / SM-2** —— 阶梯不认识个体差异（答得轻松与答得勉强走同一格）；SM-2 是 1987 年的启发式，没有难度维度也没有遗忘曲线。FSRS 是当前公开基准最好的开源调度器，Anki 已默认采用，且公式与参数完全公开、可本地跑、无外部依赖。
- **`stage` 与 `review_count` 分离** —— 前者是"连续答对"（展示用），后者是"累计次数"；答错时只重置 stage，历史次数不丢。FSRS 上线后调度完全由 S/D 决定，stage 退化成给人看的连胜计数。
- **错因双轨：`mistake_type` + `error_reason`** —— 结构化枚举可统计、可筛选，自由文本保留细节；只用一个会丢信息。
- **复习历史独立成表** —— 当前状态与历史轨迹分离，统计正确率/进步曲线不用动主表。
- **重复提交防护（3 秒）** —— 表单双击、网络重试是真实存在的；窗口足够窄，不会挡住正常的连续录入。
- **单用户 + 只绑 `127.0.0.1`** —— 本地工具的默认安全边界，不引入鉴权复杂度。
- **API 与前端分离** —— 将来换桌面壳、加同步或换数据库，只动服务端。
- **FSRS 参数不训练** —— 21 个参数需要上万条复习记录才拟合得动；个人错题本用官方默认值，等数据够了再离线训练并热加载。
- **`mastered` 不算一次评分** —— "已掌握"是用户的主动决定，不是记忆表现；把它当评分会污染 S/D 与正确率统计。
- **AI 用 CLI 而不是插件** —— agent 只要能读 JSON、跑命令就够了；写插件要维护 client bundle，收益不抵成本。
- **变式题与错题分表** —— 变式是"练习材料"，错题是"我的错误"；混在一起会让统计虚高、排期重复。分表后母题仍是唯一的复习对象。
- **掌握门禁是三条硬条件，不是一个按钮** —— 用户点"已掌握"是主观判断，门禁是客观证据；两者并存，门禁只作为提示，不强制阻止用户标记。
- **画像结论带 `review_log` id** —— 没有证据的"你函数很弱"没法验证也没法反驳；附上证据，学生可以自己判断这个结论对不对。
- **CLI 默认只读** —— 给 agent 的接口按最小权限设计：默认能写但不删，加 `--read-only` 连写都禁。删除权只留在人工操作的网页端。
- **录入走「规则解析粘贴」而不是 OCR** —— GitHub 上的错题本项目（`cuoti-auto`、`mistake-recorder`、`latex-qapp` 等）几乎都靠 PaddleOCR / mineru / 视觉大模型，那是外部服务或重模型，与本项目「零依赖、一条命令跑通」的定位直接冲突。规则解析粘贴是零依赖里唯一能把"抄题"成本降下来的方案；真需要拍照，让 DSH 里的 agent 读图转成文本再粘贴，等于把 OCR 放到模型侧而不是本地依赖里。
- **批量导入逐条报告错误，不整批回滚** —— 粘贴 30 道题，其中 1 道错因分类写错，整批失败会让人重来一遍。逐条 try/except + 返回 `{index, error}`，用户只改那一条。
- **学习页只读，不改数据** —— 它回答的是「我哪里弱、弱到什么程度、差多少才算过线」，不是操作台。要复习还是回错题页点开那道题；这样学习页不会变成第二个状态入口，也就不用担心两边状态不同步。
- **变式题挂在错题弹窗里，不做独立页面** —— 变式的意义是「这道题的另一个问法」，脱离母题单独浏览没有上下文；挂在弹窗里还能顺带看到母题的知识点和错因。
- **「斩题」用挂起而不是删除（v0.7）** —— 参考 `reiqr/shiroha-quiz` 的「斩题」：题已经会了但不想丢记录，删了就没了错因与历史。`suspended=1` 只是移出复习池，列表默认不显示、`due` 与计划不再排它、掌握度与门禁也不算它，随时可恢复。真正的删除仍只在人工操作里。
- **计划是「按天分桶 + 每日上限」，不是一条长列表（v0.7）** —— 参考 `Trey5-7e/KyStudy`「从多本习题册里挑今天该复习的题」与 `MiaoJiyu/ink-error-book` 的「每日题量上限」：一次给 200 道待复习只会让人关掉页面；按天分桶 + 上限把「今天做什么」变成一个能做完的量，塞不下的显式报 `overflow` 而不是悄悄丢。
- **保持度只做展示，不参与调度（v0.7）** —— `R = 0.9^(elapsed/S)` 是个粗糙预测，用来回答「哪些题最快会忘」；真排期仍交给 FSRS 的 S/D，避免两套模型互相打架。
- **检索范围开关默认关（v0.7）** —— 参考 `FengtingTang/mistake-notebook`「关键词不搜答案区」：默认搜全字段（更容易找回），需要精确找题干时勾一下，不改变原有行为。
- **再战区不落库，进出全由 `review_logs` 现算（v0.9）** —— 如果用 `in_arena` 标志位，出区后又错一次就得靠定时任务或手动刷新去改标志，一旦漏改就出现"标志说已出区、日志说又错了"的矛盾。现算的代价只是每次查询多几个子查询，个人量级完全可接受。
- **进区门槛默认「错 2 次」而不是「错 1 次」（v0.9，v0.12 起可配）** —— 错一次是正常遗忘，把所有错过一次的题都塞进再战区，页面会立刻变成第二个错题列表，失去"重点关照"的意义。
- **出区要「上次答错之后连对 2 次」（v0.9）** —— 借鉴 `WasteRoadJ/PracticeMaster` 的「连续答对指定次数才移出错题」：只对 1 次可能是蒙对的，2 次才勉强算稳定。注意是"上次答错之后"重新计数，不是历史总对次数，否则老题永远出不了区。
- **再战区与斩题是同一套挂起状态，不新增状态机（v0.9）** —— 斩题（`suspended=1`）立刻移出再战区且不计入在区数，恢复后若仍满足入区条件就自动回来。复用 `set_suspended()` 意味着两个功能不会各说各话，也不用加表字段。
- **知识点树用路径字符串现算，不建邻接表（v0.10）** —— 用户写「函数/单调性」时层级已经存在于数据里，再建 `knowledge_points(id, parent_id)` 只是把同一份信息抄一遍，还要处理节点改名、移动、孤立节点。现算的代价是每次查询多一次 split，个人量级可忽略；收益是「改题目的知识点」等于「改树」，不会出现树与题不一致。
- **别名只做单向合并、最多 5 跳（v0.10）** —— A→B、B→C 最终都落到 C，够表达「不同写法」；限制跳数是为了让环检测有界，撞环直接报错而不是死循环。别名不等于规范名（自我指向）也拒绝，避免无意义的记录。
- **提醒只在「未斩 + 未掌握 + 有下次日期」的题上算（v0.10）** —— 提醒的唯一目的是「该复习了」；把已掌握或被斩的题算进去，横幅会长期挂着一个点不掉的数字，用户很快学会无视它。
- **提醒按日静默（localStorage 记日期）（v0.10）** —— 一天点掉一次就够；用服务端状态记「已读」会引入一张表和一个写接口，而「今天不想再看见」本来就是浏览器端的一次性偏好。
- **变式在复习时先入库、再判分（v0.10）** —— 顺序很重要：变式不合法（题干为空）时整次复习请求失败，不留「复习记了、变式丢了」的半条记录。去重按去掉全部空白后的题干比对，避免同一个问法被重复灌进来。
- **变式缺口按「变式少 → 错得多 → 遗忘多」排序（v0.10）** —— 缺口列表的用途是决定下一道该给谁出题；变式数为 0 的题最缺，其次是把人反复绊倒的题，再次是遗忘次数高的题。三者都不看，排序就退化成随机。
- **备份用 `conn.backup()` 而不是拷文件（v0.11）** —— WAL 模式下 `.db` 旁边还有 `-wal` / `-shm`，直接拷主文件可能拿到没合并 WAL 的半截数据。SQLite 的在线备份 API 逐页复制并等写锁，得到的是一致快照，且不阻塞读写。
- **自动备份挂在启动路径上、每天最多一份（v0.11）** —— 常驻定时器要求进程一直活着，与「用完就关」的本地工具形态冲突；挂在启动路径上，打开就备，代价是「不开就不备」。20 小时间隔是为了防止一天内反复重启刷出几十份快照。
- **备份保留 14 份、按文件名轮转（v0.11）** —— 文件名带时间戳，按名字倒序即时间倒序，不需要读文件元数据；14 份约等于两周，够回滚到「误删之前」，又不会把盘塞满。
- **手机端不引入框架，只加媒体查询（v0.11）** —— 前端本来就没有构建步骤，为一个响应式布局引入 Tailwind 或组件库，会把「改一行刷新即见」变成「装依赖 + 跑构建」。媒体查询足够处理导航横滑、弹窗全屏、输入框 16px 防 iOS 缩放这几件事。
- **解析独立成字段，而不是继续塞进 `answer`（v0.12）** —— 一个字段兼两职时，任何「只看答案」的场景都会连带泄露解法：自测点开详情等于开卷，打印「只题目」模式藏不住解析，将来做变式判分把解析当标准答案喂给模型还会干扰。拆开后 `answer` 只放答案，`analysis` 放过程，两者可以分别搜索、分别展示、分别开关。迁移用 `ALTER TABLE ADD COLUMN` + 默认空串，老数据原样保留。
- **删除用「快照进 trash + 物理删」而不是软删除（v0.13）** —— 软删除要给列表、统计、计划、再战区、画像、导出、组卷的每一条查询都补 `deleted_at IS NULL`，漏一处已删的题就会悄悄回到统计里。快照法把回收站隔离成独立表，主表语义和既有查询一行都不用改；恢复时若原 id 被新题占用，就分配新 id 并重映射复习日志。
- **回收站上限 200 条（v0.13）** —— 回收站是防手滑的缓冲，不是归档。200 条足够覆盖「删错了、过一会儿想找回来」，再往上只会让表无限长；超出的按删除时间从旧到新清。
- **图片内容寻址落盘而不是自增文件名（v0.15）** —— 哈希名天然去重（同一张图传两次只占一份），备份时"按文件名比对、缺的才拷"就能幂等增量同步；自增名做不到这两点，还要额外维护映射表。代价是改名即换内容，所以图片一旦落盘就当不可变对象，不提供原地替换。
- **导出保留内存版与流式版两份实现（v0.15）** —— 流式省内存但慢 1.4 倍（每行一次 `json.dumps`）。`mb.py export` 与测试要的是"马上拿到 dict"，用内存版更快；HTTP 大响应要的是"别把 73MB 攒在内存里"，用流式。两条路径共用 `_export_row()`，并用测试断言输出等价，防止漂移。
- **整库恢复走 `restore` 子命令，且先留安全快照（v0.13）** —— 手动 `Copy-Item` 覆盖库有两个坑：WAL 未合并、覆盖后回不了头。`restore_from_backup()` 用 SQLite backup API 写回并清 `-wal`/`-shm`，覆盖前自动备份当前库，恢复错了还能再回来；同时校验源文件，避免把非错题本库写进去。
- **阈值存表而不写死常量（v0.12）** —— 「错几次进再战区」「连对几次出区」是纯偏好，写死 2/2 只是拍脑袋的默认。存表后网页上改完立即生效（`arena()` 每次读 `get_settings`），CLI 也能改；缺省值仍来自 `DEFAULT_SETTINGS`，表里没记录时与旧行为一致，不会因为升级而改变已有用户看到的结果。

- **复习时先遮答案，而不是把答案摆在旁边靠自觉（v0.18）** —— 自觉不可靠：看得见就会看。默认折叠 + 一次显式点击，把「看答案」变成需要主动决定的行为，成本只有一次点击，却能挡住大部分「扫一眼就算复习过」。

### 从开源项目 wrong-notebook 借鉴的设计

参考 [wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook)（Next.js + Prisma）后，取以下 6 点并**按零依赖前提重写**：

| 借鉴点 | 它的做法 | 我们的落地 |
|---|---|---|
| 复习历史表 | `ReviewSchedule(errorItemId, scheduledFor, completedAt, isCorrect)` | `review_logs`（[app.py](app.py)） |
| 结构化错因 | `mistakeStatus` 枚举（不会做/做错了/未判断） | `mistake_type` 枚举（[app.py](app.py)） |
| 题目来源 | `ErrorItem.source` | `source` + `SOURCE_HINTS`（[app.py](app.py)） |
| 时间范围筛选 | `timeRange=week\|month\|all` | `range=week\|month`（[app.py](app.py)） |
| 批量删除 | `/api/error-items/batch-delete` | `/api/mistakes/batch-delete`（[app.py](app.py)） |
| 全量 JSON 备份 | `/api/export?all=true` | `/api/export.json`（[app.py](app.py)） |

**没借鉴的**：Next.js/Prisma/NextAuth 技术栈（违背零依赖）、多用户与班级权限（违背单机定位）、OCR/AI 归类（需外部服务）。知识点树当时没做，v0.10 用「路径分层 + 别名表」补上了，但仍是零依赖写法，没有引入它的 `KnowledgeTag` 邻接表。

### 从 AI tutor 项目借鉴的教学设计（v0.4）

参考 [Bhala-Srinivash/agent-tutor-skill](https://github.com/Bhala-Srinivash/agent-tutor-skill)（认知科学驱动的 AI 家教 skill）与 [mordor-forge/study-skill](https://github.com/mordor-forge/study-skill)（FSRS-6 驱动的学习 skill），取以下 5 点，全部落在 [SKILL.md](SKILL.md) 与画像统计里：

| 借鉴点 | 它解决什么问题 | 我们的落地 |
|---|---|---|
| 四个认知陷阱 | AI 让学习"感觉"变简单，实际没形成记忆 | [SKILL.md](SKILL.md) 开篇的动机表：流畅错觉 / 零提取练习 / 无合意困难 / 遗忘架构 |
| 教学五步 | 讲解代替了练习 | EXPLAIN → EXAMPLE → CHECK → EVALUATE → PRACTICE，CHECK 必须看到输出 |
| 零提示出题规则 | 选项本身泄露答案，题目失去诊断力 | 6 条硬约束：选项不暗示正确性、不打推荐标、答案位置随机、干扰项须是真实概念 |
| 能量分级 | 状态差时被推着学，产生挫败与逃避 | 开场问「满电/半电/快没电」，快没电只做 1-2 道轻量复习 |
| 熟练度徽章 | 只有"会/不会"两态，看不到进步 | `band` 按平均稳定性分四档（见下） |

熟练度分档（`profile` / `mastery` 返回的 `band` 与 `band_counts`，[app.py](app.py)、[app.py](app.py)）：

| 徽章 | 档位 | 平均稳定性 S |
|---|---|---|
| 🟥 | 薄弱 | < 3 天 |
| 🟨 | 一般 | 3–13 天 |
| 🟩 | 良好 | 14–89 天 |
| 🟦 | 已牢固 | ≥ 90 天 |

分档只影响**展示与教学策略**（薄弱的多举例、已牢固的直接上难题），不影响 FSRS 排期——排期只看 S 与 D，不看徽章。

**没借鉴的**：它的课程生成 / PDF 导入流水线（我们不做内容生产）、多轮会话状态机（DSH 的会话本身就是状态）、Web 界面（我们已有）。

### 从 v0.7 调研的项目借鉴（2026-10-22）

第二轮在 GitHub 上按 star 扫了「错题本 / 错题 复习 / 错题 整理 / 错题本 打印」四组关键词（约 1300 个仓库），只取零依赖、与「打印暂缓」不冲突的部分：

| 借鉴点 | 来源项目 | 我们的落地 |
|---|---|---|
| 今日复习计划、每日题量上限 | [Trey5-7e/KyStudy](https://github.com/Trey5-7e/KyStudy)、[MiaoJiyu/ink-error-book](https://github.com/MiaoJiyu/ink-error-book) | `plan()` + `GET /api/plan` + 「计划」页 |
| 斩题（已会但不删） | [reiqr/shiroha-quiz](https://github.com/reiqr/shiroha-quiz) | `suspended` 字段 + `set_suspended()` |
| 遗忘风险可视化 | [MiaoJiyu/ink-error-book](https://github.com/MiaoJiyu/ink-error-book)、[Jasmine-Coder-Dev/error-notebook](https://github.com/Jasmine-Coder-Dev/error-notebook) | `analytics()` 的保持度四档 + 「最快会忘的题」 |
| 关键词不搜答案区 | [FengtingTang/mistake-notebook](https://github.com/FengtingTang/mistake-notebook) | `scope=question` + 「只搜题干」勾选框 |

**看过但没做的**：拍照 OCR / 视觉大模型识题（`tjunsh/ai-wrong-notebook`、`ausyeah/mistake-recorder`、`Nemoyuzx/cuoti-auto` 等，全部依赖外部服务或重模型，与零依赖冲突）；PDF 切题与组卷打印（`Jasmine-Coder-Dev/error-notebook`、`MiaoJiyu/ink-error-book`，打印功能用户已要求暂缓）；AI 记忆演化（[Bairong-Xdynamics/MistakeNotebookLearning](https://github.com/Bairong-Xdynamics/MistakeNotebookLearning)，ACL 2026 的 training-free 方案，需要 LLM，属外部依赖）；多格式导出 DOCX/PDF（同上，需要第三方库）。

### 组卷打印的设计取舍（v0.8）

| 决策 | 选择 | 理由 |
|---|---|---|
| 生成方式 | 服务端渲染 HTML + 浏览器 Ctrl+P | 生成真 PDF 必须引第三方库（reportlab/weasyprint），与「零依赖、一条命令跑通」冲突；浏览器打印还能让用户先预览、选纸张、调边距 |
| 抽题来源 | 复用列表页 `build_filters()` | 用户已经在列表页筛好了（学科/知识点/标签/错因/时间/待复习），组卷时不该再配一套筛选；前端直接把当前筛选参数带过去 |
| 排序 | `weak` 默认，按复习正确率升序，未做过的按 0.5，再看稳定性 | 「错题卷」的价值是把最可能再错的题排前面；没做过的题风险未知，放在中间而不是最前或最后 |
| 答案版式 | 三种模式而非开关 | 「先做后对」需要答案物理分页（`break-before: page`），和「边看边对」是不同的卷子，做成三个模式比一堆复选框清楚 |
| 题量上限 | 100 题 | 一张 A4 放不下更多；也防止误点把整个题库塞进打印队列 |

## 7. 已知限制

- 无鉴权：只应绑定 `127.0.0.1`，不要直接暴露公网。
- 图片自 v0.15 起落盘（`data/images/`），但**图片目录不在单文件备份里**：只拷 `mistakes.db` 会丢图，请用 `mb.py backup` 或整个 `data/` 目录一起拷。
- 检索为子串匹配，不做分词、不做相关性排序。
- 知识点树是按 `knowledge` 字符串里的 `/` **现算**的，不是独立表：改一道题的知识点会立刻反映到树上，但也因此没有跨节点的关联（「函数」与「导数」之间不会自动连线）。
- 别名只做「同义合并」，不做自动发现：`函数单调性` 与 `函数/单调性` 不会自己合并，需要手动登记一次。
- 提醒只做「到点提示」，不做推送通道：网页横幅靠轮询（页面开着才有效），桌面通知需要用户手动授权，邮件需要自己配 SMTP。
- 重复提交防护按"题目全文完全相同"判定，改写过的同一道题不会被拦。
- 组卷只出单栏 A4，没有双栏/双面/分栏排版；答案页含正确答案、我的答案、错因，以及 v0.12 起的解析（`analysis=0` 可关）。
- `/print` 是服务端渲染的 HTML，依赖浏览器打印；不生成 PDF 文件，也没有服务端分页控制（分页靠 CSS `break-inside: avoid`）。
- 自动备份只在**启动时**检查一次：长期不打开 `python app.py` 就不会产生新快照（需要的话用系统计划任务跑 `mb.py backup`）。
- 备份是**本机快照**，和主库在同一块盘上：硬盘坏了两份一起没。真要防灾，用 `--dir` 指到另一块盘或网盘同步目录。
- 手机端只做了「能用」级别：导航横滑、弹窗全屏、输入框防缩放。没有离线缓存、没有 PWA、也没有针对小屏重新设计的信息层级（卡片在手机上仍偏长）。
- FSRS 用官方默认参数，未按个人数据训练；个体差异只能靠四档评分的准确度弥补。
- 四档评分是主观的：同样答对，学生自己点「困难」还是「记得」会显著改变后续间隔。
- `SKILL.md` 需要手动复制到 `~/.dsh/skills/` 才会被 DSH 自动发现。
- 掌握门禁依赖 FSRS 的稳定性估计，新题（复习记录少）几乎不可能过线——这是设计意图，但会让早期用户觉得"永远不达标"。
- 变式题不会「凭空生成」：离线环境没有出题模型。变式由 agent 或用户出好，在复习回写时一并提交（`--variant-question`）就自动入库；「变式缺口」接口只负责排优先级，不负责生成。
- 画像只按 `knowledge` 聚合，知识点写法不一致时会被拆成两个点。
- 学习页只做展示与跳转，不能在页面上直接调门禁阈值（阈值是 [app.py](app.py) 里的常量 `MASTERY_*`）。
- 变式题管理藏在错题编辑弹窗里，没有独立的「变式题库」总览页。
- 计划页的「每天上限」是按道数算，不看每题耗时；难题与简单题混在一起时实际用时可能超预期。
- 分析页的保持度是 `0.9^(elapsed/S)` 的经验公式，不是真实测量，只适合看相对高低。
- 分析页的趋势按 `created_at`/`reviewed_at` 的日期前缀聚合，跨时区或手改系统时间会让某天数据偏移。
- 「斩题」是软隐藏：CSV/JSON 导出仍包含被斩的题（`suspended` 字段会带出来）。
- 再战区的「错 N 次」只统计 `rating=1`（又错）的记录；点「勉强」（`hard`）不算错，因此不会把题推进再战区。
- 再战区阈值默认 2/2，网页「再战」页和 `mb.py settings` 都能改（存 `settings` 表）；`ARENA_MIN_WRONG` / `ARENA_CLEAR_STREAK` 现在只作为默认值。
- 再战区不跨学科混合排序，也不按知识点聚合；它只回答「哪些题反复错」，不回答「哪个知识点最弱」（后者看学习页）。
- 回收站只保留最近 **200 条**（`TRASH_KEEP`），超出的按删除时间从旧到新清掉；恢复是**整条覆盖**，不会与当前库里的同 id 记录合并。
- 回收站与「斩题」是两回事：斩题只是移出复习池（数据还在列表里，可用 `suspended=1` 查），回收站是删除后的暂存区。
- 回收站里的条目不会参与检索、统计、计划与再战区——它们是「已删但还没清」的数据，只有回收站页能看到。
- 界面风格（v0.16）是照着桌面端 Electron 应用调的，**没有视觉回归测试**：自动化只验证「计算样式是否等于设计令牌」与页面无横向溢出，像素级效果仍需人眼确认。
- 视觉层与结构是解耦的：样式全在 `static/index.html` 的 `<style>` 块里，HTML 结构与脚本未动；以后要换主题，改这一块即可。
- 卡片状态轨按 `next_review_at` 的**自然日**比较：改系统时间或跨时区会让「逾期 N 天」跳变。
- 卡片缩略图依赖 `thumbs=1`：列表接口默认不返回 `image_url`（见 5.12），前端自己带这个参数。
- 公式只做 KaTeX 能渲染的子集：`\begin{align}` 之类的复杂环境需要 `amsmath` 扩展，当前未加载；写错宏不会报错，会原样显示成红字源码。
- 公式在**检索**里仍按源码匹配：搜「极限」搜不到渲染后的 `\lim`，要搜源码片段。
- 一题最多 6 张图；每张上限约 2MB；图片只支持 PNG/JPEG/WebP/GIF（拒 SVG，避免脚本注入）。
- 试卷只有「名字/学科/日期/备注」四个元数据，没有卷面总分、题号顺序、作答时长。
- 批量编辑一次最多 500 条，且不支持跨页勾选（换页会清空选择）。
- 批量编辑不刷新 `updated_at` 之外的任何复习状态：改学科/标签不会重置 FSRS 排期，改「状态」也不会。

## 8. 后续扩展路线

1. **组卷增强**：双栏排版、按知识点分组出卷、答案另附解析栏、导出真实 PDF（需引第三方库，与零依赖冲突，暂不做）。试卷维度（v0.20）已能按卷抽题，还差的是一张卷内的题号顺序与总分。参考 `Jasmine-Coder-Dev/error-notebook`（组卷+薄弱优先）、`FengtingTang/mistake-notebook`（三种 PDF 版式）、`MiaoJiyu/ink-error-book`（PDF/DOCX/Markdown 多格式）。
2. **复习提醒（v0.10 已做基础版）**：页面横幅 + 桌面通知 + `mb.py remind --email`。还没做的：微信/企业微信/Server 酱等推送通道、每日固定时间自动发（现在靠 cron 调 CLI）、提醒历史与「稍后提醒」。
3. **统计增强（v0.22 已做基础版）**：按学科/错因/时间的趋势图、保持度分桶、断点分布都已进网页「分析」页与 DSH 面板（纯 `div` 柱状图，零依赖）。还没做的：折线图 / 热力图、按周对比、单题记忆曲线。
4. **知识点树（v0.10 已做基础版）**：路径分层 + 别名合并 + 父节点汇总。还没做的：跨节点关联（知识图谱）、节点级备注/目标分、拖动调整层级（现在只能改题目的知识点字符串）。
5. **多端同步**：服务端换 PostgreSQL + 账号鉴权，前端仅改 API 基址。
6. **AI 错因归类**：录入时用模型从题干与我的答案推断 `mistake_type` 与 `knowledge`，仅作建议。
7. **FSRS 参数训练**：复习记录攒够（1000 条以上）后离线拟合 21 个参数，存到 `data/fsrs_params.json` 热加载。
8. **AI 闭环增强（v0.22 已做基础版）**：`review --step` 记结构化断点（六档枚举），`analytics` 出 `by_step` 与 `step_patterns`（知识点 × 步 ≥2 次才算模式），`mb_weak_steps` 把结论交给模型。还没做的：断点与 `mistake_type` 的交叉归因、按断点自动调整判分口径。
9. **变式题自动入库（v0.10 已做）**：复习回写时带 `--variant-question` 就入库并去重。还没做的：按 `times_used` 淘汰长期不用的、变式正确率单独统计、由模型批量出题（需外部依赖）。
10. **会话事件流（NDJSON，v0.22 已做基础版）**：建题 / 评分 / 斩题 / 恢复写 `events.ndjson`（跟 `--db` 同目录），`mb.py stream --ndjson` 一行一条，`GET /api/events` + `mb_events` 读。还没做的：把事件流回灌成会话上下文、按事件触发提醒。
11. **掌握门禁可配置**：把三条阈值挪到 `meta` 可读的配置里，让用户自己调松紧。
12. **备份增强（v0.11 已做基础版）**：启动时自动快照 + `mb.py backup` + 14 份轮转。还没做的：备份到网盘/S3、加密、`mb.py restore` 一键回滚（现在要手动复制文件并删 WAL）、备份完整性自检。
13. **手机端增强（v0.11 已做基础版）**：媒体查询适配。还没做的：PWA 离线可用、底部导航栏、拍照直接上传（现在要相册选图或截图粘贴）、列表虚拟滚动。
