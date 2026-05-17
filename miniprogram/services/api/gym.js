const { callCloud } = require("../cloud");

async function list(params) {
  return callCloud("rock_gym_list", params || {}, { loading: true, loadingTitle: "加载岩馆" });
}

async function get(params) {
  return callCloud("rock_gym_get", params || {}, { loading: true, loadingTitle: "加载岩馆" });
}

async function ownerList(params) {
  return callCloud("gym_owner_list", params || {}, { loading: true, loadingTitle: "加载岩馆" });
}

module.exports = {
  list,
  get,
  ownerList
};

