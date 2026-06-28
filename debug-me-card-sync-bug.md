# Debug Session: me-card-sync-bug
- **Status**: [OPEN]
- **Issue**: `我的` 页主名片未显示预期的 `送出 / 分享`，且卡面样式与 `编辑名片` 页不一致
- **Debug Server**: http://192.168.17.129:7777/event
- **Log File**: `.dbg/trae-debug-log-me-card-sync-bug.ndjson`

## Reproduction Steps
1. 重新编译并进入 `我的` 页
2. 观察是否看到名片右下角 `送出 / 分享`
3. 对比 `我的` 页名片和 `编辑名片` 页名片视觉是否一致

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | `我的` 页运行时其实没有进入 `myPrimaryCard` 分支，而是仍在空名片分支 | High | Low | Confirmed |
| B | `myCardPreviewImage` 在运行时没有成功生成或被后续状态清空，导致一直显示占位层 | High | Low | Not primary cause in current run |
| C | `ensurePrimaryCardDetail()` 或 `renderCardToCanvas()` 拿到的主名片数据不完整，导致实际渲染失败 | Medium | Medium | Not primary cause in current run |
| D | `送出 / 分享` 已渲染但被卡面层级或点击容器覆盖，用户实际不可见/不可点 | Medium | Low | Rejected by evidence path |
| E | `我的` 页缓存态和刷新态之间发生状态回滚，把刚生成的卡图或按钮状态冲掉 | Medium | Medium | Not primary cause in current run |

## Log Evidence
- `onShow` 日志：`hasPrimaryCard=false`
- `loadCardSummary` 日志：`listMy resolved -> hasPrimaryCard=false, cardId=""`
- `rock_card_list_my` 当前逻辑仅在 `RockCards` 中存在 `isPrimary=true` 且 `status="active"` 的卡时才返回 `myPrimaryCard`

## Fix Attempt
- 将 `我的` 页顶部卡统一为同一张预览卡，不再分主名片/空名片两套 UI
- 无主名片时也走同一套预览图渲染，保证和 `编辑名片` 页样式对齐
- 无主名片时点击 `送出 / 分享` 会先自动落一张默认主名片，再进入赠送/分享流程

## Verification Conclusion
- Pre-fix: `myPrimaryCard=null` 时页面落在空名片旧分支，导致右下角 `送出 / 分享` 和同源卡面改动都没有显示机会
- Post-fix: 待用户重新编译复现并回传结果后确认
