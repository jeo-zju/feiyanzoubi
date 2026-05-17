const { callCloud } = require("../cloud");

async function upsert(payload) {
  return callCloud("rock_card_upsert", payload || {}, { loading: true, loadingTitle: "保存中" });
}

async function get(payload) {
  return callCloud("rock_card_get", payload || {}, { loading: true, loadingTitle: "加载中" });
}

async function listMy(payload) {
  return callCloud("rock_card_list_my", payload || {}, { loading: false });
}

async function generateOneLiner(payload) {
  return callCloud("rock_llm_one_liner", payload || {}, { loading: true, loadingTitle: "生成中" });
}

module.exports = {
  upsert,
  get,
  listMy,
  generateOneLiner
};

