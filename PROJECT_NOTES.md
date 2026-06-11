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
