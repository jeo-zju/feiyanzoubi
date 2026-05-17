const { callCloud } = require("../cloud");

async function setPrimary(payload) {
  return callCloud("rock_card_manage", { ...(payload || {}), action: "set_primary" }, { loading: true, loadingTitle: "设置中" });
}

async function removeReceived(payload) {
  return callCloud("rock_card_manage", { ...(payload || {}), action: "remove_received" }, { loading: true, loadingTitle: "删除中" });
}

module.exports = {
  setPrimary,
  removeReceived
};

