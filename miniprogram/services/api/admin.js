const { callCloud } = require("../cloud");

async function manage(payload) {
  return callCloud("admin_manage", payload || {}, { loading: true, loadingTitle: "处理中" });
}

module.exports = {
  manage
};

