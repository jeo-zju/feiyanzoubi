# 我的日历 Tab 结构重组方案

## 1. Repo 调研结论

当前 `pages/calendar-mine/index` 的页面结构（从上到下）：

| 位置 | 模块 | 现状文件位置 | 数据来源 |
|---|---|---|---|
| 第一卡 | **日历Hero卡**：标题「XX的日历」+本月次数/打卡率chip + 近14天柱状图 + 3格（最常去岩馆/本月搭子/本月计划） | [index.wxml:L1-L35](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-mine/index.wxml#L1-L35) | `calendarApi.mine({includeSummary:true})` → `summary.chartPoints` |
| 中间 | **即将到来/历史记录 Tab** + 计划卡片列表 + 空状态 + 下拉分页（onReachBottom） | [index.wxml:L37-L75](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-mine/index.wxml#L37-L75)；[index.js:listTabs/decorateAndApplyList/onTabChange/onTapCheckin/Edit/Cancel](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-mine/index.js) | `calendarApi.mine` 的 `upcoming/past` 列表 |
| 第二卡 | **攀爬统计卡**：section-kicker「统计」+ section-title-lg「攀爬统计」+ section-desc + `line-chart-mini` 近30天折线 | [index.wxml:L77-L84](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-mine/index.wxml#L77-L84) | `stats.summary({days:30})` → `stats.chartPoints` |
| 第三卡 | **最近打卡列表**：list-row（岩馆名/日期/模式 + 积分delta）+ 分页器（上一页/页码/下一页） | [index.wxml:L86-L103](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-mine/index.wxml#L86-L103) | `stats.summary({days:30, page, pageSize})` → `recent/hasNext` |

---

## 2. 用户需求拆解

- ✅ **需求A**：「日历 + 统计」两个卡片合并
- ✅ **需求B**：「中间的计划」和「即将到来/历史记录 Tab」删除（用户说没用）
- ❓ 隐含决策：最近打卡列表放哪？（推荐：作为新卡片的底部或独立保留）

---

## 3. 合并方案讨论（三种，推荐 **方案A**）

### 方案 A（推荐 · 双图纵向堆叠在同一张 Hero 卡内，最近打卡独立）

**新页面结构（从上到下）**：

```
[ 合并后的 Hero 单卡 ]
  ├─ HD 区
  │   ├─ 左：标题「XX的攀爬」
  │   │   sub：「这个月你已安排了 N 次攀岩」
  │   └─ 右：打卡率 chip（金色）
  ├─ 3 格指标行（保留）
  │   ├─ 最常去岩馆
  │   ├─ 本月搭子
  │   └─ 本月计划
  ├─ 区块1 · 近14天计划频次
  │   └─ 原 Hero 的 mini-chart 柱状图
  ├─ 区块2 · 近30天攀爬强度
  │   └─ 原 攀爬统计 的 line-chart-mini 折线图 + 小文字描述
  └─ 区块3 · 最近打卡（可选，并入尾部或独立卡）
       └─ 现 list-row + 分页器
```

**为什么推荐**：
- 符合用户「视觉压缩 / 反对功能堆砌 / 单面」偏好：两图本就同属"个人统计"维度，合并后减少卡片外壳重复（重复的圆角/渐变/边框），信息密度更高。
- 14天柱状图 = 「**计划**频次」；30天折线图 = 「**实际**攀爬强度」：两个维度互补，不冲突。
- 最近打卡列表有分页（上一页/下一页），独立成卡保留更清爽，不强行塞进 Hero。

**删掉的内容**：
- WXML：`seg-shell`（即将到来/历史记录 seg-tabs）+ `plan-card` 列表循环 + `empty-wrap`。
- JS：`listTabs` / `listTab` / `onTabChange` / `decorateAndApplyList` / `onTapCheckin` / `onTapEdit` / `onTapCancel` / `onTapViewCheckin` / `upcoming` / `past` / `list` / `loadListPage` / `onReachBottom`（分页只在列表需要时用，删除后需把 onReachBottom 和 stats 的分页解绑，避免意外触发 loadListPage）。
- WXSS：`.seg-shell` `.plan-card*` `.empty-wrap*` `.btn-danger` `.btn-xs` 等列表相关样式。

---

### 方案 B（极简 · 只留一张 30 天折线图，弃用 14 天柱状）

只保留信息密度更高的 30 天折线图（有实际打卡值的折线比"计划"柱状图更有体感）；原 Hero 的 14 天柱状图整段删除，把 3 格指标移到折线图上方。

优点：更极致压缩；缺点：丢失「计划 vs 实际」对比信息。

---

### 方案 C（可切换单图，不推荐）

在合并后卡片顶部加一个 pill 切换「计划频次 / 攀爬强度」，同一块画布切图。

**用户曾明确反对多层级交互/抽屉**，这会增加一个"切 pill → 切 canvas 数据"的交互态，违背用户偏好，不推荐。

---

## 4. 按方案A执行时：文件改动清单

### 4.1 `pages/calendar-mine/index.wxml`

- **删除**：L37-L75 的中间 seg-shell + plan-card 循环 + empty-wrap 全部。
- **保留第一卡（Hero）** 外层结构（`.card-hero.hero-cal`），但做以下内部调整：
  - 现有 `mini-chart`（14天柱状）→ 改名为 `chart-block`，前面加一个小标题 kicker「近 14 天计划」。
  - 在 `hero-stats`（3格指标）之后，追加第二个 `chart-block`（攀爬统计），内容来自原第二卡：
    - kicker「近 30 天攀爬」+ `line-chart-mini`（原 stats.chartPoints）+ 小字 summaryText。
- **保留第三卡（最近打卡）**：独立一张卡，位置放在 Hero 之后。
- 最终结构：Hero 合并单卡 → 最近打卡列表卡。

### 4.2 `pages/calendar-mine/index.js`

**删除**：
- `data.listTabs`、`data.listTab`、`data.upcoming`、`data.past`、`data.list`、`data.page`、`data.hasMore`、`data.loading`。
- 函数：`loadListPage()`、`decorateAndApplyList()`、`_getPlanById()`、`onTabChange()`、`onTapCheckin()`、`onTapEdit()`、`onTapCancel()`、`onTapViewCheckin()`。
- 解绑：`onReachBottom()` 不再调用 `loadListPage`（stats 分页不在这里处理）。

**保留 & 合并**：
- `loadAll(silent)` 仍负责加载 Hero summary（本月计划/打卡率/3 格/14天柱状图），但不再需要装饰 upcoming/past 列表；同时在 `loadAll` 末尾或并行调用 `loadStats({reset:true})`（两个 API 一次 onShow 各调一次，保持职责清晰，避免把两个不同后端接口的数据塞进一个调用里）。
- `loadStats()` / `onStatsPrev()` / `onStatsNext()` 完整保留（最近打卡分页仍使用）。
- `onPullDownRefresh()` 中：仍然并行 `loadAll` + `loadStats`。

**注意**：原先 `loadAll` 内部的 `try { await this.decorateAndApplyList(); }` 要去掉；`finally` 里不再需要重置 `page/hasMore/loading` 这几个已删除变量。

### 4.3 `pages/calendar-mine/index.wxss`

- **删除**：`.seg-shell`、`.empty-wrap*`、`.plan-card*`（`.plan-card__left / __md / __md2 / __right / __row1~3 / __ops / __time / __gym`）、`.btn-xs`、`.btn-danger`。
- **新增**：
  - `.chart-block`：给每个子图加一个区块壳（轻微 padding 分隔两图，不至于太挤）。
  - `.chart-block__kicker`：复用项目里的 `section-kicker` 样式（22rpx、字距、低饱和紫 8F7BFF、uppercase），但字号可以略小（20rpx）。
- **保留**：`.hero-cal / .hero-cal__top / .chip / .mini-chart* / .hero-stats / .stat-cell` 等 Hero 结构；最近打卡的 `.rec / .paginator`；`.card-hero` 的渐变背景。

### 4.4 `pages/calendar-mine/index.json`

- 已注册 `seg-tabs` 和 `line-chart-mini`；`seg-tabs` 组件移除后，**从 usingComponents 中删掉 seg-tabs 的注册**，保留 line-chart-mini。

---

## 5. 潜在风险与处理

| 风险 | 影响 | 处理方式 |
|---|---|---|
| `onReachBottom` 之前触发的是 `loadListPage`（计划列表分页），现在代码删了但 `onReachBottom` 函数壳子仍可能被小程序调用 | 报错找不到 `loadListPage` | 要么把 `onReachBottom` 整个删掉；要么改成空实现不做任何事（推荐直接删） |
| `line-chart-mini` canvas 在 Hero 卡渐变背景上渲染，叠加后文字/网格看不清楚 | 视觉可读性下降 | 在 `.chart-block` 中给 line-chart-mini 外层包一个半透明深色底容器（和现有 mini-chart 的 `rgba(11,13,21,0.22)` 对齐），保证 canvas 在纯深色上绘制 |
| 删除 plan-card 相关样式时，误删其他地方共用的 `.btn-xs` / `.btn-danger` | 全局样式冲突 | 先全局 grep 一下 `.btn-xs` / `.btn-danger` 是否有其它页面在引用；如果只有 calendar-mine 自己用就大胆删，否则保留（不做任何事即可，无害） |
| `stats.summary()` 和 `calendarApi.mine()` 仍然各自调用，不做接口级合并 | 接口数量未减少（仍是两个请求） | 这是**有意为之**：两个云函数（calendar_mine / stats_summary）各自独立职责，前端简单并行调用即可；避免改动云函数合并逻辑引入 bug |
| 最近打卡列表分页（第 N 页）依赖原 `stats.page`，而 onShow / pullDown 时可能跳回第1页但 `hasNext` 状态残留 | 分页错乱 | 目前 `loadStats({reset:true})` 已经写死 `nextPage = 1` 并重置 `recent = [], page = 1, hasNext = false`，无需额外改动 |

---

## 6. 风险验证步骤（执行后自检）

1. 打开「我的日历」Tab：
   - 能看到一张合并 Hero 卡（标题 + 打卡率 chip + 3 格指标 + 14天柱状 + 30天折线）
   - 下方是「最近打卡」独立卡片（含分页）
   - **完全看不到**「即将到来 / 历史记录」Tab 和任何计划卡片
2. 在开发者工具 Network / Console 搜：
   - `calendar_mine` → 仍调用一次（summary），没有报错
   - `stats_summary` → 仍调用一次（days:30），没有报错
   - Console 不应出现 `cannot read decorateAndApplyList of undefined` 等 JS 报错
3. 下拉刷新：两个数据（Hero 指标 + 最近打卡）都能刷新
4. 最近打卡的「下一页」：点击后能 loadStats 且 hasNext 正确

---

## 7. 备注：关于"最近打卡"是否并入 Hero 尾部

方案 A 默认保持「最近打卡」独立成卡，理由：
- 该卡有分页器（下一页/页码），交互上是"可滚动扩展区"，和 Hero 的「展示快照卡」语义不同；
- 强行塞进 Hero 会让卡片高达 3~4 屏，破坏 Hero 作为"顶部视觉锚点"的观感。

如果你偏好**更极致的合并**（所有内容进一张卡），在评审时提一下即可，届时把最近打卡的 list 直接追加在 Hero 的 `line-chart-mini` 下方，并移除最近打卡外层的 `card` 壳即可（代码改动量极少，只动 WXML 层包装 class）。
