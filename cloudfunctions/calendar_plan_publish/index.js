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

function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

function isValidHM(v) {
  return /^\d{2}:\d{2}$/.test(String(v || ""));
}

function parseHM(hm) {
  const m = String(hm).match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
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

async function getUser(openid) {
  try {
    const res = await db.collection("RockUsers").where(_.or([{ openid }, { _openid: openid }, { uid: openid }])).limit(1).get();
    return (res && res.data && res.data[0]) || null;
  } catch (e) {
    return null;
  }
}

async function getPrimaryCard(openid) {
  try {
    const res = await db
      .collection("RockCards")
      .where(_.and([_.or([{ ownerOpenid: openid }, { _openid: openid }]), { isPrimary: true }]))
      .limit(1)
      .get();
    return (res && res.data && res.data[0]) || null;
  } catch (e) {
    return null;
  }
}

async function getGym(gymId) {
  if (!gymId) return null;
  try {
    const res = await db.collection("RockGyms").doc(gymId).get();
    return (res && res.data) || null;
  } catch (e) {
    return null;
  }
}

async function hydrateUserMap(openids) {
  const ids = Array.from(new Set((openids || []).filter(Boolean))).slice(0, 200);
  if (!ids.length) return {};
  try {
    const res = await db
      .collection("RockUsers")
      .where(_.or([{ openid: _.in(ids) }, { _openid: _.in(ids) }, { uid: _.in(ids) }]))
      .limit(200)
      .get();
    const list = (res && res.data) || [];
    const m = {};
    list.forEach((u) => {
      const uid = u.openid || u._openid || u.uid || "";
      if (!uid) return;
      m[uid] = {
        openid: uid,
        nickName: u.nickName || "",
        avatarUrl: u.avatarUrl || "",
        displayName: u.displayName || u.nickName || "",
        title: u.title || "",
        climbSkills: u.climbSkills || null,
        city: u.city || ""
      };
    });
    return m;
  } catch (e) {
    return {};
  }
}

function normalizeSkillTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => safeText(t)).filter(Boolean).slice(0, 10);
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    if (!openid) return fail("AUTH_REQUIRED", "请登录后操作", tid);

    const action = safeText(event && event.action) || "create";
    const payload = (event && event.payload) || {};
    const planId = safeText(event && event.planId);

    const col = db.collection("RockCalendarPlans");
    const now = Date.now();
    const today = todayYMD();
    const maxDate = addDays(today, 13);

    if (action === "cancel") {
      if (!planId) return fail("BAD_REQUEST", "缺少 planId", tid);
      const doc = await col.doc(planId).get().catch(() => null);
      const plan = doc && doc.data ? doc.data : null;
      if (!plan) return fail("NOT_FOUND", "计划不存在", tid);
      const owner = plan._openid || plan.uid || "";
      if (owner !== openid) return fail("PERMISSION_DENIED", "无权取消他人计划", tid);
      await col.doc(planId).update({ data: { status: "cancelled", updatedAt: now, updated_at: db.serverDate() } });
      return ok({ planId }, tid);
    }

    if (action === "create" || action === "update") {
      const mode = safeText(payload.mode) === "outdoor" ? "outdoor" : "gym";
      const gymId = mode === "gym" ? safeText(payload.gymId) : "";
      const outdoorName = mode === "outdoor" ? safeText(payload.outdoorName) : "";
      const date = safeText(payload.date);
      const startTime = safeText(payload.startTime);
      const endTime = safeText(payload.endTime);
      const visibility = safeText(payload.visibility) === "friends" ? "friends" : "public";
      const note = safeText(payload.note);
      const needPartner = !!(payload && payload.needPartner);
      const skillTags = normalizeSkillTags(payload && payload.skillTags);

      if (!date) return fail("BAD_REQUEST", "缺少 date", tid);
      if (!isValidYMD(date)) return fail("BAD_REQUEST", "date 格式应为 YYYY-MM-DD", tid);
      if (date < today) return fail("BAD_REQUEST", "date 不能早于今天", tid);
      if (date > maxDate) return fail("BAD_REQUEST", "仅支持发布未来 14 天内的计划", tid);
      if (!isValidHM(startTime)) return fail("BAD_REQUEST", "缺少 startTime (HH:mm)", tid);
      if (!isValidHM(endTime)) return fail("BAD_REQUEST", "缺少 endTime (HH:mm)", tid);
      const startMin = parseHM(startTime);
      const endMin = parseHM(endTime);
      if (startMin == null || endMin == null) return fail("BAD_REQUEST", "时间段格式错误", tid);
      if (endMin <= startMin) return fail("BAD_REQUEST", "结束时间需晚于开始时间", tid);
      const durationMin = endMin - startMin;
      if (durationMin < 30) return fail("BAD_REQUEST", "时间段至少 30 分钟", tid);
      if (durationMin > 12 * 60) return fail("BAD_REQUEST", "单次计划不超过 12 小时", tid);

      let gym = null;
      let gymSnapshot = null;
      if (mode === "gym") {
        if (!gymId) return fail("BAD_REQUEST", "请选择岩馆", tid);
        gym = await getGym(gymId);
        if (!gym) return fail("NOT_FOUND", "岩馆不存在", tid);
        gymSnapshot = { name: gym.name || "", city: gym.city || "", address: gym.address || "" };
      } else {
        if (!outdoorName) return fail("BAD_REQUEST", "请填写野攀地点", tid);
      }

      const user = await getUser(openid);
      const nickName = (user && (user.nickName || user.wechatName || user.name)) || "";
      const avatarUrl = (user && user.avatarUrl) || "";
      const card = await getPrimaryCard(openid);
      const displayName = (card && card.displayName) || nickName || "";
      const title = (card && card.title) || "";
      const userSnapshot = { nickName, avatarUrl, displayName, title };

      if (action === "create") {
        const data = {
          uid: openid,
          userSnapshot,
          gymId,
          gymSnapshot,
          mode,
          outdoorName,
          date,
          startTime,
          endTime,
          durationMin,
          visibility,
          note,
          needPartner,
          skillTags,
          status: "active",
          checkinRecordId: "",
          createdAt: now,
          updatedAt: now,
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        };
        const r = await col.add({ data });
        return ok({ planId: r && r._id ? String(r._id) : "" }, tid);
      }

      if (action === "update") {
        if (!planId) return fail("BAD_REQUEST", "缺少 planId", tid);
        const doc = await col.doc(planId).get().catch(() => null);
        const plan = doc && doc.data ? doc.data : null;
        if (!plan) return fail("NOT_FOUND", "计划不存在", tid);
        const owner = plan._openid || plan.uid || "";
        if (owner !== openid) return fail("PERMISSION_DENIED", "无权修改他人计划", tid);
        if (plan.status && plan.status !== "active") return fail("BAD_REQUEST", "该计划状态不可修改", tid);
        const data = {
          gymId,
          gymSnapshot,
          mode,
          outdoorName,
          date,
          startTime,
          endTime,
          durationMin,
          visibility,
          note,
          needPartner,
          skillTags,
          updatedAt: now,
          updated_at: db.serverDate()
        };
        await col.doc(planId).update({ data });
        return ok({ planId }, tid);
      }
    }

    if (action === "join_plan") {
      if (!planId) return fail("BAD_REQUEST", "缺少 planId", tid);
      const doc = await col.doc(planId).get().catch(() => null);
      const plan = doc && doc.data ? doc.data : null;
      if (!plan) return fail("NOT_FOUND", "计划不存在", tid);
      if (plan.status && plan.status !== "active") return fail("BAD_REQUEST", "计划不可报名", tid);
      const owner = plan._openid || plan.uid || "";
      if (owner === openid) return fail("BAD_REQUEST", "不能报名自己的计划", tid);
      const joinsCol = db.collection("RockCalendarJoins");
      const existRes = await joinsCol.where({ planId, openid }).limit(1).get();
      if (existRes && existRes.data && existRes.data[0]) {
        return ok({ planId, joined: true, joinId: String(existRes.data[0]._id) }, tid);
      }
      const user = await getUser(openid);
      const nickName = (user && (user.nickName || user.wechatName || user.name)) || "";
      const avatarUrl = (user && user.avatarUrl) || "";
      const card = await getPrimaryCard(openid);
      const displayName = (card && card.displayName) || nickName || "";
      const title = (card && card.title) || "";
      const r = await joinsCol.add({
        data: {
          planId,
          openid,
          planOwnerOpenid: owner,
          date: plan.date || "",
          userSnapshot: { nickName, avatarUrl, displayName, title },
          status: "joined",
          createdAt: now,
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
      return ok({ planId, joined: true, joinId: r && r._id ? String(r._id) : "" }, tid);
    }

    if (action === "unjoin_plan") {
      if (!planId) return fail("BAD_REQUEST", "缺少 planId", tid);
      const joinsCol = db.collection("RockCalendarJoins");
      const existRes = await joinsCol.where({ planId, openid }).limit(1).get();
      const row = existRes && existRes.data && existRes.data[0] ? existRes.data[0] : null;
      if (!row) return ok({ planId, joined: false }, tid);
      await joinsCol.doc(row._id).remove();
      return ok({ planId, joined: false }, tid);
    }

    if (action === "get_joiners") {
      if (!planId) return fail("BAD_REQUEST", "缺少 planId", tid);
      const doc = await col.doc(planId).get().catch(() => null);
      const plan = doc && doc.data ? doc.data : null;
      if (!plan) return fail("NOT_FOUND", "计划不存在", tid);
      const owner = plan._openid || plan.uid || "";
      const joinsCol = db.collection("RockCalendarJoins");
      const listRes = await joinsCol.where({ planId, status: "joined" }).orderBy("createdAt", "asc").limit(200).get();
      const list = (listRes && listRes.data) || [];
      const uids = list.map((x) => x.openid || "").filter(Boolean);
      if (owner) uids.push(owner);
      const userMap = await hydrateUserMap(uids);
      const joiners = list.map((x) => {
        const u = userMap[x.openid] || {};
        const snap = (x && x.userSnapshot) || {};
        return {
          joinId: String(x._id || ""),
          openid: x.openid || "",
          nickName: u.nickName || snap.nickName || "",
          avatarUrl: u.avatarUrl || snap.avatarUrl || "",
          displayName: u.displayName || snap.displayName || "",
          title: u.title || snap.title || "",
          climbSkills: u.climbSkills || null,
          city: u.city || "",
          joinedAt: Number(x.createdAt || 0)
        };
      });
      let ownerInfo = null;
      if (owner) {
        const ou = userMap[owner] || {};
        const planSnap = (plan && plan.userSnapshot) || {};
        ownerInfo = {
          openid: owner,
          nickName: ou.nickName || planSnap.nickName || "",
          avatarUrl: ou.avatarUrl || planSnap.avatarUrl || "",
          displayName: ou.displayName || planSnap.displayName || "",
          title: ou.title || planSnap.title || "",
          climbSkills: ou.climbSkills || null,
          city: ou.city || "",
          isOwner: true
        };
      }
      const joined = joiners.some((x) => x.openid === openid) || owner === openid;
      const isOwner = owner === openid;
      return ok({ planId, ownerInfo, joiners, joinedCount: joiners.length + (owner ? 1 : 0), joined, isOwner }, tid);
    }

    if (action === "remove_joiner") {
      if (!planId) return fail("BAD_REQUEST", "缺少 planId", tid);
      const targetOpenid = safeText(event && event.targetOpenid);
      if (!targetOpenid) return fail("BAD_REQUEST", "缺少 targetOpenid", tid);
      const doc = await col.doc(planId).get().catch(() => null);
      const plan = doc && doc.data ? doc.data : null;
      if (!plan) return fail("NOT_FOUND", "计划不存在", tid);
      const owner = plan._openid || plan.uid || "";
      if (owner !== openid) return fail("PERMISSION_DENIED", "仅计划发起者可移除", tid);
      if (owner === targetOpenid) return fail("BAD_REQUEST", "不能移除发起者", tid);
      const joinsCol = db.collection("RockCalendarJoins");
      const existRes = await joinsCol.where({ planId, openid: targetOpenid }).limit(1).get();
      const row = existRes && existRes.data && existRes.data[0] ? existRes.data[0] : null;
      if (row) await joinsCol.doc(row._id).remove();
      return ok({ planId, removed: true, targetOpenid }, tid);
    }

    return fail("BAD_ACTION", `不支持的 action: ${action}`, tid);
  } catch (e) {
    return fail("PUBLISH_FAILED", e && e.message ? e.message : "提交失败", tid);
  }
};
