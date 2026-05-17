const { callCloud } = require("../cloud");

async function manage(payload) {
  return callCloud("friendship_manage", payload || {}, { loading: true, loadingTitle: "处理中" });
}

module.exports = {
  manage
};

