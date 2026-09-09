# 产品计划执行状态

更新：2026-09-09。F1–F3 已全部在主工作区完成并部署；F4 剩云端迁移审计与真机验收，F5 待试用。

## 部署记录（2026-09-09，deploy-tools/miniprogram-ci）

- 云函数 `calendar_query`：已上传并 Active（3 files）。冒烟 discover 返回新字段 joinDeadline/isFull/startAt/endAt。
- 云函数 `calendar_plan_publish`：已上传并 Active（5 files）。mine_list 已切键集分页；冒烟无登录态返回 AUTH_REQUIRED（新代码已生效）。
- 小程序代码：已上传 v2.0.24（README/me 页版本号按规则由 2.0.23 递增；desc：页面元素统一+F2发现排序/截止/再约预填+F3我的约爬分页）。
- 已知云端残留：`debug_probe` 云函数状态 UpdateFailed——本地仓库已无此函数且前端无调用，可在云开发控制台手动删除。

## 任务状态

- F1 通知与管理取消：完成。cancellationAudience 覆盖发起人/确认/待确认/举报人，幂等，事务回滚。calendar-report-cancel.regression.js 8/8 通过。真实并发仍待双账号验收。
- F2 预填与发现规则：完成。discover 查询层两段排序（可报名优先，[seg,date,startTime,_id] 游标，兼容旧三段游标）；onlyAvailable 同口径过滤满员+截止；publicPlan 投影 joinDeadline/isFull/startAt/endAt；「再约一次」预填馆/类型/氛围/人数/报名方式（日期时间重校验、联系方式不复制）；首页发起带类型筛选；decorate 补 joinClosed/joinable。回归 16/16。
- F3 分页与返回加载：完成。mine_list 改 participantIds 键集分页（旧计划 owner 兜底），报名状态只查本页 20 条；calendar-mine 改游标；首页 onShow 保留列表（30s 过期 + plansDirty 写后刷新）。
- F4 部署/迁移/索引和真实环境验收：部署已完成（见上）。**待办**：①旧计划无 participantIds 的只读统计与迁移；②索引清单审核（participantIds/audience/date 等）；③双账号真实链路验收（最后名额并发、重复报名、取消/审批竞争）；④debug_probe 控制台清理。
- F5 试用准备、真实用户反馈：待 F4 真机验收后启动；真实试用不能用测试替代。

定时跟进每5分钟，整份计划完成并验收后才停止；阶段完成即派下一项。外部依赖需明确反馈并继续独立工作，未变化时安静等待。
