const { callCloud } = require("../cloud");

async function createLink(payload) {
  return callCloud("rock_card_gift_manage", { ...(payload || {}), action: "create_link" }, { loading: true, loadingTitle: "生成中" });
}

async function createDirect(payload) {
  return callCloud("rock_card_gift_manage", { ...(payload || {}), action: "create_direct" }, { loading: true, loadingTitle: "赠送中" });
}

async function get(payload) {
  return callCloud("rock_card_gift_manage", { ...(payload || {}), action: "get" }, { loading: true, loadingTitle: "加载中" });
}

async function claim(payload) {
  return callCloud("rock_card_gift_manage", { ...(payload || {}), action: "claim" }, { loading: true, loadingTitle: "领取中" });
}

async function cancel(payload) {
  return callCloud("rock_card_gift_manage", { ...(payload || {}), action: "cancel" }, { loading: true, loadingTitle: "取消中" });
}

module.exports = {
  createLink,
  createDirect,
  get,
  claim,
  cancel
};

