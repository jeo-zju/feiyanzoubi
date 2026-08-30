# [OPEN] card-face-overwrite

## 症状
- 名片页面看起来只剩一面。
- 进入页面时疑似会短暂闪过原来的正反面状态，随后被当前页面覆盖。

## 期望
- 保持原来的正反面逻辑。
- 找出覆盖旧状态的具体来源。

## 初始假设
1. `card-edit` 或 `card-view` 在首屏先渲染了旧卡面，随后某次 `setData` 把 `previewSide`、`showPlaceholder` 或 `previewImage` 覆盖成当前单面状态。
2. `loadCard()` 返回的数据结构仍包含原来的前后面字段，但页面 WXML/WXSS 已改为只展示一面，导致“旧状态闪一下”后被新模板覆盖。
3. `onReady()`、`onShow()`、`renderPreviewSoon()` 的调用时序发生竞争，先用旧缓存图渲染，随后又被新的预览图或占位图覆盖。
4. 当前出现“只有一面”的真实页面并不是 `card-view`，而是 `me` / `card-wallet` / `card-edit` 某个入口跳转到了错误页面或错误模式。
5. 名片渲染函数 `drawFrontCard()` / `drawBackCard()` 仍正常，但页面层的 `previewSide`、点击事件或导出入口没有接上，造成功能表面消失。

## 计划
- 先给相关页面加最小埋点，记录页面进入、数据加载、关键 `setData` 与预览渲染顺序。
- 复现后依据日志确认是“数据覆盖”还是“模板覆盖”。
- 再做最小修复并对比修复前后日志。

## 当前证据
- 用户复现时日志首先出现 `rock_card_list_my`，说明问题路径明确经过 `pages/me`。
- 静态检查发现 `pages/me/index.js` 在 `loadCardSummary()` 中每次都会把 `myPrimaryCardDetail` 置空、把 `flipped` 置为 `false`，这会把已经存在的背面状态覆盖回正面。
- 这与“旧状态先闪一下，随后被当前页面覆盖”的现象一致。

## 已做修复
- `pages/me/index.js`
  - 保留同一张主卡的 `flipped` 和 `myPrimaryCardDetail`。
  - 仅当主卡不存在或主卡 `cardId` 发生变化时，才重置卡面状态。
