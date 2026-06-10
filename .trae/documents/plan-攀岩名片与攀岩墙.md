# 计划：攀岩名片 + 岩馆攀岩墙

## Summary
- 新增“攀岩名片”能力：每个用户有 1 张自己的名片（正反面翻转）；同时可拥有别人赠送的名片（名片夹上限 100）。
- 新增“赠送名片”能力：支持链接领取 + 直接赠送到对方 ID（openid）；赠送/修改/自制名片都消耗“每日 credit”，每天 0 点重置（默认每日 10 次）。
- 新增“攀岩墙（照片墙）”能力：每个岩馆默认自带 1 面墙（无需馆长创建），墙可容纳 100 张名片；用户可把“自己名下名片”或“自己制作并赠送出去的名片”挂上墙；满了自动移除最老的一张。
- 新增 LLM 生成：根据名片背面文字故事生成正面“一句话介绍”，支持两种风格（鼓励/幽默）；当前只保存用户选中的一种；Key/URL 只放云函数环境变量，不进入代码仓库。

## Current State Analysis（基于仓库现状）
- 小程序现有页面：home/stats/me/checkin/owner/gym-manage/logs（无名片/墙页面入口）  
  - [app.json](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/app.json)
- 云函数现有能力：
  - 已有 `llm` 云函数，但目前是“基于字典返回固定文案”的占位实现，不调用外部模型。  
    - [cloudfunctions/llm/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/llm/index.js)
  - 已有 `share_card_render` 可生成小程序码并上传云存储（可复用做“领取名片”分享/二维码）。  
    - [cloudfunctions/share_card_render/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/share_card_render/index.js)
- 数据集合现有清单中无“名片/墙”业务实体集合。  
  - [cloudfunctions/rock_init/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_init/index.js)
- 现有调用约定：云函数返回 `{ ok, data, traceId }`，小程序端通过 `callCloud` 统一处理与记录日志。  
  - [miniprogram/services/cloud.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/services/cloud.js)

## Assumptions & Decisions（已决策）
- 赠送方式：两种都支持  
  - 链接/二维码领取：生成 giftId，收件人打开 `pages/card-claim/index` 领取。
  - 直接赠送：输入对方“用户 ID”（openid）直接投递到对方名下。
- 模型接口：按 OpenAI Chat Completions 兼容协议实现（baseUrl + apiKey + model）。
- 当前阶段不做多模态：正面一句话仅由“背面文字故事”生成；背面照片用于展示与正面头像（裁切显示）即可。
- 文案风格：生成时可选 `encourage|humor`，仅保存当前选择（需要另一种风格再生成覆盖）。
- 名片夹容量：每人最多 100 张“他人赠送名片”；达到上限时禁止继续领取/接收，需用户手动删掉旧卡后再收。
- credit：
  - 每个用户每天可“制作/修改自己名片”与“制作赠送名片”合计 10 次（默认值，后续可扩展充值）。
  - 每天 0 点（Asia/Shanghai）自动重置。
- 权限口径：
  - 名片编辑：仅名片 owner 可编辑；制作赠送阶段的“草稿卡”（未归属）仅创建者可编辑/撤销。
  - 上墙：允许挂“我名下的卡”或“我制作并已赠送给他人的卡”（createdByOpenid == 我）。
- 容量策略：墙满时自动删除最老的上墙记录；并做“同卡重复上墙时刷新到最新”的处理。

## Data Model（新增集合与字段约定）
> 采用新集合，避免与现有 RockGymBlackboards（线路统计黑板）混淆。

### 1) RockCards（名片实体）
- 归属/来源
  - `ownerOpenid`: string（名片归属者；草稿卡为空字符串）
  - `createdByOpenid`: string（制作人，等于当前调用者 openid）
  - `status`: `"active" | "draft" | "archived"`（最小化实现先用 active/draft）
  - `isPrimary`: boolean（该 owner 的“当前使用名片”；同一 owner 只允许 1 张为 true）
- 正面字段（front）
  - `displayName`: string（微信名或自定义）
  - `title`: string（头衔，如“长臂猿/理论攀岩者/小短手…”）
  - `mbti`: string（如 INFP）
  - `gyms`: array（最多 3）元素：`{ gymId, name, city }`
  - `wanderer`: boolean（“浪迹天涯”）
  - `avatarMode`: `"wechat" | "custom"`
  - `avatarFileId`: string（custom 时上传；wechat 时为空，前端用 RockUsers.avatarUrl）
  - `oneLiner`: string（由 LLM 生成/也允许手动覆盖）
  - `oneLinerStyle`: `"encourage" | "humor"`
- 背面字段（back）
  - `photoFileId`: string（背面照片 fileID）
  - `story`: string（背面文字故事，LLM 输入源）
- 元信息
  - `createdAt`/`updatedAt`: number（Date.now）
  - `created_at`/`updated_at`: serverDate（与现有集合一致）

### 2) RockCardGifts（赠送记录）
- `cardId`: string
- `fromOpenid`: string
- `toOpenid`: string（direct 方式必填；link 方式为空）
- `method`: `"link" | "direct"`
- `status`: `"pending" | "claimed" | "cancelled"`
- `claimedByOpenid`: string
- `createdAt`/`claimedAt`: number
- `created_at`/`updated_at`: serverDate

### 3) RockGymWalls（墙实例，每馆 1 个）
- 本期调整：墙为“默认存在”，不再需要馆长创建与权限校验；实现上可直接只使用上墙记录集合 RockGymWallCards。

### 4) RockGymWallCards（上墙记录，多条）
- `gymId`: string
- `wallId`: string
- `cardId`: string
- `ownerOpenid`: string（冗余快查）
- `createdByOpenid`: string（冗余快查）
- `snapshot`: object（用于墙列表渲染，避免每次 join）
  - `displayName/title/mbti/oneLiner/avatarFileId/avatarMode`
- `hungByOpenid`: string
- `hungAt`: number（用于排序/删最老）
- `created_at`: serverDate

### 5) RockCardCredits（每日 credit 账本）
- `openid`: string
- `date`: string（YYYY-MM-DD，按 Asia/Shanghai）
- `limit`: number（默认 10）
- `used`: number
- `updated_at`: serverDate

## Proposed Changes（具体改动与文件级落点）

### A. 云函数：名片 CRUD、赠送、上墙、LLM 生成
新增云函数（目录均在 [cloudfunctions](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/)）：
- `rock_card_upsert`
  - 入参：`{ cardId?, mode: "self"|"giftDraft", card: {front, back}, generateOneLiner?: boolean }`
  - 行为：
    - self：ownerOpenid = 当前 openid
    - giftDraft：ownerOpenid 为空，createdByOpenid = 当前 openid
    - 每次“新增/修改”消耗 1 credit（见 RockCardCredits）；不足则拒绝并提示“今日灵感额度已用完”
    - 可选调用 `rock_llm_one_liner` 生成 oneLiner（只用 back.story；支持风格参数）
- `rock_card_get`
  - 入参：`{ cardId }`
  - 鉴权：owner 或 createdBy 可读；link 领取页需要读 gift 对应 card（通过 gift 云函数间接返回）
- `rock_card_list_my`
  - 返回：`myPrimaryCard`、`myCards`（ownerOpenid==我）、`myCreatedGiftedCards`（createdByOpenid==我且 ownerOpenid!=空）
- `rock_card_gift_manage`
  - `action="create_link"`：从 giftDraft cardId 创建 gift（status=pending），返回 `giftId` + 供分享的 `page/scene`（复用 share_card_render）
  - `action="create_direct"`：输入 `toOpenid`，将草稿卡 ownerOpenid 直接设为 toOpenid 并创建 gift 记录
  - `action="get"`：领取页加载 gift 详情与名片预览（必要字段）
  - `action="claim"`：将 gift 标记 claimed；若 card 尚未归属则 ownerOpenid=当前 openid
    - 若当前用户不存在 primary 卡：将本 card 设为 `isPrimary=true`
    - 若已存在 primary 卡：本 card 保持 `isPrimary=false`，在“收到的名片”里可手动“设为我的名片”（会自动取消旧 primary）
  - 统一限制：每次 create_link / create_direct 都消耗 1 credit（“制作赠送名片”）
  - 名片夹容量校验：领取/直送落到收件人时，若收件人已拥有 100 张“他人赠送卡”，则拒绝入库并提示需要先删卡
  - `action="cancel"`：仅创建者可取消未领取 gift（可选）
  - `action="get"`：返回墙信息（固定容量 100；是否已有上墙记录等）
  - `action="get"`：返回墙信息（是否已创建/容量等）
  - `action="list_cards"`：查询 wall 最新 100 张（按 hungAt desc）
  - `action="hang"`：校验 gymId 合法且岩馆存在；校验名片权限（owner 或 createdBy）；去重后插入新记录；如超出 capacity 删除最老记录
  - `action="unhang"`：移除指定 cardId 的上墙记录（仅 hungBy 或 owner/createdBy）
  - 入参：`{ story, style: "encourage"|"humor", displayName?, title?, mbti?, gyms? }`
  - 入参：`{ story, displayName?, title?, mbti?, gyms? }`
  - 读取环境变量：
    - `LLM_BASE_URL`（例如 `https://xxx/v1`）
    - `LLM_API_KEY`
    - `LLM_MODEL`

需要同步更新的现有云函数：
- `rock_init`：把新集合加入 checks 清单，便于开发期自检。  
  - [cloudfunctions/rock_init/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_init/index.js)

#### A.1 云函数清单（修正版，以此为准）
> 为避免与并行改动产生冲突，本段只做“增补与纠偏说明”，不删除上方原文；如上方出现重复/串行，请以本段为准。

- `rock_card_upsert`
  - 用途：创建/更新“我的名片”、创建/更新“赠送草稿卡”
  - credit：每次成功写入消耗 1（不足直接返回 ok=false + 明确提示）
- `rock_card_get`
  - 用途：查看名片详情（墙/名片夹/领取页预览复用）
- `rock_card_list_my`
  - 用途：返回“我的主名片 + 名片夹摘要 + 我送出的名片摘要 + 今日 credit 剩余”
- `rock_card_manage`
  - `action="set_primary"`：将某张卡设为我的主名片（自动取消旧 primary）
  - `action="remove_received"`：删除名片夹中的一张卡（仅 owner；禁止删自己的主名片）
- `rock_card_gift_manage`
  - `action="create_link"`：从 giftDraft cardId 创建 gift（pending）并返回可分享参数（page/scene）
  - `action="create_direct"`：输入 `toOpenid`，将草稿卡归属给对方并创建 gift 记录
  - `action="get"`：领取页加载 gift + 卡片预览
  - `action="claim"`：领取 gift，将卡片归属给领取者（若领取者名片夹满则拒绝）
  - credit：create_link/create_direct 各消耗 1
- `rock_gym_wall_manage`
  - `action="get"`：墙默认存在，仅返回容量/总数/岩馆信息等
  - `action="list_cards"`：最新 100 张（hungAt desc）
  - `action="hang"`：允许 owner 或 createdBy 上墙；重复上墙刷新到最新；超出容量删最老
  - `action="unhang"`：仅 hungBy 或 owner/createdBy 可移除
- `rock_llm_one_liner`
  - 入参：`{ story, style: "encourage"|"humor", displayName?, title?, mbti?, gyms? }`
  - 输出：严格 1 行纯文本；风格由 style 控制（见下方 Prompt 设计修订）

### B. 小程序：页面入口、名片编辑/展示、赠送/领取、墙展示/上墙
新增页面（都需要加入 [miniprogram/app.json](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/app.json) 的 pages 列表）：
- `pages/card-edit/index`：名片编辑（含上传图片、生成一句话）
- `pages/card-gift/index`：制作并赠送（选择“链接领取”或“直接赠送到对方ID”）
- `pages/card-claim/index`：领取名片（通过 scene/giftId 打开）
- `pages/card-wallet/index`：名片夹（收到的名片列表、设为我的名片、删除名片）
- `pages/wall/index`：某岩馆的攀岩墙（gymId 传参；墙列表 + 上墙按钮）

改造现有页面入口：
- `pages/me/index.wxml|js`：重排为“情绪价值主入口”
  - 顶部卡片区域直接展示“我的名片”（可翻面）；无名片则展示“初始化名片”按钮
  - 下方新增“名片夹”卡片：展示若干缩略图 + “累计收到 X 张” + 进入名片夹页
  - 保留原有“同步微信头像昵称 / 馆长后台 / 管理日志”
  - 额外展示“我的用户ID（openid）”并提供复制按钮（用于 direct 赠送）
- `pages/checkin/index.wxml|js`：新增“攀岩墙”入口（gymId 已在页面上下文）
  - 本期移除“馆长创建墙”能力（墙默认存在）

新增 API 封装（沿用现有 callCloud 习惯）：
- `miniprogram/services/api/card.js`：upsert/get/listMine
- `miniprogram/services/api/cardGift.js`：createLink/createDirect/get/claim/list
- `miniprogram/services/api/wall.js`：get/listCards/hang/unhang

图片上传实现（前端）：
- 在 card-edit/card-gift 页面实现：
  - `wx.chooseMedia` 或 `wx.chooseImage`
  - `wx.cloud.uploadFile` 上传到 `cards/<openid>/<timestamp>.<ext>`
  - 保存返回的 fileID 到 RockCards

### C. 名片风格与标题库
- 在前端内置“头衔 title”候选列表（可持续扩充），并提供：
  - 选择列表 + “随机一个”
  - 允许自定义输入覆盖
- 名片 UI：暗色底 + 紫/黄强调色（沿用项目配色记忆：紫 #8F7BFF，黄 #F2C14E）。

## LLM Prompt 设计（落地到 rock_llm_one_liner）
目标：输出一句“幽默风趣、隐晦、牙尖嘴利但不恶毒”的攀岩名片正面文案。
- 输入：背面故事 `story`（必填），可选拼接姓名/头衔/MBTI/常去岩馆。
- 输出约束：
  - 只输出 1 句中文（不换行、不加引号、不加解释）
  - 18～30 字左右优先（过长则截短）
  - 不使用脏话/人身攻击/敏感内容
  - 可以用“攀岩黑话”、比喻、反讽，但保持友好

### Prompt 设计修订：风格=鼓励/幽默
- `style="encourage"`（鼓励向）
  - 目标：像训练搭子一样“稳住、你可以、今天也算赢”，带一点俏皮，但整体更温暖
  - 典型输出：更偏积极、夸夸、给台阶下（强调过程、心态、复盘）
- `style="humor"`（幽默向）
  - 目标：风趣+牙尖嘴利但不恶毒；更偏“梗”与隐晦的反讽
  - 典型输出：像你给的例子“用嘴攀岩者”这种，不直白讲事故细节，但能让人会心一笑

## 情绪价值设计（UI/交互层面的加分项）
> 不增加复杂社交系统的前提下，用“低成本高反馈”的方式让用户持续获得情绪价值。
- 名片生成体验
  - 生成按钮文案分风格：例如“给我来句鼓励的 / 来句阴阳怪气的”
  - 生成结果支持“一键再来一句”（消耗 credit 前先二次确认，避免误触）
  - 生成失败时给“可爱的错误提示”（比如“模型今天也在热身，稍后再试”）
- credit 机制的情绪表达
  - 在“我的”页显式展示：今日灵感次数 `剩余/10`，并用轻量文案解释“0 点刷新”
  - 用完时不冷冰冰报错：提示“今天先收工，明天 0 点再来继续嘴硬/继续夸夸”
- 墙的情绪价值
  - 上墙成功 toast：比如“已把你挂上墙了（物理意义）”
  - 墙满自动删最老时的提示：比如“墙有点挤，先把最早那位请下去透气了”

## Verification（验收与自测步骤）
> 实施阶段会按这些步骤自测，不依赖云端控制台日志。
- 数据层：
  - 创建/更新我的名片成功：字段完整、翻转显示正常
  - 上传图片可用：fileID 可预览，正反面都能显示
  - 赠送：
    - 生成链接 gift：领取页可打开、领取后归属正确、重复领取被拒绝
    - 直接赠送：输入对方 ID 后对方可在“收到的名片”看到并可设为自己的名片
  - 攀岩墙：
    - 馆长创建墙后，普通用户可进入墙页查看
    - 上墙成功：新增后按最新排序展示
    - 满 100 自动删最老（用脚本/重复操作验证）
- LLM：
  - 未配置环境变量时给出明确错误提示（不泄露任何 key）
  - 配置后生成 oneLiner 符合输出约束（1 句、隐晦有趣）

### Verification 修订补充（以新增需求为准）
- 墙默认存在：任意岩馆进入墙页即可看到空态；无需馆长创建
- 名片夹容量：收到名片达到 100 后，继续领取/直送应被拒绝，并引导用户先删除旧卡
- credit：
  - 每次“保存我的名片”成功消耗 1，达到 10 次后当天拒绝继续保存/赠送
  - 0 点后自动恢复（以 Asia/Shanghai 日期切换为准）
- 风格切换：同一故事用鼓励/幽默分别生成时，保存的仅为“当前选择”，再次生成会覆盖

## Out of Scope（本期明确不做）
- 多模态读图生成文案（后续再接）
- 复杂的社交关系/好友体系 UI（目前 direct 方式用“对方ID”实现）
- 墙的高级管理（置顶/精选/审核/举报等）
