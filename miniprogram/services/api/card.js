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

async function updateOneLiner(cardId, oneLiner) {
  return callCloud("rock_card_manage", { action: "update_one_liner", cardId, oneLiner }, { loading: false, silent: true });
}

async function removeCreated(cardId, dryRun) {
  const args = { action: "remove_created", cardId };
  if (dryRun) args.dryRun = true;
  return callCloud("rock_card_manage", args, { loading: true, loadingTitle: dryRun ? "检查中" : "删除中" });
}

module.exports = {
  upsert,
  updateOneLiner,
  get,
  listMy,
  generateOneLiner,
  removeCreated
};

