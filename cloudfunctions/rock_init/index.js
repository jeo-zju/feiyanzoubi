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

async function safeCount(name) {
  try {
    const res = await db.collection(name).count();
    return { name, ok: true, total: res && typeof res.total === "number" ? res.total : null };
  } catch (e) {
    return { name, ok: false, error: e && e.message ? e.message : String(e) };
  }
}

exports.main = async () => {
  const tid = traceId();
  try {
    const collections = [
      "RockBlackTalkDictionary",
      "RockCards",
      "RockCardCredits",
      "RockCardGifts",
      "RockCheckinRecords",
      "RockComments",
      "RockFriendships",
      "RockGymBlackboards",
      "RockGymCycles",
      "RockGymWallCards",
      "RockGyms",
      "RockUserCycleProgress",
      "RockUserDailyProgress",
      "RockUsers"
    ];
    const checks = [];
    for (let i = 0; i < collections.length; i++) {
      checks.push(await safeCount(collections[i]));
    }
    return ok({ version: 1, checks }, tid);
  } catch (e) {
    return fail("INIT_FAILED", e && e.message ? e.message : "初始化失败", tid);
  }
};

