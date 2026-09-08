const { callCloud } = require("../cloud");

async function create(payload) {
  return callCloud("checkin_create", payload || {}, { loading: true, loadingTitle: "提交中" });
}

async function context(params) {
  return callCloud("rock_checkin_context", params || {}, { loading: true, loadingTitle: "加载中" });
}

async function revertLast() {
  return callCloud("checkin_create", { action: "revert_last" }, { loading: true, loadingTitle: "撤销中" });
}

module.exports = {
  create,
  context,
  revertLast
};

