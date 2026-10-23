# 错题本 · HTTP API 一览

> 本文件是[错题本 README](../README.md)的拆分文档。含 5 API 一览。

## 5. API 一览

统一返回 `{"ok": true, "data": ...}`；错误返回 `{"ok": false, "error": {"code", "message"}}`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/meta` | 学科、知识点、标签、来源候选、错因分类。v0.43 起 `sources` 只含**库里真正用过的值**（按题量降序），另给 `source_facets`（`[{name, count, system}]`，含 0 题的内置值，供词表整理面板用）；`subject_facets` / `tag_facets` / `knowledge` 同为 facets 形态 |
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
| POST | `/api/meta/merge` | 合并 / 删除扁平值；body `{"kind": "subject"\|"tag"\|"source", "sources": ["旧名"], "target": "新名"}`，`target` 留空 = 清空该值；返回 `{kind, target, sources, moved, ids, cleared}`（`moved` 是题数，`cleared` 是布尔） |
| POST | `/api/knowledge/merge` | 合并 / 清空知识点；body `{"sources": [...], "target": "规范名"}`，`target` 留空 = 清空；合并时自动登记别名，返回额外带 `aliases_added` |
| GET | `/api/variants/gaps?limit=&subject=` | 最该补变式的题：变式数升序、错次数降序；每条带 `variant_count/wrong/right/hint` |
| GET | `/api/export.csv` | 按当前筛选导出 CSV（流式，边查边写） |
| GET | `/api/export.json` | 全量备份（复习历史、变式、别名、试卷、题目图片；version 5；图片只给 `image_url` 不给 base64；流式） |
| GET | `/api/images/{name}` | 题目图片回源（只认 `[0-9a-f]{32}.ext`，长缓存 + `nosniff`；v0.15） |

**复习规则**（[app.py](../app.py) `review_mistake()` + [fsrs.py](../fsrs.py)）：

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

