const { callCloud } = require("../cloud");

async function summary(params) {
  return callCloud("stats_summary", params || {}, { loading: true, loadingTitle: "加载统计" });
}

module.exports = {
  summary
};

