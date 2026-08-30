const { callCloud } = require("../cloud");

const FRIEND_REQUEST_TOAST = {
  pending: "申请已发送，等对方通过~",
  already_pending: "申请已发送过啦",
  already_friends: "你们已经是岩友啦",
  mutual_accepted: "对方也申请了你，已自动互加 ✓"
};

function mapRequestStatusToToast(status) {
  return FRIEND_REQUEST_TOAST[String(status || "")] || "申请已发送";
}

async function list(params) {
  return callCloud("friendship_manage", { action: "list", ...(params || {}) }, { loading: false });
}

async function request(params) {
  return callCloud("friendship_manage", { action: "request", ...(params || {}) }, { loading: true, loadingTitle: "发送中" });
}

async function accept(params) {
  return callCloud("friendship_manage", { action: "accept", ...(params || {}) }, { loading: true, loadingTitle: "处理中" });
}

async function reject(params) {
  return callCloud("friendship_manage", { action: "reject", ...(params || {}) }, { loading: true, loadingTitle: "处理中" });
}

async function remove(params) {
  return callCloud("friendship_manage", { action: "remove", ...(params || {}) }, { loading: true, loadingTitle: "移除中" });
}

async function search(params) {
  return callCloud("friendship_manage", { action: "search", ...(params || {}) }, { loading: true, loadingTitle: "搜索中" });
}

module.exports = {
  FRIEND_REQUEST_TOAST,
  mapRequestStatusToToast,
  list,
  request,
  accept,
  reject,
  remove,
  search
};
