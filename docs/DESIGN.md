# 错题本 · 数据模型与关键设计决策

> 本文件是[错题本 README](../README.md)的拆分文档。含 4 数据模型、6 关键设计决策。

## 4. 数据模型

### 4.1 `mistakes`（[app.py](../app.py)）

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

### 4.2 `review_logs`（复习历史，[app.py](../app.py)）

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

### 4.3 `variants`（变式题库，[app.py](../app.py)）

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
| 复习历史表 | `ReviewSchedule(errorItemId, scheduledFor, completedAt, isCorrect)` | `review_logs`（[app.py](../app.py)） |
| 结构化错因 | `mistakeStatus` 枚举（不会做/做错了/未判断） | `mistake_type` 枚举（[app.py](../app.py)） |
| 题目来源 | `ErrorItem.source` | `source` + `_field_facets()`（[app.py](../app.py)；候选只来自数据；v0.49 起写法示例单独放常量 `SOURCE_EXAMPLES`，只经 `meta().source_hints` 给 placeholder 用） |
| 时间范围筛选 | `timeRange=week\|month\|all` | `range=week\|month`（[app.py](../app.py)） |
| 批量删除 | `/api/error-items/batch-delete` | `/api/mistakes/batch-delete`（[app.py](../app.py)） |
| 全量 JSON 备份 | `/api/export?all=true` | `/api/export.json`（[app.py](../app.py)） |

**没借鉴的**：Next.js/Prisma/NextAuth 技术栈（违背零依赖）、多用户与班级权限（违背单机定位）、OCR/AI 归类（需外部服务）。知识点树当时没做，v0.10 用「路径分层 + 别名表」补上了，但仍是零依赖写法，没有引入它的 `KnowledgeTag` 邻接表。

### 从 AI tutor 项目借鉴的教学设计（v0.4）

参考 [Bhala-Srinivash/agent-tutor-skill](https://github.com/Bhala-Srinivash/agent-tutor-skill)（认知科学驱动的 AI 家教 skill）与 [mordor-forge/study-skill](https://github.com/mordor-forge/study-skill)（FSRS-6 驱动的学习 skill），取以下 5 点，全部落在 [SKILL.md](../SKILL.md) 与画像统计里：

| 借鉴点 | 它解决什么问题 | 我们的落地 |
|---|---|---|
| 四个认知陷阱 | AI 让学习"感觉"变简单，实际没形成记忆 | [SKILL.md](../SKILL.md) 开篇的动机表：流畅错觉 / 零提取练习 / 无合意困难 / 遗忘架构 |
| 教学五步 | 讲解代替了练习 | EXPLAIN → EXAMPLE → CHECK → EVALUATE → PRACTICE，CHECK 必须看到输出 |
| 零提示出题规则 | 选项本身泄露答案，题目失去诊断力 | 6 条硬约束：选项不暗示正确性、不打推荐标、答案位置随机、干扰项须是真实概念 |
| 能量分级 | 状态差时被推着学，产生挫败与逃避 | 开场问「满电/半电/快没电」，快没电只做 1-2 道轻量复习 |
| 熟练度徽章 | 只有"会/不会"两态，看不到进步 | `band` 按平均稳定性分四档（见下） |

熟练度分档（`profile` / `mastery` 返回的 `band` 与 `band_counts`，[app.py](../app.py)、[app.py](../app.py)）：

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

### 活词表：候选来自数据，不来自常量（v0.43）

**问题**：`SOURCE_HINTS` 这 8 个内置来源每次都被 `meta()` 并回候选，删不掉（v0.48 删掉了常量，但把示例硬编码进前端，属半成品；**v0.49 改为示例与候选分离**，见 5.46 节）；库里还有 `4` 这类脏值；四个自由文本字段（学科 / 知识点 / 标签 / 来源）在面板里全是裸 datalist，能写不能管。

**决定**：把「候选」与「示例」分开。

- 候选 = `_field_facets()` 的产物，只含 `count > 0` 的值，按「题量 → 最近用过 → 名字」三次稳定排序；
- 示例 = 0 题的内置值，只出现在 placeholder 与管理面板的「未使用」分组里（v0.48 曾把示例硬编码进前端；**v0.49 起示例回归后端常量 `SOURCE_EXAMPLES`，只经 `meta().source_hints` 拼 placeholder，不进 facets、不出现在管理面板**）；
- 治理 = `merge_meta(kind=source)` 与 `merge_knowledge()`，合并优先于删除，`target` 留空才是清空；
- 引导 = 录入时编辑距离 ≤1 的近似值给一句「已有『X』」，**只提示不自动改**（自动改会吃掉「期中考（区统考）」这类真·不同值）。

**理由**：参考 Stashmark（孤儿标签自动从建议消失 + Tags 仪表盘）与 CityU 图书馆的「受控词表 vs 自由文本」结论 —— 成熟做法是混合：自由输入 + 输入时引导 + 事后治理。反例是本机 `_wn_study/` 的 wrong-notebook：它的知识点有完整词表体系，但 `ErrorItem.source` 只是 `String?`、全项目 0 处引用 —— 说明「来源」这类低频字段确实容易被漏掉。

**代价**：`meta()` 多了一次 `GROUP BY` 查询（8 道题的库上无感，5 万题规模下与既有 facets 同量级）。

### 组卷打印的设计取舍（v0.8）

| 决策 | 选择 | 理由 |
|---|---|---|
| 生成方式 | 服务端渲染 HTML + 浏览器 Ctrl+P | 生成真 PDF 必须引第三方库（reportlab/weasyprint），与「零依赖、一条命令跑通」冲突；浏览器打印还能让用户先预览、选纸张、调边距 |
| 抽题来源 | 复用列表页 `build_filters()` | 用户已经在列表页筛好了（学科/知识点/标签/错因/时间/待复习），组卷时不该再配一套筛选；前端直接把当前筛选参数带过去 |
| 排序 | `weak` 默认，按复习正确率升序，未做过的按 0.5，再看稳定性 | 「错题卷」的价值是把最可能再错的题排前面；没做过的题风险未知，放在中间而不是最前或最后 |
| 答案版式 | 三种模式而非开关 | 「先做后对」需要答案物理分页（`break-before: page`），和「边看边对」是不同的卷子，做成三个模式比一堆复选框清楚 |
| 题量上限 | 100 题 | 一张 A4 放不下更多；也防止误点把整个题库塞进打印队列 |

