const { callCloud } = require("../cloud");

const FN = "demo_data_manage";

function invoke(action, params, options) {
  return callCloud(FN, Object.assign({ action }, params || {}), options || {});
}

function assetsStatus(options) {
  return invoke("assets_status", {}, Object.assign({ loading: true, loadingTitle: "检查素材" }, options || {}));
}

function provisionIdentities(options) {
  return invoke("provision_identities", {}, Object.assign({ loading: true, loadingTitle: "建立身份" }, options || {}));
}

function previewDemoPlans(params, options) {
  return invoke("preview", params, Object.assign({ loading: true, loadingTitle: "生成预览" }, options || {}));
}

function generateDemoPlans(params, options) {
  return invoke("generate", params, Object.assign({ loading: true, loadingTitle: "提交任务" }, options || {}));
}

function continueDemoRun(runId, options) {
  return invoke("generate_continue", { runId }, options || { silent: true });
}

function getDemoRun(runId, options) {
  return invoke("run_status", { runId }, options || { silent: true });
}

function listDemoRuns(city, options) {
  const params = city ? { city } : {};
  return invoke("list_runs", params, Object.assign({ loading: true, loadingTitle: "加载批次" }, options || {}));
}

function hideDemoPlans(options) {
  return invoke("hide", {}, Object.assign({ loading: true, loadingTitle: "隐藏中" }, options || {}));
}

function showDemoPlans(options) {
  return invoke("show_all", {}, Object.assign({ loading: true, loadingTitle: "恢复显示" }, options || {}));
}

function cleanupDemoRun(runId, options) {
  return invoke("cleanup", { runId, confirm: true }, Object.assign({ loading: true, loadingTitle: "清理中" }, options || {}));
}

module.exports = {
  assetsStatus,
  provisionIdentities,
  previewDemoPlans,
  generateDemoPlans,
  continueDemoRun,
  getDemoRun,
  listDemoRuns,
  hideDemoPlans,
  showDemoPlans,
  cleanupDemoRun
};
