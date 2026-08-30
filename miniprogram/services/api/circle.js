const { callCloud } = require("../cloud");

async function create(params) {
  return callCloud("circle_manage", { action: "create", ...(params || {}) }, { loading: true, loadingTitle: "创建中" });
}

async function update(params) {
  return callCloud("circle_manage", { action: "update", ...(params || {}) }, { loading: true, loadingTitle: "保存中" });
}

async function disband(params) {
  return callCloud("circle_manage", { action: "disband", ...(params || {}) }, { loading: true, loadingTitle: "解散中" });
}

async function list(params) {
  return callCloud("circle_manage", { action: "list", ...(params || {}) }, { loading: false });
}

async function myList() {
  return callCloud("circle_manage", { action: "myList" }, { loading: false });
}

async function detail(params) {
  return callCloud("circle_manage", { action: "getDetail", ...(params || {}) }, { loading: true, loadingTitle: "加载中" });
}

async function apply(params) {
  return callCloud("circle_manage", { action: "apply", ...(params || {}) }, { loading: true, loadingTitle: "申请中" });
}

async function approve(params) {
  return callCloud("circle_manage", { action: "approve", ...(params || {}) }, { loading: true, loadingTitle: "处理中" });
}

async function reject(params) {
  return callCloud("circle_manage", { action: "reject", ...(params || {}) }, { loading: true, loadingTitle: "处理中" });
}

async function remove(params) {
  return callCloud("circle_manage", { action: "remove", ...(params || {}) }, { loading: true, loadingTitle: "移除中" });
}

async function leave(params) {
  return callCloud("circle_manage", { action: "leave", ...(params || {}) }, { loading: true, loadingTitle: "退出中" });
}

async function createPost(params) {
  return callCloud("circle_manage", { action: "post_create", ...(params || {}) }, { loading: true, loadingTitle: "发布中" });
}

async function listPosts(params) {
  return callCloud("circle_manage", { action: "post_list", ...(params || {}) }, { loading: false });
}

async function deletePost(postId) {
  return callCloud("circle_manage", { action: "post_delete", postId }, { loading: true, loadingTitle: "删除中" });
}

module.exports = {
  create,
  update,
  disband,
  list,
  myList,
  detail,
  apply,
  approve,
  reject,
  remove,
  leave,
  createPost,
  listPosts,
  deletePost
};
