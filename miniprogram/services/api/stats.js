const { callCloud } = require("../cloud");

async function summary(params, options) {
  return callCloud("stats_summary", params || {}, {
    loading: true,
    loadingTitle: "加载统计",
    ...(options || {})
  });
}

module.exports = {
  summary
};

