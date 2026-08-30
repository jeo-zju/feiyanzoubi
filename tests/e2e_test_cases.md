# 飞岩走壁端到端测试用例（E2E）

> 版本：v1.0
> 用途：未来可直接复用，配合 `test_seed_data` 云函数（seed/cleanup/status）
> 前置：部署 `test_seed_data` 云函数后，先调用 `action=seed` 插入 80 条左右测试数据（_v 后缀，幂等）
> 执行顺序：模块 A→I；标 🔶 的用例功能尚待实现，执行时预期失败。未来补完功能后将「🔶」改为「✅」。

## 用例清单总览

| 模块 | ID 范围 | 条数 | 功能状态 |
|---|---|---|---|
| A. 用户域 | TC-USER-01 ~ 05 | 5 | ✅ 可执行 |
| B. 岩馆馆长域 | TC-GYM-01 ~ 06 | 6 | ✅ 可执行 |
| C. 打卡域 | TC-CK-01 ~ 09 | 9 | 07 条 ✅ + 02 条 🔶 |
| D. 统计域 | TC-ST-01 ~ 04 | 4 | ✅ 可执行 |
| E. 日历约爬域 | TC-CAL-01 ~ 11 | 11 | 08 条 ✅ + 03 条 🔶 |
| F. 岩友圈域 | TC-F-01 ~ 12 | 12 | 09 条 ✅ + 03 条 🔶 |
| G. 名片域 | TC-CD-01 ~ 12 | 12 | 10 条 ✅ + 02 条 🔶 |
| H. 系统域 | TC-SYS-01 ~ 05 | 5 | ✅ 可执行 |
| I. 测试数据种子 | TC-SEED-01 ~ 03 | 3 | ✅ 可执行 |
| 合计 | | 67 条 | 57 条 ✅ / 10 条 🔶 |

---

## 格式说明
每条用例列：**ID | 模块 | 标题 | 前置条件 | 操作步骤 | 预期结果 | 关联文件路径**

---

### A. 用户域（TC-USER-01~05）

| ID | 模块 | 标题 | 前置条件 | 操作步骤 | 预期结果 | 关联文件路径 |
|---|---|---|---|---|---|---|
| TC-USER-01 | 用户域 | 首次进入小程序自动建立登录态 | seed 已执行；清掉本地缓存 `app_user` | 打开小程序「我的」Tab，停 1.5s | 顶部显示有昵称（攀岩小v等）+ avatarColor 非灰色；`wx.cloud.callFunction({name:"user_manage",{action:"me"}})` 返回 ok=true | [me/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/me/index.js) / [user_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/user_manage/index.js) |
| TC-USER-02 | 用户域 | 编辑资料 → 点击同步头像昵称 | 已登录；`pages/profile-edit` 有 `chooseAvatar` + `nickname input` | 1) 我页点顶部资料条 → 跳 profile-edit<br>2) 点「头像」选择本地图片 → 点昵称输入任意 2 个字 → 保存 | 回到我页头像/昵称立即更新；`RockUsers.openid=<自己>` 库中 `nickname/avatarUrl` 新值 | [profile-edit/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/profile-edit/index.js) / [session.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/utils/session.js) |
| TC-USER-03 | 用户域 | 搜索 test_user_2_v 并发送好友请求 | 双方 1v/2v 数据已 seed；当前登的是 test_user_1_v | 我的 → 岩友列表 → 右上＋搜索 → 输入 `抱石老王v` 或 openid `test_user_2_v` → 点「添加」 | `RockFriendships` 新增 status=pending 一条；被加方下一次刷岩友列表出现「待接受 x1」徽标 | [friendship_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/friendship_manage/index.js) / [friend-list/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/friend-list/index.wxml) |
| TC-USER-04 | 用户域 | 接受 & 拒绝好友请求 | seed 已包含 `test_user_1_v → test_user_4_v` pending；当前登 4v | 打开「岩友」→ 切「收到的请求」Tab → 第一个卡「接受」；第二个「拒绝」 | 接受的双方出现在对方「我的岩友」；拒绝的在 RockFriendships 消失 / status=rejected | [friendship_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/friendship_manage/index.js) / [services/api/friendship.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/services/api/friendship.js) |
| TC-USER-05 | 用户域 | 删除已加好友 | 1v↔2v 已加（seed） | 岩友详情 → 右上 ⋯ → 删除好友 → 弹窗确认 | RockFriendships 该对消失；下次日历「岩友」Tab 不显示被删方发布的 plan | [friend-list/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/friend-list/index.js) / [friendship_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/friendship_manage/index.js) |

### B. 岩馆馆长域（TC-GYM-01~06）

| ID | 模块 | 标题 | 前置条件 | 操作步骤 | 预期结果 | 关联文件路径 |
|---|---|---|---|---|---|---|
| TC-GYM-01 | 岩馆馆长 | 首页城市/岩馆筛选切换 + 分页 | seed 含 A_v（深圳）/B_v（北京） | 首页 → 点城市 → 选「深圳」 → 点岩馆 → 选「飞岩测试馆A_v」 | 岩友圈卡片头部标签变「岩友圈 · 飞岩测试馆A_v」；14 天日历 heat 有 ≥3 个格高亮（_v 数据） | [home/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/home/index.js) / [rock_gym_list/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_gym_list/index.js) |
| TC-GYM-02 | 岩馆馆长 | 岩馆详情页展示线路/软硬度 | 点击卡片进 `gym-detail` | 首页岩馆卡 → 详情 | 页面显示周期（当期_v）；线路表格 V0-V5 / 5.9-5.12a 行数 ≥6；软硬度 = 3 | [gym-detail/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/gym-detail/index.wxml) / [rock_gym_get/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_gym_get/index.js) |
| TC-GYM-03 | 岩馆馆长 | 馆长身份登录自动看到「馆长后台」 | 当前登 `test_user_5_v`（馆长） | 我的 Tab → 抽屉「馆长后台」/ 工具箱 → 进 `owner` | 顶部「管理岩馆数量」= 2（A_v+B_v）；「线路总数」≥ 80 | [owner/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/owner/index.js) / [gym_owner_list/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/gym_owner_list/index.js) |
| TC-GYM-04 | 岩馆馆长 | 馆长修改岩馆信息（名称/地址）不影响测试前缀 | owner → A_v → 编辑资料 | 改地址为「深圳南山高新区_v」→ 保存 | gym-detail 地址立即变新值；`RockGyms.name` 仍保持 `飞岩测试馆A_v`（_v 不丢） | [gym-manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/gym-manage/index.js) / [gym_owner_upsert/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/gym_owner_upsert/index.js) |
| TC-GYM-05 | 岩馆馆长 | 新建一期 RockGymCycles 周期 + 录线路 | owner → A_v → 「新建周期」 | 起=今天 止=+13 天，模式抱石，加 4 行 V1/V2/V3/V4（count=10,8,6,2） → 保存 | `RockGymCycles` 多一条，`cycleCount` +1 → 3；打卡页切到该周期时「线路」列表可看见新等级 | [gym-manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/gym-manage/index.js) / [gym_owner_upsert/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/gym_owner_upsert/index.js) |
| TC-GYM-06 | 岩馆馆长 | 管理员审核岩馆 | 登 test_user_5_v；工具箱→岩馆审核队列 | 点 list → 取第一条 review=approve，附原因 "测试通过_v" | RockGymReviewQueue[0].status 变 approved；RockGyms 对应 doc.status = approved（若当时是 pending） | [rock_gym_review_queue_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_gym_review_queue_manage/index.js) / [backstage/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/backstage/index.wxml) |

### C. 打卡域（TC-CK-01~09，含 🔶 08/09）

| ID | 模块 | 标题 | 前置条件 | 操作步骤 | 预期结果 | 关联文件路径 |
|---|---|---|---|---|---|---|
| TC-CK-01 | 打卡 | 进入打卡页上下文三表一致初始化 | A_v 已 seed；当前选了 A_v 馆/周期_v | 首页浮动「📌 今日打卡」| 三表：顶部进度环 = cycle.progress（来自 UserCycleProgress）；「今日」= DailyProgress；线路表行数 = RockGymCycles[cur].lines.length；全部不为 0 或至少无 NaN | [checkin/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/checkin/index.js) / [rock_checkin_context/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_checkin_context/index.js) |
| TC-CK-02 | 打卡 | 抱石计数 + 加减后提交 | 登 test_user_1_v；V2 行点「＋」三次 | 1) 打开打卡 A_v <br>2) V2 点 + 三次 → 减一次 → 剩余 2 <br>3) 点提交 | RockCheckinRecords openid=1v today 的 mode=boulder 有 {grade:V2,count:2,totalDelta:6}；UserDailyProgress.boulderCount +=2 /boulderDelta +=6 | [checkin/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/checkin/index.js) / [checkin_create/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/checkin_create/index.js) |
| TC-CK-03 | 打卡 | 难度计数 + 多线路混合提交 | 切 B_v 馆（mode difficulty 5.10a/5.11a） | 5.10a + 3；5.11a + 2 → 提交 | RockCheckinRecords.items 长度=2；两个 count 正确；totalDelta = 3*2 + 2*3 = 12 | [checkin/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/checkin/index.js) / [checkin_create/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/checkin_create/index.js) |
| TC-CK-04 | 打卡 | 同日二次打卡自动累加（不覆盖） | 同 TC-CK-02 刚跑完；当日未清缓存 | 再次打卡 V3 +2 → 提交 | RockUserDailyProgress.boulderCount = 2(上次) + 2 = 4；不是覆盖成 2；RockCheckinRecords 出现第二条独立记录（两条共存） | [checkin_create/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/checkin_create/index.js) |
| TC-CK-05 | 打卡 | 线路表里没有某个等级 → 输入兜底 `自定义等级` | 切换到一个仅 V0-V3 的空白周期，UI 有「＋自定义」 | 输入 V7，delta=7，count=1 → 提交 | 记录里 mode=boulder grade=V7；deltaPer=7；totalDelta=7 无报错 | [checkin/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/checkin/index.wxml) / [checkin_create/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/checkin_create/index.js) |
| TC-CK-06 | 打卡 | 全 0 点击提交 → 前端挡回（禁止空提交） | 未点任何＋ | 直接点底部「提交」 | 弹提示「至少选择一次线路」或按钮 disabled；RockCheckinRecords 无新增 | [checkin/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/checkin/index.js) |
| TC-CK-07 | 打卡 | 三表写入一致性（Records/DailyProgress/CycleProgress） | 登 1v，A_v，全新一天（0 点后或手动删今天记录） | 执行任意一次有效提交（V3+3） | `Records.dateKey=today` count=3 delta=12；`DailyProgress.openid=1v & dateKey=today` boulderCount=3 boulderDelta=12；`CycleProgress.openid=1v & cycleId=A_v_cur` 同样增量；三表完全对应 | [checkin_create/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/checkin_create/index.js) |
| TC-CK-08 | 打卡增强 | 🔶 功能待实现（F-2）：撤销最近 30 分钟内最后一条打卡 | — | 打完一次 V2+2 → 打卡成功页有「撤销」按钮；或设置里撤销 → 点它 | 三表 Records/DP/CP 回滚该条；cycleProgress 的 delta 与上次提交差值 = 本次撤销 delta；且老记录不会被误撤销（>30min 按钮 disabled） | [checkin_create/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/checkin_create/index.js)（**需加 action=revert_last**） |
| TC-CK-09 | 打卡增强 | 🔶 功能待实现（F-2）：30 分钟外的撤销被拒绝 | — | 提交 1 条打卡；手动改 createdAt 往前 1h → 按撤销 | 后端 fail("OUTSIDE_REVOCATION_WINDOW")；前端弹「时间已过，无法撤销」；三表不动 | [checkin_create/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/checkin_create/index.js)（**需加 action=revert_last + createdAt 窗口判断**） |

### D. 统计域（TC-ST-01~04）

| ID | 模块 | 标题 | 前置条件 | 操作步骤 | 预期结果 | 关联文件路径 |
|---|---|---|---|---|---|---|
| TC-ST-01 | 统计 | 最近 30 天图表不崩，折线能画出来 | 登 1v 且 A_v/14 天打卡 seed 已加载 | 切「我的日历」Tab → 滑到折线图区 | `lineChartMini` 组件完成 draw 后无报错；onCanvasRetry 次数 ≤ 4（hard constraint）；画布实际渲染有线条（不是全白） | [calendar-mine/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-mine/index.js) / [lineChartMini/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/components/lineChartMini/index.js) |
| TC-ST-02 | 统计 | 30 天完整性（seed + 提交新数据后刷新） | 同 01 后再打一次卡 | 回到 stats → 下拉刷新 | 今日那条柱 delta 值比刷新前增加 = 打卡 totalDelta；不是 0/NaN | [stats_summary/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/stats_summary/index.js) / [stats/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/stats/index.js) |
| TC-ST-03 | 统计 | 最近记录分页 next/prev | seed 有 ≥ 15 条 Records（实际有 20+） | Stats 页「最近记录」滑到底 → 下一页 → 上一页 | 第 1 页的最末一条（按时间早）是 page1.first；翻下一条后 ID 不重复；paginator 的 "第一页"按钮在回到第 1 页时 disabled | [stats/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/stats/index.js) / [pageState.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/utils/pageState.js) |
| TC-ST-04 | 统计 | topGym 字段 = 自己最近 30 天最多的那家馆 | 登 1v；seed 里 A_v Records 数 ≈ 7，B_v ≈ 3 | Stats 首屏顶部「最爱岩馆」卡 | 名称 = 飞岩测试馆A_v；次数 > B_v 次数 | [stats_summary/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/stats_summary/index.js) |

### E. 日历约爬域（TC-CAL-01~11，含 🔶 09/10/11）

| ID | 模块 | 标题 | 前置条件 | 操作步骤 | 预期结果 | 关联文件路径 |
|---|---|---|---|---|---|---|
| TC-CAL-01 | 日历约爬 | 首页日历 grid 14 天跨度 | 任意登录 | 打开首页 | `weekLabels` = 7 个；`dateCells.length` = 14（hard constraint）；首格 = 今天或昨天，末格 = 首 +13 | [home/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/home/index.js) / [calendar_query/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/calendar_query/index.js) |
| TC-CAL-02 | 日历约爬 | 三段 pill（公开 / 岩友 / 岩友圈）切换数据变化 | 登 1v；seed 有 3 条 public / friends | 点「公开」→ 切「岩友」→ 切「岩友圈」 | 切到「岩友」时只显示 2v、3v 的 plan（1v↔2v 1v↔3v 为已加），不显示 5v 馆长的；切「岩友圈」时出现 A_v 馆深圳抱石交流_v 圈筛选器 | [home/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/home/index.js) / [calendar_query/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/calendar_query/index.js) |
| TC-CAL-03 | 日历约爬 | 公开的日历 plan 成功发布 | 登 4v | 首页浮动「＋ 发布日历」→ 选今天 19:00-21:00 → 选 A_v → visibility=公开 → 填写 needPartner=true + 备注 | 发布成功；1v 首页「公开」Tab A_v 今日格子的「人数」+1 或 timeline 能看到 4v 的卡片 | [publish/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/publish/index.js) / [calendar_plan_publish/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/calendar_plan_publish/index.js) |
| TC-CAL-04 | 日历约爬 | 仅岩友可见的 plan 非岩友不可见 | 用 4v 发 visibility=friends；登不是 4v 岩友的 9v | 切「岩友」 pill → 今日 A_v 时间轴 | 4v 那条不出现；而 2v（岩友）出现；public 的仍在 | [calendar_query/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/calendar_query/index.js) |
| TC-CAL-05 | 日历约爬 | 我的日历汇总（我的发布 / 我报名的） | 登 1v；seed 有 2 条 1v 的 plan | 切 Tab 我的日历 → 顶部两段：我发布的 / 我参加的 | 「我发布的」数量与 RockCalendarPlans.openid=1v count 一致 | [calendar-mine/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-mine/index.js) / [calendar_mine/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/calendar_mine/index.js) |
| TC-CAL-06 | 日历约爬 | 日期格子 → 点进 timeline 展示时间顺序列表 | 有 A_v 今日 3 条 | 首页点今天格子 | timeline 页按 startAt ASC 排序；每条卡有岩馆 / 昵称 / 开始结束 / 好友圈标识 | [calendar-timeline/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-timeline/index.js) |
| TC-CAL-07 | 日历约爬 | 发布者「取消自己发布的」+ 取消后列表消失 | 登 1v → 发布一条 2h 后 plan | 日历mine → 我发布 → 长按卡片 → 取消 → 确认 | RockCalendarPlans._id.status = canceled 或 doc 删；首页 timeline / calendar-mine 不可见（或置灰 disabled） | [calendar_plan_publish/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/calendar_plan_publish/index.js)（action=cancel） |
| TC-CAL-08 | 日历约爬 | 请求 > 14 天 → 后端拒绝 & 前端自动截断 | 手动写参数 start=today-30 days end=today+30 days 直接调 `calendar_query` | 发请求 | 后端 fail("RANGE_TOO_LARGE") 或自动 clamp 到 14；最终返回 records 跨度 <= 14 | [calendar_query/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/calendar_query/index.js)（需要 14 天硬限判断） |
| TC-CAL-09 | 日历约爬 | 🔶 功能待实现（F-1）：岩友报名 plan / 取消报名 | — | 登 2v 看到 1v 的 public plan → timeline 右上「＋ 我要报名」按钮（位于"发布日历"/加好友之间）→ 点一下 → 再点一次取消 | 1）RockCalendarPlans[planId].joinedCount +1 / -1；2）报名者 2v 出现在 `我报名的`；3）重复点二次幂等不 +2 | [calendar_plan_publish/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/calendar_plan_publish/index.js)（**需加 join/unjoin 2 action**） / [calendar-timeline/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-timeline/index.wxml)（**需加报名按钮**） |
| TC-CAL-10 | 日历约爬 | 🔶 功能待实现（F-1）：发布者查看报名名单 | — | 1v 发一条 public plan → 用 2v/3v/4v 分别执行 TC-CAL-09 报名 → 1v 回到 plan → 点「查看报名人」按钮 | 弹名单页：2v/3v/4v 头像昵称全列；数量 = 3 = joinedCount；点击每一行可跳岩友详情 | [calendar_plan_publish/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/calendar_plan_publish/index.js)（**需加 get_joiners action**） / [calendar-mine/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-mine/index.js) |
| TC-CAL-11 | 日历约爬 | 🔶 功能待实现（F-1）：发布者移除某报名人 | — | 3v 已报名；1v 在名单页长按 3v → 移除 | 1v 这边名单消失 3v；3v 下一次刷新 calendar-mine 的「我报名的」不再有这条；joinedCount -1 | [calendar_plan_publish/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/calendar_plan_publish/index.js)（**需加 remove_joiner action**） |

### F. 岩友圈域（TC-F-01~12，含 🔶 10/11/12）

| ID | 模块 | 标题 | 前置条件 | 操作步骤 | 预期结果 | 关联文件路径 |
|---|---|---|---|---|---|---|
| TC-F-01 | 岩友圈 | 首页岩友圈列表+按当前馆过滤 | 选 A_v 馆 | 首页卡「共 2 个岩友圈」→「› 更多岩友圈」 | circle-list 页显示深圳抱石交流_v + 新手友好攀岩_v （2 个 A_v 馆相关）；不含北京难度约爬_v | [circle-list/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/circle-list/index.js) / [circle_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/circle_manage/index.js)（action=list） |
| TC-F-02 | 岩友圈 | 首页冗余入口已去除；用「岩友圈卡右上＋」正常建圈 | home 卡片区有「共 N 个」的 header 右＋ | 点 header 右＋→填 name=小范围测试圈_v；gys=[A_v]；desc=… | 创建成功：`RockCircles.name = 小范围测试圈_v`，创建者 admin；RockCircleMembers 当前用户 admin | [home/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/home/index.wxml)（**验证 2 个冗余入口已经删掉**） / [circle-edit/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/circle-edit/index.js) / [circle_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/circle_manage/index.js)（action=create） |
| TC-F-03 | 岩友圈 | 圈的申请→通过流程 | 当前登 5v（未入深圳抱石_v） | 详情 → 申请 → 填申请语「想加入_v」 → 再切回登 1v（是 admin） → 切「待处理」→ 通过 | RockCircleMembers status 从 pending → accepted；memberCount 增加 1（检查写回） | [circle-detail/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/circle-detail/index.js) / [circle_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/circle_manage/index.js)（action=apply / approve） |
| TC-F-04 | 岩友圈 | 拒绝申请 | 同 03 后半，但 1v 点「拒绝」 | RockCircleMembers 该行删除或 status=rejected；memberCount 不变 | [circle_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/circle_manage/index.js)（action=reject） |
| TC-F-05 | 岩友圈 | 圈成员列表 admin / member / pending 排序和角色徽标正确 | seed 有深圳抱石交流_v = 10 个成员（其中 7 accepted / 3 pending） | 点进深圳抱石圈 → 切「成员」Tab | 顶部前两位是 admin（攀岩小v…），后面按加入顺序；pending 3 人出现在另一个"待批准"区或带黄色徽标 | [circle-detail/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/circle-detail/index.wxml) / [circle_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/circle_manage/index.js)（action=getDetail） |
| TC-F-06 | 岩友圈 | admin 编辑圈信息（名字/颜色/头像色板/简介） | 登 1v → 深圳抱石_v → 右上 ⋯ → 编辑 | 改 description = "深圳抱石_v 更新描述" → 保存 | 回到详情立即变新描述；其他成员刷新详情也是新描述 | [circle-edit/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/circle-edit/index.js) / [circle_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/circle_manage/index.js)（action=update） |
| TC-F-07 | 岩友圈 | admin 踢人 | 1v admin → 成员 Tab → 长按 7v（普通 member）→ 踢出 | RockCircleMembers 删该行；memberCount 7（原 8 accepted - 1） | [circle_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/circle_manage/index.js)（action=remove / memberCount 写回） |
| TC-F-08 | 岩友圈 | 我主动退圈（非 admin 情况） | 登 7v → 深圳抱石_v → 右上⋯ → 退圈 | memberCount = 7 → 6；我这边列表里这个圈不显示「已在」 | [circle_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/circle_manage/index.js)（action=leave） |
| TC-F-09 | 岩友圈 | admin 解散圈（双确认 + 成员全部删） | 登 1v → 新手友好_v（member 很少）→ 解散 → 再次弹确认 → 是 | RockCircles _id 删 或 status=disbanded；所有 RockCircleMembers 行全删（disband 清理）；其他人下一次刷不再出现 | [circle_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/circle_manage/index.js)（action=disband） |
| TC-F-10 | 岩友圈 | 🔶 功能待实现（F-4）：圈成员发帖 / 图片文本 | — | 进入圈详情 → 底部 Tab 应存在「动态」→ 右上＋→ 写 30 字以内 + 1 张本地图 → 发布 | RockCirclePosts 新 doc（circleName + openid + content + images[] + createdAt）；动态列表顶部出现自己发的；自己有编辑/删除菜单 | [circle_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/circle_manage/index.js)（**需加 post_create / post_list / post_delete**） / [circle-detail/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/circle-detail/index.wxml)（**需加动态 Tab**） |
| TC-F-11 | 岩友圈 | 🔶 功能待实现（F-4）：非成员不可发圈帖、仅 admin 删任何人帖 | — | 1）登 5v 没进新手圈 → 尝试 post_create（直接调云函数）→ 应拒绝<br>2）2v 发一条 → 登 1v（admin）→ 删除 2v 的帖 | 1）4xx NO_MEMBER；<br>2）帖子从列表消失；RockCirclePosts 对应 doc 不存在或 status=deleted | [circle_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/circle_manage/index.js)（**需加权限校验**） |
| TC-F-12 | 岩友圈 | 🔶 功能待实现（F-4）：圈动态分页下拉刷新 | — | 循环发 25 条帖 → 打开动态列表 | 首屏 20 条；下拉到底后出现「加载更多」；点加载 more = 5 条；total = 25 | [circle-detail/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/circle-detail/index.js)（**需加分页状态**） |

### G. 名片域（TC-CD-01~12，含 🔶 11/12）

| ID | 模块 | 标题 | 前置条件 | 操作步骤 | 预期结果 | 关联文件路径 |
|---|---|---|---|---|---|---|
| TC-CD-01 | 名片 | 新建一张名片 → 正反面 → 保存成功 | 登 1v（credit.remaining ≥ 3） | 我页 → 顶部卡「编辑资料」旁边点「编辑名片」或直接点顶部名片预览图 → 填 title / level / oneLiner / styles | 提交后 RockCards 多 1 条 ownerOpenid=1v；返回图可以看背面（layout=classic 的格子） | [card-edit/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/card-edit/index.js) / [rock_card_upsert/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_upsert/index.js) |
| TC-CD-02 | 名片 | 保存名片到相册 / 生成分享图 | 完成 CD-01 | card-view 右上「⬇ 存相册」 | 有授权后弹「已保存」；canvas 绘制后 share_card_render 服务端生成的分享图正常（返回 fileID） | [card-view/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/card-view/index.js) / [share_card_render/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/share_card_render/index.js) |
| TC-CD-03 | 名片 | 灵感一句话生成（DeepSeek LLM）并填到输入框 | credit.remaining > 0 | 名片编辑 → oneLiner 输入框 → 点「✨ 灵感」按钮 | 1s~5s 返回中文一句话（6~15 字）；credit.remaining -1；若 credit=0 提示已用完 | [card-edit/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/card-edit/index.js) / [rock_llm_one_liner/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_llm_one_liner/index.js) |
| TC-CD-04 | 名片 | 多卡切换主卡（set_primary） | seed 中 1v/3v 各有 1 张名片；手动再创建 1v 的第 2 张 | 名片夹 → 选新的那张 → 右上 ⋯ → 设为主卡 | `RockCardCredits[1v].primaryCardId`（或 RockCards.isPrimary）更新；我页顶部卡的渲染变成新主卡；非主卡 `isPrimary=false` | [card-wallet/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/card-wallet/index.js) / [rock_card_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_manage/index.js)（action=set_primary） |
| TC-CD-05 | 名片 | 名片夹三段 Tab：我创建的 / 我收到的 / 上墙的 | 1v 有创 1 张，有收到 2v 直送的（需要先手动执行 CD-07），还有上墙 seed 的 | 切到名片夹 | 三段数量分别与 RockCards(owner=1v) / RockCardGifts(to=1v, status=claimed) / RockGymWallCards(owner=1v) 完全吻合 | [card-wallet/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/card-wallet/index.js) / [rock_card_list_my/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_list_my/index.js) |
| TC-CD-06 | 名片 | 创建赠链接型名片 | 1v 选主卡 → 右上 ⋯ → 生成赠送链接 | 生成 `giftLink` = 短 key + 卡片；RockCardGifts.status = pending；giftType = link | [card-gift/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/card-gift/index.js) / [rock_card_gift_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_gift_manage/index.js)（action=create_link） |
| TC-CD-07 | 名片 | 直送名片给岩友（2v → 1v） | 登 2v；选择主卡；选择直接赠送给岩友 1v | RockCardGifts 新一行；1v 收到系统通知 / 下次刷 wallet「我收到的」出现 待领取徽标 | [card-gift/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/card-gift/index.js) / [rock_card_gift_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_gift_manage/index.js)（action=create_direct） |
| TC-CD-08 | 名片 | 赠送链接并发幂等领取（2 人点同一链接 → 1 人得，另一人失败） | 生成 1 个 link；开 2 个 wx 登录 3v 和 4v 几乎同时点领取 | 第一个得：RockCards.owner 变 3v；gift.status = claimed；RockCardGifts.toOpenid = 3v；第二个失败：提示「名片已被他人领取」；gift 状态保持 claimed（不变回 pending） | [rock_card_gift_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_gift_manage/index.js)（action=claim 条件更新+回滚） |
| TC-CD-09 | 名片 | 取消已赠送（未领取的链接 / 未领取的直送） | 生成 CD-06 的 link；未被领取 | 赠出 Tab → 该卡片 → 取消 | gift.status=canceled；再点链接 → 提示「已被取消」 | [rock_card_gift_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_gift_manage/index.js)（action=cancel） |
| TC-CD-10 | 名片 | 上墙到指定岩馆 + 下墙 | 选 1v 的卡 → 上墙 → 选 A_v → 选择槽位 6 → 保存 | RockGymWallCards 新增行；刷新 `wall` 页 → 卡出现在第 6 格；再次下墙 → RockGymWallCards 该行删除 | [wall/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/wall/index.js) / [rock_gym_wall_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_gym_wall_manage/index.js)（action=hang / unhang） |
| TC-CD-11 | 名片 | 🔶 功能待实现（F-3）：删除自己创建的名片（未上墙且未赠） | — | 1v 新建一张卡 title=删不掉_v → 保存 → 再到卡详情 → 右上⋯ → 新项「删除名片」 | RockCards 该 doc 不存在；card-wallet「我创建的」数量 -1；若还在 gift 或 wall 则应先提示「请先下墙/取消赠送」再允许删 | [rock_card_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_manage/index.js)（**需加 action=remove_created**） |
| TC-CD-12 | 名片 | 🔶 功能待实现（F-3）：删除已上墙 / 已赠未领取的创建名片（级联下墙 & 取消赠） | — | 先执行挂墙（CD-10）；再点删除 → 弹「名片已上墙，删除会同时下墙并取消赠 → 确认」 | RockGymWallCards 对应行删；RockCardGifts（若赠 pending）status=canceled；最终 RockCards 行删 | [rock_card_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_manage/index.js)（**remove_created 级联 wall & gift 清理**） |

### H. 系统域（TC-SYS-01~05）

| ID | 模块 | 标题 | 前置条件 | 操作步骤 | 预期结果 | 关联文件路径 |
|---|---|---|---|---|---|---|
| TC-SYS-01 | 系统 | Tab 切换 L1/L2 缓存命中（重复访问不重请求） | 清缓存；第 1 次进首页；测完立刻切走再回来 | 1）第 1 次首页 → 产生 1 条 `calendar_query` 调用（看 Network）；<br>2）10s 内切 Tab 再回首页 → 无新 callCloud（读 L1 内存 Map TTL 60s） | [cache.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/utils/cache.js)（L1 Map + L2 wx.storageSync） / [services/cloud.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/services/cloud.js) |
| TC-SYS-02 | 系统 | 写操作后 cache.invalidate 前缀 → 下次读重新拉最新（例如打卡后图表值对） | 登 1v；记住「今日打卡数」before=X；再打 1 次卡 → 成功 | 回到 stats 立刻拉取 → X + 本次 totalDelta（写操作已 invalidate 该 keyPrefix，不会命中 stale） | [checkin_create/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/checkin_create/index.js) / [cache.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/utils/cache.js)（invalidate 调用点 ≥16） |
| TC-SYS-03 | 系统 | 云函数 fail code 返回 → 前端 showErrorModal 持久模态，点"知道了"才关 | 手动传错误参数（例如 circle_manage action=zzz） | 观察页面 | 出现模态框「操作失败」+ `error.code=BAD_ACTION` + 描述文本；不点确定遮罩不会自己消失 | [services/cloud.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/services/cloud.js)（`showErrorModal` 持久弹窗） |
| TC-SYS-04 | 系统 | WXML 所有 data-* 只传 ID，禁止传整个 `{{item}}`（避免大对象序列化溢出） | — | 全项目 grep `data-\w+="\{\{[a-zA-Z_]*item[a-zA-Z_]*\}\}"` （排除 data-id / data-cid 等） | grep 结果为空；若有就改 WXML 为传 `_id` 并在 JS 做 idMap 反查 | 全 `*.wxml`（本工程历史已通过 grep 检查） |
| TC-SYS-05 | 系统 | lineChartMini Canvas 2D 重试上限 ≤ 4 次 + 组件 detached 清定时器 | 模拟 canvas 连续 draw 失败（断网或 mock canvas.createImage() fail）→ 看日志 | 组件内部 `_retryLeft` 从 4 递减，到 0 后停止；离开页面触发 detached → `_destroyed=true` + `_retryT=null`；重试定时器不再存在（无内存泄漏） | [lineChartMini/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/components/lineChartMini/index.js#L21)（L21 _retryLeft=4, L32 detached） |

### I. 测试数据种子（TC-SEED-01~03）

| ID | 模块 | 标题 | 前置条件 | 操作步骤 | 预期结果 | 关联文件路径 |
|---|---|---|---|---|---|---|
| TC-SEED-01 | 种子 | action=seed 首次执行成功，插入约 80 条数据（_v 后缀） | 先执行 cleanup(confirm=true) 清旧；admin 登录 | 调 `wx.cloud.callFunction({name: "test_seed_data", data:{action:"seed"}})` | ok=true；inserted.batch1.Users=10；batch2= 2 GYM + 4 Cycle；batch3 Circles=3 Members≈23 Friendships≈3；batch4 全部 count 大于 0 | [test_seed_data/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/test_seed_data/index.js) |
| TC-SEED-02 | 种子 | seed 幂等：第二次 seed 返回 skip 而不是重复新增 | 直接再调一次 seed（不 cleanup） | 返回 mode="idempotent_skip"，note 里说检测到已有；DB count 保持不变（Users 还是 10） | [test_seed_data/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/test_seed_data/index.js)（existingUsers 判断） |
| TC-SEED-03 | 种子 | cleanup 双保险：不传 confirm=true → 只有预览；confirm=true 才真删除 | 已有数据；先 `action=cleanup` 不带 confirm | 第一步：返回 mode=preview_only + willDelete；DB 仍在；<br>第二步：`action=cleanup, confirm=true` → RockUsers 数量变回 0（仅_v的），真实用户（非_v后缀）完好无损 | [test_seed_data/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/test_seed_data/index.js)（confirm 强等 true 判断 + USER_REGEX 严格匹配） |

---

## 功能待实现清单（🔶 汇总，用户指派其他 Agent 实现）

| 编号 | 功能 | 关联用例 | 需改的云函数（新增 action） | 需改前端 |
|---|---|---|---|---|
| F-1 | 约爬计划报名 / 取消报名 / 查看名单 / 移除报名人 | TC-CAL-09 / 10 / 11 | calendar_plan_publish：join_plan / unjoin_plan / get_joiners / remove_joiner；calendar_query 返回 `joinedCount` / `meJoined` | [calendar-timeline/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-timeline/index.wxml) 报名按钮 + [calendar-mine/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-mine/index.js) 「我报名的」段落 |
| F-2 | 撤销最近 30 分钟的打卡（三表回滚） | TC-CK-08 / 09 | checkin_create：action=revert_last（30min 外拒绝） | [checkin/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/checkin/index.wxml) 提交成功页撤销按钮 |
| F-3 | 删除自己创建的名片（含级联下墙 / 取消赠） | TC-CD-11 / 12 | rock_card_manage：action=remove_created | [card-view/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/card-view/index.js) 删除菜单项 |
| F-4 | 岩友圈发帖 / 列表 / 删除 | TC-F-10 / 11 / 12 | circle_manage：post_create / post_list / post_delete + 新建集合 RockCirclePosts | [circle-detail/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/circle-detail/index.wxml) 新增「动态」Tab |

> 可选非阻塞建议（O-1 用户拉黑 / O-2 名片夹分页）已在 PROJECT_NOTES §14 记录，未加 TC。
