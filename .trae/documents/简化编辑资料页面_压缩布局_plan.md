# 简化编辑资料页面 · 压缩布局计划

## 一、仓库调研结论

编辑资料页面位于 [miniprogram/pages/profile-edit/](file:///c:/Users/jeo/Documents/trae_projects/feiyanzoubi/miniprogram/pages/profile-edit)，共 4 个文件。

### 现存冗余信息清单（将全部移除）

| 冗余项 | 位置 | 理由 |
|---|---|---|
| "资料" section-kicker | hero 卡 | 用户已在"编辑资料"页，标签重复 |
| "完善你的攀岩档案" 大标题 + 描述文字 | hero 卡 | 功能自解释，无需引导文案 |
| 岩友 ID · xxx | hero 卡底部 | 非编辑项，展示价值低，删 |
| "保存后会上传到云端… / 可以直接使用当前头像…" | 头像下方 section-tip | 按钮文字"更换头像"已说明 |
| 项目名（Project）字段 | 头像昵称卡 | 用户明确要求删除 |
| 保护技能 switch + 说明文字 | 攀岩能力卡底部 | 用户明确要求删除 |
| "头像与昵称" / "攀岩能力" / "身体数据" / "常居城市" 4 个卡片标题 | 各 card-hd | 用户可自行通过字段内容理解模块含义 |
| field.label 左侧独立 160rpx 宽占位 | 所有 .field | 改为顶部小标签，横向节省约 160rpx |

### 保留字段（仅 7 项）
头像、昵称、城市、抱石、顶绳、先锋、身高、臂展 → 共 8 项，3 行布局。

---

## 二、修改文件与模块

| 文件 | 修改内容 |
|---|---|
| `miniprogram/pages/profile-edit/index.wxml` | 3 卡布局；删除所有 hero / tip / 项目名 / 保护技能 / 全部 card-hd 标题 / 全部独立左侧 label；字段标签改为 inline 顶部小标签 |
| `miniprogram/pages/profile-edit/index.wxss` | 删除 .label / .field-switch / .profile-panel 等旧样式；新增紧凑 row/col 样式、顶部小标签、头像 mini 区、紧凑 picker/input |
| `miniprogram/pages/profile-edit/index.js` | 清掉 projectName、rockId（setData & data）、protector 加载/事件/保存，其余业务不变 |

---

## 三、具体修改步骤

### 步骤 1：WXML 极致压缩

**总结构：3 张卡片（均无 card-hd 标题） + 1 保存按钮**

#### 卡片 1 · 基础资料（一张卡 = 一行）
```
┌─────────────────────────────────────────┐
│  ┌────┐   昵称  [__________________]    │
│  │头像│   城市  [选择常居城市      ▾]    │
│  └────┘   [更换头像]                     │
└─────────────────────────────────────────┘
```
- `.head-row`：flex 横向，头像区（左）+ 右列区（右）
- 左列：`.avatar-wrap` 纵向：头像图（80rpx 圆）+ "更换" mini 按钮（位于头像正下方，字数缩短为"更换"）
- 右列：`.head-right` 纵向 2 行：昵称输入、城市 picker（每行 = 顶部 22rpx 小标签 + 控件）
- **完全删除**：hero 卡整卡、项目名字段、rockId、头像下方 tip 文字

#### 卡片 2 · 攀岩能力（三项一行）
```
┌─────────────────────────────────────────┐
│  抱石          顶绳          先锋        │
│ [V3▾]        [5.11a▾]      [5.10d▾]     │
└─────────────────────────────────────────┘
```
- `.inline-row`：3 列等宽 flex，gap 14rpx
- 每列 `.inline-col`：顶部小标签（"抱石"等，22rpx muted，字重 600） + picker-val
- **完全删除**：保护技能整行（switch + 说明）

#### 卡片 3 · 身体数据（身高臂展一行）
```
┌─────────────────────────────────────────┐
│  身高（cm）     臂展（cm）                │
│ [  178  ]      [  180  ]                 │
└─────────────────────────────────────────┘
```
- `.inline-row`：2 列等宽 flex，gap 14rpx
- 每列 `.inline-col`：顶部小标签（含单位，避免重复占位） + input（placeholder 含示例）

卡片 1/2/3 之间均加 `.mt`（16rpx）。保存按钮不变。

---

### 步骤 2：WXSS 样式重写（保留必要的，新增紧凑类）

**删除/覆盖**：
- `.label`（160rpx 宽 → 废弃）
- `.profile-panel`（纵向居中 → 废弃）
- `.field-switch` 整套（保护技能 → 废弃）
- `.avatar-btn` 宽 220rpx → 改为 compact 版

**新增**（全部遵循现有规范：颜色 #E7E9F3，字重 600，低饱和紫）：
```css
/* ===== 行 / 列 ===== */
.inline-row {
  display: flex;
  gap: 14rpx;
  align-items: flex-start;
}
.inline-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.inline-label {
  font-size: 22rpx;
  font-weight: 600;
  color: rgba(231, 233, 243, 0.68);
  padding-left: 4rpx;
}

/* ===== 头部 头像+右列 ===== */
.head-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
}
.avatar-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx;
  flex: none;
}
.compact-avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 48rpx;
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid rgba(143, 123, 255, 0.28);
}
.compact-avatar-btn {
  width: 120rpx;
  height: 48rpx;
  border-radius: 12rpx;
  font-size: 22rpx;
  font-weight: 600;
}
.head-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  min-width: 0;
}

/* ===== 控件紧凑版 ===== */
.compact-input {
  height: 72rpx;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.04);
  border: 1rpx solid rgba(255, 255, 255, 0.08);
  color: #E7E9F3;
  font-size: 26rpx;
  font-weight: 600;
  padding: 0 18rpx;
  box-sizing: border-box;
}
.compact-picker-val {
  height: 72rpx;
  line-height: 72rpx;
  padding: 0 18rpx;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.035);
  border: 1rpx solid rgba(255, 255, 255, 0.06);
  color: #E7E9F3;
  font-size: 26rpx;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

---

### 步骤 3：JS 逻辑清理

1. **删除展示数据**：
   - `data.projectName` 移除
   - `data.rockId` 移除
   - `loadUser` 中对 `projectName` / `rockId` 的 setData 移除
   - `data.climbSkills.protector` 键可保留但默认 false，**不赋值**

2. **删除事件**：
   - 整个 `onProtectorChange` 方法删除

3. **保存时剥离 protector**：
   在 `onSave` 构造 `profilePayload` 后加一行：
   ```js
   if (profilePayload && profilePayload.climbSkills) {
     delete profilePayload.climbSkills.protector;
   }
   ```
   防止历史数据误写入。

---

## 四、潜在依赖与注意事项

- **头像按钮文字从"更换头像" → "更换"**：位置紧贴头像下方，语义明确，用户可理解。
- **删除所有卡片标题（card-hd）**：用户偏好"用户自己体会"，字段内容本身足够区分模块，此举每页节省约 120rpx 垂直空间（3 张卡 × 40rpx 标题区）。
- **攀岩三项宽度**：最大内容 "5.12a+" 宽约 110rpx，3 列 + 2×gap14 + 左右 padding 44 = 422rpx，剩余 328rpx 空间充裕，不会换行。
- **身高臂展 label 带单位**："身高（cm）" 把单位放 label，input 只需放 placeholder "如 178"，节省控件内部空间。

---

## 五、风险处理

| 风险 | 影响 | 处理 |
|---|---|---|
| 删除卡片标题后用户无法理解模块含义 | 体验下降 | 字段本身有明确 label（抱石/顶绳/先锋/身高/臂展），模块边界由卡片物理边界承载，结合"用户自己体会"的偏好，可接受 |
| "更换"两字按钮过短难理解 | 误触 | 按钮正上方就是头像，结合手势对象，含义自明；若不行可回退为"换头像"（3 字，宽 140rpx） |
| protector 字段从 payload 剥离后，后端仍有旧数据影响功能 | 历史残留 | 本次仅前端不再提供编辑入口，后端存量不清理；后续如需清理走独立数据迁移 |
| compact-picker-val 高度 72rpx 触控区偏小 | 误触 | 微信小程序 picker 点击区域是整个 picker 标签，不限于视觉元素，实际触控 ≥ 72rpx 达标 |

