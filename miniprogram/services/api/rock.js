const { callCloud } = require("../cloud");

async function init(payload) {
  return callCloud("rock_init", payload || {}, { loading: true, loadingTitle: "初始化" });
}

async function seedGyms(payload) {
  return callCloud("rock_seed_gyms", payload || {}, { loading: true, loadingTitle: "写入示例" });
}

module.exports = {
  init,
  seedGyms
};

