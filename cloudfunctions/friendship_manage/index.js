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

// issue #35: 云函数端用管理端权限批量把 cloud:// fileID 换成临时 https URL。
// 客户端 wx.cloud.getTempFileURL 受云存储安全规则约束，读他人头像可能被拒
// （现象：自己头像可见、他人头像空白，渲染层报 /pages/.../cloud:// 500）；
// 云函数端为管理端权限，不受存储规则限制。
async function resolveCloudAvatarFields(items, field) {
  if (!Array.isArray(items)) return items;
  const f = field || "avatarUrl";
  const ids = [];
  items.forEach((it) => {
    const v = it && it[f];
    if (v && String(v).indexOf("cloud://") === 0 && ids.indexOf(v) < 0) ids.push(String(v));
  });
  if (!ids.length) return items;
  const urlMap = {};
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const r = await cloud.getTempFileURL({ fileList: ids.slice(i, i + 50) });
      ((r && r.fileList) || []).forEach((fi) => {
        if (fi && fi.fileID && fi.tempFileURL) urlMap[fi.fileID] = fi.tempFileURL;
      });
    }
  } catch (e) {}
  return items.map((it) => {
    const v = it && it[f];
    if (v && urlMap[v]) return Object.assign({}, it, { [f]: urlMap[v] });
    return it;
  });
}

function shortId(openid) {
  // #30: 统一为与 user_manage hashOpenidToRockId 一致的 FNV-1a 算法，保证同一用户 ID 全局唯一稳定
function hashOpenidToRockId(openid) {
  if (!openid) return "000000";
  let h = 0x811c9dc5;
  for (let i = 0; i < openid.length; i++) {
    h ^= openid.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  h = h >>> 0;
  const base = 36;
  const length = 6;
  let out = "";
  let v = h;
  while (out.length < length) {
    const r = v % base;
    out = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"[r] + out;
    v = Math.floor(v / base);
    if (v === 0) v = 1;
  }
  return out.slice(-length).toUpperCase();
}}

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
        rockId: u.rockId || shortId(uid),
        climbSkills: u.climbSkills || null,
        city: u.city || ""
      };
    });
    // issue #35: 头像 cloud:// 换成临时 https URL（管理端权限，他人也可读）
    const mKeys = Object.keys(m);
    const mResolved = await resolveCloudAvatarFields(mKeys.map((k) => m[k]), "avatarUrl");
    mKeys.forEach((k, i) => { m[k] = mResolved[i]; });
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
            _openid: uid,
            nickName: u.nickName || "",
            avatarUrl: u.avatarUrl || "",
            rockId: u.rockId || shortId(uid),
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
            // 岩友 ID 同时兼容两种派生：文档里存的官方 rockId（名片/个人页展示，FNV）与旧列表行 shortId
            const storedRockId = String(u.rockId || "").toUpperCase();
            const derivedRockId = u.rockId || shortId(uid);
            const hitStored = storedRockId && (storedRockId === rockIdLike || storedRockId.indexOf(rockIdLike) === 0);
            const hitDerived = derivedRockId === rockIdLike || derivedRockId.indexOf(rockIdLike) === 0;
            if (hitStored || hitDerived) {
              results.push({
                openid: uid,
                _openid: uid,
                nickName: u.nickName || "",
                avatarUrl: u.avatarUrl || "",
                rockId: hitStored ? storedRockId : derivedRockId,
                match: "rockId"
              });
              if (results.length >= 20) break;
            }
          }
        } catch (e) {}
      }
      // issue #35: 搜索结果头像 cloud:// 换成临时 https URL（管理端权限，他人也可读）
      const resolvedResults = await resolveCloudAvatarFields(results, "avatarUrl");
      // 【云函数改动】list 为 users 的兼容别名（旧前端曾读 r.list），行内 _openid 为 openid 的兼容别名
      return ok({ users: resolvedResults, list: resolvedResults }, tid);
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
