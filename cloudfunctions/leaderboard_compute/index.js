const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function traceId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ok(data, tid) {
  return { ok: true, data, traceId: tid };
}

function fail(code, message, tid) {
  return { ok: false, error: { code, message }, traceId: tid };
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function formatYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function sumTotals(t) {
  if (!t) return 0;
  return Number(t.boulder || 0) + Number(t.difficulty || 0) + Number(t.lead || 0);
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const days = Math.max(1, Math.min(90, Number(event && event.days ? event.days : 30)));
    const limit = Math.max(1, Math.min(50, Number(event && event.limit ? event.limit : 20)));
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    const startYMD = formatYMD(start);
    const endYMD = formatYMD(end);

    const res = await db
      .collection("RockUserDailyProgress")
      .where({
        date: _.gte(startYMD).and(_.lte(endYMD))
      })
      .limit(1000)
      .get();
    const list = (res && res.data) || [];
    const scoreMap = {};
    list.forEach((d) => {
      const oid = d && (d.openid || d._openid);
      if (!oid) return;
      const s = sumTotals(d.totals);
      scoreMap[oid] = (scoreMap[oid] || 0) + s;
    });
    const openids = Object.keys(scoreMap);
    openids.sort((a, b) => scoreMap[b] - scoreMap[a]);
    const top = openids.slice(0, limit);
    let users = [];
    if (top.length) {
      const usersRes = await db.collection("RockUsers").where({ openid: _.in(top) }).limit(100).get();
      users = (usersRes && usersRes.data) || [];
    }
    const userMap = users.reduce((m, u) => {
      m[u.openid] = u;
      return m;
    }, {});
    const leaderboard = top.map((oid, idx) => ({
      rank: idx + 1,
      openid: oid,
      score: scoreMap[oid],
      user: userMap[oid] ? { nickName: userMap[oid].nickName || "", avatarUrl: userMap[oid].avatarUrl || "" } : null
    }));
    return ok({ days, leaderboard }, tid);
  } catch (e) {
    return fail("LEADERBOARD_FAILED", e && e.message ? e.message : "计算失败", tid);
  }
};

