const { callCloud } = require("../cloud");

async function publish(params) {
  return callCloud("calendar_plan_publish", params || {}, { loading: true, loadingTitle: "提交中" });
}

async function queryCalendar(params) {
  return callCloud("calendar_query", { mode: "calendar", ...(params || {}) }, { loading: false });
}

async function queryTimeline(params) {
  return callCloud("calendar_query", { mode: "timeline", ...(params || {}) }, { loading: true, loadingTitle: "加载时间轴" });
}

async function mine(params, options) {
  const opts = options && typeof options === "object" ? options : {};
  return callCloud("calendar_mine", params || {}, { loading: true, loadingTitle: "加载中", ...opts });
}

async function joinPlan(planId) {
  return callCloud("calendar_plan_publish", { action: "join_plan", planId }, { loading: true, loadingTitle: "报名中" });
}

async function unjoinPlan(planId) {
  return callCloud("calendar_plan_publish", { action: "unjoin_plan", planId }, { loading: true, loadingTitle: "取消报名中" });
}

async function getJoiners(planId) {
  return callCloud("calendar_plan_publish", { action: "get_joiners", planId }, { loading: false });
}

async function removeJoiner(planId, targetOpenid) {
  return callCloud("calendar_plan_publish", { action: "remove_joiner", planId, targetOpenid }, { loading: true, loadingTitle: "移除中" });
}

module.exports = {
  publish,
  queryCalendar,
  queryTimeline,
  mine,
  joinPlan,
  unjoinPlan,
  getJoiners,
  removeJoiner
};
