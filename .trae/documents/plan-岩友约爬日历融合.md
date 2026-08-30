# 计划：岩友约爬日历功能融合

## Summary
将截图中的"岩友约爬日历"核心功能（日历查询、岩友时间轴、发布日历、我的日历 Tab、个人中心升级）融入现有"飞岩走壁"小程序。**风格保持深色主题（#0B0D15 背景 + #7C6EE6 紫 + #E6C76A 黄）**，不照搬参考的米白+绿色配色。

---

## 一、Repo Research Conclusion（基于仓库现状）

### 1.1 现有 TabBar 与页面结构
- 当前 TabBar：**首页（岩馆搜索） / 统计 / 我的**，共 3 个 tab
  - [app.json](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/app.json#L41-L66)
- 已有能力：岩馆列表搜索、打卡、名片、名片夹、攀岩墙、礼物系统、credit 额度

### 1.2 设计风格（严格保持）
- 背景：`#0B0D15`（近黑）
- 主强调：紫 `#8F7BFF` / `#7C6EE6`（低饱和）
- 次强调：黄 `#F2C14E` / `#E6C76A`（低饱和）
- 文字主色：`#E7E9F3`（米白），辅助 `rgba(231,233,243,0.6)`
- 卡片：`rgba(255,255,255,0.06)` 背景 + `rgba(255,255,255,0.08)` 边框 + 20rpx 圆角
  - 参考 [app.wxss](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/app.wxss#L13-L18)

### 1.3 现有云函数约定
- 返回结构 `{ ok: true, data, traceId }`，错误通过 `error.code + error.message` 表达
- 小程序端统一用 `callCloud(name, data)` 调用并打 debug 日志
  - [cloud.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/services/cloud.js)

### 1.4 已有数据集合（无需重建）
- `RockGyms` / `RockUsers` / `RockCheckinRecords`：直接复用
- `RockCards` / `RockCardGifts`：已存在，用于"礼物墙"和"名片"部分，不重复造轮子

---

## 二、参考功能拆解（截图 5 张 → 映射到我们的结构）

| 截图页面 | 核心功能 | 在我们程序中的落点 |
|---|---|---|
| ① 日历查询首页 | 城市+未来14天日历+人数热度+岩馆筛选+公开/岩友切换+底部双按钮 | **新 Tab1「约爬」**（替换原"首页"的单纯搜索） |
| ② 岩友时间轴 | 按日期进入→岩友横向头像+Gantt 风格时间条+智能匹配/筛选/排序 | **新页面 `pages/calendar-timeline/index`** |
| ③ 发布日历 | 岩馆搜索→日期→时间段（带时长）→公开/仅岩友→高级选项 | **新页面 `pages/calendar-publish/index`** |
| ④ 我的页（礼物/攀岩墙/足迹Tab） | 头像+昵称+等级Tag（抱石/顶绳/先锋）+礼物墙网格+侧边抽屉 | **升级 Tab3「我的」**，扩展现有结构 |
| ⑤ 侧边抽屉菜单 | 礼物/岩友/设置/反馈 | **新增抽屉组件**，嵌入"我的"页左上角 |

另外参考底部 Tab：**日历查询 / 我的日历 / 我**
→ 我们调整为 **约爬 / 我的日历 / 我的**（3 Tab，保持与现有 tab 数量一致，将"统计"合并进"我的日历"顶部）

---

## 三、TabBar 改造方案

### 3.1 新 TabBar（3 项不变，替换文案/图标/页面路径）

| Tab | pagePath | 文字 | 图标说明 |
|---|---|---|---|
| 1 | `pages/home/index` | **约爬** | 原首页图标，选中用紫色/黄色 |
| 2 | `pages/calendar-mine/index` | **我的日历** | 新图标（日历样式），替换原"统计" |
| 3 | `pages/me/index` | **我的** | 保持不变 |

> 原"统计"能力合并到 Tab2「我的日历」顶部，作为概览卡片，不丢失功能。

---

## 四、数据模型（新增集合 & 扩展 RockUsers）

### 4.1 RockCalendarPlans（攀岩日程计划，核心集合）
每条记录代表一个用户在某岩馆/野攀点的某时间段计划

| 字段 | 类型 | 说明 |
|---|---|---|
| `_openid` / `uid` | string | 发布者（系统自动） |
| `userSnapshot` | object | 冗余：`{ nickName, avatarUrl, displayName, title }`，来自 RockCards 主名片，避免 join |
| `gymId` | string | 岩馆 ID（岩馆模式必填；野攀模式为空） |
| `gymSnapshot` | object | 冗余：`{ name, city, address }` |
| `mode` | `"gym"` \| `"outdoor"` | 岩馆 / 野攀 |
| `outdoorName` | string | 野攀模式下的地点名 |
| `date` | string | `YYYY-MM-DD` |
| `startTime` | string | `HH:mm`，如 `"19:00"` |
| `endTime` | string | `HH:mm`，如 `"21:00"` |
| `durationMin` | number | 分钟数，用于校验与排序 |
| `visibility` | `"public"` \| `"friends"` | 公开 / 仅岩友可见 |
| `note` | string | 备注（高级选项） |
| `needPartner` | boolean | 是否求搭子（高级选项） |
| `skillTags` | string[] | 求搭子的能力偏好，如 `["boulder_v3", "lead_5.10"]` |
| `status` | `"active"` \| `"cancelled"` \| `"done"` | 状态 |
| `checkinRecordId` | string | 如用户事后打卡，关联 RockCheckinRecords._id，方便在时间轴展示"已打卡"徽标 |
| `createdAt` / `updatedAt` | number | `Date.now()` |
| `created_at` / `updated_at` | serverDate | 与现有集合一致 |

### 4.2 RockFriendships（岩友关系，复用/扩展现有）
检查现有 `friendship_manage` 云函数，确认是否已有集合。如已有 `RockFriendships`，直接复用；没有就新建。

| 字段 | 类型 | 说明 |
|---|---|---|
| `fromOpenid` | string | 发起方 |
| `toOpenid` | string | 接收方 |
| `status` | `"pending"` \| `"accepted"` \| `"rejected"` \| `"blocked"` |
| `createdAt` / `acceptedAt` | number | 时间戳 |

> 用于"公开日历 / 我的岩友"筛选逻辑：`visibility=friends` 仅双向 accepted 可见。

### 4.3 RockUsers 扩展（3 个字段）
在现有用户资料上追加，不破坏老数据：

| 新增字段 | 类型 | 说明 |
|---|---|---|
| `climbSkills` | object | `{ boulder: "V3", lead: "5.10a", difficulty: "5.9", protector: true }`，boulder/lead/difficulty 留空表示未填；protector=true 表示会保护 |
| `city` | string | 常居城市，用于日历查询默认城市 |
| `giftWall` | array | 已收到的礼物 ID 列表，最多 10 个（简化礼物墙实现，从已有 RockCardGifts 聚合也可，可选字段） |

---

## 五、云函数（新增 4 个 + 扩展 1 个现有）

> 均放在 `cloudfunctions/` 目录，遵循现有"入口校验 → 业务 → 返回 `{ ok, data, traceId }`"模式。

### 5.1 calendar_plan_publish（发布/取消计划）
```
入参：{ planId?, action: "create"|"update"|"cancel", payload: {...} }
校验：
  - date 必须是未来 14 天内（或允许今天，发布后不能改已过期的）
  - startTime < endTime，时长 ≥ 30min，≤ 12h
  - gymId 必填（mode=gym 时）且 RockGyms 存在
  - visibility ∈ public|friends
行为：
  - create：新增 RockCalendarPlans，返回 planId
  - update：仅本人 & status=active 可改；改 date/time/gym/visibility
  - cancel：仅本人；status=cancelled，时间轴不展示（或标灰色取消）
返回：{ planId }
```

### 5.2 calendar_query（日历查询 + 时间轴查询 二合一）
```
入参：{ mode: "calendar"|"timeline", ... }
  - mode=calendar：
      { city?, gymId?, visibility: "public"|"friends", startDate, endDate（最多14天） }
    返回：
      {
        dateAgg: [
          { date: "2026-08-29", total: 19, gymIdCount: { gym1: 8, gym2: 6 }, friendCount: 3 },
          ...
        ]
      }
      // 用于小圆点颜色：total 0=灰, 1-3=浅紫, 4-9=紫, 10+=深紫
      // （参考截图的人少-人多配色，换成我们的紫系渐变）
  - mode=timeline：
      { date, city?, gymId?, visibility, sortBy: "time"|"match", filterGymId?, onlyFriends? }
    返回：
      {
        plans: [ plan对象（含userSnapshot、gymSnapshot） ],
        userList: [ // 去重的岩友列表，用于顶部头像横排
          { _openid, nickName, avatarUrl, displayName, title }
        ]
      }
性能要点：
  - 按 (date, gymId) 建索引；14 天聚合一次读控制在 100 条内
```

### 5.3 calendar_mine（我的日历 + 统计概览 合并）
```
入参：{ range: "upcoming"|"past"|"all", page, pageSize }
返回：
  {
    upcoming: [ 未来 N 条计划（含日期+岩馆+状态） ],
    past:     [ 过去 N 条（含是否已打卡） ],
    summary: {
      thisMonthPlans: number,     // 本月发布计划次数
      thisMonthCheckinRate: 0.72, // 已打卡 / 已过期计划
      topGym: { name, count },    // 最常去岩馆
      totalPartners: number       // 一起爬过的岩友数（按同时间段同馆计算）
    }
  }
// "统计" tab 的原有 lineChart 数据也挂在 summary 下：summary.chartPoints，复用 stats 页组件
```

### 5.4 friendship_manage（已存在 → 扩展 action）
现有 [friendship_manage](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/friendship_manage/)。
补齐 / 新增 action：
- `action="list"`：我的岩友（accepted）+ 我发起的 pending + 他人发起的 pending
- `action="request"`：发起好友申请（通过昵称搜索 or 岩友ID，ID 直接用 openid 末尾 6 位 hash，展示用）
- `action="accept"` / `"reject"`：处理申请
- `action="remove"`：删除岩友

### 5.5 rock_init（扩展）
把新增集合 `RockCalendarPlans` / `RockFriendships`（如不存在）列入自检清单。

---

## 六、小程序端：页面级改造清单

### 6.1 Tab1：`pages/home/index`（约爬日历查询首页）
**替换现有纯岩馆搜索页**，布局自上而下（严格单屏思维，内容紧凑）：

1. **顶部栏**：城市胶囊按钮（左侧） + 标题 "哪天去爬？" + 通知铃铛（右上角，红点代表岩友新申请/新计划发布）
2. **分段切换**：`岩馆 / 野攀` — 使用现有组件 [segmentedTabs](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/components/segmentedTabs/)
3. **日历卡片（核心）**：
   - 标题：`"2026年8月 → 9月 · 未来14天"`
   - 右上方：人数热度图例（4 个圆点：灰 / 浅紫 / 紫 / 深紫 → 对应人少→人多）
   - 7×2 日期网格：每格显示 `日期` + `人数`（19人、7人…），今天加黄色边框高亮
   - **点击某日期 → 跳 timeline 页**
4. **岩馆筛选器**：
   - 左侧小图标 + 文字：`全部岩馆 ▾`，点击弹 actionSheet 选岩馆
5. **可见性切换**：`公开日历 / 我的岩友` — segmentedTabs 组件
6. **底部固定双按钮（浮层，不随内容滚）**：
   - 左：`今日打卡` → 空心按钮（`btn-ghost`），跳选择岩馆→打卡
   - 右：`+ 发布日历` → 实心紫色（`btn-primary`），跳发布页

样式：参考 [home/index.wxss](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/home/index.wxss)，卡片用 `.card`，按钮走全局 `.btn`。

### 6.2 新页面：`pages/calendar-timeline/index`（岩友时间轴）
入参：`?date=2026-08-29&gymId=&visibility=public`

布局：
1. **顶栏返回 + 日期标题**（`8月29日 · 周六`）+ 右 `+ 发布日历` 小按钮
2. **面包屑**：`上海 · 全部岩馆 · 公开日历`（点击可切换）
3. **筛选横条**（可横向滚动的 pill）：`筛选 ▸` `智能匹配 ⚡` `公开日历 ✓` `排序 ▾`
4. **岩友头像横排**：scroll-view，头像圆形 + 昵称下挂，点击可定位到该岩友的时间段
5. **时间轴（核心）**：
   - 左侧时间刻度列：10:00 / 11:00 … 22:00（每格 1h）
   - 右侧按岩友分 5 列（超过 5 人横向滚动）
   - 每人的时间段 → 一个带圆角的彩色竖条：
     - 颜色按人分配（从 8 色深色调色板循环取：`#7C6EE6, #E6C76A, #5B8DEF, #F28B94, #59C3A7, #C58BF0, #F7A35D, #8FC86F`）
     - 条内显示：`13:00-22:00` + 岩馆名（两行，字小 20-22rpx）
   - 点击条 → 弹层显示该计划详情 + `查看TA的名片` + `加为岩友`（如非好友）
6. **智能匹配**（点按钮开启）：
   - 按"我的 climbSkills 与对方 climbSkills 交集 + 时间段重叠度 + 同岩馆"打分，降序排
   - 顶部加一个小提示：`已为你找到 5 位最合适的搭子 ⚡`

### 6.3 新页面：`pages/calendar-publish/index`（发布日历）
布局：
1. **返回 + 顶部城市**（左上角，可切换）
2. **岩馆搜索**：输入框 → 实时模糊匹配（复用 gym list API）
3. **日期选择**：未来 14 天网格，单选；已选日期加红色对勾圈
4. **时间段选择器**（创新交互，参考截图）：
   - 上下两行淡灰时间参考（`18:30 / 19:30 …`、`20:30 / 21:30`）
   - 中间是高亮的浅紫选择条：`19:00  —  21:00`
   - 左右端点可拖动（用 slider 组件模拟，或简化为"起始时间 picker + 时长 picker"组合，保证体感快）
   - 右上显示：`已选择 2 小时`（tag-warn 样式）
5. **可见性**：`公开发布 / 对我的岩友发布`（segmentedTabs）
6. **高级选项**（折叠行，点击展开）：
   - 备注输入框
   - "求搭子"开关（开 → 再选能力偏好 tag：抱石 V2-V4 / 顶绳 5.9-5.11 / 需要保护员 …）
7. **底部大按钮**：`发布日历`（紫色实心，点击前校验必填；成功后返回上一页并 toast "已发布，等岩友找上门 🧗"）

### 6.4 Tab2 新页面：`pages/calendar-mine/index`（我的日历）
替换原 `pages/stats/index` tab，顶部合并统计概览。

布局：
1. **Hero 卡（card-hero）**：
   - Section kicker：`本月`
   - Section title-lg：`我本月发布了 8 次计划`
   - Section desc：`去了 3 家岩馆，和 5 位岩友同场过`
   - 下方是 14 天 mini 线图（复用 `lineChartMini` 组件）
2. **3 个小统计卡（stat-grid）**：
   - 打卡率 `72%` / 最常去 `攀岩工厂` / 搭子数 `5`
3. **分段切换**：`即将到来 / 历史记录`
4. **计划列表**：
   - 每行：日期星期 + 时间段 + 岩馆名 + 状态胶囊（`已完成 ✓` 黄 / `待赴约` 紫 / `已取消` 灰）
   - 点击某行 → 进入 timeline 页（或详情弹层，看交互复杂度）
   - 即将到来的可加一个"提醒我"开关（订阅消息，后续可接）

### 6.5 Tab3：`pages/me/index`（我的页 — 重大升级）
参考截图的"个人中心 + 礼物/攀岩墙/足迹 Tab + 左上角抽屉"：

**改造点（对照现有 [me/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/me/index.wxml)）：**

1. **左上角新增抽屉按钮**：三条横线图标，点击 → 抽屉从左滑出（300rpx 宽）
   - 抽屉内容：
     - 顶部：圆形"岩"头像 + `请完善资料` + 岩友ID（短 hash）
     - 分组「礼物」：可赠送的礼物 / 收到的礼物 / 送出的礼物（→ 对应现有 card-wallet 等）
     - 分组「岩友」：岩友与群组（→ 好友列表页，需新建 `pages/friend-list/index`）
     - 分组「设置」：设置 / 问题反馈
2. **头部区域替换**：
   - 上方保留"点击编辑资料"入口
   - 下方新增一行能力胶囊：`抱石 V3` `顶绳 5.10a` `先锋 未填`（缺的标签加灰色"未填"）
   - 再下一行小字：`保护技能 ✓ 会保护` 或 `保护技能 未填写`（点都能进 profile-edit 里的新增技能编辑区）
3. **我的名片区（保留）**：现有的翻转名片展示 + 编辑/送人/保存 保持不动
4. **分段切换（新增，代替 glance-grid 位置）**：`礼物 / 攀岩墙 / 足迹`
   - Tab「礼物」：礼物墙网格（4×3），未获得的灰色占位图标，已有礼物点亮显示。底部提示："发布一次攀岩计划，收下第一份礼物，它会被钉到你的墙上"
   - Tab「攀岩墙」：直接复用现有 `pages/wall/index` 的列表组件（或跳转入口，本期简化为卡片入口）
   - Tab「足迹」：14 天打卡热力小方格（紫色深浅对应次数，0=灰空、1=浅、3+=深）+ 来访 X 家岩馆
5. **底部快启（保留）**：馆长 / 工具箱 保持不动

> 补充页面：`pages/friend-list/index`（简单列表：待处理申请 / 我的岩友 / 搜索加好友）

### 6.6 新页面：`pages/profile-edit/index`（扩展能力编辑区）
在现有资料编辑页底部追加：
- 攀岩能力分组：
  - 抱石等级：Picker（空、V0-V10）
  - 顶绳难度：Picker（空、5.6-5.14d）
  - 先锋难度：Picker（同上）
  - 保护技能：Switch（会保护 / 不会）
- 常居城市：City Picker（用于约爬日历默认城市）

---

## 七、API 层封装（新增文件）

新增：
- `miniprogram/services/api/calendar.js`
  ```js
  publish({ planId?, action, payload })      // calendar_plan_publish
  queryCalendar({ city, gymId, visibility, startDate, endDate }) // calendar_query mode=calendar
  queryTimeline({ date, ...filters })         // calendar_query mode=timeline
  mine({ range, page, pageSize })             // calendar_mine
  ```
- `miniprogram/services/api/friendship.js`
  ```js
  list()
  request({ toOpenid })
  accept({ fromOpenid })
  reject({ fromOpenid })
  remove({ openid })
  search({ keyword }) // 按昵称/岩友ID搜
  ```

---

## 八、视觉转换规则（参考配色 → 我们的配色）

| 参考元素的颜色 | 我们替换为 |
|---|---|
| 浅米白背景 `#FAF8F2` | 不变：全局 `#0B0D15` |
| 薄荷绿主按钮 `#0D6B4C` / `#4CA984` | 紫色主按钮 `#8F7BFF`（文字 `#0B0D15`） |
| 淡绿色选中态 | `rgba(143,123,255,0.18)` + 紫色边 |
| 橙色时间段条 | 调色板 8 色循环（见 §6.2），首色紫、次色黄 |
| 绿色小圆点（人多） | 紫色系渐变：无→灰→浅紫 `rgba(143,123,255,0.3)`→`#7C6EE6`→深紫 `#5C4ED1` |
| 黄色已选勾 | 直接用我们的黄 `#F2C14E`，完美契合 |

交互细节继承项目风格偏好：
- 小字提示用 20-22rpx、`rgba(231,233,243,0.6)`
- 分段 tab 切换无动画延迟（立即 setData，乐观更新）
- 日历人数和时间轴颜色先本地缓存上次结果，刷新时先显示旧值再覆写→体感快

---

## 九、潜在依赖 & 风险处理

| 风险 | 处理 |
|---|---|
| 时间轴列太多（>5 人）横向滚动手感差 | 限制首次渲染 12 人；更多的"加载更多"按钮追加 |
| 日历查询 14 天 × 多岩馆 → DB 读压力 | 加组合索引 `(date, gymId)`；结果按天 cache 60s（云函数里用一个小集合 RockCalendarCache 存 hash） |
| "野攀"模式缺少 POI 数据 | V1 只做：手动输入 outdoorName + 城市；不接地图选点（后续迭代） |
| 岩友关系如果现 friendship_manage 实现不完善 | 先按 §4.2 新建 / 重写这个云函数，保持 action 名和现有调用不冲突 |
| 订阅消息（提醒我） | V1 不接真推送，只做本地 `wx.setStorage` + 进入小程序时 check 弹 toast |

---

## 十、Verification（实施后自测步骤）

### 日历查询
- [ ] 切换城市 → 未来 14 天人数热度正确按城市聚合
- [ ] 切换"公开日历/我的岩友" → 我的岩友筛选下只显示岩友（双向 accepted）的计划
- [ ] 选某岩馆 → 人数只算该岩馆
- [ ] 点击任意有计划的日期 → 跳到 timeline 并加载正确计划

### 发布日历
- [ ] 发布一条公开的、19:00-21:00、指定岩馆的计划 → 日历上对应日期+1，timeline 可见
- [ ] 改 visibility 为 friends → 非岩友的账号在 timeline 看不到
- [ ] 取消该计划 → 日历人数 -1，timeline 消失

### 我的日历
- [ ] 即将到来/历史记录切换正确
- [ ] 本月统计数字 = 实际发布数；打卡率正确

### 我的页
- [ ] 抱石/顶绳/先锋等级显示正确，未填的显示灰胶囊"未填"
- [ ] 礼物 Tab 显示现有 RockCardGifts 中我收到的礼物（聚合到 4×3 网格）
- [ ] 足迹 Tab 14 天格子颜色 = 实际打卡次数
- [ ] 侧边抽屉打开顺滑；点击"岩友与群组"进列表；待处理申请显示数字红点

### 岩友关系
- [ ] A 申请 B → B 在抽屉-岩友-待处理看到；接受后 A 在 timeline"我的岩友"可见 B 的 friends 可见计划

---

## 十一、Out of Scope（本期明确不做）
- 野攀地图选点、POI 搜索
- 真实订阅消息推送（只做本地提醒占位）
- 岩友群组/聊天室（仅列表 + ID 直加）
- 时间轴智能匹配算法不做机器学习，做规则打分（3 权重：技能匹配 40% + 时间段重叠 40% + 同岩馆 20%）
