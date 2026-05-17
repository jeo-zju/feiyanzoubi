# 恢复微信小程序「飞岩走壁」计划

## Summary
- 目标：在当前仓库中重建“飞岩走壁”小程序源码，使其功能等价于截图所示版本，并保持代码结构干净、可运行、符合小程序编码规范、页面模块化便于扩展。
- 范围：补齐截图中的全部云函数与数据库集合对接；重做小程序前端页面（首页/统计/我的 + 馆长模式与岩馆管理/打卡页等），并提供可配置的云环境接入方式以对接现有云环境数据。

## Current State Analysis（基于当前仓库实际内容）
- 当前是云开发 QuickStart 模板：
  - 小程序端仅有 [app.json](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/app.json)（两页：index/example）、[app.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/app.js)（env 为空）、少量示例页面与组件。
  - 云函数端仅有 [quickstartFunctions](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/quickstartFunctions)。
- temp 截图透露的“目标形态”：
  - 底部 Tab：首页 / 统计 / 我的；暗色 UI。
  - 页面与交互：岩馆搜索列表、岩馆打卡（抱石/难度切换、等级行 +/-）、统计页折线图与最近记录、我的页（同步微信头像昵称、馆长后台、管理日志）、馆长模式（我的岩馆列表）、岩馆管理（岩馆信息/周期设置/线路录入）。
  - 云函数列表（需补齐）：admin_manage、rock_seed_gyms、rock_init、stats_summary、share_card_render、leaderboard_compute、gym_owner_upsert、friendship_manage、dictionary_list、comment_create、comment_list、checkin_create、auth_login、llm，以及 quickstartFunctions。
  - 数据库集合名（需对接）：RockBlackTalkDictionary、RockCheckinRecords、RockComments、RockFriendships、RockGymBlackboards、RockGymCycles、RockGyms、RockUserCycleProgress、RockUserDailyProgress、RockUsers（另有云开发默认 analysis_* 等）。

## Assumptions & Decisions
- 复原标准：按你的选择“功能等价即可”，UI/交互尽量贴近截图但不追求逐像素复刻。
- 数据策略：按你的选择“对接现有云环境”，不做破坏性迁移；云函数读写会尽量兼容缺字段/旧字段，并给出默认值。
- 云函数范围：按你的选择“全部云函数补齐”，但会按“可用优先级”分层实现：先满足现有页面闭环，再补齐其余能力与边界校验。
- 云环境 ID（envId）不在仓库中硬编码：提供单点配置（envList.js / app.js），确保项目可运行但不泄露敏感信息。

## Proposed Changes（文件级别、可执行、决策完备）

### 1) 小程序端：重构为业务应用（替换 QuickStart 页面）
**目标**：实现截图对应的页面与组件结构；页面之间尽量解耦（每页只依赖公共组件与 service 层），便于后续扩展。

- 更新全局配置
  - 修改 [miniprogram/app.json](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/app.json)
    - pages：替换为业务页面路由（Home/Stats/Me/Checkin/Owner/Manage/Logs 等）。
    - tabBar：配置 3 个 tab（首页/统计/我的），并接入现有 icons（必要时新增 icons）。
    - window：导航栏标题改为“飞岩走壁”，并保持 v2 样式。
  - 修改 [miniprogram/app.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/app.js)
    - 云初始化：从 envList.js 读取 envId；提供兜底（未配置时提示）。
    - 初始化登录态：启动时调用 auth_login（可延迟到进入“我的”页触发，避免首屏阻塞）。
  - 修改 [miniprogram/app.wxss](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/app.wxss)
    - 建立暗色主题基础样式（容器、卡片、按钮、输入框、标签等）。

- 新增公共目录（干净分层）
  - 新增 `miniprogram/services/`
    - `cloud.js`：统一封装 `wx.cloud.callFunction`（错误归一、loading、traceId）。
    - `api/*.js`：按领域拆分（auth、gym、checkin、stats、comment、friendship、dictionary、admin、share、leaderboard、llm）。
  - 新增 `miniprogram/utils/`
    - `date.js`、`validate.js`、`paginate.js`、`format.js` 等纯函数工具，避免页面互相引用。
  - 新增 `miniprogram/components/`
    - `segmentedTabs`：用于“抱石/难度”、“岩馆信息/周期设置/线路录入”。
    - `gymCard`：岩馆列表卡片（名称/城市/周期/标签/统计等）。
    - `paginator`：上一页/下一页 + “第 N 页”。
    - `stepperRow`：等级行（label、累计/上限、- / +、当前增量）。
    - `lineChartMini`：用 canvas 实现简易折线图（不引入第三方库，降低依赖）。

- 新增/替换页面（与截图对齐）
  - `miniprogram/pages/home/index.*`
    - 顶部“今天打算爬哪家馆？”搜索区：城市/岩馆名输入 + 搜索按钮。
    - 岩馆列表：卡片 + 标签（上次/默认周期/月份等）+ 分页。
    - 点击岩馆进入打卡页（携带 gymId）。
  - `miniprogram/pages/checkin/index.*`
    - 展示当前岩馆、周期月份、打卡日期。
    - “难度/抱石”切换；等级行列表（累计/上限、- / +）。
    - 提交按钮“今天就爬到这了！”调用 checkin_create。
    - “去爬其他馆”回到首页/选择岩馆。
  - `miniprogram/pages/stats/index.*`
    - 最近 30 天折线图（打卡条数/线路数）。
    - 文案“最近30天你爬过X家岩馆，新打卡了Y条线路。”
    - 最近记录列表 + 分页；数据来自 stats_summary。
  - `miniprogram/pages/me/index.*`
    - 用户卡片（头像、昵称/项目名）、“同步微信头像昵称”按钮（调用 auth_login with userInfo）。
    - 管理区：馆长后台（进入 owner 页）、管理日志（进入 logs 页）。
  - `miniprogram/pages/owner/index.*`（馆长模式：我的岩馆）
    - 顶部统计（管理岩馆数、抱石/难度线路总数）。
    - 岩馆列表（可新增“+”）。
    - 点击进入岩馆管理页。
  - `miniprogram/pages/gym-manage/index.*`（岩馆管理）
    - Tabs：岩馆信息 / 周期设置 / 线路录入。
    - 岩馆信息：创建/更新岩馆（name/city/address）→ gym_owner_upsert。
    - 周期设置：周期名、开始日期、抱石等级、难度等级、保存周期 → rock_init / gym_owner_upsert（按后端设计拆分）。
    - 线路录入：按等级录入数量、支持新增自定义等级、提交“更新线路”。
  - `miniprogram/pages/logs/index.*`
    - 展示云函数调用结果/错误摘要（本地日志 + 可选云端 admin_manage 拉取）。

### 2) 云函数端：按截图补齐全部云函数（兼容现有数据）
**目标**：云函数命名与截图一致；入参/出参统一；所有写操作做权限校验；所有集合名使用截图中的名称。

- 新增云函数目录（每个函数独立部署，依赖 wx-server-sdk）
  - `cloudfunctions/auth_login`
    - 获取 openid；如传入 userInfo 则同步到 RockUsers（avatarUrl/nickName 等）；返回 userProfile。
  - `cloudfunctions/rock_init`
    - 初始化/校验集合必要索引与默认文档（尽量非破坏性）；返回当前版本与检测结果。
  - `cloudfunctions/rock_seed_gyms`
    - 写入示例岩馆/默认周期（仅当集合为空或显式参数允许）；避免覆盖现有数据。
  - `cloudfunctions/gym_owner_upsert`
    - 创建/更新岩馆、维护管理员（openids）、周期与线路配置（分字段 upsert）。
  - `cloudfunctions/checkin_create`
    - 写入 RockCheckinRecords；并更新/聚合 RockUserDailyProgress、RockUserCycleProgress（幂等：同日同馆同类型可覆盖或累加，规则在实现中固定）。
  - `cloudfunctions/stats_summary`
    - 统计最近 30 天：折线图点位 + 最近记录分页 + 文案所需的 X/Y。
  - `cloudfunctions/comment_create` / `comment_list`
    - 针对岩馆/打卡记录的评论发布与查询（分页、字段脱敏）。
  - `cloudfunctions/friendship_manage`
    - 关注/取关/列表（RockFriendships）。
  - `cloudfunctions/leaderboard_compute`
    - 计算排行榜（按周期/30天维度），使用 RockUserCycleProgress / RockUserDailyProgress 聚合。
  - `cloudfunctions/dictionary_list`
    - 返回 RockBlackTalkDictionary（用于趣味文案/llm prompt）。
  - `cloudfunctions/share_card_render`
    - 生成分享所需数据（小程序码、标题、副标题、统计摘要）；不在云端硬渲染图片以避免额外依赖。
  - `cloudfunctions/admin_manage`
    - 仅管理员可用：查看关键集合健康状况、最近错误摘要、手动触发 rock_init 等。
  - `cloudfunctions/llm`
    - 不接外部密钥服务：提供“本地规则 + dictionary”生成的轻量文案/总结，保证可用与可运行。

- 统一返回结构（所有云函数一致）
  - `{ ok: true, data, traceId }` / `{ ok: false, error: { code, message }, traceId }`
  - traceId 用于前端日志页定位问题。

### 3) 数据结构与兼容策略（不迁移、可渐进）
- 采用“读时兼容、写入补齐”的策略：
  - 读取：字段不存在时提供默认值；对可能的旧字段名做 fallback。
  - 写入：以最小必要字段写入，避免破坏现有文档；仅在明确接口中更新对应字段。
- 关键权限边界：
  - gym_owner_upsert / rock_seed_gyms / admin_manage：校验调用者 openid 是否在管理员名单/岩馆管理员名单中。
  - checkin_create：仅写入自己的记录（openid 绑定）。

## Verification（验收/自测步骤）
- 本地（微信开发者工具）：
  - 项目可编译启动；TabBar 正常；页面路由无报错。
  - 首页：搜索/分页/进入打卡页正常（无数据时有空态）。
  - 打卡：加减交互正常；提交后云端写入成功并可在统计页看到变化。
  - 统计：折线图渲染正常；最近记录分页正常。
  - 我的：同步头像昵称成功；可进入馆长后台与管理页。
  - 馆长后台：创建岩馆、保存周期、录入线路数量成功；返回首页/列表可看到更新。
- 云端：
  - 所有云函数可部署；在云函数日志中无未捕获异常。
  - 现有集合名不变；不会触发破坏性清空/覆盖。

## Implementation Notes（执行时遵循）
- 仅在必要处复用组件；业务逻辑集中在 services/api，页面只做状态与渲染，保持页面独立性。
- 不引入外部密钥依赖；llm/share 等功能保证“可用但安全”。
