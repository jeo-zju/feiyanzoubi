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

function safeText(v) {
  return v == null ? "" : String(v).trim();
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function formatYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayYMD() {
  const d = new Date();
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);
  return formatYMD(utc8);
}

function addDays(ymd, days) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  return formatYMD(d);
}

function daysBetween(start, end) {
  const s = start.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const e = end.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!s || !e) return 0;
  const ds = new Date(Number(s[1]), Number(s[2]) - 1, Number(s[3]));
  const de = new Date(Number(e[1]), Number(e[2]) - 1, Number(e[3]));
  return Math.round((de - ds) / 86400000);
}

async function getMyCircleIds(openid) {
  if (!openid) return [];
  try {
    const res = await db
      .collection("RockCircleMembers")
      .where({ openid, status: "accepted" })
      .limit(100)
      .get();
    const list = (res && res.data) || [];
    return Array.from(new Set(list.map((r) => String(r.circleId || "")).filter(Boolean)));
  } catch (e) {
    return [];
  }
}

async function getFriendOpenids(openid) {
  try {
    const res = await db
      .collection("RockFriendships")
      .where(
        _.or([
          _.and([{ fromOpenid: openid }, { status: "accepted" }]),
          _.and([{ toOpenid: openid }, { status: "accepted" }]),
          _.and([{ openid }, { targetOpenid: _.exists(true) }])
        ])
      )
      .limit(500)
      .get();
    const list = (res && res.data) || [];
    const set = new Set();
    list.forEach((r) => {
      if (r.status === "accepted" && r.fromOpenid && r.toOpenid) {
        if (r.fromOpenid === openid) set.add(r.toOpenid);
        if (r.toOpenid === openid) set.add(r.fromOpenid);
      }
      if (!r.status && r.openid === openid && r.targetOpenid) {
        set.add(r.targetOpenid);
      }
    });
    return Array.from(set);
  } catch (e) {
    return [];
  }
}

function buildVisibilityWhere(visibility, openid, friendIds, myCircleIds) {
  const v = safeText(visibility);
  if (v === "friends") {
    const allowed = new Set(friendIds || []);
    allowed.add(openid);
    return _.and([
      { visibility: _.in(["public", "friends"]) },
      _.or([{ _openid: _.in(Array.from(allowed)) }, { uid: _.in(Array.from(allowed)) }])
    ]);
  }
  if (v === "circle") {
    const mine = Array.from(new Set((myCircleIds || []).filter(Boolean)));
    const ors = [
      { visibility: "circle", _openid: openid },
      { visibility: "circle", uid: openid }
    ];
    if (mine.length) ors.push({ visibility: "circle", circleIds: _.in(mine) });
    return _.or(ors);
  }
  return _.or([{ visibility: "public" }, _.and([{ visibility: "friends" }, _.or([{ _openid: openid }, { uid: openid }])])]);
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID || "";
    const mode = safeText(event && event.mode) || "calendar";

    const friendIds = openid ? await getFriendOpenids(openid) : [];
    const myCircleIds = openid ? await getMyCircleIds(openid) : [];
    const col = db.collection("RockCalendarPlans");

    if (mode === "calendar") {
      const city = safeText(event && event.city);
      const gymId = safeText(event && event.gymId);
      const visibility = safeText(event && event.visibility) || "public";
      let startDate = safeText(event && event.startDate) || todayYMD();
      let endDate = safeText(event && event.endDate);
      if (!endDate) endDate = addDays(startDate, 13);
      const diff = daysBetween(startDate, endDate);
      if (diff < 0) return fail("BAD_REQUEST", "endDate 不能早于 startDate", tid);
      if (diff > 60) return fail("BAD_REQUEST", "跨度最多 60 天", tid);

      const dates = [];
      const n = diff + 1;
      for (let i = 0; i < n; i++) dates.push(addDays(startDate, i));

      const baseWhere = [
        { status: "active" },
        { date: _.in(dates) },
        buildVisibilityWhere(visibility, openid, friendIds, myCircleIds)
      ];
      if (gymId) baseWhere.push({ gymId });
      if (city) baseWhere.push({ "gymSnapshot.city": city });
      const where = _.and(baseWhere);

      const raw = await col.where(where).limit(1000).get();
      const plans = (raw && raw.data) || [];

      const agg = {};
      plans.forEach((p) => {
        const d = p.date;
        if (!agg[d]) agg[d] = { date: d, total: 0, gymIdCount: {}, friendCount: 0 };
        const uid = p._openid || p.uid || "";
        agg[d].total += 1;
        const gid = p.gymId || "outdoor";
        agg[d].gymIdCount[gid] = Number(agg[d].gymIdCount[gid] || 0) + 1;
        if (friendIds.indexOf(uid) >= 0 || uid === openid) agg[d].friendCount += 1;
      });

      const dateAgg = dates.map((d) => agg[d] || { date: d, total: 0, gymIdCount: {}, friendCount: 0 });
      return ok({ dateAgg }, tid);
    }

    if (mode === "timeline") {
      const date = safeText(event && event.date);
      if (!date) return fail("BAD_REQUEST", "缺少 date", tid);
      const city = safeText(event && event.city);
      const gymId = safeText(event && event.gymId);
      const visibility = safeText(event && event.visibility) || "public";
      const filterGymId = safeText(event && event.filterGymId);
      const onlyFriends = !!(event && event.onlyFriends);
      const sortBy = safeText(event && event.sortBy) || "time";

      const baseWhere = [{ status: "active" }, { date }, buildVisibilityWhere(visibility, openid, friendIds, myCircleIds)];
      if (gymId) baseWhere.push({ gymId });
      if (filterGymId) baseWhere.push({ gymId: filterGymId });
      if (city) baseWhere.push({ "gymSnapshot.city": city });
      if (onlyFriends) {
        const allowed = new Set(friendIds || []);
        allowed.add(openid);
        baseWhere.push(_.or([{ _openid: _.in(Array.from(allowed)) }, { uid: _.in(Array.from(allowed)) }]));
      }
      const where = _.and(baseWhere);

      const raw = await col.where(where).limit(200).orderBy("startTime", "asc").get();
      let plans = (raw && raw.data) || [];

      const planIds = plans.map((p) => String(p._id || "")).filter(Boolean);
      let joinAgg = {};
      let meJoinedSet = new Set();
      if (planIds.length) {
        try {
          const jRaw = await db.collection("RockCalendarJoins").where({ planId: _.in(planIds), status: "joined" }).limit(1000).get();
          const jList = (jRaw && jRaw.data) || [];
          jList.forEach((j) => {
            const pid = String(j.planId || "");
            if (!pid) return;
            joinAgg[pid] = Number(joinAgg[pid] || 0) + 1;
            if (String(j.openid || "") === openid) meJoinedSet.add(pid);
          });
        } catch (e) {}
      }
      plans = plans.map((p) => {
        const pid = String(p._id || "");
        const owner = p._openid || p.uid || "";
        const jcount = Number(joinAgg[pid] || 0) + (owner ? 1 : 0);
        return Object.assign({}, p, {
          joinedCount: jcount,
          meJoined: meJoinedSet.has(pid) || owner === openid
        });
      });

      const userSeen = {};
      const userList = [];
      plans.forEach((p) => {
        const uid = p._openid || p.uid || "";
        if (!uid) return;
        if (!userSeen[uid]) {
          userSeen[uid] = true;
          const snap = (p && p.userSnapshot) || {};
          userList.push({
            _openid: uid,
            nickName: snap.nickName || "",
            avatarUrl: snap.avatarUrl || "",
            displayName: snap.displayName || "",
            title: snap.title || ""
          });
        }
      });

      if (sortBy === "match") {
        plans = plans.slice().sort((a, b) => {
          const uidA = a._openid || a.uid || "";
          const uidB = b._openid || b.uid || "";
          const sa = friendIds.indexOf(uidA) >= 0 ? 2 : 0;
          const sb = friendIds.indexOf(uidB) >= 0 ? 2 : 0;
          const ga = a.gymId && gymId && a.gymId === gymId ? 1 : 0;
          const gb = b.gymId && gymId && b.gymId === gymId ? 1 : 0;
          return sb + gb - (sa + ga) || String(a.startTime).localeCompare(String(b.startTime));
        });
      }

      return ok({ plans, userList }, tid);
    }

    return fail("BAD_MODE", `不支持的 mode: ${mode}`, tid);
  } catch (e) {
    return fail("QUERY_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};
