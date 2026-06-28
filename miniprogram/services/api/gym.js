const { callCloud } = require("../cloud");

async function list(params, options) {
  return callCloud("rock_gym_list", params || {}, {
    loading: true,
    loadingTitle: "加载岩馆",
    ...(options || {})
  });
}

async function get(params, options) {
  return callCloud("rock_gym_get", params || {}, {
    loading: true,
    loadingTitle: "加载岩馆",
    ...(options || {})
  });
}

async function ownerList(params, options) {
  return callCloud("gym_owner_list", params || {}, {
    loading: true,
    loadingTitle: "加载岩馆",
    ...(options || {})
  });
}

module.exports = {
  list,
  get,
  ownerList
};

