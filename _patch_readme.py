import io, sys
p = "README.md"
s = io.open(p, encoding="utf-8").read()
orig = s

def rep(old, new, label):
    global s
    n = s.count(old)
    if n != 1:
        print("ANCHOR FAIL", label, n)
        sys.exit(1)
    s = s.replace(old, new)
    print("ok", label)

NL = chr(10)

rep("**当前状态**：v0.33，最小闭环已跑通并通过 **150 个端到端测试 + 70 个 node 测试**",
    "**当前状态**：v0.34，最小闭环已跑通并通过 **159 个端到端测试 + 73 个 node 测试**", "status")

para = ("**v0.34（知识点分层检索 + 合并清理）**：以前「知识点」是一个自由文本框，谁都能往里写 `111`、`2` 这种脏值；"
        "下拉里是一长串平铺的原字符串，点父节点 `函数` 一道题都搜不到（默认精确匹配）；树视图和别名机制早就写好了，却没人用得上。"
        "这一版把三条链路接上：**① 存的时候给台阶** —— 表单输入框挂上 `datalist`，历史路径带 `/` 层级直接补全，"
        "placeholder 写着「如 函数/单调性（用 / 分层）」；**② 找的时候分层** —— `/api/meta` 的 `knowledge` 从字符串数组升级成 "
        "`[{path,name,parent,depth,count}]` facet（保留 `knowledge_flat` 兼容老调用方），下拉按 `depth` 用全角空格缩进并带题数，"
        "点父节点默认连子树一起搜（`kdeep=1`），另加「（未归类 · N 道）」项走 `nokp=1`；**③ 乱的时候能收** —— "
        "学习页新增「合并 / 清理知识点」面板，勾几个脏值 + 填一个规范名，一次 `POST /api/knowledge/merge` 把题批量改写过去并顺手登记别名，"
        "子树层级会保留（`函数/二次函数` 并到 `初中数学` → `初中数学/二次函数`）。CLI 侧同步加了 `mb.py merge --to`、"
        "`list --kq`（前缀包含）/`--exact`（精确）/`--nokp`（只看未归类），`merge` 也纳入 `--read-only` 拦截名单。"
        + NL + NL)
rep("**v0.33（学习 / 计划 / 分析三页重做", para + "**v0.33（学习 / 计划 / 分析三页重做", "paragraph")

rows = ("| **知识点分层检索**（下拉带层级缩进与题数，选父节点默认含子树，另有「未归类」入口） | ✅ | "
        "[app.py](app.py) `knowledge_facets()` / `meta()`；[app.py](app.py) `build_filters()` 的 `kdeep` / `kq` / `nokp` 三档；"
        "[index.html](static/index.html) `loadStats()` 的 facet 渲染与 `query()`；[client.js](dsh-plugin/lib/client.js) `knowledgeFacets()` / `facetLabel()` |"
        + NL +
        "| **知识点合并 / 清理**（多选脏值并到规范名，保留子树层级并登记别名；CLI `mb.py merge`） | ✅ | "
        "[app.py](app.py) `merge_knowledge()`、`POST /api/knowledge/merge`；[mb.py](mb.py) `cmd_merge`；"
        "[index.html](static/index.html) 学习页 `#st-merge-box` / `mergeSources()` / `loadMergeList()` |" + NL)
rep("| **变式题自动积累**（复习回写时带变式一起入库，去重计数）",
    rows + "| **变式题自动积累**（复习回写时带变式一起入库，去重计数）", "table")

rep("- 别名只做「同义合并」，不做自动发现：`函数单调性` 与 `函数/单调性` 不会自己合并，需要手动登记一次。",
    "- 别名只做「同义合并」，不做自动发现：`函数单调性` 与 `函数/单调性` 不会自己合并，需要手动登记一次。v0.34 起可以在学习页一次性多选合并（会顺手登记别名），但相近写法仍然不会自动推荐 —— 没有做字符串相似度聚类，因为把 `函数` 和 `函数值` 自动判成同一个，比留着两份更难收拾。",
    "limits")

rep("还没做的：跨节点关联（知识图谱）、节点级备注/目标分、拖动调整层级（现在只能改题目的知识点字符串）。",
    "还没做的：跨节点关联（知识图谱）、节点级备注/目标分、拖动调整层级（现在只能改题目的知识点字符串）。v0.34 补了分层检索（父节点含子树、未归类入口）与批量合并清理，剩下的仍是这三项。",
    "roadmap")

io.open(p, "w", encoding="utf-8", newline=NL).write(s)
print("written", len(orig), "->", len(s))