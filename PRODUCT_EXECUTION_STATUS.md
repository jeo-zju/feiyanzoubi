# 产品计划执行状态

## 2026-09-10 晨间复核补记

- 结果：待修复、不上传；详见 [MORNING_ACCEPTANCE_REPORT_2026-09-10.md](MORNING_ACCEPTANCE_REPORT_2026-09-10.md)。版本 2.0.25 已在本地准备，本轮未部署。
- 旧记录兼容已去除最近 200 条截断，改为完整分页、最新状态归并、计划 ID 分批查询；下文原 R1 的“最近 200 条”描述仅保留为历史记录。当前仍有历史报名读放大，迁移后待收敛。
- 回归更新：核心 32/32、取消 8/8，以及发布设置、剩余页面两组回归通过。

## 2026-09-10 新增发布阻断项

- P1：同一用户可以组织/参加时间重叠的多个约爬。调整方案见 [SCHEDULE_CONFLICT_ADJUSTMENT_PLAN.md](SCHEDULE_CONFLICT_ADJUSTMENT_PLAN.md)。当前只完成计划，未实现、未迁移、未部署。
- 推荐规则：组织、已参加和待确认都占用个人时间；端点相接允许，退出/拒绝/取消后释放；服务端通过同用户日程事务保证并发互斥。
- 该问题解决前，晨间其他修复不作为完整验收通过版本自动上传。


更新：2026-09-09。F1 已部署验收；F2/F3 首轮上线后验收发现 6 项问题（见 PRODUCT_ACCEPTANCE_REPAIR_PLAN.md），R1–R6 修复已在主工作区完成并通过回归（**尚未部署**）；F4 剩云端迁移审计与真机验收，F5 待试用。

## 部署记录（2026-09-09，deploy-tools/miniprogram-ci）

- 云函数 `calendar_query`：已上传并 Active（3 files）。冒烟 discover 返回新字段 joinDeadline/isFull/startAt/endAt。
- 云函数 `calendar_plan_publish`：已上传并 Active（5 files）。mine_list 已切键集分页；冒烟无登录态返回 AUTH_REQUIRED（新代码已生效）。
- 小程序代码：已上传 v2.0.24（README/me 页版本号按规则由 2.0.23 递增；desc：页面元素统一+F2发现排序/截止/再约预填+F3我的约爬分页）。
- 已知云端残留：`debug_probe` 云函数状态 UpdateFailed——本地仓库已无此函数且前端无调用，可在云开发控制台手动删除。
- **待部署**：R1–R6 修复（本轮）涉及云函数 `calendar_plan_publish`、`calendar_query` 与小程序首页/详情/发布页；下次发版版本号 2.0.25（README 与 me/index.js 两处同步 +1），部署需另行授权。

## 任务状态

- F1 通知与管理取消：完成。cancellationAudience 覆盖发起人/确认/待确认/举报人，幂等，事务回滚。calendar-report-cancel.regression.js 8/8 通过。真实并发仍待双账号验收。
- F2 预填与发现规则：**部分完成，待本计划验收**。首轮能力（discover 两段排序、[seg,date,startTime,_id] 游标兼容旧三段、onlyAvailable 同口径、publicPlan 投影、decorate joinClosed/joinable）已上线；验收问题 R2（满员合同统一）、R5（预填/提交校验）已修复待部署。
- F3 分页与返回加载：**部分完成，待本计划验收**。首轮能力（mine_list participantIds 键集分页、报名状态只查本页 20 条）已上线；验收问题 R1（成员索引统一/旧成员兼容）、R3（跨页去重合同）、R4（首页返回缓存真正落地：30s+签名+plansDirty 仅成功后消费）、R6（可见范围仅发起人可改）已修复待部署。
- R1–R6 验收修复（本轮，顺序 R1+R6 → R2 → R5 → R3+R4）：代码全部完成，tests/regression.js 29/29、calendar-report-cancel.regression.js 8/8 通过。
  - R1：lifecycle.memberIndex（发起人始终在内 + 有效 pending/confirmed；v2 信任索引、旧计划按报名行推导）；mine_list 范围三并集（participantIds / own / 最近 200 条有效报名 planId）；旧计划编辑后发起人回填索引；取消/移除不误回归。
  - R2：join_plan 满员即拒绝新申请（PLAN_FULL，direct/approval 一致），待确认申请保留不占位、approve 仍走容量校验；截止兜底 joinDeadline||endAt 口径统一；详情页满员/审批文案。
  - R3：首页翻页合并按 _id 去重（mergeListById），实时列表合同；漏项由下拉/返回刷新补齐。
  - R4：首页 refreshIfNeeded（首次/签名变化[日期·城市·tab·类型·岩馆·仅可报名·用户]/超 30s/plansDirty 才重置加载），刷新保留旧列表、失败显式提示、脏标记仅刷新成功后消费。
  - R5：utils/plan.js 新增 validateSlot/sanitizePrefill/sanitizeCapacity（人数 2–12、今天至 +13 天、30 分钟–12 小时、不跨日、未开始；预填白名单不过度清空、非法日期回落推荐并显式提示）；发布页提交前校验，过期时段新建弹窗确认改期、编辑模式直接拦截；suggestedTime 固定时钟测试。
  - R6：编辑时可见范围锁定仅在存在非发起人成员时触发（仅发起人可自由改范围）。
- F4 部署/迁移/索引和真实环境验收：部署已完成首轮。**待办**：①旧计划无 participantIds 的只读统计与迁移（R1 已做有界读兼容，迁移永久补齐后收敛）；②索引清单审核（participantIds/audience/date 等）；③双账号真实链路验收（最后名额并发、重复报名、取消/审批竞争、满员审批）；④debug_probe 控制台清理；⑤R1–R6 修复的部署与真机回归。
- F5 试用准备、真实用户反馈：待 F4 真机验收后启动；真实试用不能用测试替代。
