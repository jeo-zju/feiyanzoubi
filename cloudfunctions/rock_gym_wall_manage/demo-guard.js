// 模拟身份（accountType:"demo"）统一服务端隔离。本文件按函数目录逐份部署，
// 只依赖 wx 数据库句柄，不依赖 profile.js / wx-server-sdk，便于复制到各写入入口。
//
// 核心事实：真实调用方身份只来自 cloud.getWXContext().OPENID（微信 OPENID 以 o 开头），
// demo_ 前缀的合成 ID 永远不可能出现在可信登录态中；以下检查是纵深防御，
// 同时负责演示局的公开投影、只读策略与全局展示开关。
const DEMO_OPENID_PREFIX = "demo_";
const DATA_ORIGIN_DEMO = "demo";

function isDemoId(id) {
  return typeof id === "string" && id.indexOf(DEMO_OPENID_PREFIX) === 0;
}

function ownerIdOf(plan) {
  return String((plan && (plan.openid || plan._openid || plan.uid)) || "");
}

function isDemoPlan(plan) {
  return !!plan && (plan.dataOrigin === DATA_ORIGIN_DEMO || isDemoId(ownerIdOf(plan)));
}

// 对真实用户的统一失败：演示局永远呈现普通“名额已满/无法操作”，不返回任何 demo 专属错误码
function planFullError() {
  return Object.assign(new Error("名额已满，看看其他约爬吧"), { code: "PLAN_FULL" });
}
function forbiddenError(message) {
  return Object.assign(new Error(message || "当前无法完成该操作"), { code: "FORBIDDEN" });
}

// 全局展示开关：RockAppConfig / doc("demo") {showAll:false} 立即停止所有公开返回。
// 缺省视为展示（未生成过时也不会有任何演示数据）。
let showCache = { at: 0, show: true };
async function demoShowAll(db) {
  const now = Date.now();
  if (now - showCache.at <= 20000) return showCache.show;
  let show = true;
  try {
    const r = await db.collection("RockAppConfig").doc("demo").get();
    if (r && r.data && r.data.showAll === false) show = false;
  } catch (e) { show = true; }
  showCache = { at: now, show };
  return show;
}
function resetShowCache() { showCache = { at: 0, show: true }; }

// 写入口通用防护：演示身份不能作为行为发起人
async function assertRealActor(openid) {
  if (isDemoId(openid)) throw forbiddenError();
}

module.exports = {
  DEMO_OPENID_PREFIX,
  DATA_ORIGIN_DEMO,
  isDemoId,
  ownerIdOf,
  isDemoPlan,
  planFullError,
  forbiddenError,
  demoShowAll,
  resetShowCache,
  assertRealActor
};
