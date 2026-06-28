# 岩馆自动同步设计

## 目标

为小程序补齐一套可持续更新的岩馆基础数据能力，优先解决以下问题：

1. 自动收集岩馆的基础信息：名称、地点、坐标、联系方式、来源平台。
2. 为业务侧补充明确的岩馆类型：`boulder`、`difficulty`、`mixed`、`unknown`。
3. 支持未来定时同步，避免完全依赖人工录入。
4. 保留馆长认领和人工修正入口，避免自动化误判直接污染正式库。

## 与现有项目的关系

当前项目已经存在以下基础：

- `RockGyms` 作为岩馆主集合，被首页和详情直接消费。
- `gym_owner_upsert` 已具备馆长创建、编辑岩馆和周期的能力。
- `rock_seed_gyms` 可作为一次性初始化入口，但能力偏弱，只适合手动导入。
- `rock_checkin_context` 和打卡链路会读取 `currentCycle`、`currentCycleId`、`routes`、`lines` 等字段。

因此自动同步能力不应改造现有主链路，而应新增独立同步层：

- 新增云函数 `rock_sync_gyms`
- 新增原始来源集合和审核集合
- 将自动结果写入 `RockGyms`
- 保留 `gym_owner_upsert` 作为人工覆盖入口

## 总体架构

建议采用四层结构：

1. 来源采集层
   - 地图 POI API 为主来源，优先接入一个稳定平台。
   - 可选来源：高德、腾讯位置服务、百度。
   - 后续可增加官网、公众号、点评等补充来源，但不作为第一阶段主来源。

2. 原始入库层
   - 所有外部结果先写入原始集合，不直接覆盖正式馆表。
   - 原始记录保存来源平台、原始字段、抓取时间、任务批次。

3. 归一化与匹配层
   - 统一字段格式。
   - 去重、合并、判断是否为新增馆。
   - 对高风险字段打置信度，低置信度进入审核。

4. 正式业务层
   - 只有通过规则或人工审核的数据才更新 `RockGyms`。
   - 馆长后续仍可手动修正，人工值优先级高于自动值。

## 第一阶段数据范围

第一阶段先只自动维护以下信息：

- 岩馆名称
- 省、市、区
- 详细地址
- 经纬度
- 电话
- 来源平台及来源 ID
- 岩馆类型 `gymType`
- 营业状态 `status`
- 最近同步时间

第一阶段不自动维护以下信息：

- 周期 `RockGymCycles`
- 线路黑板统计 `RockGymBlackboards`
- 具体难度分布和线路数量

原因：

- 周期和线路数据变化快，且地图源通常拿不到。
- 如果第一阶段强行同步 `routes` / `lines`，会引入大量猜测值，影响打卡可信度。
- 更合理的做法是先把馆表铺全，再让馆长或运营补周期和线路。

## 正式馆表字段设计

在现有 `RockGyms` 基础上扩展以下字段。

### 核心字段

```js
{
  name: "向山攀岩",
  normalizedName: "向山攀岩",
  aliasNames: ["向山", "XIANGSHAN CLIMB"],
  province: "浙江省",
  city: "杭州市",
  district: "西湖区",
  address: "xxx路xxx号",
  lat: 30.2741,
  lng: 120.1551,
  location: {
    lat: 30.2741,
    lng: 120.1551
  },
  phone: "0571-xxxxxxx",
  gymType: "boulder", // boulder | difficulty | mixed | unknown
  gymTypeSource: "auto_rule", // auto_rule | owner_confirmed | manual_admin
  gymTypeConfidence: 0.86,
  status: "active", // active | maybe_closed | closed
  claimedByOwner: false,
  sourceRefs: [
    {
      provider: "tencent",
      providerPoiId: "1234567890",
      providerName: "向山攀岩馆",
      fetchedAt: 1780000000000,
      lastSeenAt: 1780000000000
    }
  ],
  sourceSummary: {
    primaryProvider: "tencent",
    sourceCount: 1
  },
  syncMeta: {
    firstSeenAt: 1780000000000,
    lastSeenAt: 1780000000000,
    lastSyncedAt: 1780000000000,
    lastVerifiedAt: 1780000000000
  },
  reviewState: "approved", // approved | pending_review | rejected
  createdAt: 1780000000000,
  updatedAt: 1780000000000
}
```

### 字段说明

- `normalizedName`
  - 用于去重匹配。
  - 去除空格、括号差异、全半角差异、常见后缀差异。

- `aliasNames`
  - 保存历史别名、简称、英文名、自动识别的近似别名。

- `province/city/district`
  - 便于按城市增量同步，也便于未来筛选。

- `lat/lng`
  - 后续可支持“附近岩馆”“城市范围补抓”等能力。

- `gymType`
  - 必须显式存在，不再仅靠 `routes` 或 `lines` 间接推断。

- `gymTypeSource`
  - 记录该字段来自自动规则、馆长确认或后台人工修正。

- `gymTypeConfidence`
  - 自动判断时必须带置信度，便于审核。

- `status`
  - `active`: 最近同步能找到且无关闭信号。
  - `maybe_closed`: 多次找不到或用户反馈疑似关闭。
  - `closed`: 人工确认关闭。

- `claimedByOwner`
  - 馆长认领后自动同步只能更新低风险字段，不能直接覆盖关键字段。

## 新增集合设计

### 1. `RockGymSourceRecords`

用途：保存外部来源原始记录，所有自动结果先落这里。

```js
{
  provider: "tencent",
  providerPoiId: "1234567890",
  batchId: "sync_20260627_hangzhou_01",
  fetchedAt: 1780000000000,
  keyword: "攀岩馆",
  region: "杭州市",
  rawName: "向山攀岩馆",
  rawAddress: "杭州市西湖区xxx",
  rawPhone: "0571-xxxxxxx",
  rawLocation: { lat: 30.2741, lng: 120.1551 },
  rawCategory: "运动健身",
  rawStatus: "",
  rawPayload: { ... },
  normalized: {
    name: "向山攀岩馆",
    normalizedName: "向山攀岩馆",
    province: "浙江省",
    city: "杭州市",
    district: "西湖区",
    address: "杭州市西湖区xxx",
    lat: 30.2741,
    lng: 120.1551,
    phone: "0571-xxxxxxx"
  },
  matchResult: {
    matchedGymId: "xxxxx",
    matchType: "provider_id", // provider_id | geo_name | manual
    score: 0.95
  },
  processState: "normalized" // fetched | normalized | merged | pending_review | ignored
}
```

### 2. `RockGymReviewQueue`

用途：收纳低置信度或冲突数据，等待运营或馆长处理。

```js
{
  type: "gym_type_conflict", // new_gym | duplicate_conflict | gym_type_conflict | maybe_closed
  gymId: "xxxxx",
  sourceRecordIds: ["a", "b"],
  status: "pending", // pending | approved | rejected
  reason: "自动判断为 mixed，但现有馆长标记为 boulder",
  proposedPatch: {
    gymType: "mixed",
    gymTypeConfidence: 0.62
  },
  createdAt: 1780000000000,
  updatedAt: 1780000000000,
  handledBy: "",
  handledAt: 0
}
```

### 3. `RockGymSyncRuns`

用途：记录每次同步执行结果，便于排查和统计。

```js
{
  batchId: "sync_20260627_hangzhou_01",
  triggerType: "manual", // manual | scheduled
  provider: "tencent",
  scope: {
    provinces: [],
    cities: ["杭州市"],
    keywords: ["攀岩馆", "抱石馆"]
  },
  stats: {
    fetched: 120,
    normalized: 118,
    matched: 96,
    inserted: 8,
    updated: 21,
    pendingReview: 7,
    ignored: 14,
    failed: 2
  },
  startedAt: 1780000000000,
  finishedAt: 1780000005000,
  success: true,
  errorMessage: ""
}
```

## 岩馆类型判定规则

`gymType` 不建议依赖单一来源字段，采用规则评分。

### 规则输入

- 名称
- 分类
- 简介或标签
- 来源平台二级类目
- 电话、官网或公众号简介中的关键词
- 馆长确认结果

### 规则输出

```js
{
  gymType: "mixed",
  confidence: 0.78,
  reasons: [
    "名称命中关键词: 抱石",
    "简介命中关键词: 顶绳",
    "两个来源同时表明存在综合馆特征"
  ]
}
```

### 第一阶段关键词规则

- 命中 `抱石`、`抱石馆`、`boulder`、`bouldering`
  - `boulder += 0.6`

- 命中 `难度`、`先锋`、`顶绳`、`绳索`、`lead`、`top rope`
  - `difficulty += 0.6`

- 同时命中两类高权重关键词
  - 输出 `mixed`

- 只有弱信号，且不足以明确判断
  - 输出 `unknown`

### 覆盖优先级

字段更新优先级从高到低：

1. 后台人工修正
2. 馆长确认
3. 多来源一致的自动判定
4. 单来源自动判定

规则：

- 一旦 `gymTypeSource` 为 `owner_confirmed` 或 `manual_admin`，自动同步不得直接覆盖。
- 自动同步只允许把 `unknown` 升级为明确值，不允许低置信度覆盖人工值。

## 去重与匹配规则

自动同步的核心难点是“同一岩馆多来源去重”。

建议按以下顺序匹配：

### 一级：来源 ID 匹配

如果 `provider + providerPoiId` 已存在于某个 `RockGyms.sourceRefs` 中，则直接认定为同馆。

### 二级：名称标准化 + 坐标距离

满足以下条件之一时，可判为高置信度同馆：

- `normalizedName` 完全一致，且坐标距离小于 300 米
- `normalizedName` 高相似，且电话一致
- 名称存在“店”“馆”“攀岩”“攀石”等后缀差异，且地址高度接近

### 三级：低置信度候选

以下情况不自动合并，进入审核：

- 名称近似，但坐标相差较大
- 同一商场或园区内出现多个相似馆名
- 电话缺失，地址模糊

### 标准化建议

名称标准化至少处理以下内容：

- 去空格和连续空白
- 中文括号与英文括号统一
- 去除尾部常见噪音词：`店`、`馆`、`中心店`、`体验馆`
- 英文统一转小写
- 去掉装饰符号

## 更新策略

不同字段的自动更新风险不同，需要分级处理。

### 可自动覆盖的低风险字段

- `address`
- `province`
- `city`
- `district`
- `lat`
- `lng`
- `phone`
- `sourceRefs`
- `syncMeta.lastSeenAt`
- `syncMeta.lastSyncedAt`

### 需要谨慎覆盖的中风险字段

- `name`
- `aliasNames`
- `status`

规则：

- 若只是地址更完整，可直接覆盖。
- 若名称变化较大，保留原名并把新名称加入 `aliasNames`。
- 若连续多次同步找不到该馆，再把 `status` 从 `active` 调整为 `maybe_closed`。

### 默认不自动覆盖的高风险字段

- `gymType`
- `currentCycle`
- `currentCycleId`
- `routes`
- `lines`
- `ownerOpenid`
- `managerOpenids`

这些字段只有人工流程才允许修改。

## 关闭馆与失效数据处理

不建议因为一次同步找不到就把馆标记为关闭。

建议规则如下：

1. 同城市、多关键词、多次同步都找不到某馆来源 ID。
2. 同时最近 90 天没有用户打卡。
3. 没有馆长认领或馆长未主动维护。

满足条件后：

- 将 `status` 改为 `maybe_closed`
- 生成一条 `RockGymReviewQueue` 记录

只有在人工确认后，才允许改为 `closed`。

## 云函数设计

新增云函数：`cloudfunctions/rock_sync_gyms`

### 触发方式

- 手动触发
  - 用于开发联调、运营补抓、指定城市重刷

- 定时触发
  - 用于持续更新

### 入参设计

```js
{
  provider: "tencent", // tencent | amap | baidu
  mode: "city", // city | gym_detail | replay_source
  force: false,
  dryRun: false,
  cities: ["杭州市", "上海市"],
  keywords: ["攀岩馆", "抱石馆", "室内攀岩"],
  pageLimit: 20,
  onlyGymIds: [],
  batchId: "optional_manual_batch_id"
}
```

### 出参设计

```js
{
  ok: true,
  data: {
    batchId: "sync_20260627_hangzhou_01",
    stats: {
      fetched: 120,
      normalized: 118,
      matched: 96,
      inserted: 8,
      updated: 21,
      pendingReview: 7,
      ignored: 14,
      failed: 2
    },
    preview: [
      {
        provider: "tencent",
        name: "向山攀岩馆",
        action: "insert",
        matchedGymId: ""
      }
    ]
  },
  traceId: "xxx"
}
```

### 执行流程

#### 1. 参数校验

- 校验 `provider`
- 校验 `mode`
- 校验城市列表、关键词、翻页上限

#### 2. 建立批次记录

- 生成 `batchId`
- 在 `RockGymSyncRuns` 创建运行记录

#### 3. 拉取来源数据

- 按 `city x keyword x page` 拉取结果
- 对外部请求增加速率限制和错误重试

#### 4. 原始入库

- 每条结果写入 `RockGymSourceRecords`
- 用 `provider + providerPoiId + fetchedDate` 防重复写入

#### 5. 归一化

- 统一名称、地址、行政区、经纬度、电话
- 生成 `normalizedName`
- 运行 `gymType` 判定规则

#### 6. 匹配正式馆

- 先按来源 ID
- 再按名称和距离
- 无法确定则进入审核

#### 7. 写入正式馆表

- 新馆：插入 `RockGyms`
- 老馆：按字段级更新策略更新
- 冲突：写 `RockGymReviewQueue`

#### 8. 更新运行记录

- 更新统计
- 写入成功或失败状态

## 建议的内部函数拆分

`rock_sync_gyms/index.js` 内建议拆成以下方法：

```js
function buildBatchId() {}
function normalizeName(name) {}
function normalizePhone(phone) {}
function inferGymType(input) {}
function matchExistingGym(normalized, candidates) {}
function shouldAutoUpdateField(fieldName, currentGym, proposedValue) {}
async function fetchProviderPois(params) {}
async function saveSourceRecord(record) {}
async function upsertGymFromSource(sourceRecord, options) {}
async function enqueueReview(item) {}
async function finishSyncRun(batchId, result) {}
```

## 与现有业务兼容规则

### 1. 不直接自动生成周期

原因：

- 现有 `rock_checkin_context` 依赖有效周期。
- 周期如果自动创建错误，会直接影响打卡体验。

策略：

- 新增馆先允许 `currentCycle` 为空。
- 前端可在详情或打卡入口提示“该馆暂未维护周期”。
- 馆长认领后通过 `gym_owner_upsert` 补全周期。

### 2. 不自动覆盖馆长配置

对于已有 `ownerOpenid` 或 `claimedByOwner = true` 的馆：

- 自动同步只更新地址、坐标、来源信息、同步时间。
- `gymType`、`routes`、`lines`、周期相关字段不自动改。

### 3. 保持首页兼容

首页当前消费 `name/city/address/currentCycle/routes/lines`。

因此第一阶段即使自动同步只补馆表，也不会破坏首页：

- `name/city/address` 有值即可正常显示
- `currentCycle/routes/lines` 可为空
- 前端若已有空值容错，则无需立即修改

## 第一阶段实施建议

按最小可用路径拆分：

### 阶段 1：补字段

目标：

- 扩展 `RockGyms` 字段定义
- 不改前台交互

产出：

- `gymType`
- `province/city/district`
- `lat/lng`
- `sourceRefs`
- `syncMeta`
- `reviewState`

### 阶段 2：实现单来源手动同步

目标：

- 先接一个来源
- 先跑单城市

建议优先级：

- 若优先考虑微信生态协同，先接腾讯位置服务
- 若优先考虑 POI 搜索习惯，可优先高德

产出：

- `rock_sync_gyms`
- `RockGymSourceRecords`
- `RockGymSyncRuns`

### 阶段 3：实现审核队列

目标：

- 把冲突和低置信度结果沉淀出来

产出：

- `RockGymReviewQueue`
- 简易后台审核流程，先云函数可用即可

### 阶段 4：接定时任务

目标：

- 每天或每周自动更新

建议策略：

- 每天跑少量城市增量
- 每周跑全国重点城市

## 运维与风控建议

- 所有外部 API Key 仅放云函数环境，不下发到小程序前端。
- 每个批次保存 `batchId`，便于回滚和问题定位。
- 首次运行时使用 `dryRun = true`，先看命中和误判比例。
- 同步请求需要速率限制，避免配额超限。
- 对外部失败进行有限重试，避免单次网络抖动导致整批失败。

## 推荐的开发顺序

建议按以下顺序进入实现：

1. 扩展 `RockGyms` 数据字段兼容
2. 新建 `rock_sync_gyms` 云函数骨架
3. 接入一个地图来源并实现 `dryRun`
4. 新增 `RockGymSourceRecords` 和 `RockGymSyncRuns`
5. 实现去重和字段合并
6. 增加 `RockGymReviewQueue`
7. 最后再做定时调度和后台审核页

## 当前决策结论

本项目的自动同步方案以“地图 POI 为基础、人工审核兜底、馆长认领覆盖”为主线。

第一阶段先把“馆表铺全”做好，不追求一步到位自动维护周期和线路；这样可以用最小风险把自动采集接入现有云开发架构，并为后续的持续更新、城市扩张和馆长运营打基础。
