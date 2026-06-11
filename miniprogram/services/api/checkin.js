const { callCloud } = require("../cloud");

async function create(payload) {
  return callCloud("checkin_create", payload || {}, { loading: true, loadingTitle: "提交中" });
}

async function context(params) {
  return callCloud("rock_checkin_context", params || {}, { loading: true, loadingTitle: "加载中" });
}

module.exports = {
  create,
  context
};

