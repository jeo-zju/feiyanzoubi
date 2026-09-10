# 飞岩走壁（攀岩社交小程序）

## 版本

**当前版本：2.0.25**

> 本轮产品调整记录见 [PRODUCT_ADJUSTMENT_PLAN.md](PRODUCT_ADJUSTMENT_PLAN.md)。当前首页定位为「找搭子」，公开约爬详情、报名确认、通知及屏蔽安全页面已加入；部署和真机验收仍待完成。

> 若首页提示“云端约爬功能尚未更新”，说明云端仍是旧版 `calendar_query`。请在微信开发者工具中右键上传并部署 `cloudfunctions/calendar_query`（包含同目录的 `discover.js`），再重新编译；或按 `deploy-tools/README.md` 配置上传密钥后执行 `npm run functions -- calendar_query`。

> 版本规则：末位小版本号由自动化流程每次修改递增 1；大版本号人工维护。

> 基于微信小程序原生框架 + 微信云开发（云函数 + 云数据库 + 云存储）的一站式攀岩社交应用：约爬日历 / 打卡统计 / 馆长维护线路 / 名片上墙 / 岩友圈 / LLM 灵感一句话。

---

## 一句话定位
- **用户端**：找馆 → 打卡 → 看趋势 → 发约爬 → 做名片 → 进圈交朋友
- **馆长端**：维护周期线路 / 软硬度 / 合并岩馆 / 审核新馆
- **管理员**：工具箱（岩馆同步 / 审核队列 / 备份文档 / 调试日志）

---

## 功能模块 × 页面说明（16 模块）

| 模块 | 主要页面 | 说明 |
|---|---|---|
| 01 登录 & 资料 | profile-edit, me TabBar | chooseAvatar + nickname 输入 → 云存储上传头像 → user_manage.update |
| 02 首页日历 | home（TabBar） | 14 天热度格 + 城市/岩馆/圈三级筛选 + 公开/岩友/圈三段 pill |
| 03 时间轴 | calendar-timeline | 点击某日期查看当天所有约爬 plan 按开始时间排序 |
| 04 发布约爬 | calendar-publish | 岩馆/时间/攀爬类型/氛围/名额；直接加入或发起人确认 |
| 05 我的约爬 | calendar-mine（TabBar） | 即将参加/我发起/已结束；攀爬记录从辅助入口进入 |
| 06 打卡 | checkin | 上下文初始化 → 抱石/难度表格 +/− → 三表写入一致性 |
| 07 统计 | stats | 30 天柱图 + topGym + 最近记录分页（pageState.js）|
| 08 岩馆 | home 卡片 / gym-detail / gym-list | 搜馆 / 详情线路表 / 软硬度 |
| 09 馆长后台 | owner / gym-manage / gym-merge | 馆长岩馆清单 → 维护周期+线路 → 合并/删除/转交/审核 |
| 10 岩馆审核后台 | backstage（工具箱首页）+ review_queue | 管理员审核新馆；RockGymReviewQueue |
| 11 岩友圈 | circle-list / circle-edit / circle-detail | 11 个 action 闭环（申请/批准/踢人/退圈/解散…）|
| 12 好友 | friend-list / friend-detail | 搜索/加/批准/拒绝/删；RockFriendships 双向 |
| 13 名片 | card-edit / card-view / card-wallet / card-gift | 创卡 / 主卡 / 存相册 / 赠链接 / 直接赠 |
| 14 攀岩墙 | wall / rock_gym_wall_manage | 名片挂到岩馆墙上槽位 / 下墙 |
| 15 LLM 灵感 | rock_llm_one_liner（DeepSeek/OpenAI） | ✨ 灵感按钮生成名片一句话 |
| 16 管理员工具箱 | backstage / debug-logs | 岩馆同步 / listUsers / 备份白名单 / 调试日志页 |

---

## 4 步快速上手（本地 → 真机联调）

1. **① 导入微信开发者工具**
   - 用微信开发者工具打开仓库根目录；AppID 填自己的测试号
   - 点「云开发」创建或选择一个环境（DYNAMIC_CURRENT_ENV 自动适配）

2. **② 部署 29 个云函数**
   - `cloudfunctions/` 右键 → 「在终端中打开」→ 对每个文件夹执行：
     ```
     npm install
     # 然后在开发者工具里对该目录右键 "上传并部署：云端安装依赖（不上传 node_modules）"
     ```
   - 必部署清单：见 [ARCHITECTURE.md §2](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/ARCHITECTURE.md#%C2%A72-%E4%B9%9D%E4%B8%9A%E5%8A%A1%E5%9F%9F--%E4%BA%91%E5%87%BD%E6%95%B0-action-%E6%98%A0%E5%B0%84%E8%A1%A8)（9 域共 28 个）+ `test_seed_data`（测试专用 1 个）

3. **③ 数据库 20 集合创建（首次部署需手工创建 + 配权限）**
   - 云开发控制台 → 数据库 → 新建集合（依次建 20 个，集合名大小写敏感）：
     `RockUsers / RockGyms / RockGymCycles / RockCheckinRecords / RockUserDailyProgress / RockUserCycleProgress / RockCards / RockCardCredits / RockCardGifts / RockCircles / RockCircleMembers / RockCalendarPlans / RockFriendships / RockGymWallCards / RockGymReviewQueue / RockGymSyncRuns / RockGymSourceRecords`（17 个核心）
   - 额外 3 个死集合 RockComments / RockBlackTalkDictionary 可跳过（已从备份白名单移除，admin_manage 不再引用）
   - 权限策略：**所有集合建议设为「仅创建者可读写，云函数读写不受限」**，避免绕过逻辑

4. **④ 插入测试数据（推荐，每次测试一键 seed/cleanup）**
   - 部署完成 `test_seed_data` 云函数后，在云函数管理面板执行测试事件：
     - seed：`{"action":"seed"}` → 插入 10 个假用户 + 2 馆 + 3 圈 + 打卡/约爬/名片/上墙，总计约 80 条。所有测试实体 `_v` 后缀，与真实数据隔离。
     - status：`{"action":"status"}` → 查看各集合测试数据条数
     - cleanup preview：`{"action":"cleanup"}` → 预览将要删多少条，**不动 DB**
     - cleanup 真正删除：`{"action":"cleanup","confirm":true}` → **只删符合正则的 _v 数据**，真实用户数据安全

---

## 文档索引

| 文档 | 路径 | 要点 |
|---|---|---|
| 🏛 架构设计 | [ARCHITECTURE.md](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/ARCHITECTURE.md) | 三层结构图 / 9 域映射 / 三条关键数据流 / ER / 6 硬约束 / 统一协议 |
| 📝 工程笔记 + 演进史 | [PROJECT_NOTES.md](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/PROJECT_NOTES.md) | 清理决策 / 硬约束历史 / 集合对照 / 云函数 action 协议 / Backlog F-1~F-4 |
| 🧪 端到端测试用例（67 条） | [tests/e2e_test_cases.md](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/tests/e2e_test_cases.md) | A~I 九模块 × 7 列；10 条标 🔶 为待实现功能；每条末尾 IDE 可跳关联源文件 |
| 🗂 本次计划文档（存档）| [.trae/documents/最终测试检查与系统文档_plan.md](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/.trae/documents/%E6%9C%80%E7%BB%88%E6%B5%8B%E8%AF%95%E6%A3%80%E6%9F%A5%E4%B8%8E%E7%B3%BB%E7%BB%9F%E6%96%87%E6%A1%A3_plan.md) | 本次最终测试工作全流程（计划 + 功能完整性审计）|

---

## 工程约束速记（5 条，改代码前先看）

1. **日历跨度 ≤ 14 天**，前后端都挡（ARCHITECTURE.md HC-01）
2. **WXML 只传 ID**：`data-cid="{{item._id}}"`，绝对不要 `data-item="{{item}}"`
3. **写操作 → invalidate 前缀**；所有写成功前先 `cache.invalidate("calendar:")`
4. **29 云函数统一响应** `{ ok, data, error, traceId }`；不要自定义形状
5. **测试数据一律 _v 后缀**；seed 重复执行幂等；cleanup 永远 `confirm:true` 双保险
