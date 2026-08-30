# 最终测试检查与系统文档计划

## 零、功能逻辑完整性检查（新增，必看）

> **按用户要求：缺失功能在此列出并在测试文档中标为「预期失败 TODO」，不补实现。请指派其他 Agent 实现。**
>
> **检查方法**：逐云函数 action 枚举 + 页面跳转入口反推 + 硬约束项逐条验证。共发现 **4 个确定的功能缺口** + **2 个可选增强建议**。

### 0.1 确定缺失的功能闭环（高优先级，需其他 Agent 补）

| # | 缺失功能 | 当前状态 | 影响范围 | 建议修复云函数 + 前端页 |
|---|---|---|---|---|
| **F-1** | **约爬计划「报名/取消报名」闭环** | ❌ 仅有发布者 create / update / cancel（自己删自己的计划）。没有：岩友 `报名 join_plan`、岩友 `取消报名 unjoin_plan`、发布者 `get_joiners` 看报名名单、发布者 `移除报名人` | 首页日历 + 时间轴（calendar-timeline 右上角"+发布日历"与加好友按钮之间没有"报名"按钮，用户看到约爬后无法确认参加） | `calendar_plan_publish` 加 4 个 action + `calendar_query` 返回字段里带 `joinedCount` + `meJoined`；`pages/calendar-timeline/index.wxml` 加报名按钮 |
| **F-2** | **打卡误提交的撤销**（最近 1 条可回滚） | ❌ checkin_create 只有创建，无 `revert_last` / `delete_record`。用户点错线路等级+数量后无法撤销，三表（Records/DailyProgress/CycleProgress）只能手动去数据库改 | 打卡高频操作（误点概率高） | `checkin_create` 增加 `action: "revert_last"`，回溯最近 30 分钟该用户的最后一次打卡，三表逐条反向减去并改回计数 |
| **F-3** | **删除自己创建的名片** | ❌ rock_card_manage 仅有 `set_primary` / `remove_received`（删除收到的），无 `remove_created`（删除自己创建的）。名片发错内容或反悔无法从墙和名片夹移除 | 名片编辑后反悔 / 内容含隐私需要删除 | `rock_card_manage` 增加 `action: "remove_created"`（仅 ownerOpenid 匹配允许，且同时下墙 + 删除对应未领取 gift） |
| **F-4** | **岩友圈发布/查看动态（帖子）** | ❌ circle_manage 有 11 个 action，但全部是圈信息和成员管理，没有 `post_create / post_list / post_delete`。圈虽然能聚人但没有内容载体，用途只剩"打标签" | 与用户对"岩友圈"的心智预期不符（圈里应该能发消息/约局） | `circle_manage` 新增 post 相关 action，新建集合 `RockCirclePosts`；pages/circle-detail 加动态列表 Tab |

### 0.2 可选增强（非阻塞，建议但不强求）
| # | 功能 | 说明 |
|---|---|---|
| O-1 | 用户拉黑/屏蔽 | friendship_manage 没有 block。遇到骚扰用户只能移除好友，但对方仍能反复发请求。非阻塞（小程序投诉也能处理） |
| O-2 | 名片夹"我收到的"分页+筛选 | rock_card_list_my 返回所有，老用户可能有上百张，加载变慢。目前非阻塞 |

### 0.3 硬约束项状态验证（不做功能变更，仅列结果）
| 硬约束 | 验证结果 |
|---|---|
| Canvas 重试上限 & detached 销毁 | ✅ 通过：[lineChartMini/index.js#L21](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/components/lineChartMini/index.js#L21) `_retryLeft = 4`，[L32](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/components/lineChartMini/index.js#L32) 清 `_retryT` |
| WXML dataset 仅传 ID 不传对象 | ✅ 通过：全量 grep WXML 无 `data-xxx="{{item}}"` 这种写法（之前修复过） |
| 日历跨度严格 14 天 | ⚠️ 需要你做测试时手动验证（TC-CAL-08）。代码层前端传参未做严格截断，依赖后端 |
| 写操作后 cache.invalidate | ✅ 通过：之前版本已在 16 个写操作点加了 invalidate |
| onShow 并发作废（加锁） | ✅ 通过：home / calendar-mine / me 均有 `_onShowRunning` |

### 0.4 本次执行对缺失功能的处理方式
1. **不写任何业务代码**实现 F-1~F-4
2. **在 tests/e2e_test_cases.md 中加 10 条测试用例**（对应 F-1~F-4 每个 2-3 条），状态标为 **「🔶 功能待实现 — 预期失败」**，未来 Agent 补完功能后直接把"🔶 预期失败"改为"✅ 执行"即可
3. **在 PROJECT_NOTES.md §14 功能 Backlog** 记录 F-1~F-4 + O-1/O-2，附带影响范围说明和建议云函数/页面

---

## 一、Repo 研究结论

### 1.1 项目结构总览
- **前端（原生微信小程序）**：`miniprogram/`，共 33 个页面，3 个 TabBar（首页/我的日历/我的）
- **后端（微信云函数）**：`cloudfunctions/`，共 28 个云函数
- **数据库集合**：根据云函数代码扫描，共发现 20 个集合引用

### 1.2 前端实际引用的云函数（28 个全部被引用，无冗余）
| 云函数名 | 前端API代理 | 说明 |
|---|---|---|
| user_manage | user.js | 用户登录/更新/查询个人信息 |
| calendar_query | calendar.js | 查询日历约爬计划 |
| calendar_mine | calendar.js | 我的日历汇总 |
| calendar_plan_publish | calendar.js | 发布约爬计划（create/update/cancel） |
| checkin_create | checkin.js | 提交打卡（仅有 create，缺 revert_last） |
| rock_checkin_context | checkin.js | 打卡页初始化上下文 |
| circle_manage | circle.js | 岩友圈 11 个 action（缺 post 动态） |
| friendship_manage | friendship.js | 好友 request/accept/reject/remove/search |
| rock_gym_list | gym.js | 岩馆列表+搜索 |
| rock_gym_get | gym.js | 岩馆详情 |
| rock_gym_hardness_upsert | gymOwner.js | 岩馆软硬度维护 |
| gym_owner_list | gym.js, gymOwner.js | 馆长岩馆列表 |
| gym_owner_manage | gymOwner.js | 馆长岩馆管理（合并/删除等 9+ action） |
| gym_owner_upsert | gymOwner.js | 馆长岩馆信息/周期/线路维护 |
| rock_card_upsert | card.js | 名片创建/更新 |
| rock_card_get | card.js | 名片详情 |
| rock_card_list_my | card.js | 我的名片列表 |
| rock_card_manage | cardManage.js | 名片 set_primary / remove_received（缺 remove_created） |
| rock_card_gift_manage | cardGift.js | 名片 create_link / create_direct / get / claim / cancel |
| rock_gym_wall_manage | wall.js | get / list_cards / hang / unhang |
| share_card_render | share.js | 名片分享图渲染 |
| stats_summary | stats.js | 统计汇总+图表 |
| rock_llm_one_liner | card.js | LLM 生成灵感一句话 |
| rock_sync_gyms | backstage.js | 岩馆同步工具 |
| admin_manage | backstage.js | 管理员 health/listUsers/authDebug 等 14 个 action |
| rock_gym_review_queue_manage | backstage.js | 岩馆审核队列 list / review |

结论：**28 个云函数全部被前端引用，无冗余云函数可删除。**

### 1.3 数据库集合清单（20 个，2 个候选清理）
| 集合名 | 使用云函数 | 状态 |
|---|---|---|
| RockUsers | 13+ 个 | **核心表** |
| RockGyms | 10+ 个 | **核心表** |
| RockCheckinRecords | checkin_create, stats_summary, rock_gym_list | **核心表** |
| RockGymCycles | rock_gym_get, checkin_create, gym_owner_upsert | **核心表** |
| RockUserDailyProgress | checkin_create, stats_summary | **核心表** |
| RockUserCycleProgress | checkin_create | **核心表** |
| RockCards | rock_card_* / wall / share | **核心表** |
| RockCardCredits | upsert / list_my / gift_manage | **核心表** |
| RockCardGifts | gift_manage | **核心表** |
| RockCircles | circle_manage | **核心表** |
| RockCircleMembers | circle_manage | **核心表** |
| RockCalendarPlans | calendar_* 3 个 | **核心表** |
| RockFriendships | user_manage / friendship_manage / calendar_query | **核心表** |
| RockGymWallCards | wall_manage | **核心表** |
| RockGymReviewQueue | sync / upsert / review_queue_manage | **核心表**（后台） |
| RockGymSyncRuns | sync | 后台同步记录 |
| RockGymSourceRecords | sync | 同步源数据 |
| RockComments | admin_manage 仅 DOC_COLLECTIONS 声明 | 🔶 **死代码候选清理** |
| RockBlackTalkDictionary | admin_manage 仅 DOC_COLLECTIONS 声明 | 🔶 **死代码候选清理** |
| **RockCirclePosts** | **未被任何云函数引用** | 🔴 **对应缺失功能 F-4，未来需要新增集合** |
| **RockCheckinRevocationLog** | **未被任何云函数引用** | 🔴 **对应缺失功能 F-2，未来需要新增集合（或复用 checkin_create 原表加反向记录）** |

### 1.4 功能重复入口审计（33 页面 WXML + 跳转全量扫）

#### 1.4.1 入口地图
| 目标页面 | 入口数 | 等级 |
|---|---|---|
| 创建岩友圈 circle-edit | 4（卡片＋/无岩馆空态/有岩馆空态/选圈弹窗＋） | 🔴 严重冗余 |
| 调试日志 debug-logs | 2（我的页 ⚙抽屉 + 管理员工具箱首页） | 🟡 对普通用户暴露过度 |
| 发布日历 publish | 2（首页浮动 / 时间轴右上） | 🟢 合理（全局 + 上下文快捷） |
| 岩友圈列表 circle-list | 2（我的页卡片 / 首页更多） | 🟢 合理（我的圈 / 当前岩馆更多圈） |
| 岩友列表 friend-list | 1（我的页卡片） | 🟢 |
| 馆长后台 owner | 2（我的页抽屉 / 工具箱首页） | 🟢 合理（馆长本人 / 管理员代查） |
| 打卡 checkin | 1（首页浮动） | 🟢 |
| 时间轴 timeline | 2（点日期 / 无岩馆兜底） | 🟢（后者是 fallback） |
| 岩馆合并 gym-merge | 2（我的页抽屉 / gym-manage 上下文） | 🟢 |

#### 1.4.2 建议删除（本次执行）
1. **创建岩友圈 4→2**：删「无岩馆+圈模式空态按钮」+「选圈弹窗＋」，保留「有岩馆空态引导」+「岩友圈卡片右上＋」
2. **调试日志 2→1**：从我的页 ⚙抽屉删除，仅管理员工具箱保留（分层隔离）

#### 1.4.3 不删的双入口（保留）
发布日历 / 岩友圈列表 / 馆长后台 — 虽有 2 个入口，但场景、用户心智不同。

---

## 二、文件与模块修改清单

### 2.1 新增文件
| 文件 | 用途 |
|---|---|
| `tests/e2e_test_cases.md` | **64 条测试用例**（原 54 条 + 10 条待实现功能标记） |
| `cloudfunctions/test_seed_data/index.js` | 幂等种子数据云函数（_v 后缀） |
| `cloudfunctions/test_seed_data/package.json` | wx-server-sdk 依赖 |
| `ARCHITECTURE.md` | 系统架构（文字结构图 / 9 业务域 / 3 数据流 / ER / 硬约束） |

### 2.2 修改文件
| 文件 | 变更 |
|---|---|
| `README.md` | 替换 16 行极简版为完整（定位+16 模块表+4 步快速上手+测试数据+文档索引+约束速记） |
| `PROJECT_NOTES.md` | 追加 §9 集合对照 / §10 云函数协议 / §11 清理决策 / §12 测试数据规范 / §13 入口去重 / §14 功能 Backlog（F-1~F-4 + O-1~O-2） |
| `cloudfunctions/admin_manage/index.js` | DOC_COLLECTIONS 移除 RockComments + RockBlackTalkDictionary |
| `miniprogram/pages/home/index.wxml` | 2 处删按钮（创建岩友圈冗余入口） |
| `miniprogram/pages/me/index.wxml` | 1 处删行（调试日志从我的页抽屉移除，JS 函数保留） |

---

## 三、执行步骤（5 阶段 + 0 阶段）

### 阶段 0：功能入口去重（影响 UI，最先做）
- **0.1** home/index.wxml：删 `<view wx:if="{{visibility==='circle' && !gymId}}" class="card card--circle-empty">` 整段（line 88-93）
- **0.2** home/index.wxml：删 `sheet__btn-plus` ＋（line 164）
- **0.3** me/index.wxml：删 drawer-row "🐞 调试日志 ›"（line 105-109）

### 阶段 1：test_seed_data 幂等种子云函数
- **1.1** `cloudfunctions/test_seed_data/` 新建
- **1.2** 入参协议：`{ action: "seed" | "cleanup" | "status", confirm?: boolean }`
- **1.3** seed 按 4 批写约 80 条文档：
  - 批 1（10 条）：RockUsers（test_user_1_v ~ test_user_10_v，昵称攀岩小v…自由人v，馆长v role=owner）
  - 批 2（6 条）：RockGyms×2（飞岩测试馆A_v/B_v，深圳，ownerOpenid=馆长v） + RockGymCycles×4（每馆当前+上期 14 天内，含 lines 字段 V0-V5 / 5.9-5.12）
  - 批 3（约 40 条）：RockCircles×3 + RockCircleMembers×23（深圳抱石/北京难度/新手友好，role=admin + member/pending 混合） + RockFriendships×3（1↔2 accept；1↔3 accept；1→4 pending）
  - 批 4（约 24 条）：RockCheckinRecords×20（用户1-6 × 近14天 × A/B馆，boulder V2-V5/difficulty 5.10a-5.11c 混合，totalDelta≥3） + RockUserDailyProgress×12 + RockUserCycleProgress×8；RockCalendarPlans×8（近14天，public/friends 混合，3 条 needPartner）；RockCards×6 + RockCardCredits×6 + RockCardGifts×1（1→2 pending）；RockGymWallCards×3（A_v 墙挂 1/3/5 的名片）
- **1.4** cleanup 策略：`confirm!==true` 只返回 `{ willDelete: {...} }` 预览；`confirm:true` 才真删。匹配：RockUsers where openid `/^test_user_.*_v$/`；其它表全部 join 到这批 openid/圈名/馆名正则，绝对不碰不符合的
- **1.5** status：count 各集合测试数据量

### 阶段 2：tests/e2e_test_cases.md（64 条，分 9 模块）
每条 7 列表格：`ID / 模块 / 标题 / 前置条件 / 操作步骤 / 预期结果 / 关联文件路径`
- **A 用户域（5）**：TC-USER-01~05（登录/改资料/搜+发好友/接受拒绝/删好友）
- **B 岩馆馆长域（6）**：TC-GYM-01~06（搜/详情/馆长列表/编辑/建周期+线路/审核）
- **C 打卡域（7）**：TC-CK-01~07（上下文/抱石计数/难度计数/混合提交/同日累加/无线路兜底/三表一致）
- **D 统计域（4）**：TC-ST-01~04（图表不崩/30 天完整性/分页/topGym）
- **E 日历约爬域（8 + 🔶 加 3 条 TODO）**：TC-CAL-01~08（14 天/三段 pill/公开发/仅好友/我的页汇总/时间轴/取消自己/14 天截断）；**🔶 TC-CAL-09 / 10 / 11 — 功能待实现（F-1 join/unjoin/发布者看名单）预期失败**
- **F 岩友圈域（9 + 🔶 加 3 条 TODO）**：TC-F-01~09（列表+过滤/建圈/通过申请/拒绝申请/成员升序列表/编辑圈信息/踢人/退圈/解散圈）；**🔶 TC-F-10 / 11 / 12 — 功能待实现（F-4 发帖/删帖/列表）预期失败**
- **G 名片域（10 + 🔶 加 2 条 TODO）**：TC-CD-01~10（创建/存相册/灵感/设主卡/名片夹切换/赠链接/直送/并发幂等/取消/上墙）；**🔶 TC-CD-11 / 12 — 功能待实现（F-3 删除自己创建的名片）预期失败**
- **H 打卡增强（🔶 加 2 条 TODO 放这里）**：TC-CK-08/09 — **功能待实现（F-2 撤销最近 1 条）预期失败**
- **I 系统域（5）**：TC-SYS-01~05（Tab 缓存命中/写操作 invalidate / showErrorModal 持久弹窗 / dataset 仅 ID / Canvas ≤4 次重试）

### 阶段 3：云函数与数据库表冗余
- **3.1** 全量通读 admin_manage/index.js 所有 action，确认 RockComments / RockBlackTalkDictionary 无业务读写（仅 DOC_COLLECTIONS）
- **3.2** DOC_COLLECTIONS 数组移除 2 个元素；不改数据库真实集合，仅下白名单
- **3.3** PROJECT_NOTES.md §9 输出 20+2 集合对照表（含 RockCirclePosts / RevocationLog 作为未来新增）；§11 记录清理决策

### 阶段 4：系统架构与文档
- **4.1 ARCHITECTURE.md**：文字版三层架构图 + §2 九域云函数映射 + §3 三数据流（打卡三表/名片领取条件更新+回滚/圈成员 memberCount 维护） + §4 前端五层目录树 services/utils/components + §5 ER 关系（1:N / M:N 全部） + §6 6 条硬约束 + §7 统一响应 ok/data/error/traceId 协议
- **4.2 README.md**：替换现 16 行，增加：产品定位一句话、16 行模块×页面×说明 表、4 步快速上手指南（导入工具→部署云函数→20 集合创建→seed 数据）、文档索引 3 个 md 链接、工程约束速记 5 条
- **4.3 PROJECT_NOTES.md** 追加 6 节：§9 集合对照 / §10 28 云函数 action 协议逐项列 / §11 清理决策（云函数 0 删 / DOC_COLLECTIONS 撤 2 / 入口 2 处） / §12 测试数据规范（_v 后缀 / 三 action / confirm 双保险） / §13 入口去重记录 / §14 Backlog（F-1~F-4 详细说明 + O-1 O-2）

---

## 四、依赖与注意事项
1. test_seed_data 需在"所有用户可读写"（或云函数创建者管理员写）权限下发
2. 云函数真实 wx.OPENID 无法伪造 → seed 直接写库绕过 user_manage
3. RockCalendarPlans / CheckinRecords 用 today-0~13 天写，保证首页 14 天可见
4. cleanup 永远默认只预览，双保险 `confirm:true` 才执行，且匹配条件用正则严格限定 _v 后缀 / test_user_ 前缀

## 五、风险与回退
| 风险 | 缓解 |
|---|---|
| cleanup 误删生产 | 默认 preview-only；confirm 必须显式 true；匹配正则严格 _v / test_user_ 前缀 |
| 入口去重后用户找不到建圈 | 保留 2 处（卡片＋/有岩馆空态）；真有问题一行 WXML 加回即可 |
| seed 数据超时（60s） | 分 4 批 await，每批 Promise.all 并行 ≤20 条，总量 ≤80 |
| 64 条用例后续脱节 | §13 强约束"改代码同步改用例"；每条末尾 file:// 绝对路径锚点，IDE 可跳转 |
| F-1~F-4 缺失功能被误判为 Bug | tests 中所有待实现项标 **🔶 功能待实现 — 预期失败**，一眼区分 |
