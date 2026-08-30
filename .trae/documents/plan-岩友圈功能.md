# 岩友圈功能设计与实现计划（极简单屏版）

## 一、需求理解与调整

### 1.1 核心功能（按三大约束重构）
基于用户反馈，三条硬约束贯穿设计：
1. **单屏原则**：每个页面严格 1 屏内，不允许纵向滚动；内容超出则跳转二级页（二级页同样 1 屏）
2. **极简交互**：所有操作一眼可懂，不写任何说明文字；按钮 ≤ 图标+2 字
3. **无保护员**：数据模型、UI 全链路不引入「保护员」相关角色/字段/标签

| 场景 | 功能描述 |
|------|---------|
| **入口** | 首页分段按钮「公开日历 / 岩友 / 岩友圈」三项 |
| **岩友圈下拉** | 选「岩友圈」后，左侧出现我加入的圈的下拉选择器（底部 sheet 弹出，单屏内） |
| **首页列表** | 选中某岩馆后，日历卡片下方出现「该岩馆岩友圈」模块，**只展示前 2 个**；「更多」→ 跳二级列表页（1 屏，使用左右翻页按钮替代纵向滚动） |
| **创建圈** | 首页卡片右上角「+」按钮 → 创建页（1 屏表单） |
| **申请加入** | 卡片右下角「申请」2 字按钮；已加入显示「已在」 |
| **圈详情** | 点击卡片 → 详情页（1 屏），顶栏标题+简介，下方 3 个圆按钮（成员 / 审批 / 岩馆），点击每个按钮弹出对应 1 屏 sheet 弹层 |
| **管理员操作** | 成员/岩馆 sheet 内每行右滑出现「移除」（单字「删」按钮），审批 sheet 每行「✓」「✕」两个图标按钮 |
| **解散 / 退出** | 详情页右上角齿轮 → 单屏 sheet 内红色「解散」/ 灰色「退出」 |
| **多圈加入** | 一人可加入多圈 |
| **岩馆关联** | 一圈可关联多馆 |

---

## 二、数据模型设计

### 2.1 新增数据库集合（无保护员字段）

#### `RockCircles`
```javascript
{
  _id: String,
  name: String,             // 必填，≤12字（极简）
  description: String,      // ≤40字（单行显示）
  avatarColor: String,      // 替代头像：6种低饱和色之一，避免上传
  adminOpenid: String,
  city: String,
  gymIds: Array<String>,    // 关联岩馆
  memberCount: Number,      // 冗余
  status: "active" | "disbanded",
  createdAt: Number,
  updatedAt: Number,
  created_at: ServerDate,
  updated_at: ServerDate
}
```

#### `RockCircleMembers`
```javascript
{
  _id: String,
  circleId: String,
  openid: String,
  role: "admin" | "member",        // 仅两种角色，无保护员
  status: "pending" | "accepted" | "rejected",
  appliedAt: Number,
  joinedAt: Number,
  createdAt: Number,
  updatedAt: Number,
  created_at: ServerDate,
  updated_at: ServerDate
}
```

---

## 三、云函数设计

### 3.1 `circle_manage`（精简 action，去冗余）

| action | 权限 | 入参 |
|--------|------|------|
| `create` | 登录 | name, city, gymIds?, description? |
| `update` | 管理员 | circleId, name?, description?, gymIds? |
| `disband` | 管理员 | circleId |
| `list` | 公开 | city?, gymId?, page, pageSize |
| `myList` | 登录 | 无 |
| `getDetail` | 登录 | circleId |
| `apply` | 登录 | circleId |
| `approve` | 管理员 | circleId, openid |
| `reject` | 管理员 | circleId, openid |
| `remove` | 管理员 | circleId, openid |
| `leave` | 成员 | circleId |

*去掉 `addMember`（直接通过「申请+审批」闭环即可，减少操作入口）。*

---

## 四、前端服务层

`miniprogram/services/api/circle.js`（略，同原版但去掉 addMember）

---

## 五、页面设计（严格单屏）

### 5.1 首页（pages/home）
- **保持 1 屏**：日历卡片高度压缩，岩友圈列表固定高度只放 2 行
- 分段按钮：公开日历 | 岩友 | 岩友圈
- 岩友圈下拉：复用城市 sheet 样式，**最多展示 8 个我加入的圈**（超过显示「更多圈 →」进入 circle-list 二级页）
- 「该岩馆岩友圈」模块：
  - 标题行：「岩友圈 · XX岩馆」+ 右上角「+ 创建」图标按钮
  - 卡片 × 2：每张卡 = 色圆 + 名称 + 成员数 + 关联馆数小徽章 + 右下角「申请/已在」按钮
  - 若有更多：2 张卡片下方居中「› 更多岩友圈」→ 跳转 `circle-list`

### 5.2 新增：岩友圈列表页（circle-list）
**1 屏，不滚动**
- 顶：返回 + 标题「岩友圈 · XX岩馆」+ 右上角「+」
- 中：**一张大卡片**（当前页内容），展示第 N 个圈的详情摘要
- 底：左「‹ 上一个」 / 页码「1 / 5」/ 下一个「›」（替代纵向翻页，保证 1 屏）
- 卡片右下：「申请」按钮；点击卡片 → 进入 `circle-detail`

### 5.3 新增：创建/编辑页（circle-edit）
**1 屏，不滚动**
- 顶：返回 + 「新建岩友圈」/ 「编辑」+ 右上「✓」保存
- 上：色圆选择（6 个色块横排点选）
- 中：名称输入框（≤12字） + 简介输入框（单行，≤40字）
- 下：「关联岩馆」→ 点选打开岩馆多选 sheet（1 屏，多选打勾，顶「完成」）
- 底部留空，不超出屏

### 5.4 新增：详情页（circle-detail）
**1 屏，不滚动，三枚圆形图标按钮分区内容**
- 顶部 40%：色圆 + 圈名称 + 简介（一行截断） + 成员数 + 关联馆数
- 中部 35%：三等分横向排列 3 个圆按钮
  - 左：「成员」图标（头像叠层） → 点此弹出 **成员 sheet**（1 屏，最多 8 行，超量提示「› 更多成员」→ 成员子页，但 V1 可先只看 8 人）
  - 中：「审批」图标（待办角标数字） → **仅管理员可见**，点弹出审批 sheet（1 屏，每行头像+2 图标按钮 ✓/✕）
  - 右：「岩馆」图标（馆标） → 点弹出关联岩馆 sheet（1 屏，管理员每行可「-」取消关联，底有「+ 关联岩馆」按钮）
- 底部 15%：
  - 未加入：居中黄色大按钮「+ 申请加入」
  - 已加入（非管理员）：居右小齿轮 → 打开 sheet：「退出」（灰色，二次确认）
  - 管理员：居右小齿轮 → 打开 sheet：「编辑」（跳 circle-edit）/ 「解散」（红色，二次确认）
- 右下 10%：留白

### 5.5 App 注册
`pages` 数组新增 3 个页面：`circle-list` / `circle-edit` / `circle-detail`

---

## 六、视觉规范（对齐项目约束 + 极简）

- 背景 `#0B0D15`，文字 `#E7E9F3`，字重 ≤ 600
- 色圆替代圈头像：6 种低饱和紫/蓝/绿 `#5D5A88 / #4C6A8A / #4A7C6E / #7C5A6A / #8A6A4C / #6A6A8A`
- 所有按钮高度 64rpx，圆角 12rpx；主按钮黄 `#F2C14E`，次按钮透明描边，危险红 `#C65A5A`
- 列表 sheet 行高 96rpx；每行右侧操作区不超过 2 个图标
- 零说明文字：所有含义通过图标与位置表达（如「审批」按钮上的红点数字即代表有待审批）

---

## 七、文件改动清单（11 新增 + 6 修改）

### 新增（11 文件）
- `cloudfunctions/circle_manage/index.js`
- `cloudfunctions/circle_manage/package.json`
- `miniprogram/services/api/circle.js`
- `miniprogram/pages/circle-list/{index.js, index.wxml, index.wxss, index.json}`
- `miniprogram/pages/circle-edit/{index.js, index.wxml, index.wxss, index.json}`
- `miniprogram/pages/circle-detail/{index.js, index.wxml, index.wxss, index.json}`

### 修改（6 文件）
- `miniprogram/app.json` — 注册 `circle-list` / `circle-edit` / `circle-detail`
- `miniprogram/pages/home/index.{js,wxml,wxss,json}` — 三分段 + 圈下拉 + 2 张圈卡片 + 更多入口
- `miniprogram/utils/constants.js` — 加 6 个色圆常量

---

## 八、风险与处理

| 风险 | 处理 |
|------|------|
| 列表项超出 1 屏 | 严格限数量：首页 2 张，list 页 1 张翻页式浏览，sheet 弹层 ≤ 8 行 |
| 创建表单超屏 | 简介压缩为 1 行单行输入；岩馆多选单独 sheet，不占主屏空间 |
| 用户操作理解成本 | 所有按钮用已有 App 常用范式（✓ 保存、✕ 拒绝、+ 添加、› 更多、齿轮=设置），不写说明 |
| 保护员混入 | 数据模型与 UI 代码搜索 `保护员` / `belayer` / `保护` 关键字，确保不出现 |
| 申请重复 | 云函数唯一约束，返回 `already_applied` / `already_member` 状态码，前端直接对应按钮态切换 |

---

## 九、实施步骤（按顺序）

1. 云函数 `circle_manage` 编写 + 部署验证（11 个 action）
2. 服务层 `services/api/circle.js`
3. 空壳页面 × 3 + `app.json` 注册
4. 首页改造：分段按钮第三项 → 圈下拉 sheet → 2 张圈卡 + 更多入口
5. `circle-list` 页：单卡片 + ‹ 上/下 › 翻页
6. `circle-edit` 页：色圆 + 名称 + 简介 + 关联岩馆 sheet
7. `circle-detail` 页：3 圆按钮分区 sheet（成员/审批/岩馆）+ 齿轮菜单
8. 联调：创建 → 首页可见 → 他号申请 → 审批通过 → 成员列表可见 → 关联岩馆 → 按岩馆筛选列表
9. 视觉检查：所有页在 iPhone SE（最小屏）预览，确保无纵向滚动条
