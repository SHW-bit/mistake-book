# 错题本 · Mistake Book

[![CI](https://github.com/SHW-bit/mistake-book/actions/workflows/ci.yml/badge.svg)](https://github.com/SHW-bit/mistake-book/actions/workflows/ci.yml)

零第三方依赖的本地错题本：Python 标准库 + SQLite + 原生 HTML/JS。
（装了 Pillow 会自动用它生成缩略图，没装照样跑 —— 见 5.29.3。）
一条命令启动，浏览器打开即用。

```bash
cd mistake-book
python app.py
# 打开 http://127.0.0.1:8000
```

**当前状态**：v0.42，最小闭环已跑通并通过 **172 个端到端测试 + 96 个 node 测试** —— 录入（单条 + 批量粘贴解析）→ 存储 → 检索 → FSRS 复习调度 → 复习历史 → 变式题库 → 学习画像 / 掌握门禁 → **知识点树** → 今日复习计划 → 斩题（挂起）→ 学习分析 → 组卷打印 → 再战区 → **到期提醒** → 统计 → 导出。v0.7 从 GitHub 同类项目里挑了三个零依赖的功能补上：按天排的复习计划、把已会但不舍得删的题移出复习池、录入/复习趋势与遗忘风险分析。v0.8 补上组卷打印：复用列表筛选条件抽题，服务端渲染 A4 试卷页，浏览器 Ctrl+P 存 PDF。v0.9 补上再战区：错两次的题自动进区、上次答错后连对两次自动出区，与「斩题 / 恢复」直接配对。v0.10 补上三件事：**到期提醒**（页面横幅 + 桌面通知 + CLI 发邮件）、**知识点树**（知识点用 / 分层自动成树，别名把不同写法合并）、**变式题自动积累**（复习回写时一并提交变式就入库，并按缺口排优先级）。v0.11 补上**自动备份**（启动时自动留快照、按份数轮转、`mb.py backup` 手动备）与**手机端适配**（导航横滑、输入框 16px 防 iOS 缩放、弹窗全屏、操作区吸底）。v0.12 补上两件事：**独立解析字段**（`analysis` 与 `answer` 分开存，自测/打印时不再等于开卷）与**再战区阈值可配**（进区、出区门槛在网页上直接改，存 `settings` 表）。v0.13 补上三件事：**回收站**（删除不再是物理消失，整条题目 + 复习历史快照进回收站，可原样恢复，只保留最近 200 条）、**`mb.py restore`**（从备份文件恢复整个库，覆盖前自动留一份安全快照）、**错因详细描述换成多行输入框**（长文本不再只能横着滚）。v0.14 做了一轮**性能优化**（只改查询与索引，不动 API 语义）：5 万题规模下首屏 972ms → 77ms、统计 931ms → 90ms、组卷 523ms → 59ms，详见 5.9 节。v0.14.1 修了 `one()` 只认 HTTP 列表参数的 bug：此前 CLI 传标量会被截成首字（`mb.py list --q 极限` 只搜「极」、`--limit 20` 只取 2 条），网页端不受影响。v0.15 把三件"会随题量变疼"的事处理了：**图片改为落盘**（内容寻址存 `data/images/`，库里只留文件名，老库启动时自动迁移）、**导出改流式**（`/api/export.json` 与 CSV 边生成边写，2 万题峰值内存 139MB → 1.1MB）、**前端有了单元测试**（纯函数抽到 `static/lib.js`，`node --test` 跑，由 Python 测试统一入口驱动）。v0.16 把界面按参考项目（今知错题本 Electron 版）的排版体系重做了一遍：13px 正文、6px 卡片圆角、发丝分隔线、克制的单一蓝色强调、30px 紧凑控件，**只改视觉层**，接口、数据结构与交互逻辑未动，详见 5.11 节。v0.17 重做了列表卡片：左侧 3px 状态轨按复习状态着色、题面升到 14px/500、知识点 chip 加重、到期改成相对时间、缩略图进列表、「斩题」改为悬停显示，详见 5.12 节。v0.18 补上「**复习先遮答案**」：打开已有错题时答案与解析默认折叠，逼学生先自己重做一遍，点「看答案与解析」才展开，详见 5.13 节。v0.19 起把界面按「纸面」方向整体重做（暖白画布、墨绿强调、14px 正文、32px 控件、左侧栏 + 手机底部 tabbar），分 5 批推进，**批 1（设计系统 + 壳层）、批 2（错题列表页）、批 3（弹窗）、批 4（学习 / 计划 / 分析 / 回收站 / 再战区）已完成**，详见 5.14 节。v0.20 补上四项：**公式输入（LaTeX，KaTeX 本地内置、无 CDN）**、**一道题多张图（≤6 张，内容寻址去重）**、**试卷维度**（题目归卷、按卷筛选、卷内题数统计）、**批量改状态 / 学科 / 错因 / 知识点 / 来源 / 试卷 / 难度 / 标签**，详见 5.15 节。v0.21 把错题本接进 DSH：两条预设（错题复习 / 错题答疑）+ 8 个专用工具（`mb_due` / `mb_search` / `mb_get` / `mb_add` / `mb_review` / `mb_stats` / `mb_weak_steps` / `mb_events`），模型直接调、不过 shell，详见 5.16 节。阶段二把复习界面塞进 DSH 侧栏：一个「错题」面板，左列错题、右侧看题与四档评分，点「让 AI 带我复习这道」由宿主按「错题复习」预设建会话并嵌进右栏，详见 5.17 节。v0.22 是阶段三：面板补全（面板里直接新建、搜索、按学科筛选、翻复习历史）、统计增强（录入/复习趋势柱、保持度分桶、最该补的知识点、错因与学科分布）、AI 闭环（评分时顺手记「错在哪一步」，`mb_weak_steps` 与 `mb_events` 把断点分布与事件流交给模型），详见 5.18 节。v0.23 把网页版的全部功能（组卷打印除外）搬进了 DSH 面板：六个页签（错题 / 学习 / 计划 / 分析 / 再战 / 回收站）、筛选抽屉与条件 chips、批量修改与批量删除、全字段编辑弹窗（含多图与 Ctrl+V 粘贴）、变式题、复习历史、导出 CSV/JSON、到期提醒横幅；代理层同时放开 PUT/DELETE/PATCH 并支持 `raw=1` 原样回传文件流，详见 5.19 节。v0.24 收了一轮交互细节：**18 处原生 `<select>` 换成同一套自定义下拉**（点击/键盘/点外部关闭，选中项打勾）、**计划页每日上限改成数字输入并存进 settings**（`daily_limit`，1–200，默认 20，`/api/plan` 不传就跟随它）、**计划里的题能直接点进错题详情**并带「← 返回计划」，详见 5.20 节。v0.24.1 修了自定义下拉在深色主题下「白底 + 继承来的浅色字」看不清的问题（弹层现在按宿主文字亮度选深/浅配色，并加了对比度回归测试），同时把弹层从 `absolute` 改成 `fixed` 按按钮位置定位，不再被滚动容器裁掉，详见 5.20.6、5.20.7。v0.24.2 修了三个用起来会「丢东西」的 bug：**斩题后没有任何提示、条目直接从列表消失**（现在会弹提示条，带「查看已斩题 / 撤销」）；**面板批量修改的标签方式选了「覆盖」必然 400**（后端只认 `set`/`add`/`remove`）；**批量导入用空行分隔的多道题会被静默合并成一条、且结果一出来窗口就关掉看不到**（现在空行也能分条，结果常驻显示成功 / 重复 / 失败与逐条原因），详见 5.21 节。v0.25 让 **DSH 面板也能渲染 LaTeX 公式**：后端开一个只放行 `static/vendor/katex/` 的 `/api/asset` 只读口，面板经宿主代理的 `raw=1` 通道取回 `katex.min.js`，用 **MathML 输出**（不经 CSS/字体，因此不用把 26 万字节 woff2 塞过文本通道），题面 / 答案 / 解析 / 变式 / 计划 / 再战 / 回收站共 10 处全部生效；顺带修正了 5.15.1 里「网页列表卡片也渲染公式」的文档漂移，详见 5.22 节。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [README.md](README.md) | 本页：需求假设、功能清单与代码映射、快速开始、已知限制、路线 |
| [docs/DESIGN.md](docs/DESIGN.md) | 4 数据模型（8 张表的字段与关系）、6 关键设计决策（为什么这么选） |
| [docs/API.md](docs/API.md) | 5 HTTP API 一览 |
| [docs/history/00-highlights.md](docs/history/00-highlights.md) | 版本速览（每个版本一句话） |
| [docs/history/v0.1-v0.20.md](docs/history/v0.1-v0.20.md) | 5.5–5.15：FSRS、提醒、备份、性能、图片落盘、界面与卡片演进 |
| [docs/history/v0.21-v0.30.md](docs/history/v0.21-v0.30.md) | 5.16–5.29：DSH 插件三阶段、面板视觉五轮、图片导入 |
| [docs/history/v0.31-v0.42.md](docs/history/v0.31-v0.42.md) | 5.30–5.39：三页重做、分层检索、排序器、变式链路、bundle、工具面、纯图片录入 |

> 正文里出现的「详见 5.x 节」等编号保持原样（未重排），按上表去对应文件里找。

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
| **知识点分层检索**（下拉带层级缩进与题数，选父节点默认含子树，另有「未归类」入口） | ✅ | [app.py](app.py) `knowledge_facets()` / `meta()`；[app.py](app.py) `build_filters()` 的 `kdeep` / `kq` / `nokp` 三档；[index.html](static/index.html) `loadStats()` 的 facet 渲染与 `query()`；[client.js](dsh-plugin/lib/client.js) `knowledgeFacets()` / `facetLabel()` |
| **知识点合并 / 清理**（多选脏值并到规范名，保留子树层级并登记别名；CLI `mb.py merge`） | ✅ | [app.py](app.py) `merge_knowledge()`、`POST /api/knowledge/merge`；[mb.py](mb.py) `cmd_merge`；[index.html](static/index.html) 学习页 `#st-merge-box` / `mergeSources()` / `loadMergeList()` |
| **列表排序器**（最新录入 / 最快到期 / 最不稳定 / 错得最多，白名单防注入） | ✅ | [app.py](app.py) `SORT_OPTIONS` / `DEFAULT_SORT`、`query_mistakes()` 的 `sort` 参数；[index.html](static/index.html) `#sort` 下拉与 `query()`；[mb.py](mb.py) `list --sort` |
| **学科 / 标签合并清理**（多选脏值并到规范名，标签精确匹配不串味） | ✅ | [app.py](app.py) `_field_facets()` / `merge_meta()`、`POST /api/meta/merge`；[mb.py](mb.py) `meta-merge`；[index.html](static/index.html) `#mg-kind` / `loadMergeList()` |
| **弹窗内上一题 / 下一题**（按当前列表顺序在本页翻） | ✅ | [index.html](static/index.html) `#btn-prev-item` / `#btn-next-item`、`orderPos()` / `syncNav()` / `stepItem()` |
| **变式题自动积累**（复习回写时带变式一起入库，去重计数） | ✅ | app.py 的 _extract_variant()、create_variant(dedup=True)；mb.py review --variant-question；[tools.js](dsh-plugin/lib/tools.js) `mb_review` 的 `variant_*` 三参数（v0.36） |
| **变式库存在列表里可见**（到期/搜索结果标「无变式」或「变式 N」） | ✅ | [tools.js](dsh-plugin/lib/tools.js) `brief()`；数据来自 [app.py](app.py) `LIST_COLUMNS` 的 `variant_count` |
| **变式缺口提示**（谁最该补变式：变式少优先，其次错得多） | ✅ | app.py 的 variant_gaps()、GET /api/variants/gaps；学习页「缺少变式题」列表 |
| **自动备份**（启动时距上次 ≥20 小时自动留快照，保留最近 14 份） | ✅ | [app.py](app.py) `backup_db()` / `auto_backup()`、`_prune_backups()`；`python app.py --no-backup` 可关 |
| **手动备份** | ✅ | [mb.py](mb.py) `mb.py backup [--dir] [--keep]` |
| **回收站**（删除进回收站，可恢复；只留最近 200 条） | ✅ | [app.py](app.py) `list_trash()` / `restore_trash()` / `purge_trash()`；`GET /api/trash`、`POST /api/trash/{id}/restore`、`DELETE /api/trash/{id}`、`POST /api/trash/purge`；网页「回收站」页 |
| **从备份恢复**（`mb.py restore --from`，覆盖前自动留安全快照） | ✅ | [app.py](app.py) `restore_from_backup()`；[mb.py](mb.py) `restore` |
| **手机端适配**（导航横滑、输入 16px 防缩放、弹窗全屏、操作区吸底） | ✅ | [index.html](static/index.html) 的 `@media(max-width:640px)` / `@media(max-width:380px)` |
| **DSH 插件**（两条预设 + 8 个 `mb_*` 工具，模型直接调） | ✅ | [dsh-plugin/](dsh-plugin) `lib/tools.js`（工具注册）、`lib/api.js`（HTTP + 服务自动拉起） |
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
│   ├── test_api.py     # 172 个端到端测试（含前端测试的 Python 入口）
│   ├── test_frontend.py# 调 node --test 跑前端用例；无 node 则 skip
│   └── frontend.test.cjs # 前端纯函数用例（node:test）
├── data/               # 运行时自动生成
│   ├── mistakes.db     #   主库
│   ├── images/         #   题目图片（内容寻址，v0.15）
│   └── backups/        #   自动备份快照（mistakes-*.db）+ images/ 镜像
├── dsh-plugin/         # DSH 插件（标准 bundle：面板 + 13 个工具 + 复习/答疑预设）
├── docs/               # 文档（从 README 拆出，见「文档索引」）
│   ├── DESIGN.md       #   4 数据模型 + 6 关键设计决策
│   ├── API.md          #   5 HTTP API 一览
│   └── history/        #   版本演进：00-highlights + v0.1~v0.42 三段
└── README.md           # 本页：假设、功能映射、快速开始、限制、路线
```

## 7. 已知限制

- 无鉴权：只应绑定 `127.0.0.1`，不要直接暴露公网。
- 图片自 v0.15 起落盘（`data/images/`），但**图片目录不在单文件备份里**：只拷 `mistakes.db` 会丢图，请用 `mb.py backup` 或整个 `data/` 目录一起拷。
- 检索为子串匹配，不做分词、不做相关性排序。
- 知识点树是按 `knowledge` 字符串里的 `/` **现算**的，不是独立表：改一道题的知识点会立刻反映到树上，但也因此没有跨节点的关联（「函数」与「导数」之间不会自动连线）。
- 别名只做「同义合并」，不做自动发现：`函数单调性` 与 `函数/单调性` 不会自己合并，需要手动登记一次。v0.34 起可以在学习页一次性多选合并（会顺手登记别名），但相近写法仍然不会自动推荐 —— 没有做字符串相似度聚类，因为把 `函数` 和 `函数值` 自动判成同一个，比留着两份更难收拾。
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
- 变式题不会「凭空生成」：离线环境没有出题模型。变式由 agent 或用户出好，在复习回写时一并提交（面板 `mb_review` 的 `variant_question`，或 CLI `--variant-question`）就自动入库；「变式缺口」接口只负责排优先级，不负责生成。
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
- 一题最多 6 张图；每张上限约 8MB；图片只支持 PNG/JPEG/WebP/GIF（拒 SVG，避免脚本注入）。
- 试卷只有「名字/学科/日期/备注」四个元数据，没有卷面总分、题号顺序、作答时长。
- 批量编辑一次最多 500 条，且不支持跨页勾选（换页会清空选择）。
- 批量编辑不刷新 `updated_at` 之外的任何复习状态：改学科/标签不会重置 FSRS 排期，改「状态」也不会。
- 排序只作用于当前页的查询（服务端 `ORDER BY`），但**弹窗「上一题 / 下一题」只在本页内翻**：翻到本页头/尾就置灰，不会自动跳页。跨页翻需要前端维护全量顺序或后端多吐一页，代价大于收益。
- 学科 / 标签合并是**整列改写**，没有撤销：合并前会写一条 `merged_subject` / `merged_tag` 事件，但事件流只记「从哪几个值并到哪」，不能一键回滚（知识点合并同理）。

## 8. 后续扩展路线

1. **组卷增强**：双栏排版、按知识点分组出卷、答案另附解析栏、导出真实 PDF（需引第三方库，与零依赖冲突，暂不做）。试卷维度（v0.20）已能按卷抽题，还差的是一张卷内的题号顺序与总分。参考 `Jasmine-Coder-Dev/error-notebook`（组卷+薄弱优先）、`FengtingTang/mistake-notebook`（三种 PDF 版式）、`MiaoJiyu/ink-error-book`（PDF/DOCX/Markdown 多格式）。
2. **复习提醒（v0.10 已做基础版）**：页面横幅 + 桌面通知 + `mb.py remind --email`。还没做的：微信/企业微信/Server 酱等推送通道、每日固定时间自动发（现在靠 cron 调 CLI）、提醒历史与「稍后提醒」。
3. **统计增强（v0.22 已做基础版）**：按学科/错因/时间的趋势图、保持度分桶、断点分布都已进网页「分析」页与 DSH 面板（纯 `div` 柱状图，零依赖）。还没做的：折线图 / 热力图、按周对比、单题记忆曲线。
4. **知识点树（v0.10 已做基础版）**：路径分层 + 别名合并 + 父节点汇总。还没做的：跨节点关联（知识图谱）、节点级备注/目标分、拖动调整层级（现在只能改题目的知识点字符串）。v0.34 补了分层检索（父节点含子树、未归类入口）与知识点批量合并，v0.35 把同一个面板扩到学科与标签（`POST /api/meta/merge`），剩下的仍是这三项。
5. **多端同步**：服务端换 PostgreSQL + 账号鉴权，前端仅改 API 基址。
6. **AI 错因归类**：录入时用模型从题干与我的答案推断 `mistake_type` 与 `knowledge`，仅作建议。
7. **FSRS 参数训练**：复习记录攒够（1000 条以上）后离线拟合 21 个参数，存到 `data/fsrs_params.json` 热加载。
8. **AI 闭环增强（v0.22 已做基础版）**：`review --step` 记结构化断点（六档枚举），`analytics` 出 `by_step` 与 `step_patterns`（知识点 × 步 ≥2 次才算模式），`mb_weak_steps` 把结论交给模型。还没做的：断点与 `mistake_type` 的交叉归因、按断点自动调整判分口径。
9. **变式题自动入库（v0.10 已做）**：复习回写时带 `--variant-question` 就入库并去重。v0.36 把这条链路接到了 DSH 面板（`mb_review` 的 `variant_*` 三参数 + 列表行显式标「无变式」）。还没做的：按 `times_used` 淘汰长期不用的、变式正确率单独统计、由模型批量出题（需外部依赖）。
10. **会话事件流（NDJSON，v0.22 已做基础版）**：建题 / 评分 / 斩题 / 恢复写 `events.ndjson`（跟 `--db` 同目录），`mb.py stream --ndjson` 一行一条，`GET /api/events` + `mb_events` 读。还没做的：把事件流回灌成会话上下文、按事件触发提醒。
11. **掌握门禁可配置**：把三条阈值挪到 `meta` 可读的配置里，让用户自己调松紧。
12. **备份增强（v0.11 已做基础版）**：启动时自动快照 + `mb.py backup` + 14 份轮转。还没做的：备份到网盘/S3、加密、`mb.py restore` 一键回滚（现在要手动复制文件并删 WAL）、备份完整性自检。
13. **手机端增强（v0.11 已做基础版）**：媒体查询适配。还没做的：PWA 离线可用、底部导航栏、拍照直接上传（现在要相册选图或截图粘贴）、列表虚拟滚动。


---

更多：见[文档索引](#文档索引)。