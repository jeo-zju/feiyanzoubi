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
- 抽出 `miniprogram/utils/cardRenderer.js`，统一名片绘制主体，减少 `card-edit` / `card-view` 的重复布局代码
- 修复 `card-view` 保存图片依赖固定延时的问题，改为等待 canvas 真正绘制完成后再导出，降低空白图或导错面的风险
- 抽出 `miniprogram/utils/pageState.js`，统一 `home`、`stats`、`owner` 三页的分页翻页与加载状态处理
- 简化 `paginator` 组件输入，上一页可用性改为由当前页号自动判断
- 清理 `card-edit` 中未被模板使用的派生状态，减少无意义的 `setData` 和后续维护噪音
- 修复 `owner` 页“管理岩馆数量”口径错误，改为由 `gym_owner_list` 返回用户管理岩馆总数
- 修复 `owner` 页线路汇总口径错误，改为由 `gym_owner_list` 返回全部管理岩馆的线路总数
- 修复 `rock_checkin_context` 跨周期取进度的问题，打卡上下文现在按目标 `cycleId` 过滤周期进度和历史记录
- 修复 `stats_summary` 同一天多次打卡时图表被覆盖的问题，按日期改为累加而不是覆盖
- 修复 `stats_summary` 最近记录分页提前截断的问题，改为分批拉取原始记录并按需累积，减少老用户“提前没有下一页”的概率
- 修复名片赠送链路中的 3 个问题：取消链接后恢复草稿、直送首张名片自动设主卡、领取页未领取状态不再暴露额外故事内容
- 对名片领取增加基于 `gift.status = pending` 的条件更新，缩小同一链接被并发重复领取的窗口
- 继续强化名片领取一致性：卡片归属写入改为 `ownerOpenid` 为空时才允许更新，若卡片更新失败则把 gift 从 `claimed` 回滚回 `pending`
- 新增前端调试日志页 `pages/debug-logs`，并把云函数调用日志、运行错误、未处理 Promise 异常、本地页面不存在错误统一落到本地日志存储中，入口位于“我的 > 管理 > 调试日志”
- `rock_llm_one_liner` 已改为直连 DeepSeek OpenAI 兼容接口，环境变量优先读取 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`，同时兼容 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`；默认模型为 `deepseek-chat`，默认地址为 `https://api.deepseek.com`
- 重新设计 `我的` 页：顶部改为紧凑资料条，`名片夹` 和 `灵感` 收成两张轻量信息卡，底部改为 4 格快捷入口；显式“同步微信头像昵称”按钮已移除，改为点击顶部资料区触发同步
- 新增 `miniprogram/utils/window.js` 统一读取窗口宽度，优先使用 `wx.getWindowInfo()`，已替换 `me`、`card-edit`、`card-view`、`lineChartMini` 中的 `wx.getSystemInfoSync()`，避免新版基础库的 deprecated 告警
- 已完成 `wx.getUserProfile` 迁移：新增极简资料编辑页 `pages/profile-edit`，通过 `chooseAvatar` + `type="nickname"` 获取资料，头像会先上传到云存储再调用 `auth_login` 持久化；`miniprogram/utils/session.js` 新增 `syncAppLogin()`，用于统一“登录/更新资料后回写 `app.globalData.user`”的逻辑
- 开始统一页面视觉骨架：在 `miniprogram/app.wxss` 新增共享的 `card-hero`、`section-kicker`、`section-title-lg`、`section-desc`、`panel`、`stat-grid`、`list-row`、`empty-state` 等样式，并已用于 `profile-edit`、`owner`、`stats`、`wall`，让标题区、统计卡、列表行和空态文案更统一、更简洁
- 第二轮视觉收敛继续落到高频业务页：`card-wallet`、`card-gift` 已接入统一的 Hero/统计卡/列表行/面板样式；`checkin` 保持原有打卡逻辑不变，仅统一头部信息层级和表格外层容器，让高频页面的节奏更接近同一产品
- 名片编辑与保存页已从“双面切换”交互收敛为单面名片：照片不再单独预览，而是作为同一张名片的背景氛围图参与渲染；`card-edit` / `card-view` 已同步改单面文案与保存逻辑，避免“选照片后预览错乱”的体验问题
- 名片相关页面的产品口径已继续统一为单面名片，`card-wallet` 的保存按钮、`rock_llm_one_liner` 的提示词和底层渲染中的历史文案也已同步清理，避免继续出现“正面 / 反面 / 背面”的残留表达
- 名片产品线又做了一轮文案收敛：`card-wallet`、`card-gift`、`card-claim`、`card-view`、`card-edit`、`wall` 的按钮、提示语和空态文案继续压缩，减少解释句和步骤感，统一成更简洁、更克制的语气
- 非名片页也继续统一产品语言：`owner`、`stats`、`home`、`checkin` 的标题、空态、按钮文案和离开/保存提示继续收敛，减少口语化长句和说明堆叠，让全局语气更一致
- 又做了一轮轻量视觉统一：`home` 顶部搜索卡接入 `card-hero` 风格，`owner` 的新增按钮、`checkin` 顶部辅助按钮改为更接近统一的 mini 密度，`stats` 图表区增加留白，整体页面间距和层级进一步对齐
- 再做了一轮细节收口：`home` 顶部搜索区正式改成 Hero 结构，补齐 `section-kicker / title / desc` 的层级；通用 `paginator` 组件也同步收细，按钮高度、圆角、间距和页码宽度都更接近全局次级操作的密度
- 为适配不同移动端屏幕高度，继续收敛了页面纵向布局：`home`、`owner`、`stats` 改成“首屏固定 + 内部列表滚动”的视口布局，避免整页被列表顶出一屏；`checkin` 去掉了过大的底部留白；`window.js` 新增 `getWindowHeight()` / `isCompactScreen()`，`me` 页会根据屏幕高度自动缩小名片尺寸，减少小屏设备首屏溢出
- `rock_llm_one_liner` 继续增强兼容性：修正 `gyms` 对象数组提示词拼接，兼容 `message.content` 为数组等返回格式；当 DeepSeek 返回空内容时，自动回退到本地 mock 文案，避免前端直接看到“未返回可用文案”
- 调试日志页新增筛选交互：顶部总数/错误/云调用统计卡和每条日志上的类型、分类标签都可点击筛选，并新增当前筛选状态提示，提升排查错误时的可用性
- `profile-edit` 继续收敛为更窄更稳的一张编辑卡：减少说明文案，只保留头像和昵称两项核心资料，统一卡片宽度和节奏，避免宽窄不一的拼装感
- `me` 页又做了一轮减法：去掉“我的名片”标题和外层卡框后，继续清掉顶部 `Project` 占位副标题、把名片角标改成更轻的箭头、把“名片夹/灵感”收成单行数据表达、把“馆长/日志”入口压成单行轻按钮，页面层级更少、更像一屏内的自然信息流
- 继续清理用户侧占位残留：`auth_login` 不再给 `projectName` 回填英文默认值 `Project`，避免“我的”页昵称下方再次出现无业务含义的占位副标题
- 继续清理前端示例占位：`me` 空名片与 `card-edit` 预览中的“岩点测试员 / 长臂猿 / ENTP / 用脚点谈判”已换成更中性的“你的名字 / 攀岩爱好者 / 写一句介绍自己 / 常去的馆”，避免测试感过强的示例直接暴露给用户
- `me` 页空名片又按真实产品语义调整了一轮：默认姓名优先使用微信昵称，绰号和一句话改为从既有内置词库里随机生成，避免再次回到“攀岩爱好者”这种直白占位；空名片角标文案也从“创建”改成了更符合当前操作的“编辑”
- `me` 与 `card-edit` 的默认名片内容现已完全共用 `miniprogram/utils/cardDefaults.js`：统一从同一套绰号/一句话词库生成，并按用户 `openid/nickName` 稳定计算默认展示，避免“我的页看到一套、点进编辑又变另一套”
- “编辑资料” 与 “名片” 的重复信息已合并：`me` 页去掉了独立资料条，直接在名片卡片里展示头像与名字；`profile-edit` 页面从路由中移除并删除文件，头像与昵称的同步逻辑改为内聚到 `card-edit`，在名片编辑页里直接点头像走 `chooseAvatar`、点名字走 `type="nickname"`，保存名片时一并同步用户资料，同时仍保留自定义头像/自定义昵称能力
- `card-edit` 又做了一轮更轻的交互收束：去掉“头像和名字”独立卡片、去掉“素材”独立卡片，改成直接在名片预览上点击头像/昵称进入编辑，并把素材收成预览下方一行摘要，右侧用小笔图标进入编辑面板；照片选择与“生成一句”改为跟随素材摘要的轻按钮，而不再占一整张卡
- `card-edit` 继续去重后，素材摘要也从卡片下方移除，只保留名片上的最终展示内容；小笔图标改为直接浮在名片右下角，作为唯一的素材编辑入口，避免“卡片里有一句、卡片下又重复一遍”的双重表达
- `card-edit` 顶部原“单面预览”标签已替换成真正的分享入口：点击会先静默保存当前名片、生成领取链接，再弹出“保存图片 / 分享给好友”的选择；分享使用当前页面生成的名片预览图作为 `imageUrl`，保存图片也直接复用当前预览图，不再额外跳去 `card-view`
- 之后又按交互收口把分享入口从 `card-edit` 移回 `me` 页名片操作区：`我的` 页现为“送出 / 分享”，分享会在该页直接生成预览图并弹出“保存图片 / 分享给好友”；`card-edit` 顶部不再保留分享按钮，避免编辑页和我的页双入口重复。空名片上的“点击编辑名片”提示也已删除，只保留卡面本身与“编辑”角标
- 因用户反馈 `me` 页名片与 `card-edit` 视觉不一致，`me` 页主名片已改为通过隐藏 canvas 使用同一个 `drawFrontCard()` 渲染后显示，不再用单独拼装的简化 DOM 卡片；`送出 / 分享` 也改为直接浮在卡面右下角，避免此前落在卡片下方时不明显或难以被看到
- 随后复查发现前一版“未生效”的直接原因有两处：一是 `me/index.wxml` 同时存在两个 `canvas-id="myCardCanvas"`，导致绘制目标混乱；二是 `setData` 切出主名片分支后立即绘制 canvas，节点尚未真正挂载时就调用了 `createCanvasContext()`。现已删除重复 canvas，并在 `me/index.js` 中新增 `afterViewReady()`，确保主名片节点渲染完成后再绘制，从而让 `我的` 页卡面和右下角“送出 / 分享”真正生效
- 之后再次核对发现 `card-edit` 实际显示层并不是可见 canvas，而是“隐藏 canvas 生成临时图 + `<image>` 展示”。`me` 页此前曾误切到可见 canvas，和 `card-edit` 的显示路径并不一致。现已改回与 `card-edit` 完全同型：隐藏 `myCardCanvas` 出图，写入 `myCardPreviewImage` 后显示 `<image>`；卡面右下角 `送出 / 分享` 覆盖在该图层上
- 为提升 Tab 切换体验，新增 `miniprogram/utils/pageCache.js` 轻量页面缓存层，并接入 `home`、`stats`、`me` 三个 Tab：进入页面时先读短时本地缓存秒开旧数据，再静默刷新云函数结果；同时 `services/api/gym.js`、`stats.js`、`card.js` 支持按调用场景关闭全局 loading，避免“切换 Tab 总要转圈一下”的阻塞感
- 缓存策略继续扩展到高频非 Tab 页面：`owner` 馆长页支持列表与汇总的短时缓存；`checkin` 页按“用户 + 岩馆 + 日期”缓存 `rock_checkin_context` 返回值，进入最近使用的岩馆或切日期时可先显示旧上下文，再静默刷新，减少每次进入都等初始化数据的体感
- 名片赠送口径已重新梳理：自己的主名片现在视为“可无限分发的源名片”，分享/送出只生成领取记录，不再转移原卡所有权，也不再消耗灵感；领取自己的分享时会复制一张给对方收进名片夹。`giftDraft` 继续作为“帮别人制作名片”的独立模式，仅在新建草稿时消耗一次灵感，后续编辑与送出不再重复扣减
- `card-wallet` 已改为同页区分“收到的 / 送出的”两类记录，并把“保存图片”收口为当前页直接保存；领取成功也不再跳 `card-view`，而是直接回名片夹，减少名片夹内部的次级页面层数
- `我的` 页与 `card-edit` 页的可视名片已收口为共享模板 `miniprogram/templates/profile-card.wxml` 与共享样式 `miniprogram/styles/profile-card.wxss`。后续若要调整名片顶部渐变条、头像区、标题、一句话等结构，必须优先修改这两处，避免再次出现“我的页一套 / 编辑页一套 / canvas 导图又一套”的分叉回归

## 当前环境注意事项
- 当前工程实际位于 VMware 共享目录 `/mnt/hgfs/trae_projects/feiyanzoubi`，不是本机本地磁盘目录。
- 在这个共享挂载环境下，IDE 的文件删除能力会尝试“移动到废纸篓”，但 `/mnt/hgfs` 不满足对应废纸篓目录要求，因此 `DeleteFile` 类删除操作会稳定失败，并提示“未能将文件移动到废纸篓”。
- 后续如果需要删除文件或目录，默认改用命令行真实删除回退方案处理；不要把删除失败误判为授权问题。

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
