const { callCloud } = require("../cloud");

async function create(payload) {
  return callCloud("comment_create", payload || {}, { loading: true, loadingTitle: "发布中" });
}

async function list(params) {
  return callCloud("comment_list", params || {}, { loading: false });
}

module.exports = {
  create,
  list
};

