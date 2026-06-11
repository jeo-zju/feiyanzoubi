const { callCloud } = require("../cloud");

async function upsertGym(payload) {
  return callCloud("gym_owner_upsert", payload || {}, { loading: true, loadingTitle: "保存中" });
}

module.exports = {
  upsertGym
};

