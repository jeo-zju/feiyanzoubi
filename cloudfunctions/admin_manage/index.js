const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function traceId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ok(data, tid) {
  return { ok: true, data, traceId: tid };
}

function fail(code, message, tid) {
  return { ok: false, error: { code, message }, traceId: tid };
}

async function isAdmin(openid) {
  const res = await db.collection("RockUsers").where({ openid }).limit(1).get();
  const u = res && res.data && res.data[0] ? res.data[0] : null;
  if (!u) return false;
  return u.role === "admin" || u.isAdmin === true;
}

async function safeCount(name) {
  try {
    const res = await db.collection(name).count();
    return { name, total: res && typeof res.total === "number" ? res.total : null, ok: true };
  } catch (e) {
    return { name, ok: false, error: e && e.message ? e.message : String(e) };
  }
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    if (!(await isAdmin(openid))) return fail("FORBIDDEN", "无权限", tid);

    const action = (event && event.action) || "health";
    if (action === "health") {
      const names = [
        "RockUsers",
        "RockGyms",
        "RockGymCycles",
        "RockCheckinRecords",
        "RockUserDailyProgress",
        "RockUserCycleProgress",
        "RockComments",
        "RockFriendships",
        "RockBlackTalkDictionary"
      ];
      const checks = [];
      for (let i = 0; i < names.length; i++) {
        checks.push(await safeCount(names[i]));
      }
      return ok({ checks }, tid);
    }

    if (action === "echo") {
      return ok({ event }, tid);
    }

    return fail("BAD_REQUEST", "未知 action", tid);
  } catch (e) {
    return fail("ADMIN_FAILED", e && e.message ? e.message : "执行失败", tid);
  }
};

