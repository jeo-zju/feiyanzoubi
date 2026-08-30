# 飞岩走壁系统架构文档

> v1.0 · 配套 README.md / PROJECT_NOTES.md / tests/e2e_test_cases.md 使用

---

## §1 总览：三层文字结构图

```
┌──────────────────────────────────────────────────────────────────────┐
│  前端（原生微信小程序） miniprogram/                                 │
│  ├─ app.js / app.json / app.wxss（启动 + TabBar + 全局样式收敛）     │
│  ├─ pages/  33 个页面                                               │
│  │    ├─ 3 TabBar: home / calendar-mine / me                        │
│  │    ├─ 5 打卡/统计: checkin / stats / timeline / publish / mine   │
│  │    ├─ 8 岩馆/馆长: gym-* / owner 系列                             │
│  │    ├─ 10 名片/墙/赠送: card-edit / view / wallet / gift / wall   │
│  │    ├─ 6 圈/好友: circle-* / friend-* / profile-edit              │
│  │    └─ 1 工具箱: backstage / debug-logs                           │
│  ├─ components/ lineChartMini / paginator / 等（无业务状态）         │
│  ├─ services/cloud.js（callCloud 统一封装：traceId/解包/持久弹窗）  │
│  ├─ services/api/ 按业务域 10 个代理（user/calendar/checkin/gym…）  │
│  └─ utils/ cache/session/date/cardCanvas/cardRenderer/pageState     │
├──────────────────────────────────────────────────────────────────────┤
│  调用协议：wx.cloud.callFunction → 云函数统一响应                    │
│         { ok: bool, data?: any, error?: {code,msg}, traceId }       │
├──────────────────────────────────────────────────────────────────────┤
│  后端（微信云函数） cloudfunctions/  28 个已引用                      │
│  9 业务域 → 见 §2 映射表                                             │
├──────────────────────────────────────────────────────────────────────┤
│  数据层（微信云数据库） 20 个集合 + 2 个未来新增（F-2/F-4）           │
│  + 微信云存储（头像上传 / 名片分享图 / 上墙图 / 圈帖图）              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## §2 九业务域 → 云函数 action 映射表

| 域 | 云函数名(28) | 对外 action（不包含内部辅助）| 负责页面 |
|---|---|---|---|
| ① 用户 | `user_manage` | login / me / update | me / profile-edit |
| ② 好友 | `friendship_manage` | request / accept / reject / remove / search | friend-list / friend-detail |
| ③ 岩馆列表 | `rock_gym_list` / `rock_gym_get` | —（按查询参数） | home / gym-detail |
| ④ 馆长后台 | `gym_owner_list` / `gym_owner_upsert` / `gym_owner_manage` / `rock_gym_hardness_upsert` / `rock_gym_review_queue_manage` | list 查 / upsert(馆+周期+线路) / manage(合并/删除/转交) / hardness / list_review / approve | owner / gym-manage / gym-merge / backstage |
| ⑤ 打卡 & 上下文 | `rock_checkin_context` / `checkin_create` | context / create（**缺 F-2: revert_last**） | checkin |
| ⑥ 日历约爬 | `calendar_query` / `calendar_mine` / `calendar_plan_publish` | 范围查询 / mine 汇总 / create+update+cancel（**缺 F-1: join/unjoin/get_joiners/remove_joiner**） | home / calendar-mine / calendar-timeline / publish |
| ⑦ 岩友圈 | `circle_manage` | create / update / disband / list / myList / getDetail / apply / approve / reject / remove / leave（**缺 F-4: post_create/post_list/post_delete**） | circle-list / circle-edit / circle-detail / home |
| ⑧ 名片 + 墙 + 分享 | `rock_card_upsert` / `get` / `list_my` / `manage` / `gift_manage` / `wall_manage` / `share_card_render` / `rock_llm_one_liner` | upsert / get / list_my / set_primary+remove_received（**缺 F-3: remove_created**） / create_link+create_direct+get+claim+cancel / hang+unhang+list_cards / 灵感一句话 | card-edit / card-view / card-wallet / card-gift / wall / backstage |
| ⑨ 统计 & 工具箱 | `stats_summary` / `admin_manage` / `rock_sync_gyms` | summary 图表+分页 / health+listUsers+authDebug+docBackup / sync | stats / backstage / debug-logs |
| ➕ 测试专用（独立域）| `test_seed_data` | seed / cleanup(confirm=true) / status | — |

---

## §3 三条核心数据流（一致性关键点）

### 3.1 数据流 1：打卡三表累加写入（Records → DailyProgress → CycleProgress）
```
 用户点提交
    ↓
 checkin_create/index.js
    1. 构造 RockCheckinRecords 明细（items: [{grade,count,deltaPer,totalDelta}]）
    2. 同一 openid+dateKey → RockUserDailyProgress boulderCount/boulderDelta 累加（inc）
    3. 同一 openid+cycleId   → RockUserCycleProgress 同上累加
    4. 三步任一失败返回 fail，已成功的 inc 不会回滚（非强事务）
    ↓ ✅ 三表一致的 TC = tests/e2e_test_cases.md TC-CK-07
```

### 3.2 数据流 2：名片领取条件更新 + 失败回滚（防并发重复领取）
```
  岩友点「领取」gift_link
      ↓
  rock_card_gift_manage action=claim
      1. where {_id=giftId, status=pending} → update → claimed & toOpenid = 我的openid（原子条件更新，只 1 人通过）
      2. where {_id=cardId, ownerOpenid 为空} → update 归属（条件更新）
      3. 若卡片归属更新失败（例如被他人抢先完成） → 把 gift.status 从 claimed **回滚** pending（缩小脏读窗口）
      4. 返回结果：第 1 人 ok；第 2 人 fail(GIFT_CLAIMED)
      ↓ ✅ TC-CD-08（2 人并发领取 → 一人得）
```

### 3.3 数据流 3：岩友圈成员数 memberCount 写回 6 触发点
```
  成员变化动作（6 个）
     ├ approve（通过申请）  ↑ +1
     ├ reject（拒绝）         不变
     ├ remove（管理员踢人） ↓ -1
     ├ leave（自己退）      ↓ -1
     ├ apply（申请）         → pendingCount 写回
     └ disband（解散）        → Circles 表整个删除 or status=disbanded
     ↓
  每个 action 尾部必须 RockCircles.doc(id).update({ memberCount: _.inc(x), pendingCount: _.inc(y) })
  ↓ ✅ 验收：TC-F-03/04/07/08/09 分别校验 memberCount 写回
```

---

## §4 前端目录五层分工
```
miniprogram/
├─ app.js / app.json / app.wxss         入口 + 注册页 + TabBar + 收敛视觉样式
├─ pages/                               业务页面（不跨页共享 state；共享走 app.globalData.user + cache.js）
├─ components/                          纯组件（Props → 渲染；不直接读云函数）：lineChartMini / paginator
├─ services/
│  ├─ cloud.js                          callCloud 统一封装（traceId / mask loading / 解包 / showErrorModal）
│  └─ api/*.js                          10 个按业务域薄包装：不写 if/else，不拼 WX 组件
└─ utils/
   ├─ cache.js                          ★ 两级缓存：L1 Map TTL 60s / L2 storageSync TTL 600s
   ├─ session.js                        ensureAppLogin / syncAppLogin 登录态兜底
   ├─ cardCanvas.js + cardRenderer.js   名片正反面绘制共用
   ├─ pageState.js                      home/stats/owner 三页分页/加载态
   ├─ date.js / format.js / window.js   纯函数工具
```

---

## §5 ER 关系（20 + 2 未来集合）
```
RockUsers 1 ─── n RockCheckinRecords（openid）
RockUsers 1 ─── n RockUserDailyProgress（openid+dateKey）
RockUsers 1 ─── n RockUserCycleProgress（openid+cycleId）
RockUsers 1 ─── 1 RockCardCredits（额度）
RockUsers 1 ─── n RockCards ownerOpenid
RockUsers n ⇄──⇄ n RockUsers：RockFriendships（fromOpenid+toOpenid，status=accepted/rejected/pending）

RockGyms 1 ─── n RockGymCycles（馆→多期线路周期）
RockGymCycles 1 ─── n RockCheckinRecords（cycleId）
RockGyms 1 ─── n RockGymWallCards（槽位挂名片）
RockCards 1 ─── n RockGymWallCards（cardId）
RockCards 1 ─── n RockCardGifts（from:link/direct）→ RockCardGifts.status=pending/claimed/canceled
RockCardGifts.n.claimed.card → 1 RockCards.ownerOpenid（归属转移）

RockCircles n ⇄──⇄ n RockUsers：RockCircleMembers（role=admin/member, status=accepted/pending/rejected）
RockGyms n ⇄──⇄ n RockCircles：circle.gymIds[]
RockCalendarPlans.n ←── 1 RockUsers（发布者 openid）；RockCalendarPlans 1 → 1 RockGyms
RockCirclePosts n ─── 1 RockCircles（**F-4 未来新增**）：circleName + openid + content + images[]
RockCheckinRevocationLog（**F-2 未来新增**）：撤销审计 log

（后台） RockGymReviewQueue / RockGymSyncRuns / RockGymSourceRecords → 馆长审核/合并工具
```

---

## §6 六条硬约束（Hard Constraints）

| # | 硬约束 | 落地点 |
|---|---|---|
| HC-01 | **日历 14 天跨度硬限**。前端传参超出自动 clamp；后端 cloudfunction 请求 14+ 直接 RANGE_TOO_LARGE | calendar_query / calendar_mine / calendar_plan_publish；TC-CAL-08 |
| HC-02 | **WXML dataset 只传 ID**，禁止 `data-item="{{item}}"`；反查在 JS 用 Map | 全 `*.wxml`；TC-SYS-04 grep 检查 |
| HC-03 | **Canvas 重试上限 = 4 次 × 220ms**；组件 detached 清 `_retryT` 并置 `_destroyed=true` 防止内存泄漏 | components/lineChartMini/index.js；TC-SYS-05 |
| HC-04 | **两级缓存 + 写前 invalidate**：所有写操作成功回调之前必须 `cache.invalidate(keyPrefix)` | cache.js；TC-SYS-01/02 |
| HC-05 | **onShow 并发作废锁**：home / calendar-mine / me 的 onShow 首行设 `_onShowRunning=true`，执行完清掉；防止 Tab 快速切换重复触发 | 三个 TabBar 页 |
| HC-06 | **云函数响应统一协议** `{ ok, data?, error?:{code,message}, traceId }`；前端 callCloud 不解析任何其它字段 | services/cloud.js；**28+1 云函数入口尾部 ok() / fail()** |

---

## §7 统一响应协议（callCloud + 云函数双向）
```
✓ 成功：
{
  ok: true,
  data: <任意结构>,
  traceId: "<ms>_<rand>"
}

✗ 失败：
{
  ok: false,
  error: {
    code: "BAD_ACTION" | "NO_PERMISSION" | "GIFT_CLAIMED" | "RANGE_TOO_LARGE" | "OUTSIDE_REVOCATION_WINDOW" | "INTERNAL_ERROR" | ... ,
    message: "中文可读描述"
  },
  traceId: "<ms>_<rand>"
}
```
前端 services/cloud.js 统一做：`wx.showLoading({mask:true})` → `wx.cloud.callFunction` → `!res.ok` → `showErrorModal`（点确定才消失，持久）→ `wx.hideLoading` + console 打印 `traceId` + duration。

---

## §8 外部依赖与环境变量

| 服务 | 环境变量 | 用途 |
|---|---|---|
| DeepSeek OpenAI 兼容（默认） | `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 名片灵感一句话生成 cloudfunctions/rock_llm_one_liner |
| OpenAI（fallback） | `OPENAI_API_KEY` / `BASE_URL` / `MODEL` | 同上，兼容老配置 |
| 微信云开发 | 自动（wx-server-sdk DYNAMIC_CURRENT_ENV）| DB/Storage/CloudFunction 三端 |

> 参考：PROJECT_NOTES.md §5 硬约束记录；§14 Backlog F-1~F-4 缺失功能清单
