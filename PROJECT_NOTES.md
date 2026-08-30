# 飞岩走壁工程笔记

## 项目定位
- 这是一个基于微信小程序原生框架和微信云开发的攀岩业务项目。
- 核心闭环是：登录 -> 选岩馆 -> 按周期打卡 -> 查看统计 -> 馆长维护岩馆 -> 通过名片和攀岩墙增强社交互动。

## 技术栈
- 前端：原生微信小程序，目录在 `miniprogram/`
- 后端：微信云函数，目录在 `cloudfunctions/`
- 数据：微信云数据库，主要集合包括 `RockGyms`、`RockUsers`、`RockCheckinRecords`、`RockUserCycleProgress`

## 目录职责
- `miniprogram/app.js`：小程序启动入口，初始化云环境
- `miniprogram/app.json`：页面注册、TabBar、全局窗口配置
- `miniprogram/pages/home`：岩馆搜索、分页列表、进入打卡
- `miniprogram/pages/checkin`：打卡主流程，处理抱石/难度计数与提交
- `miniprogram/pages/stats`：最近 30 天统计与近期记录
- `miniprogram/pages/me`：用户中心、名片入口、馆长后台入口
- `miniprogram/pages/owner`：馆长管理入口，查看自己管理的岩馆
- `miniprogram/pages/gym-manage`：馆长核心后台，维护岩馆信息、周期和线路
- `miniprogram/pages/card-*`：名片创建、赠送、领取、查看、名片夹
- `miniprogram/pages/wall`：攀岩墙展示与上墙
- `miniprogram/services/cloud.js`：统一封装 `wx.cloud.callFunction`
- `miniprogram/services/api/*`：按业务域划分的云函数调用代理
- `miniprogram/utils/*`：日期、格式化、登录态等通用工具
- `cloudfunctions/auth_login`：登录并同步用户信息
- `cloudfunctions/rock_gym_list`：岩馆列表
- `cloudfunctions/rock_checkin_context`：打卡页初始化数据
- `cloudfunctions/checkin_create`：提交打卡
- `cloudfunctions/stats_summary`：统计汇总
- `cloudfunctions/gym_owner_list` / `gym_owner_upsert`：馆长后台
- `cloudfunctions/rock_card_*`：名片域
- `cloudfunctions/rock_gym_wall_manage`：攀岩墙

## 当前前后端主链路
1. `pages/me` 调 `auth_login` 建立用户身份
2. `pages/home` 调 `rock_gym_list` 获取岩馆
3. `pages/checkin` 先调 `rock_checkin_context`，再调 `checkin_create`
4. `pages/stats` 调 `stats_summary`
5. `pages/owner` / `pages/gym-manage` 调 `gym_owner_list`、`gym_owner_upsert`
6. 名片相关页面调 `rock_card_upsert`、`rock_card_get`、`rock_card_list_my`、`rock_card_gift_manage`
7. `pages/wall` 调 `rock_gym_wall_manage`

## 本次已完成的清理
- 删除了只用于开发调试的日志页面入口，不再把调试页注册到正式页面路由
- 删除了“我的”页中的日志入口按钮
- 移除了 `debug_probe` 相关前端入口，避免正式流程携带调试探测能力
- 删除了未被页面引用的前端 API 代理文件
- 删除了微信模板残留 `quickstartFunctions` 及其部署脚本坏引用
- 删除了本地临时素材目录 `temp/`
- 抽出 `miniprogram/utils/session.js`，统一 `ensureAppLogin()` 登录兜底逻辑
- 简化 `miniprogram/services/cloud.js`，移除只服务于日志页的全局调用日志缓存
- 抽出 `miniprogram/utils/cardCanvas.js`，统一名片页的文本裁剪、自动换行和图片路径解析逻辑
- 抽出 `miniprogram/utils/cardRenderer.js`，统一名片正反面绘制主体，减少 `card-edit` / `card-view` 的重复布局代码
- 修复 `card-view` 保存图片依赖固定延时的问题，改为等待 canvas 真正绘制完成后再导出，降低空白图或导错面的风险
- 抽出 `miniprogram/utils/pageState.js`，统一 `home`、`stats`、`owner` 三页的分页翻页与加载状态处理
- 简化 `paginator` 组件输入，上一页可用性改为由当前页号自动判断
- 清理 `card-edit` 中未被模板使用的派生状态，减少无意义的 `setData` 和后续维护噪音
- 修复 `owner` 页“管理岩馆数量”口径错误，改为由 `gym_owner_list` 返回用户管理岩馆总数
- 修复 `owner` 页线路汇总口径错误，改为由 `gym_owner_list` 返回全部管理岩馆的线路总数
- 修复 `rock_checkin_context` 跨周期取进度的问题，打卡上下文现在按目标 `cycleId` 过滤周期进度和历史记录
- 修复 `stats_summary` 同一天多次打卡时图表被覆盖的问题，按日期改为累加而不是覆盖
- 修复 `stats_summary` 最近记录分页提前截断的问题，改为分批拉取原始记录并按需累积，减少老用户“提前没有下一页”的概率
- 修复名片赠送链路中的 3 个问题：取消链接后恢复草稿、直送首张名片自动设主卡、领取页未领取状态不再暴露背面内容
- 对名片领取增加基于 `gift.status = pending` 的条件更新，缩小同一链接被并发重复领取的窗口
- 继续强化名片领取一致性：卡片归属写入改为 `ownerOpenid` 为空时才允许更新，若卡片更新失败则把 gift 从 `claimed` 回滚回 `pending`
- 新增前端调试日志页 `pages/debug-logs`，并把云函数调用日志、运行错误、未处理 Promise 异常、本地页面不存在错误统一落到本地日志存储中，入口位于“我的 > 管理 > 调试日志”
- `rock_llm_one_liner` 已改为直连 DeepSeek OpenAI 兼容接口，环境变量优先读取 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`，同时兼容 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`；默认模型为 `deepseek-chat`，默认地址为 `https://api.deepseek.com`
- 重新设计 `我的` 页：顶部改为紧凑资料条，`名片夹` 和 `灵感` 收成两张轻量信息卡，底部改为 4 格快捷入口；显式“同步微信头像昵称”按钮已移除，改为点击顶部资料区触发同步
- 新增 `miniprogram/utils/window.js` 统一读取窗口宽度，优先使用 `wx.getWindowInfo()`，已替换 `me`、`card-edit`、`card-view`、`lineChartMini` 中的 `wx.getSystemInfoSync()`，避免新版基础库的 deprecated 告警
- 已完成 `wx.getUserProfile` 迁移：新增极简资料编辑页 `pages/profile-edit`，通过 `chooseAvatar` + `type="nickname"` 获取资料，头像会先上传到云存储再调用 `auth_login` 持久化；`miniprogram/utils/session.js` 新增 `syncAppLogin()`，用于统一“登录/更新资料后回写 `app.globalData.user`”的逻辑
- 开始统一页面视觉骨架：在 `miniprogram/app.wxss` 新增共享的 `card-hero`、`section-kicker`、`section-title-lg`、`section-desc`、`panel`、`stat-grid`、`list-row`、`empty-state` 等样式，并已用于 `profile-edit`、`owner`、`stats`、`wall`，让标题区、统计卡、列表行和空态文案更统一、更简洁
- 第二轮视觉收敛继续落到高频业务页：`card-wallet`、`card-gift` 已接入统一的 Hero/统计卡/列表行/面板样式；`checkin` 保持原有打卡逻辑不变，仅统一头部信息层级和表格外层容器，让高频页面的节奏更接近同一产品

## 当前仍建议后续处理的优化点
- `card-edit` 与 `card-view` 的名片绘制已抽出主体，但仍可继续统一尺寸、间距和文案常量，减少两套布局参数分散
- 多个云函数重复实现 `traceId`、`ok`、`fail` 响应协议，可收敛到 `cloudfunctions/_shared`
- `home`、`stats`、`owner` 的分页状态管理相似，可抽行为层或通用 helper
- 名片领取并发已具备 gift/card 两侧条件保护和失败回滚，但还不是完整数据库事务；若后续继续强化，可把 gift/card 更新收进数据库事务
- 调试日志目前存储在小程序本地缓存中，适合开发和联调；若后续需要跨设备排查，可再加远端上报或导出能力
- 若确认没有外部运维依赖，可继续评估删除未被前端引用的云函数，如 `admin_manage`、`dictionary_list`、`leaderboard_compute`、`comment_*`、`friendship_manage`、`llm`、`rock_init`、`rock_seed_gyms`

## 修改后的判断
- 当前正式业务线更聚焦在“打卡 + 统计 + 馆长后台 + 名片”
- 调试代码和模板残留已经收口，页面路由与服务层更贴近实际业务
- 后续新开窗口时，优先阅读本文件，再按需要展开到对应业务目录

---

## §9 数据库集合对照表（20 当前 + 2 未来新增 F-2/F-4）

| # | 集合名 | 使用云函数数 | 状态 | 备注 |
|---|---|---|---|---|
| 1 | RockUsers | 13+ | 🔵 核心表 | 用户基础信息：openid/uid/nickname/avatar/role/… |
| 2 | RockGyms | 10+ | 🔵 核心表 | 岩馆元数据：名称/城市/ownerOpenid/gymType/hardness/status |
| 3 | RockGymCycles | 3 | 🔵 核心表 | 岩馆的每期线路周期（14天）+ lines[] 等级/计数/delta |
| 4 | RockCheckinRecords | 3 | 🔵 核心表 | 打卡明细；openid + gymId + cycleId + dateKey + items[] + totalDelta |
| 5 | RockUserDailyProgress | 2 | 🔵 核心表 | 同一 openid+dateKey 的当日汇总（boulderCount/boulderDelta/difficulty*）|
| 6 | RockUserCycleProgress | 2 | 🔵 核心表 | 同一 openid+cycleId 的周期累计值 |
| 7 | RockCards | 8+ | 🔵 核心表 | 名片：ownerOpenid / oneLiner / level / styles / layout / isPrimary |
| 8 | RockCardCredits | 3 | 🔵 核心表 | 灵感额度 remaining/total |
| 9 | RockCardGifts | 1（gift_manage） | 🔵 核心表 | 名片赠送 link/direct；status=pending/claimed/canceled |
| 10 | RockCircles | 1（circle_manage） | 🔵 核心表 | 岩友圈 name/description/city/memberCount/pendingCount/gymIds[] |
| 11 | RockCircleMembers | 1（circle_manage） | 🔵 核心表 | 圈成员 role=admin/member；status=accepted/pending/rejected |
| 12 | RockCalendarPlans | 3 | 🔵 核心表 | 约爬计划 openid+dateKey+startAt/endAt+visibility+needPartner |
| 13 | RockFriendships | 3 | 🔵 核心表 | 好友双向：from/to/status=accepted/rejected/pending |
| 14 | RockGymWallCards | 1（wall_manage） | 🔵 核心表 | 名片上墙槽位 gymId/cardId/slot/hungAt |
| 15 | RockGymReviewQueue | 3 | 🟠 后台 | 新馆审核队列：待审核/approved/rejected |
| 16 | RockGymSyncRuns | 1（rock_sync_gyms） | 🟠 后台 | 同步执行记录（runId/startedAt/endedAt/inserted/updated）|
| 17 | RockGymSourceRecords | 1（rock_sync_gyms） | 🟠 后台 | 同步源原始快照 |
| 18 | RockComments | 0 | 🔴 死代码（已从 admin_manage DOC_COLLECTIONS 移除） | 仅 admin_manage 备份白名单引用过，无任何 CRUD；真实集合可控制台手动删 |
| 19 | RockBlackTalkDictionary | 0 | 🔴 死代码（已从 admin_manage DOC_COLLECTIONS 移除） | 同上；0 业务代码读写 |
| 20 | RockCirclePosts | 0 | 🟡 未来新增（对应 Backlog F-4） | 圈帖动态 circleName + openid + content + images[] + createdAt |
| 21 | RockCheckinRevocationLog | 0 | 🟡 未来新增（对应 Backlog F-2） | 打卡撤销审计 log：撤销哪条 record/谁操作/时间/原因 |

## §10 29 云函数对外 action 协议速查

> 所有响应统一：`{ ok, data?, error?{code,message}, traceId }`
> 调用：前端 services/api/* 薄代理 → services/cloud.js callCloud → wx.cloud.callFunction

| 云函数(29) | 对外 action | 错误码示例 |
|---|---|---|
| user_manage | login / me / update | NO_PERMISSION / BAD_INPUT |
| friendship_manage | request / accept / reject / remove / search | ALREADY_FRIENDS / NOT_FOUND |
| rock_gym_list | —（按 query） | — |
| rock_gym_get | —（按 gymId） | NOT_FOUND |
| gym_owner_list | —（按 openid） | — |
| gym_owner_upsert | upsert_info / upsert_cycle / upsert_lines / delete_cycle | NOT_OWNER |
| gym_owner_manage | merge_propose / merge_apply / list_merges / manage_merge / delete_gym / transfer_owner / list_all / list_orphan | NOT_ADMIN / NOT_OWNER / SAME_GYM |
| rock_gym_hardness_upsert | —（按 gymId+hardness） | — |
| rock_checkin_context | —（按 gymId?cycleId?） | NOT_FOUND |
| checkin_create | create（**缺 F-2: revert_last**） | EMPTY_SUBMIT / NO_SUCH_CYCLE / OUTSIDE_REVOCATION_WINDOW |
| calendar_query | —（start/end/gymId/visibility） | RANGE_TOO_LARGE |
| calendar_mine | —（openid） | — |
| calendar_plan_publish | create / update / cancel（**缺 F-1: join_plan / unjoin_plan / get_joiners / remove_joiner**） | NOT_OWNER / DATE_PAST |
| circle_manage | create / update / disband / list / myList / getDetail / apply / approve / reject / remove / leave（**缺 F-4: post_list/post_create/post_delete**） | NOT_ADMIN / NOT_MEMBER / CIRCLE_NOT_FOUND |
| rock_card_upsert | —（upsert） | INSUFFICIENT_CREDIT |
| rock_card_get | —（cardId） | NOT_FOUND / NO_PERMISSION |
| rock_card_list_my | —（created/received/wall 三段） | — |
| rock_card_manage | set_primary / remove_received（**缺 F-3: remove_created**） | NOT_OWNER |
| rock_card_gift_manage | create_link / create_direct / get / claim / cancel | GIFT_CLAIMED / NOT_RECIPIENT |
| rock_gym_wall_manage | get / list_cards / hang / unhang | SLOT_OCCUPIED / NOT_OWNER |
| share_card_render | render（返回 fileID） | RENDER_FAILED |
| rock_llm_one_liner | —（prompt + 额度判断） | LLM_FAIL / INSUFFICIENT_CREDIT |
| stats_summary | —（30 天趋势 + topGym + 最近分页） | — |
| rock_sync_gyms | sync | NOT_ADMIN |
| admin_manage | health / list_users / auth_debug / doc_backup_list / doc_backup_export / doc_backup_import（DOC_COLLECTIONS 已撤 2） | NOT_ADMIN |
| rock_gym_review_queue_manage | list / review | NOT_ADMIN |
| **test_seed_data**（新增） | **seed / cleanup / status** | BAD_ACTION / (cleanup 必须 confirm:true 才执行删除) |

## §11 清理决策（本次执行结果汇总）

| 类别 | 数量 | 结果 |
|---|---|---|
| 云函数冗余可删？ | 28 个扫前端引用 | **0 个删除**：28 个云函数全部被 miniprogram/services/api/* 引用，一个不少 |
| 数据库集合（业务写读为 0）可撤备份白名单 | 20 个集合全扫 `collection(...)` | **2 个从 admin_manage DOC_COLLECTIONS 移除：RockComments / RockBlackTalkDictionary**。真实集合在控制台保留（避免立即物理删风险），等下一次手工清 |
| 数据库真实集合删除 | — | **0 个真实删除**：不碰控制台真实集合实体，交由用户上线前核对后手动删 |
| 功能入口去重（UI） | 33 页 WXML + 跳转全扫 | **删 3 行**：① home/index.wxml 「无岩馆+圈模式」空态创建圈按钮；② home/index.wxml 选圈 sheet 右上＋；③ me/index.wxml 抽屉里的「🐞 调试日志」一行（保留工具箱入口仅管理员能到）|
| 双入口但不删的 | 6 组（发布日历/岩友圈列表/馆长后台/时间轴/打卡/岩馆合并） | **全部保留**：场景和用户心智不同 |

## §12 测试数据规范（test_seed_data 云函数）

1. **命名一律 _v 后缀**：用户名 `test_user_1_v ~ test_user_10_v`；昵称 `攀岩小v…馆长v`；馆名 `飞岩测试馆A_v / B_v`；圈名 `深圳抱石交流_v…`
2. **三 action 协议**（统一 OK: `{ok, data, traceId}`）：
   - `action: "status"` → `{ counts:{ RockUsers:10, RockGyms:2, ... }, total: X }`
   - `action: "seed"` → 首次插入 10 用户 + 2 馆 + 4 周期 + 3 圈 + ~23 成员 + 3 好友 + ~20 打卡 + ~12 DP + ~8 CP + 8 约爬 + 6 卡 + 6 Credits + 1 赠 + 3 上墙 = 约 80 条；若检测到已有数据则返回 `mode: "idempotent_skip"` 防重复
   - `action: "cleanup"` + **不传 confirm → preview_only 返回 willDelete 预览，DB 零改动**；`confirm:true` 才真删；匹配严格正则 `openid /^test_user_.*_v$/`；集合里其他字段用 `name/_v$`、`gymName/_v$`、`circleName/_v$` 等
3. **cleanup 删除顺序（从外键到内）**：WallCards → Gifts → Credits → Cards → CalendarPlans → CycleProg → DailyProg → Records → Friendships → Members → Circles → Cycles → Gyms → Users，避免外键悬挂
4. **幂等性保证**：seed 前先 `count RockUsers openid 正则` 和 `count RockGyms name 正则`；两者任意 >0 直接 skip，不会无限堆数据
5. **部署位置**：`cloudfunctions/test_seed_data/` 含 `package.json`（wx-server-sdk ~2.4.0）+ `index.js`；需要管理员权限或全部用户可写权限（测试环境推荐）

## §13 功能入口去重记录

**入口地图（33 页跳转全扫 → 按目标页聚合入口数）：**

| 目标页面 | 入口数 | 决策 |
|---|---|---|
| 创建岩友圈 circle-edit | 4 入口（卡片 ＋/无岩馆空态/有岩馆空态/选圈 sheet＋） | 🔴 删 2，剩 2：保留「有岩馆空态引导」+「卡片 header 右 ＋」；删「无岩馆＋圈模式空态引导（逻辑矛盾：圈模式依赖 gymId）」和「选圈弹窗右上＋（用户心智：选圈就是选，不是创建）」 |
| 调试日志 debug-logs | 2 入口（我的页 ⚙抽屉 / 工具箱首页） | 🟡 删 1，剩 1：仅工具箱保留；普通用户看不到我的页抽屉里的 🐞 |
| 发布日历 publish | 2 入口（首页浮动 + 时间轴右上 ＋） | 🟢 保留 2：全局快速 + 上下文快捷（看某天直接加） |
| 岩友圈列表 circle-list | 2 入口（我的页卡片 / 首页 › 更多） | 🟢 保留 2：「我的圈」vs「当前岩馆更多圈」心智不同 |
| 馆长后台 owner | 2 入口（我的页抽屉 / 工具箱首页） | 🟢 保留 2：馆长本人 vs 管理员代查 |
| 打卡 checkin | 1 入口（首页浮动 📌） | 🟢 |
| 时间轴 timeline | 2 入口（点日期 / 无岩馆兜底跳转） | 🟢（后者是 fallback 不冗余）|
| 岩馆合并 gym-merge | 2 入口（我的页抽屉 / gym-manage 上下文 ⋯） | 🟢 保留 2：全局操作 vs 馆长操作岩馆内页上下文 |

## §14 功能 Backlog（F-1~F-4 确定缺失；O-1/O-2 可选；本文件只登记 + 写 TC，不补代码）

### 必补（高优先级；已在 tests/e2e_test_cases.md 有 🔶 预期失败用例）

| ID | 缺失功能 | 影响范围 | 建议修复云函数新增 action | 建议前端修改位置 |
|---|---|---|---|---|
| **F-1** | 约爬计划报名/取消报名/查看名单/移除报名人（四件套） | 目前约爬发了之后只能"看"，没有"我要去"的确认动作 → 约爬的社交闭环只完成一半 | calendar_plan_publish 加 4 个：join_plan / unjoin_plan / get_joiners / remove_joiner；calendar_query 返回字段扩 `joinedCount:number / meJoined:boolean` | pages/calendar-timeline：右上「＋发布日历」旁加报名按钮；pages/calendar-mine：加「我报名的」段 |
| **F-2** | 撤销最近 30 分钟最后一条打卡（三表回滚） | 高频误操作：误点 +3 V5 后 delta 算错；当前用户只能去数据库手工删三条表；体验很差 | checkin_create 新增 `action: "revert_last"`，用 `createdAt >= now()-1800000` 取最后一条，按 Records.totalCount/totalDelta 反减去 UserDailyProgress + UserCycleProgress + 删除 Records（或置 revoked=true）+ 写 RockCheckinRevocationLog 审计 | checkin 提交成功页顶部加「撤销」按钮（30 min 内高亮；超时变灰 disabled） |
| **F-3** | 删除自己创建的名片（含级联：若上墙先下墙；若赠未领取先取消） | 名片写错 / 隐私需要删 / 内容过期：目前只能改封面改不了"创建过"这一事实，会被人在墙上或老链接打开看到 | rock_card_manage 新增 `action: "remove_created"`：仅 ownerOpenid 匹配；先查 RockGymWallCards[cardId] 批量 unhang；再查 RockCardGifts[cardId] pending → cancel；最后删 RockCards | card-view 右上 ⋯ 加「删除名片」菜单；若检测到有 gift/wall，弹二次确认「同时下墙并取消 2 条赠送 → 删除」 |
| **F-4** | 岩友圈发帖 / 列表 / 删除动态（帖子） | 当前圈 11 action 全是成员管理；用户心智"进圈能聊天/发图"不满足；圈只剩一个社交标签，用途虚 | circle_manage 扩 3 action：post_list（分页，按圈过滤，按时间倒序）/ post_create（成员才能发）/ post_delete（自己发的 or admin 任意删）；新增集合 RockCirclePosts（circleId/name + openid/nickname + content + images[] + createdAt/status） | circle-detail 底部 TabBar 加「信息 / 成员 / 动态」；动态 Tab 右上 ＋ 发新帖 |

### 可选增强（非阻塞，建议但不强制；未加 TC）
- **O-1**：用户拉黑 / 屏蔽（friendship_manage 加 block/unblock + blocked list；对方发请求 403）→ 目前小程序投诉渠道也可处理，非阻塞
- **O-2**：名片夹「我收到的」分页 + 按等级筛选（rock_card_list_my 加 page/limit/grade）→ 老用户 100+ 张才会卡，非阻塞

