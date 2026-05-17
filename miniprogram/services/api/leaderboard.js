const { callCloud } = require("../cloud");

async function compute(params) {
  return callCloud("leaderboard_compute", params || {}, { loading: true, loadingTitle: "计算中" });
}

module.exports = {
  compute
};

