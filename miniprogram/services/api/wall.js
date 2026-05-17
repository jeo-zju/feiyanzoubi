const { callCloud } = require("../cloud");

async function get(payload) {
  return callCloud("rock_gym_wall_manage", { ...(payload || {}), action: "get" }, { loading: true, loadingTitle: "加载中" });
}

async function listCards(payload) {
  return callCloud("rock_gym_wall_manage", { ...(payload || {}), action: "list_cards" }, { loading: true, loadingTitle: "加载中" });
}

async function hang(payload) {
  return callCloud("rock_gym_wall_manage", { ...(payload || {}), action: "hang" }, { loading: true, loadingTitle: "上墙中" });
}

async function unhang(payload) {
  return callCloud("rock_gym_wall_manage", { ...(payload || {}), action: "unhang" }, { loading: true, loadingTitle: "移除中" });
}

module.exports = {
  get,
  listCards,
  hang,
  unhang
};

