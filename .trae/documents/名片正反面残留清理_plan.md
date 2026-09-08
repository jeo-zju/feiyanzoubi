# 名片正反面残留清理 实施方案

## 仓库调研结论

当前名片原设计为"正反两面"（正面：姓名/头衔/MBTI/一句话/常去岩馆；背面：照片+故事），现已简化为单面。经全量代码扫描，**残留的反面/背面代码分布在 7 个模块共 15+ 处**，分三类：

### A. 用户可见的 UI 残留（最高优先级）

| 文件 | 位置 | 残留内容 |
|------|------|----------|
| [card-view/index.wxml](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/card-view/index.wxml#L7-L24) | L7, L19-24 | 文案"正面/反面都能保存到相册"；4 个按钮：预览正面 / 预览反面 / 保存正面 / 保存反面 |
| [card-view/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/card-view/index.js#L207-L316) | L230-251, L313-316 | `renderBack()`、`saveBack()` 方法；`drawBackCard` 导入 |
| [cardRenderer.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/utils/cardRenderer.js#L249-L323) | L249-323 | 完整 `drawBackCard()` 函数，含"背面故事"标题文字；L331 导出 |
| [card-view/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/card-view/index.js#L8-L54) | L8-54, L74-76, L122-131, L211-218, L235-242 | 大量 `debug-point A/B/C/D + reportDebug` 调试代码（专为排查正反面覆盖问题写的） |

### B. 云函数数据结构 & 校验残留（次高优先级，不清理会影响新功能）

| 文件 | 位置 | 残留内容 |
|------|------|----------|
| [rock_card_upsert/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_upsert/index.js#L61-L82) | L61, L79-82, L128 | `normalizeCard()` 保留 `back` 字段（photoFileId+story）；**L128 强校验 `back.story` 非空** 否则报错 —— 这是前端 profile-edit 必须塞默认值的根因 |
| [rock_card_upsert/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_upsert/index.js#L165-L186) | L171, L182 | 新建/更新时将 `back` 写入 RockCards 文档 |
| [rock_card_gift_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_gift_manage/index.js#L182-L186) | L185 | `get` action 返回 card 时附带 `back` 字段（做了 pending 隐藏） |
| [admin_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/admin_manage/index.js#L224) | L224 | 后台查询时回传 `item.back` |
| [rock_card_manage/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/cloudfunctions/rock_card_manage/index.js#L56-L57) | L57 注释 | "不需要背面故事" —— 属于注释残留，代码本身已正确 |

### C. 前端兼容 & 注释残留（低优先级，但不删会造成认知负担）

| 文件 | 位置 | 残留内容 |
|------|------|----------|
| [profile-edit/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/profile-edit/index.js#L335-L341) | L335-340 | 新用户创建名片时硬塞 `back: { story: "飞岩走壁，攀无止境" }` 默认占位（为绕过 upsert 的必填校验） |
| [profile-edit/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/profile-edit/index.js#L335) | L335 注释 | "upsert 要求背面故事非空，用默认占位" |
| RockCards 集合（数据） | 所有历史文档 | `back: { photoFileId, story }` 子对象 —— **保留但不再写入，不做物理迁移**（兼容历史数据即可） |
| 文档 / 方案 md | `.trae/documents/*`、`PROJECT_NOTES.md`、`ARCHITECTURE.md`、`debug-card-face-overwrite.md` | 大量正反面描述 —— 方案文档不在代码执行路径，保留即可，不作为本次改动范围 |

---

## 清理范围（涉及文件清单）

### 必改（7 个文件）
1. `miniprogram/pages/card-view/index.wxml` —— 去掉正反面按钮组，改为单"预览/保存"
2. `miniprogram/pages/card-view/index.js` —— 删 `renderBack/saveBack`，删 debug-report 代码，导入移除 `drawBackCard`
3. `miniprogram/utils/cardRenderer.js` —— 删 `drawBackCard()` 函数，从 exports 移除
4. `cloudfunctions/rock_card_upsert/index.js` —— 去掉 `back.story` 必填校验；`normalizeCard` 中 back 字段保留但不再强制非空（兼容老数据读取）；新建时不再写入 back
5. `cloudfunctions/rock_card_gift_manage/index.js` —— 返回 card 时不再附带 `back` 字段
6. `cloudfunctions/admin_manage/index.js` —— 返回 card 列表时不再附带 `back` 字段
7. `miniprogram/pages/profile-edit/index.js` —— 新建名片时不再塞 `back.story` 默认占位

### 不改（2 类）
- **RockCards 历史数据的 `back` 字段**：不做数据迁移，保留原文档结构。后续新写入的卡不再含 `back`，已有的 back 仅作为"历史快照"存在，代码路径不再读取。
- **Markdown 文档（方案/笔记/调试记录）**：在 `.trae/documents/`、`PROJECT_NOTES.md`、`ARCHITECTURE.md` 中的正反面描述属于历史文档，不影响运行。如需清理可单独发起文档整理任务。

---

## 实施步骤（按依赖顺序）

### Step 1：云函数 rock_card_upsert —— 解除 `back.story` 强校验（先做，否则 Step 6 会失败）
- `normalizeCard()` 中：`back` 结构保留（从 `event.card.back` 解构）但不再用 `clampText` 强制处理 —— 允许为空对象 `{}`
- **删除** L128：`if (!normalized.back.story) return fail("BAD_REQUEST", "背面故事不能为空", tid);`
- 新建名片时（L165-176）：`doc` 中**不再写入 `back` 字段**（即去掉 `back: normalized.back`）
- 更新已有名片时（L180-186）：`patch` 中**不再合并 `back`**（去掉 `back: { ...existing.back, ...normalized.back }`）
- 结果：老卡原有的 back 保留不动，新卡 / 更新不再写入新 back

### Step 2：云函数 rock_card_gift_manage —— 返回值剔除 back
- `get` action（L182-186）：返回 `card` 时只保留 `{ _id, front }`，删除 `back: giftStatus === ... ? ... : card.back` 整行
- 结果：赠送 / 领取链路不再暴露任何背面信息

### Step 3：云函数 admin_manage —— 返回值剔除 back
- L224 附近：`back: item.back && ... ? item.back : {}` 整行删除，只保留 `front`
- 结果：后台也不再看背面（本来就是冗余）

### Step 4：前端 cardRenderer.js —— 删 drawBackCard + 导出
- 删除 L249-323 整个 `drawBackCard()` 函数体
- `module.exports` 中去掉 `drawBackCard,`（保留 `drawFrontCard, flushCanvas`）
- 同步清理 L282 / L308 两处"背面故事"字符串（随函数一起删）

### Step 5：前端 card-view 页面 —— 改成单预览 + 单保存
- **WXML**：
  - L7 文案：`正面/反面都能保存到相册` → `保存到相册`
  - 删除 L18-21 整个"预览正面/预览反面"按钮行（`<view class="row mt2">...</view>`）
  - 删除 L22-25 整个"保存正面/保存反面"按钮行，**替换**为单按钮：`<view class="btn btn-primary flex mt2" bindtap="onSave">保存到相册</view>`
- **JS**：
  - L4 导入：移除 `drawBackCard,`，只留 `{ drawFrontCard, flushCanvas }`
  - 删除 L8-54 整个 `reportDebug` 调试块（含 `#region debug-point A` 包裹的所有代码）
  - 删除 L74-76、L122-131、L211-218、L235-242 所有 `#region debug-point X` 代码块
  - 删除 L230-251 `renderBack()` 方法
  - 删除 L309-316 `saveFront()` / `saveBack()` 两个方法
  - **改写** L207-228 `renderFront()` → 重命名为 `render()`，去掉 debug-report，其余逻辑保持（仍然调 drawFrontCard）
  - **新增** `onSave()` 方法：顺序调用 `this.render()` + `this.saveCurrent()`
  - `onLoad` / `load` 中最后 `await this.renderFront()` → 改成 `await this.render()`
  - L126-128 的 `hasBack / hasStory / hasPhoto` 状态判断块（在 load 的 debug 报告里）随 debug 代码一并删除

### Step 6：前端 profile-edit —— 新建名片不再塞默认 back.story
- L335-340 新建名片块：
  ```js
  // 删掉下面这整段
  await cardApi.upsert({
    card: {
      front: frontSync,
      back: { story: "飞岩走壁，攀无止境" }  // ← 删除这行
    }
  });
  // 改为只传 front
  await cardApi.upsert({ card: { front: frontSync } });
  ```
- L335 注释"upsert 要求背面故事非空，用默认占位" → 删除这条注释（校验已在 Step 1 解除）

### Step 7：回归检查
- 对上述 7 个改动文件，重新 grep 一遍 `back|反面|背面|drawBack|renderBack|saveBack`，确保无漏网残留

---

## 依赖关系与注意事项

- **执行顺序必须 Step 1 → Step 6**：因为 Step 6 移除了默认 back.story，若先改前端但云函数还在强校验，新用户保存资料会报"背面故事不能为空"。
- **历史数据不迁移**：RockCards 原有的 `back` 字段是合法存储，只是代码不再读写。这样避免全表扫描风险，也不破坏线上数据。
- **pickCardSnapshot / snapshotFromCard 已经是正面扁平快照**：`rock_card_list_my`（L50-63）和 `rock_gym_wall_manage`（L23-35）的快照函数本身只取 `front.*`，本次不需改动。
- **赠送链路的权限隐藏**：`rock_card_gift_manage` 中 pending 状态对陌生用户隐藏 back 的逻辑已无意义，直接整个字段剔除比做空对象更干净。

---

## 验证方式

1. **手动冒烟**（真机 / 开发者工具均可）：
   - 进入"我的" → 点击名片 → 进入 card-view：应只有一个"保存到相册"按钮，无"预览反面 / 保存反面"；文案不再出现"正反面"字样。
   - 点击保存到相册 → 正常保存正面图到相册。
   - 退出登录 → 用新微信号登录 → 进入资料页随便改个昵称 → 保存：应正常成功（不再因缺少 back.story 报错）。
   - 保存后回到"我的"，主名片能正常显示一句话 / 头像。

2. **赠送链路验证**：
   - 生成一张赠送草稿 → 生成领取码 → 用另一个号领取 → 领取页 card-claim 正常显示 front 字段（displayName / title / oneLiner）。
   - 领取后在 card-view 里查看，同样只有单保存按钮。

3. **静态校验**（代码扫描）：
   ```
   全局搜索：反面|背面|drawBackCard|renderBack|saveBack|\.back\b
   预期命中：仅在 .md 文档 / 历史注释中，业务代码（.wxml/.js/.wxss/云函数.js）中为 0。
   ```

---

## 风险与处理

| 风险 | 影响 | 处理方式 |
|------|------|----------|
| Step 1 删除必填校验后，老版本小程序前端（未更新的用户）调用 upsert 仍传了空 back —— 不会报错但也不写 back | 无感知：老代码逻辑不变，传了 back 也会在 Step1 中被丢弃（不写入 doc），和新版本结果一致 | 可接受 |
| 若未来想恢复"故事/照片"字段（不叫反面了，改名成正面内的 `story` / `photos`） | 数据层还有历史 back.story 可做一次性迁移脚本 | 本次先不迁移，留数据不动；如果真要复用，单独写迁移 SQL 即可 |
| card-view 中 `saveCurrent` 是先 canvas 生成再保存，但改完后 render() 可能在 onShow 已跑过 —— 需确保 onSave 内部再调一次 render() | 避免 canvas 被用户切换后内容变脏 | onSave 内显式 `await this.render()` + `await this.saveCurrent()`，已在 Step 5 写明 |
