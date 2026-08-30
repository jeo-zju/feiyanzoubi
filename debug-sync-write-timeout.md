# Debug Session: sync-write-timeout
- **Status**: [OPEN]
- **Issue**: 后台岩馆同步在写入模式下调用云函数超时，3 秒后返回 `FUNCTIONS_TIME_LIMIT_EXCEEDED`
- **Debug Server**: pending
- **Log File**: .dbg/trae-debug-log-sync-write-timeout.ndjson

## Reproduction Steps
1. 进入 `pages/backstage-sync/index`
2. 触发后台岩馆同步写入
3. 约 3 秒后报错：`Invoking task timed out after 3 seconds`

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | 前端发起的参数组合直接进入了高耗时正式写入路径 | High | Low | Pending |
| B | `rock_sync_gyms` 在写入流程中串行执行过多步骤，单次调用天然超过 3 秒 | High | Med | Pending |
| C | 某个数据库匹配或更新步骤退化，耗时集中在集合查询/写入 | Med | Med | Pending |
| D | 当前实现缺少异步化/分段化，写入模式仍是同步阻塞模型 | High | Med | Pending |
| E | 当前云环境函数时间限制就是 3 秒，导致正常流程也被截断 | Med | Low | Pending |

## Log Evidence
- Pending

## Verification Conclusion
- Pending
