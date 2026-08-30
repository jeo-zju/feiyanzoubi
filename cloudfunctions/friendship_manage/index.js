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

function shortId(openid) {
  if (!openid) return "";
  let h = 0;
  for (let i = 0; i < openid.length; i++) h = (h * 31 + openid.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().slice(-6);
}

async function hydrateUsers(openids) {
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
        rockId: shortId(uid),
        climbSkills: u.climbSkills || null,
        city: u.city || ""
      };
    });
    return m;
  } catch (e) {
    return {};
  }
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    if (!openid) return fail("AUTH_REQUIRED", "请登录后操作", tid);

    const action = safeText(event && event.action) || "list";
    const col = db.collection("RockFriendships");
    const now = Date.now();

    if (action === "request") {
      const toOpenid = safeText(event && event.toOpenid);
      if (!toOpenid) return fail("BAD_REQUEST", "缺少 toOpenid", tid);
      if (toOpenid === openid) return fail("BAD_REQUEST", "不能添加自己", tid);
      const exist = await col
        .where(
          _.or([
            _.and([{ fromOpenid: openid }, { toOpenid }]),
            _.and([{ fromOpenid: toOpenid }, { toOpenid: openid }])
          ])
        )
        .limit(1)
        .get();
      const doc = exist && exist.data && exist.data[0] ? exist.data[0] : null;
      if (doc) {
        if (doc.status === "accepted") return ok({ status: "already_friends", id: doc._id }, tid);
        if (doc.fromOpenid === openid && doc.status === "pending") return ok({ status: "already_pending", id: doc._id }, tid);
        if (doc.fromOpenid === toOpenid && doc.status === "pending") {
          await col.doc(doc._id).update({ data: { status: "accepted", acceptedAt: now, updatedAt: now, updated_at: db.serverDate() } });
          return ok({ status: "mutual_accepted", id: doc._id }, tid);
        }
      }
      const r = await col.add({
        data: {
          fromOpenid: openid,
          toOpenid,
          status: "pending",
          createdAt: now,
          updatedAt: now,
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
      return ok({ status: "pending", id: r && r._id ? String(r._id) : "" }, tid);
    }

    if (action === "accept") {
      const fromOpenid = safeText(event && event.fromOpenid);
      if (!fromOpenid) return fail("BAD_REQUEST", "缺少 fromOpenid", tid);
      const exist = await col.where(_.and([{ fromOpenid }, { toOpenid: openid }, { status: "pending" }])).limit(1).get();
      const doc = exist && exist.data && exist.data[0] ? exist.data[0] : null;
      if (!doc) return fail("NOT_FOUND", "申请不存在", tid);
      await col.doc(doc._id).update({ data: { status: "accepted", acceptedAt: now, updatedAt: now, updated_at: db.serverDate() } });
      return ok({ status: "accepted", id: doc._id }, tid);
    }

    if (action === "reject") {
      const fromOpenid = safeText(event && event.fromOpenid);
      if (!fromOpenid) return fail("BAD_REQUEST", "缺少 fromOpenid", tid);
      const exist = await col.where(_.and([{ fromOpenid }, { toOpenid: openid }, { status: "pending" }])).limit(1).get();
      const doc = exist && exist.data && exist.data[0] ? exist.data[0] : null;
      if (!doc) return fail("NOT_FOUND", "申请不存在", tid);
      await col.doc(doc._id).update({ data: { status: "rejected", updatedAt: now, updated_at: db.serverDate() } });
      return ok({ status: "rejected", id: doc._id }, tid);
    }

    if (action === "remove") {
      const targetOpenid = safeText(event && event.targetOpenid);
      if (!targetOpenid) return fail("BAD_REQUEST", "缺少 targetOpenid", tid);
      const exist = await col
        .where(
          _.or([
            _.and([{ fromOpenid: openid }, { toOpenid: targetOpenid }]),
            _.and([{ fromOpenid: targetOpenid }, { toOpenid: openid }])
          ])
        )
        .limit(1)
        .get();
      const doc = exist && exist.data && exist.data[0] ? exist.data[0] : null;
      if (doc) await col.doc(doc._id).remove();
      return ok({ removed: true }, tid);
    }

    if (action === "search") {
      const keyword = safeText(event && event.keyword);
      if (!keyword) return ok({ users: [] }, tid);
      const rockIdLike = keyword.toUpperCase();
      let users = [];
      try {
        const nickRes = await db
          .collection("RockUsers")
          .where({ nickName: db.RegExp({ regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), options: "i" }) })
          .limit(30)
          .get();
        users = (nickRes && nickRes.data) || [];
      } catch (e) {}
      const results = users
        .filter((u) => {
          const uid = u.openid || u._openid || u.uid || "";
          return uid && uid !== openid;
        })
        .map((u) => {
          const uid = u.openid || u._openid || u.uid || "";
          return {
            openid: uid,
            nickName: u.nickName || "",
            avatarUrl: u.avatarUrl || "",
            rockId: shortId(uid),
            match: "nickName"
          };
        });
      if (!results.length && /^[0-9A-Z]{4,8}$/.test(rockIdLike)) {
        try {
          const all = await db.collection("RockUsers").limit(200).get();
          const list = (all && all.data) || [];
          for (let i = 0; i < list.length; i++) {
            const u = list[i];
            const uid = u.openid || u._openid || u.uid || "";
            if (!uid || uid === openid) continue;
            if (shortId(uid) === rockIdLike || shortId(uid).indexOf(rockIdLike) === 0) {
              results.push({
                openid: uid,
                nickName: u.nickName || "",
                avatarUrl: u.avatarUrl || "",
                rockId: shortId(uid),
                match: "rockId"
              });
              if (results.length >= 20) break;
            }
          }
        } catch (e) {}
      }
      return ok({ users: results }, tid);
    }

    // action = list（兼容旧的 follow 模型数据）
    const page = Math.max(1, Number(event && event.page ? event.page : 1));
    const pageSize = Math.max(1, Math.min(100, Number(event && event.pageSize ? event.pageSize : 50)));
    const skip = (page - 1) * pageSize;

    const relRes = await col
      .where(_.or([{ fromOpenid: openid }, { toOpenid: openid }, { openid }]))
      .orderBy("updatedAt", "desc")
      .orderBy("createdAt", "desc")
      .skip(skip)
      .limit(pageSize + 1)
      .get();
    const rels = (relRes && relRes.data) || [];
    const hasNext = rels.length > pageSize;
    const slice = rels.slice(0, pageSize);

    const uids = new Set();
    slice.forEach((r) => {
      if (r.fromOpenid) uids.add(r.fromOpenid);
      if (r.toOpenid) uids.add(r.toOpenid);
      if (r.openid && r.targetOpenid) {
        uids.add(r.openid);
        uids.add(r.targetOpenid);
      }
    });
    const userMap = await hydrateUsers(Array.from(uids));

    const accepted = [];
    const incoming = [];
    const outgoing = [];
    const legacyFollow = [];
    slice.forEach((r) => {
      if (r.status === "accepted") {
        const otherId = r.fromOpenid === openid ? r.toOpenid : r.fromOpenid;
        accepted.push({ id: r._id, openid: otherId, user: userMap[otherId] || null, acceptedAt: r.acceptedAt || r.updatedAt });
      } else if (r.status === "pending" && r.toOpenid === openid) {
        incoming.push({ id: r._id, openid: r.fromOpenid, user: userMap[r.fromOpenid] || null, createdAt: r.createdAt });
      } else if (r.status === "pending" && r.fromOpenid === openid) {
        outgoing.push({ id: r._id, openid: r.toOpenid, user: userMap[r.toOpenid] || null, createdAt: r.createdAt });
      } else if (!r.status && r.openid === openid && r.targetOpenid) {
        legacyFollow.push({ id: r._id, openid: r.targetOpenid, user: userMap[r.targetOpenid] || null, createdAt: r.createdAt });
      }
    });

    const myRockId = shortId(openid);
    return ok({ accepted, incoming, outgoing, legacyFollow, hasNext, myRockId }, tid);
  } catch (e) {
    return fail("FRIENDSHIP_FAILED", e && e.message ? e.message : "操作失败", tid);
  }
};
