# 首页新增岩馆软硬度计划

## Summary
- 目标：在现有微信小程序项目中新增岩馆“软硬度”主观评分能力，支持用户在单馆页为某家岩馆打 `1-10` 分，`1=软、10=硬`。
- 首页改为双 tab 结构：`岩馆列表` 与 `软硬度排行榜`。两个 tab 中的岩馆卡片都可点击进入现有 `miniprogram/pages/checkin/index` 页面。
- `岩馆列表` tab 延续当前首页逻辑，仍按原有分页/筛选展示，并保持“上次去过的岩馆优先置顶且带标记”。
- `软硬度排行榜` tab 必须先选择城市后才展示榜单；榜单按该城市下岩馆的软硬度均分从高到低排序，并展示评分人数、均分、无人评分状态。
- 首页卡片展示口径：有评分时显示“`X 人打出 Y.Y 分`”，无人评分时显示“`无人打分`”。

## Current State Analysis
- 首页当前页面为 `miniprogram/pages/home/index.js`、`miniprogram/pages/home/index.wxml`、`miniprogram/pages/home/index.wxss`。
- 首页当前仅有搜索区和线路模式 `seg-tabs`，数据通过 `miniprogram/services/api/gym.js` 调 `cloudfunctions/rock_gym_list/index.js` 获取。
- 首页岩馆卡片由 `miniprogram/components/gymCard/index.js`、`index.wxml`、`index.wxss` 承担，当前已展示城市、地址、周期、支持模式、线路数和“上次来访”标签。
- 点击首页岩馆后进入 `miniprogram/pages/checkin/index.js`、`index.wxml`、`index.wxss`，该页实际承担“岩馆内页/打卡页”职责，并通过 `miniprogram/services/api/checkin.js` 调 `cloudfunctions/rock_checkin_context/index.js` 拉取单馆上下文。
- 现有云函数 `cloudfunctions/rock_gym_list/index.js` 已完成首页分页、城市/关键字/模式筛选、以及基于用户历史打卡的“来访次数 / 上次来访日期”补充。
- 现有云函数 `cloudfunctions/rock_checkin_context/index.js` 已有用户身份、单馆信息、周期、个人进度等上下文，适合一并返回当前用户对该馆的软硬度评分与评分汇总。
- 项目目前没有岩馆主观评分集合；最接近的用户生成内容参考是 `cloudfunctions/comment_create/index.js` 与 `cloudfunctions/comment_list/index.js`。

## Assumptions & Decisions
- 评分模型：每个用户对每家岩馆只能保留 1 条当前评分；重复打分时覆盖旧分，不保留历史版本。
- 分数语义：`1=软`、`10=硬`，首页和排行榜都按“分数越高越硬”解释。
- 排行榜仅在已选择城市时可见明细；未选择城市时显示提示文案，不请求榜单数据。
- 排行榜展示对象仍是岩馆卡片列表，不做独立复杂榜单样式；卡片可直接点击进入 `checkin` 页面。
- 排行榜排序规则：先按 `hardnessAvg` 降序，再按 `hardnessCount` 降序，最后按 `updatedAt` 或馆名兜底，避免同分顺序抖动。
- 首页普通列表继续保留“最近去过的馆优先置顶”；排行榜 tab 不做人为置顶，严格按硬度排序，但仍在卡片上标记“上次去过”。
- 为降低首页查询成本，评分聚合结果冗余存入 `RockGyms`，用户单条评分存入新集合 `RockGymHardnessRatings`。
- 聚合字段命名统一为：`hardnessAvg`、`hardnessCount`、`hardnessUpdatedAt`；用户评分字段命名为 `myHardnessScore`。
- 城市输入仍复用首页现有文本输入框 `city`，不新增城市选择器；排行榜 tab 直接消费该输入值。

## Proposed Changes

### 1. 新增评分写入云函数
- 新建 `cloudfunctions/rock_gym_hardness_upsert/index.js`。
- 职责：
  - 从 `cloud.getWXContext()` 识别当前用户。
  - 校验 `gymId` 必填、`score` 为 `1-10` 的整数。
  - 在 `RockUsers` 中补查当前用户，兼容项目已有 `openid/_openid/uid` 识别方式。
  - 在新集合 `RockGymHardnessRatings` 中按“用户 + 岩馆”查已有记录；存在则更新，不存在则新增。
  - 评分记录字段建议：
    - `gymId`
    - `openid`
    - `userId`
    - `score`
    - `createdAt`
    - `updatedAt`
  - 写入后重新查询该馆所有评分，计算最新 `hardnessAvg`、`hardnessCount`。
  - 将聚合结果回写 `RockGyms` 对应文档：
    - `hardnessAvg`
    - `hardnessCount`
    - `hardnessUpdatedAt`
  - 返回：
    - `score`
    - `hardnessAvg`
    - `hardnessCount`
    - `myHardnessScore`
- 说明：
  - 先采用“写后重算该馆全部评分”的简单方案，逻辑直观，避免增量统计被并发写坏。
  - 后续如评分规模变大，再考虑事务或增量聚合；本次不提前复杂化。

### 2. 扩展首页岩馆列表云函数
- 修改 `cloudfunctions/rock_gym_list/index.js`。
- `normalizeGym()` 新增标准化输出：
  - `hardnessAvg`
  - `hardnessCount`
  - `hardnessUpdatedAt`
- 扩展事件参数：
  - `sortBy`，支持默认列表模式和 `hardness`
  - `ratedOnly`，排行榜查询时为 `true`
- 列表模式行为：
  - 维持现有 `city / keyword / mode / page / pageSize` 过滤。
  - 普通列表保持当前分页和“最近访问优先”的前端置顶逻辑。
- 排行榜模式行为：
  - `sortBy === "hardness"` 时要求 `city` 非空；若为空则直接返回空列表与 `needCity: true`。
  - 仅返回当前城市下的岩馆。
  - 若 `ratedOnly === true`，只保留 `hardnessCount > 0` 的岩馆。
  - 按 `hardnessAvg desc`、`hardnessCount desc`、`updatedAt desc` 排序后分页。
- 保留现有用户打卡补充逻辑，以便排行榜卡片也能显示“上次去过”标签。

### 3. 扩展单馆上下文云函数
- 修改 `cloudfunctions/rock_checkin_context/index.js`。
- 在现有 `gym / progress / routeCounts / supportedModes` 返回结构基础上，追加：
  - `hardnessAvg`
  - `hardnessCount`
  - `myHardnessScore`
- 实现方式：
  - 从 `gymRaw` 或 `gym` 上读取冗余聚合字段填入 `gym.hardnessAvg`、`gym.hardnessCount`。
  - 用当前用户身份 + `gymId` 查询 `RockGymHardnessRatings`，返回 `myHardnessScore`。
  - 在最终 `ok()` 返回体中把 `myHardnessScore` 顶层返回，或同时塞入 `gym` 内，前端统一读取。
- 这样 `checkin` 页首次加载时即可同时拿到馆内硬度汇总与用户已打分结果，无需额外读取接口。

### 4. 扩展前端岩馆 API
- 修改 `miniprogram/services/api/gym.js`。
- 新增：
  - `listHardnessRank(params, options)`，内部仍调用 `rock_gym_list`，但固定传 `sortBy: "hardness"`、`ratedOnly: true`。
  - `upsertHardnessScore(params, options)`，调用新云函数 `rock_gym_hardness_upsert`。
- `miniprogram/services/api/checkin.js` 无需新增接口，继续复用 `context()` 获取单馆评分摘要。
- 如实现时发现 `gym.js` 过于拥挤，可拆出 `miniprogram/services/api/hardness.js`，但优先保留在 `gym.js` 以减少改动面。

### 5. 改造首页为双 tab
- 修改 `miniprogram/pages/home/index.json`，注册 `seg-tabs` 组件。
- 修改 `miniprogram/pages/home/index.js`：
  - 新增顶层 tab 状态，例如：
    - `topTab`
    - `topTabs: [{ key: "list", label: "岩馆列表" }, { key: "hardness", label: "软硬度排行榜" }]`
  - 保留原 `modeTabs`，但仅在 `topTab === "list"` 时展示。
  - 新增排行榜数据状态：
    - `rankGyms`
    - `rankPage`
    - `rankHasNext`
    - `rankLoading`
    - `rankNeedCity`
  - `onTopTabChange()` 中切换列表/排行榜：
    - 切到 `list` 时走现有 `loadGyms({ reset: true })`
    - 切到 `hardness` 时若未填城市则仅更新提示态；有城市则调用新排行榜加载逻辑
  - 新增 `loadHardnessRank({ reset, silent, hasCache })`，复用现有分页工具或复制一套排行榜分页状态。
  - 普通列表继续沿用 `lastGymId` 置顶逻辑；排行榜不做置顶。
  - 首页缓存键 `getGymsCacheKey()` 需区分 `topTab` 与排行榜查询参数，防止不同 tab 串缓存。
- 修改 `miniprogram/pages/home/index.wxml`：
  - 在顶部搜索卡片中新增首页双 tab。
  - `岩馆列表` tab 下保留当前模式 tab 与原列表。
  - `软硬度排行榜` tab 下展示：
    - 未选城市提示：“请先输入城市后查看软硬度排行榜”
    - 有城市但无评分时提示：“该城市暂无软硬度评分”
    - 有数据时用 `gym-card` 列表渲染排行榜结果
  - 两个 tab 中的 `gym-card` 都继续绑定 `onTapGym`。
- 修改 `miniprogram/pages/home/index.wxss`：
  - 为首页双 tab、排行榜空态、排行榜列表间距补充样式。
  - 确保顶部搜索区在增加一层 tab 后仍不挤压当前输入框和模式 tab。

### 6. 扩展岩馆卡片展示评分信息
- 修改 `miniprogram/components/gymCard/index.js`。
- 在 `buildDisplayGym()` 中新增衍生字段：
  - `hardnessText`
  - `hardnessTagType` 或直接输出展示文案
  - `hasLastVisit` / `lastVisitLabel` 继续复用现有字段
- 修改 `miniprogram/components/gymCard/index.wxml`：
  - 在现有 tags 区新增评分标签或单独一行说明。
  - 展示规则：
    - `hardnessCount > 0` 时显示 `{{hardnessCount}} 人打出 {{hardnessAvg}} 分`
    - 否则显示 `无人打分`
  - 若 `lastVisitLabel` 存在，继续以醒目标签展示“上次去过/上次 YYYY-MM-DD”。
- 修改 `miniprogram/components/gymCard/index.wxss`：
  - 为评分文案增加样式，保证在普通列表和排行榜列表中都清晰可读。

### 7. 在单馆页新增“给硬度打分”入口
- 修改 `miniprogram/pages/checkin/index.js`。
- 在 `data` 中新增：
  - `myHardnessScore`
  - `hardnessAvg`
  - `hardnessCount`
  - `hardnessPickerVisible`
  - `hardnessOptions` 或 `hardnessScores: [1..10]`
- 在 `normalizeContextState()` 中从 `res.gym` / `res.myHardnessScore` 提取评分数据，写入页面状态。
- 新增交互方法：
  - `openHardnessPicker()`
  - `closeHardnessPicker()`
  - `selectHardnessScore(e)` 或 `submitHardnessScore(score)`
- 交互建议：
  - 采用轻量自定义底部评分面板，直接展示 `1-10` 按钮网格。
  - 不用 `wx.showActionSheet`，因为 10 个分值过长，体验较差。
  - 已打分时在按钮区域注明“你已打 X 分，可重新打分覆盖”。
- 提交成功后：
  - 更新本页 `myHardnessScore / hardnessAvg / hardnessCount`
  - 适度刷新 `rock_checkin_context` 缓存或直接覆盖当前页面状态
  - 返回首页时让首页 `onShow()` 重新走当前 tab 的刷新逻辑，以便立即看到新均分
- 修改 `miniprogram/pages/checkin/index.wxml`：
  - 在顶部按钮区或卡片头部增加“给硬度打分”按钮。
  - 在馆名附近展示当前馆软硬度摘要：
    - 有评分时：`X 人打出 Y.Y 分`
    - 无评分时：`无人打分`
    - 用户已打分时追加：`你打了 X 分`
  - 增加评分选择面板结构。
- 修改 `miniprogram/pages/checkin/index.wxss`：
  - 为评分摘要、打分按钮、评分面板补充样式，保持与现有卡片风格一致。

### 8. 数据集合与兼容策略
- 新增集合：`RockGymHardnessRatings`。
- 文档结构建议：
  - `gymId`
  - `openid`
  - `userId`
  - `score`
  - `createdAt`
  - `updatedAt`
- `RockGyms` 追加聚合字段：
  - `hardnessAvg`
  - `hardnessCount`
  - `hardnessUpdatedAt`
- 兼容处理：
  - 旧馆没有这些字段时，前后端都按 `hardnessCount = 0`、`hardnessAvg = null` 处理。
  - 首页和单馆页统一由前端把“无字段”格式化成“无人打分”，避免后端强行补假值。

## Verification Steps
- 云函数验证：
  - 新用户首次对某馆打分，`RockGymHardnessRatings` 新增 1 条记录，`RockGyms` 聚合字段同步更新。
  - 同一用户再次给同馆打不同分，只更新原记录，不新增第二条。
  - 不同用户连续打分后，均分按一位小数或约定精度正确展示。
- 首页验证：
  - `岩馆列表` tab 保留当前搜索、模式筛选、分页、点击进馆行为。
  - 普通列表中最近去过的馆仍被前端优先置顶。
  - 卡片在有评分/无评分两种情况下展示正确文案。
  - 切换到 `软硬度排行榜` tab 且未填写城市时，只出现提示，不显示排行。
  - 填写城市后排行榜正确按均分降序，且卡片可进入 `checkin` 页面。
- 单馆验证：
  - 进入馆内页可看到“给硬度打分”按钮与当前摘要。
  - 已打分用户能看到自己的分值，并可重新打分覆盖。
  - 提交后当前页摘要立即更新，返回首页后该馆在相应 tab 中也能看到新数据。
- 回归验证：
  - `checkin` 原有打卡保存流程不受影响。
  - `gym-manage`、`rock_gym_get`、馆长编辑链路无需改动且不应被评分功能影响。
