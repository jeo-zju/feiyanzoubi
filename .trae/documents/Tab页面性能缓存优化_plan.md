# Tab页面性能缓存优化计划（三次审视修订版）

> 本计划已通过三次自审：①遗漏优化点补全 ②用户体验风险排除 ③功能正确性风险约束固化

---

## 一、代码库调研结论（已核对）

### 1.1 当前Tab结构
小程序共3个Tab页，定义在 [app.json](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/app.json#L46-L71)：
- Tab1：首页 `pages/home/index`
- Tab2：我的日历 `pages/calendar-mine/index`
- Tab3：我的 `pages/me/index`

### 1.2 重复加载问题诊断（已逐条核对源码）

通过分析三个Tab页面的 `onShow` 生命周期，发现以下**跨Tab重复云函数调用**问题：

| 云函数 | 调用方 | 触发频率 |
|---|---|---|
| `user_manage:me` (getMe) | 首页onShow + 我的onShow | 每次Tab切换×2 |
| `rock_card_list_my` (listMy) | 首页onShow + 我的onShow | 每次Tab切换×2 |
| `calendar_mine` (mine+includeSummary) | 首页onShow + 我的日历onShow | 每次Tab切换×2 |
| `friendship_manage:list` | 首页onShow内部调用2次（红点+好友统计） | 每次显示×2 |
| `rock_gym_list` (list by city) | 首页onShow | 每次显示 |
| `circle_manage:myList` | 首页onShow | 每次显示 |

**额外诊断（首次审视补充）：**
- `pages/me/index.js` 每次 onShow 全量重画 canvas（下载头像→draw→canvasToTempFilePath），这是**UI卡顿最大瓶颈**，远超云函数延迟。
- `pages/me/index.js` 每次 onShow 重新计算 windowWidth 算卡片尺寸，该值永不变化。
- `pages/calendar-mine/index.js` 的30天 stats 每次冷启动都重新拉，实际每日一变。
- 所有 Storage 操作未加 try-catch，极端场景（存储满/数据损坏）有崩溃风险。

### 1.3 现有缓存设施
- `app.globalData` 中仅零散存放 `user` 和 `me`（纯L1，冷启动丢失）。
- `wx.setStorageSync` 仅存 `home_city` 和 `lastGymId`，利用率极低。
- 无统一缓存层，无TTL管理，无缓存版本号。

---

## 二、缓存策略与分层架构（已通过三次审视）

### 2.1 数据分级与缓存策略

**【第二次审视锁定】核心原则：缓存未过期 = 完全不发网络请求（不做无意义SWR），仅缓存过期时才静默后台刷新，避免界面"旧→新"闪烁。**

按数据变化频率分为三类，对应不同缓存层和TTL：

| 级别 | 数据类型 | 缓存层 | TTL | 备注 |
|---|---|---|---|---|
| **A-半静态** | 用户资料(me)、岩馆列表(按城市)、我的岩友圈、名片/积分摘要 | **L2本地Storage + L1内存** | 30~120min | 跨冷启动复用 |
| **B-中动态** | 日历统计摘要、好友统计、好友申请红点、30天stats摘要 | **L1内存globalData** | 3~60min | Tab切换间复用，冷启动不命中 |
| **C-实时** | 首页日历热力图(日期聚合)、岩馆下岩友圈列表 | 不缓存 | - | 保证实时性 |

**【首次审视补充A类+】：我的名片卡面渲染PNG文件 → 存 `wx.env.USER_DATA_PATH/my_card_${fingerprint}.png`，指纹匹配直接用，跳过canvas重绘。**

### 2.2 两层缓存架构（已加容错约束）

```
调用方 (pages/*/index.js)
       ↑
  cache.get(key, { ttlMin, loader, forceRefresh, useL2 })
       ├─ 命中L1 + TTL有效 ──────────────────────► 直接返回（不发请求）
       ├─ L1 miss → 命中L2 + TTL有效 ──► 回填L1 ─► 返回（不发请求）
       └─ L1/L2 miss 或 TTL过期 → 调 loader(云函数) → 写L2(可选) → 写L1 → 返回
                                     （forceRefresh=true 强制走此分支，跳缓存）
```

**【第三次审视硬约束】cache.get 内部所有操作必须 try-catch，任何异常 → 直接 fallback 调用 loader（等同于无缓存，功能不退化）。**

**【第三次审视硬约束】缓存key必须带版本前缀 `_cache_v1_`，未来改结构改 `_v2_` 天然不读旧脏数据。**

### 2.3 首页预加载（Pre-warm）（已加时机约束）

**【首次+第三次审视锁定】**：首页 `loadAllHome` 里的所有任务完成后，通过 `setTimeout(() => prewarm(), 50)` 延迟到首屏渲染稳定后**非阻塞**预热：
- Tab2「我的日历」所需的 `calendar_mine summary` 数据
- Tab3「我的」所需的 `card listMy` 数据

**【第三次审视硬约束】prewarm 内所有云函数必须传 `{ loading: false, silent: true }`，不显示任何 loading，不弹错误模态；且所有 Promise 必须 .catch 吞掉错误，预加载失败绝对不能影响任何页面。**

### 2.4 缓存失效机制（已覆盖所有写操作）

1. **TTL自然过期**：严格按2.1表。**【第二次审视锁定】未过期时绝不发后台刷新请求，绝不造成界面闪烁。**
2. **主动失效（硬约束）**：
   - 用户下拉刷新 `onPullDownRefresh` → 传 `forceRefresh=true` 穿透缓存。
   - 写操作（打卡、发名片、改资料、发布计划、加好友、圈管理）→ 立即 `cache.invalidate(keyPrefix)`。
3. **登录切换清理（第三次审视锁定）**：session 中 login 返回 openid 与上一次不一致时 → 立即 `cache.clearAll()` 清掉所有缓存（A/B类+L1/L2），杜绝同设备不同微信号串数据。
4. **版本号前缀**：见2.2节。

---

## 三、修改文件清单与具体改动步骤（每条已加正确性硬约束）

### Step 1：新建统一缓存工具层 `miniprogram/utils/cache.js`（新文件）

**职责**：封装两级缓存的统一入口，所有内部逻辑**必须**包裹 try-catch，错误 fallback 直连 loader。

**核心API设计**：
```js
CACHE_KEYS 常量（全部带 _cache_v1_ 前缀）
  CACHE_KEYS.ME_PROFILE      // A类，TTL=60min，L1+L2
  CACHE_KEYS.GYM_LIST_PREFIX // A类，+ city.toLowerCase() 后缀，TTL=120min，L1+L2
  CACHE_KEYS.MY_CIRCLES      // A类，TTL=30min，L1+L2
  CACHE_KEYS.CARD_SUMMARY    // A类，TTL=30min，L1+L2
  CACHE_KEYS.CALENDAR_SUMMARY // B类，TTL=5min，仅L1
  CACHE_KEYS.FRIEND_COMBINED // B类，合并红点+好友统计一次结果，TTL=3min/10min双写
  CACHE_KEYS.STATS_30DAY     // B类，TTL=60min，L1+L2
  CACHE_KEYS.ME_CARD_FINGERPRINT // 本地PNG指纹，A类（配合本地文件）

核心函数：
  cache.get(key, { ttlMin, loader, forceRefresh=false, useL2=true })  → Promise<value>
    【硬约束】内部 try-catch，出错直接 loader()，不能让页面异常
  cache.set(key, value, ttlMin, { saveL2=true })
    【硬约束】所有 wx.setStorageSync 必须 try-catch
  cache.invalidate(prefixOrKey) // 精确删除或前缀模糊删除
  cache.clearAll()              // 登录切换/调试用，同步清L1 Map + 所有 _cache_v1_ 的Storage键
```

缓存条目结构（L1和L2统一）：
```js
{ v: 1, d: actualValue, e: expireAtMsTimestamp }
```
**【第三次审视】读L2时 `JSON.parse` 必须 try-catch，解析失败当 miss 处理。**

### Step 2：扩充 `app.js` globalData 缓存区 + 预加载调度 + 全局尺寸缓存

**文件**：[app.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/app.js#L3-L9)

**改动**：
1. `globalConstants.STORAGE_KEYS` 整合进 Step1 的 `CACHE_KEYS` 枚举（保持 `LAST_GYM_ID` 向后兼容）。
2. `globalData._cache = { map: new Map(), lastOpenid: '' }` 作为 L1 + 上一次登录openid记录。
3. `globalData._winSizeCached = null` 存一次计算过的 windowWidth（首次审视补充，我的页计算卡片尺寸用，永不变化）。
4. 暴露薄封装：`app.cacheGet / app.cacheSet / app.cacheInvalidate / app.cacheClearAll`（内部 require utils/cache.js 调用）。
5. 暴露 `app.prewarmOtherTabs()`：**【硬约束】必须在内部用 setTimeout(..., 50) 延迟执行，且所有云函数调用 silent=true、loading=false、错误不抛。**
6. `onLaunch` 时检查上一次 `wx.getStorageSync('_cache_v1_last_openid_')`，若存在且与本次登录的 openid 不匹配 → 立刻 `cache.clearAll()`（第三次审视防串号约束）。

### Step 3：改造首页 `pages/home/index.js`

**文件**：[pages/home/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/home/index.js)

**改动点（逐条加约束）**：

1. **onShow 中 getMe**：改用 `cache.get(CACHE_KEYS.ME_PROFILE, { ttlMin:60, loader:()=>userApi.getMe() })`。
   - 【体验约束】命中TTL有效 → 直接 setData，**不做**后台二次刷新。
   - 【体验约束】仅 L1/L2 都 miss 或 TTL 过期 → 发请求刷新。

2. **loadGymList**：缓存 key = `${CACHE_KEYS.GYM_LIST_PREFIX}${this.data.city.trim().toLowerCase()}`，TTL=120min。
   - 【正确性约束】key 必须 `city.toLowerCase().trim()`，避免大小写/空格重复缓存。
   - 换城市时因为 city 变了自动 key 不同，原有代码 `gymId=""` 等清空逻辑保持不变。

3. **loadCardSummary**：`CACHE_KEYS.CARD_SUMMARY` TTL=30min，L1+L2。

4. **loadCalendarStats**：`CACHE_KEYS.CALENDAR_SUMMARY` TTL=5min，仅L1。
   - 【正确性约束】首页 calendarApi.mine 参数与 calendar-mine 页完全一致（includeSummary:true, tab:upcoming, page:1, pageSize:1），代码注释写死提醒。

5. **loadFriendStats + checkNotiDot **【合并为一次调用】（首页内部重复消除！）**：
   - 【正确性硬约束】合并调用**必须用 `pageSize=20`**（取原两个调用中的最大值）。若用 `pageSize=1` 会导致 `accepted.length` 被截断，好友数统计比改造前更不准。
   - 结果存入 `CACHE_KEYS.FRIEND_COMBINED`（TTL=3min for红点，TTL=10min for好友数，或直接用 minTTL=3min 简单起见）。拆数据方式与原代码一致：
     ```js
     notiDot = (r.incoming||[]).length > 0
     stats.friends = (r.accepted||[]).length + (r.legacyFollow||[]).length
     ```
   - 【正确性约束】如果云函数有独立 `acceptedCount` 字段则优先用字段，没有则用数组长度（**与改造前行为完全一致**，不引入新偏差）。

6. **loadMyCircles**：`CACHE_KEYS.MY_CIRCLES` TTL=30min L1+L2。

7. **loadCalendar + loadGymCircles**：保留 **完全不缓存**（C类实时数据），保证时效性。

8. **loadAllHome 全部任务完成后**：调用 `setTimeout(() => { try{ app.prewarmOtherTabs() }catch(_){} }, 50)` 预热Tab2/3。**【硬约束】绝对不能 await prewarm，绝对要在 setTimeout 内。**

9. `wx.setStorageSync("home_city", ...)` 加 try-catch。

### Step 4：改造「我的日历」 `pages/calendar-mine/index.js`

**文件**：[pages/calendar-mine/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/calendar-mine/index.js)

**改动点**：

1. **onShow/loadAll 中 calendarApi.mine(includeSummary)**：优先读 `CACHE_KEYS.CALENDAR_SUMMARY`（与首页共享key，因为参数一致）。
   - 【体验约束】TTL有效 → 直接渲染，**不做**后台二次刷新。
   - 过期 → 静默后台刷新 + setData（SWR，仅这一种情况允许SWR）。

2. **loadStats（summary 30天）**：结果存入新增 `CACHE_KEYS.STATS_30DAY` TTL=60min，L1+L2（首次审视补充，30天数据变化频率极低）。
   - onPullDownRefresh：forceRefresh=true 穿透缓存。
   - onShow中 TTL 内不刷新。

3. 现有的 `_onShowRunning` 防抖锁保持不变，与缓存无冲突。

### Step 5：改造「我的」 `pages/me/index.js`

**文件**：[pages/me/index.js](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/me/index.js)

**【首次审视锁定最大性能瓶颈消除：canvas渲染缓存】**

1. **onShow 中 getMe**：同首页，`CACHE_KEYS.ME_PROFILE` TTL=60min。

2. **computeMyCardSize**：
   - 【首次审视补充】windowWidth 永不改变，改用 `app.globalData._winSizeCached`；没缓存时算一次写进去。
   - 避免每次 onShow 都调 `getWindowWidth()`（虽然开销小但完全没必要）。

3. **loadCardSummary**：
   - `CACHE_KEYS.CARD_SUMMARY` TTL=30min。
   - 返回后计算**卡面指纹**：
     ```js
     const fingerprint = [
       nextPrimaryCard && nextPrimaryCard.cardId,
       nextPrimaryCard && nextPrimaryCard._updateTime || '',
       this.data.me && (this.data.me._updateTime || this.data.me.updatedAt || ''),
       JSON.stringify(nextPrimaryCard||{}).length
     ].join('_');
     ```
   - 将 fingerprint 存入 `CACHE_KEYS.ME_CARD_FINGERPRINT`（本地同步Storage即可，不用TTL）。

4. **renderMyCard  canvas渲染缓存（关键！）**：
   - 进入函数时：
     a. 计算当前数据 fingerprint；
     b. 读 Storage 里的上次指纹 + 本地PNG路径（`wx.env.USER_DATA_PATH/my_card_${fingerprint}.png`）；
     c. 用 `wx.getImageInfo({ src: 本地路径 })` 校验文件存在且可读；
     d. **命中指纹+文件存在 → 直接 setData({ myCardPreviewImage: 本地路径 })，return，跳过 canvas 全流程**（这步省掉 90% 的"我的"页卡顿时间）。
   - 未命中 → 按现有逻辑 canvas 绘制 → 导出 `canvasToTempFilePath` → 再调 `wx.saveFile({ tempFilePath, success:r => 存本地永久路径到 Storage })` + 存当前 fingerprint。
   - 【容错约束】每一步文件操作、canvas 操作全部 try-catch；失败就降级走原重绘逻辑，绝不让页面崩。
   - 卡片数据没变化 → 绝不多画一次canvas。

5. `myCardPreviewImage` 的 tempFilePath **不缓存**（微信临时文件不稳定），但 saveFile 后的 USER_DATA_PATH 永久路径缓存。

### Step 6：写操作后的缓存失效点（全量梳理，【第二次审视锁定】必须全部命中，否则体验脏数据）

| 操作文件 | 操作成功后必须 invalidate 的 key |
|---|---|
| `pages/profile-edit/index.js` 保存资料 | `CACHE_KEYS.ME_PROFILE`, `CACHE_KEYS.ME_CARD_FINGERPRINT`（触发卡面重绘） |
| `pages/card-edit/index.js` 保存名片 | `CACHE_KEYS.CARD_SUMMARY`, `CACHE_KEYS.ME_CARD_FINGERPRINT` |
| `pages/calendar-publish/index.js` 发布计划 | `CACHE_KEYS.CALENDAR_SUMMARY`, `CACHE_KEYS.STATS_30DAY` |
| `pages/checkin/index.js` 打卡成功 | `CACHE_KEYS.CALENDAR_SUMMARY`, `CACHE_KEYS.CARD_SUMMARY`, `CACHE_KEYS.ME_CARD_FINGERPRINT`, `CACHE_KEYS.STATS_30DAY` |
| `pages/friend-list/index.js` accept/reject 好友 | `CACHE_KEYS.FRIEND_COMBINED`（红点+统计一起失效） |
| `pages/circle-edit/index.js` 创建/编辑/解散圈 | `CACHE_KEYS.MY_CIRCLES` |
| `pages/circle-detail/index.js` 申请/批准/退出圈 | `CACHE_KEYS.MY_CIRCLES` |
| `pages/card-gift/index.js` 赠送名片成功 | `CACHE_KEYS.CARD_SUMMARY`, `CACHE_KEYS.ME_CARD_FINGERPRINT` |
| `pages/card-claim/index.js` 收名片成功 | `CACHE_KEYS.CARD_SUMMARY` |

**【二次审视硬约束】每个写操作文件必须在 `wx.showToast({ title:'成功' })` 的前一行调用 `app.cacheInvalidate(xxx)`，顺序不能反。**

---

## 四、微信小程序规范合规（已核对）

1. **Storage 上限10MB**：本方案仅缓存结构化JSON小数据（A+B类总计 < 100KB）+ 1张名片PNG（≈300~800KB），**总占用 < 1MB**，远低于限制。
2. **StorageSync 同步API**：数据量小可安全使用同步接口，不阻塞UI。所有操作 try-catch（Step1硬约束）。
3. **用户隐私合规**：仅缓存**当前登录用户**自身的资料、名片、岩馆公开列表等非敏感信息；不存第三方隐私；符合《微信小程序隐私保护指引》。
4. **onHide/onUnload 不堆积写操作**：所有 Storage 写入都在云函数返回成功后立即执行，不在生命周期卸载时批量写入。
5. **离线可用增强**：无网时 L2 Storage 命中旧数据直接显示（而非空白加载页），是体验正向增强；网络恢复后下次 TTL 过期自动刷新。

---

## 五、风险矩阵与应对（已填入三次审视发现的所有风险）

| 风险 | 概率 | 影响 | 具体应对措施（已固化为硬约束） |
|---|---|---|---|
| 同设备切换微信号 → B看到A缓存 | 低 | 极高（隐私） | Step2.6：login openid 不一致 → 立即 `cache.clearAll()` 全清 |
| 写操作后未及时失效 → 看到旧数据 | 中 | 中高（挫败感） | Step6：每个写操作文件逐个核对加失效调用 + TTL兜底 + 下拉refresh强制穿透 |
| SWR模式造成"旧→新"界面闪烁 | 中 | 中（视觉瑕疵） | 【原则锁定】TTL内**完全不**发网络请求；仅缓存过期这一种情况允许静默刷新，且静默刷新不闪（setData相同字段值） |
| friendship合并 pageSize=1 → 好友数错误 | 高（一旦写错） | 高（功能bug） | Step3.5 文档写死 + 代码注释写死：**必须pageSize=20**，并在实现时 double-check |
| cache.js 异常导致页面崩溃 | 低 | 极高 | Step1：cache.get 全程 try-catch，异常直接 fallback 调 loader，功能退化至改造前无缓存水平 |
| Storage 损坏/满 → parse/写入异常 | 极低 | 高 | 所有 `JSON.parse`、`wx.getStorageSync`、`wx.setStorageSync` 全部 try-catch |
| prewarm 抢占首屏导致卡顿 | 中 | 中（首屏慢） | Step2&3：setTimeout(...,50) 延迟 + silent=true + loading=false + catch错误 |
| 卡片本地PNG被微信清理 → 找不到文件 | 低 | 低（多画一次） | Step5.4：`wx.getImageInfo` 校验文件，失败立即降级重画 + saveFile 存新的 |
| 岩馆城市大小写重复缓存 | 低 | 低（多占几KB） | Step3.2：key 必须 `city.toLowerCase().trim()` |
| 后续改参数 → calendar_mine 缓存错串 | 低 | 中 | Step4.1：代码内注释强调参数必须与首页一致；或未来给key加参数hash后缀（本次不加，保持简洁，用注释约束） |

---

## 六、验证方式（可执行checklist）

执行后用以下 checklist 验证**全部通过才算完成**：

### 体验验证
1. **冷启动→首页渲染完→切Tab2：数据秒显（预热命中L1），无 loading 遮罩。
2. **三Tab互相切换5次**：网络面板中云函数调用量从改造前 ≈18 次 → 降为 ≈3 次（仅首页C类实时日历热力图+岩馆圈有真实请求）。
3. **切Tab时绝不出现"旧数据闪一下变新"**（验证"TTL内不发请求"原则被遵守）。
4. **下拉刷新三个Tab**：所有数据都从网络重新加载，缓存被穿透并更新。
5. **关闭小程序重进**：首页用户资料、岩馆列表、名片摘要秒显示（L2命中）。
6. **"我的"页第二次进入**：卡面图片秒显，没有 canvas 绘制的卡顿延迟。

### 功能正确性验证
7. **编辑个人资料保存 → 回到"我的"页**：资料立即更新 + 卡面重绘（指纹不匹配）。
8. **发布新计划成功 → 切回我的日历Tab**：本月计划数数字增加（CACHE_CALENDAR_SUMMARY 已失效）。
9. **打卡成功 → 切回"我的"页**：积分值更新 + 卡面重绘（指纹不匹配）。
10. **接受好友申请 → 切回首页**：红点消失 + 好友数+1（FRIEND_COMBINED失效）。
11. **切换城市（上海→北京）→ 岩馆列表不串**（key按city分开）。
12. **friendship 合并调用统计好友数**：与改造前数值**完全一致**（无截断偏差）。

### 容错验证
13. **Storage 手动清空后正常启动**（相当于首次）：无报错，所有功能正常，缓存自动重建。
14. **断网状态切Tab**：能显示L2命中的旧数据（而非空白），不崩溃。
15. **prewarm 云函数全部手动 mock 失败**：不影响三Tab任何功能（静默失败）。
