const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const CIRCLE_COLORS = ["#5D5A88", "#4C6A8A", "#4A7C6E", "#7C5A6A", "#8A6A4C", "#6A6A8A"];
const MAX_NAME_LEN = 12;
const MAX_DESC_LEN = 40;
const DEFAULT_PAGE_SIZE = 20;

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
function pickColor() {
  return CIRCLE_COLORS[Math.floor(Math.random() * CIRCLE_COLORS.length)];
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

// #25: 读取用户主名片（RockCards）——头像/称呼/标题真实存于名片 front，RockUsers 上通常是空的
async function fetchMainCards(openids) {
  const ids = Array.from(new Set((openids || []).filter(Boolean))).slice(0, 200);
  const out = {};
  if (!ids.length) return out;
  const pick = (c) => {
    if (!c) return;
    const oid = safeText(c.ownerOpenid);
    if (!oid || out[oid]) return;
    const front = (c && c.front) || {};
    // 与前端 wall 页一致：自定义头像用 avatarFileId（cloud fileID），微信头像用 avatarUrl
    const avatarUrl =
      front.avatarMode === "custom"
        ? safeText(front.avatarFileId) || safeText(c.avatarUrl)
        : safeText(front.avatarUrl) || safeText(c.avatarUrl);
    out[oid] = {
      cardId: safeText(c._id),
      displayName: safeText(front.displayName) || safeText(c.displayName),
      title: safeText(front.title) || safeText(c.title),
      avatarUrl
    };
  };
  try {
    const primaryRes = await db
      .collection("RockCards")
      .where({ ownerOpenid: _.in(ids), isPrimary: true })
      .limit(200)
      .get();
    ((primaryRes && primaryRes.data) || []).forEach(pick);
  } catch (e) {}
  const missing = ids.filter((id) => !out[id]);
  if (missing.length) {
    try {
      // 兜底：没有 isPrimary 标记的用户，取任一 active 名片（优先带 isPrimary 的）
      const fbRes = await db
        .collection("RockCards")
        .where({ ownerOpenid: _.in(missing), status: "active" })
        .limit(200)
        .get();
      const byOwner = {};
      ((fbRes && fbRes.data) || []).forEach((c) => {
        const oid = safeText(c.ownerOpenid);
        if (!oid || out[oid]) return;
        if (!byOwner[oid]) byOwner[oid] = c;
        else if (c.isPrimary && !byOwner[oid].isPrimary) byOwner[oid] = c;
      });
      Object.keys(byOwner).forEach((oid) => pick(byOwner[oid]));
    } catch (e) {}
  }
  return out;
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
    const userIds = list.map((u) => u.openid || u._openid || u.uid || "").filter(Boolean);
    const cardMap = await fetchMainCards(userIds);
    const m = {};
    list.forEach((u) => {
      const uid = u.openid || u._openid || u.uid || "";
      if (!uid) return;
      const card = cardMap[uid] || {};
      m[uid] = {
        openid: uid,
        nickName: u.nickName || "",
        // 名片主卡优先：displayName/title/avatarUrl，缺省回落 RockUsers
        displayName: card.displayName || u.displayName || u.nickName || "",
        title: card.title || u.title || "",
        avatarUrl: card.avatarUrl || u.avatarUrl || "",
        cardId: card.cardId || "",
        rockId: u.rockId || shortId(uid),
        city: u.city || ""
      };
    });
    return m;
  } catch (e) {
    return {};
  }
}

function normalizeCircle(doc) {
  if (!doc) return null;
  return {
    _id: String(doc._id || ""),
    name: safeText(doc.name),
    description: safeText(doc.description),
    avatarColor: safeText(doc.avatarColor) || CIRCLE_COLORS[0],
    adminOpenid: safeText(doc.adminOpenid),
    city: safeText(doc.city),
    gymIds: Array.isArray(doc.gymIds) ? doc.gymIds.filter(Boolean) : [],
    memberCount: Math.max(0, Number(doc.memberCount || 0) || 0),
    status: safeText(doc.status) || "active",
    createdAt: Number(doc.createdAt || 0) || 0,
    updatedAt: Number(doc.updatedAt || 0) || 0
  };
}

function matchesGym(circleDoc, gymId) {
  if (!safeText(gymId)) return true;
  const gymIds = Array.isArray(circleDoc && circleDoc.gymIds) ? circleDoc.gymIds : [];
  return gymIds.some((g) => String(g) === String(gymId));
}
function matchesCity(circleDoc, city) {
  if (!safeText(city)) return true;
  return safeText(circleDoc && circleDoc.city) === safeText(city);
}
function matchesKeyword(circleDoc, keyword) {
  if (!safeText(keyword)) return true;
  const kw = safeText(keyword).toLowerCase();
  const n = safeText(circleDoc && circleDoc.name).toLowerCase();
  const d = safeText(circleDoc && circleDoc.description).toLowerCase();
  return n.includes(kw) || d.includes(kw);
}

async function updateMemberCount(circleId) {
  try {
    const r = await db
      .collection("RockCircleMembers")
      .where({ circleId: String(circleId), status: "accepted" })
      .count();
    const count = Number(r && r.total) || 0;
    await db.collection("RockCircles").doc(String(circleId)).update({
      data: { memberCount: count, updatedAt: Date.now(), updated_at: db.serverDate() }
    });
    return count;
  } catch (e) {
    return 0;
  }
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    const action = safeText(event && event.action) || "list";
    const now = Date.now();

    const requireLogin = () => {
      if (!openid) throw { code: "AUTH_REQUIRED", message: "请登录后操作" };
    };

    const getOrCreateUserDoc = async () => {
      requireLogin();
      let res = await db
        .collection("RockUsers")
        .where(_.or([{ openid }, { _openid: openid }, { uid: openid }]))
        .limit(1)
        .get();
      if (res && res.data && res.data[0]) return res.data[0];
      try {
        const add = await db.collection("RockUsers").add({
          data: {
            openid,
            _openid: openid,
            nickName: "",
            avatarUrl: "",
            createdAt: now,
            created_at: db.serverDate()
          }
        });
        return { _id: add && add._id, openid };
      } catch (e) {
        return { openid };
      }
    };

    if (action === "create") {
      requireLogin();
      const name = safeText(event && event.name).slice(0, MAX_NAME_LEN);
      if (!name) return fail("BAD_REQUEST", "请输入圈名称", tid);
      const city = safeText(event && event.city);
      const description = safeText(event && event.description).slice(0, MAX_DESC_LEN);
      const gymIds = Array.isArray(event && event.gymIds) ? event.gymIds.map((g) => String(g)).filter(Boolean) : [];
      const avatarColor = (CIRCLE_COLORS.includes(safeText(event && event.avatarColor)) && safeText(event.avatarColor)) || pickColor();

      const addR = await db.collection("RockCircles").add({
        data: {
          name,
          description,
          avatarColor,
          adminOpenid: openid,
          city,
          gymIds,
          memberCount: 1,
          status: "active",
          createdAt: now,
          updatedAt: now,
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
      const circleId = String(addR && addR._id ? addR._id : "");
      if (circleId) {
        try {
          await db.collection("RockCircleMembers").add({
            data: {
              circleId,
              openid,
              role: "admin",
              status: "accepted",
              appliedAt: now,
              joinedAt: now,
              createdAt: now,
              updatedAt: now,
              created_at: db.serverDate(),
              updated_at: db.serverDate()
            }
          });
        } catch (e) {}
      }
      return ok({ circleId, name }, tid);
    }

    if (action === "update") {
      requireLogin();
      const circleId = safeText(event && event.circleId);
      if (!circleId) return fail("BAD_REQUEST", "缺少 circleId", tid);
      const cRes = await db.collection("RockCircles").doc(circleId).get();
      const circle = cRes && cRes.data ? cRes.data : null;
      if (!circle) return fail("NOT_FOUND", "圈不存在", tid);
      if (safeText(circle.adminOpenid) !== openid) return fail("FORBIDDEN", "无权限", tid);

      const patch = {};
      if (event && event.name !== undefined) {
        const v = safeText(event.name).slice(0, MAX_NAME_LEN);
        if (v) patch.name = v;
      }
      if (event && event.description !== undefined) {
        patch.description = safeText(event.description).slice(0, MAX_DESC_LEN);
      }
      if (event && event.avatarColor !== undefined && CIRCLE_COLORS.includes(safeText(event.avatarColor))) {
        patch.avatarColor = safeText(event.avatarColor);
      }
      if (Array.isArray(event && event.gymIds)) {
        patch.gymIds = event.gymIds.map((g) => String(g)).filter(Boolean);
      }
      patch.updatedAt = now;
      patch.updated_at = db.serverDate();
      await db.collection("RockCircles").doc(circleId).update({ data: patch });
      return ok({ updated: true }, tid);
    }

    if (action === "disband") {
      requireLogin();
      const circleId = safeText(event && event.circleId);
      if (!circleId) return fail("BAD_REQUEST", "缺少 circleId", tid);
      const cRes = await db.collection("RockCircles").doc(circleId).get();
      const circle = cRes && cRes.data ? cRes.data : null;
      if (!circle) return fail("NOT_FOUND", "圈不存在", tid);
      if (safeText(circle.adminOpenid) !== openid) return fail("FORBIDDEN", "无权限", tid);
      await db.collection("RockCircles").doc(circleId).update({
        data: { status: "disbanded", updatedAt: now, updated_at: db.serverDate() }
      });
      return ok({ disbanded: true }, tid);
    }

    if (action === "list") {
      const city = safeText(event && event.city);
      const gymId = safeText(event && event.gymId);
      const keyword = safeText(event && event.keyword);
      const page = Math.max(1, Number(event && event.page ? event.page : 1));
      const pageSize = Math.max(1, Math.min(50, Number(event && event.pageSize ? event.pageSize : DEFAULT_PAGE_SIZE)));
      const skip = (page - 1) * pageSize;

      let all = [];
      try {
        const res = await db
          .collection("RockCircles")
          .where({ status: "active" })
          .orderBy("updatedAt", "desc")
          .limit(500)
          .get();
        all = (res && res.data) || [];
      } catch (e) {
        all = [];
      }
      const filtered = all.filter(
        (c) => matchesCity(c, city) && matchesGym(c, gymId) && matchesKeyword(c, keyword)
      );
      filtered.sort((a, b) => Number(b.memberCount || 0) - Number(a.memberCount || 0));
      const hasNext = filtered.length > skip + pageSize;
      const list = filtered.slice(skip, skip + pageSize).map(normalizeCircle);

      let myMembershipMap = {};
      if (openid) {
        try {
          const cIds = list.map((c) => c._id).filter(Boolean);
          if (cIds.length) {
            const mRes = await db
              .collection("RockCircleMembers")
              .where({ openid, circleId: _.in(cIds) })
              .limit(100)
              .get();
            ((mRes && mRes.data) || []).forEach((m) => {
              myMembershipMap[String(m.circleId)] = {
                role: safeText(m.role),
                status: safeText(m.status)
              };
            });
          }
        } catch (e) {}
      }

      return ok({ list, hasNext, page, total: filtered.length, myMembershipMap }, tid);
    }

    if (action === "myList") {
      requireLogin();
      let mRes;
      try {
        mRes = await db
          .collection("RockCircleMembers")
          .where({ openid, status: _.or(_.eq("accepted"), _.eq("pending")) })
          .orderBy("updatedAt", "desc")
          .limit(50)
          .get();
      } catch (e) {
        mRes = { data: [] };
      }
      const rels = (mRes && mRes.data) || [];
      const cIds = rels.map((r) => String(r.circleId)).filter(Boolean);
      let circles = [];
      if (cIds.length) {
        try {
          const cRes = await db.collection("RockCircles").where({ _id: _.in(cIds) }).limit(100).get();
          circles = (cRes && cRes.data) || [];
        } catch (e) {}
      }
      const map = {};
      circles.forEach((c) => {
        map[String(c._id)] = normalizeCircle(c);
      });
      const list = rels
        .map((r) => {
          const c = map[String(r.circleId)];
          if (!c || c.status !== "active") return null;
          return { ...c, myRole: safeText(r.role), myStatus: safeText(r.status) };
        })
        .filter(Boolean);
      return ok({ list }, tid);
    }

    if (action === "getDetail") {
      requireLogin();
      const circleId = safeText(event && event.circleId);
      if (!circleId) return fail("BAD_REQUEST", "缺少 circleId", tid);
      let circle = null;
      try {
        const cRes = await db.collection("RockCircles").doc(circleId).get();
        circle = cRes && cRes.data ? normalizeCircle(cRes.data) : null;
      } catch (e) {
        circle = null;
      }
      if (!circle) return fail("NOT_FOUND", "圈不存在", tid);

      const relsRes = await db
        .collection("RockCircleMembers")
        .where({ circleId })
        .orderBy("createdAt", "asc")
        .limit(200)
        .get();
      const rels = (relsRes && relsRes.data) || [];
      const uids = rels.map((r) => r.openid).filter(Boolean);
      const userMap = await hydrateUsers(uids);

      const members = [];
      const pendings = [];
      rels.forEach((r) => {
        const openidVal = safeText(r.openid);
        const u = userMap[openidVal] || null;
        const row = {
          openid: openidVal,
          user: u,
          role: safeText(r.role),
          status: safeText(r.status),
          joinedAt: Number(r.joinedAt || 0) || 0,
          appliedAt: Number(r.appliedAt || 0) || 0,
          // #25: 扁平化成员展示字段（主卡优先），wxml 直接消费
          displayName: (u && u.displayName) || "",
          nickName: (u && u.nickName) || "",
          title: (u && u.title) || "",
          avatarUrl: (u && u.avatarUrl) || "",
          cardId: (u && u.cardId) || "",
          rockId: (u && u.rockId) || ""
        };
        if (row.status === "accepted") members.push(row);
        else if (row.status === "pending") pendings.push(row);
      });

      const gymDetails = [];
      if (circle.gymIds && circle.gymIds.length) {
        try {
          const gRes = await db
            .collection("RockGyms")
            .where({ _id: _.in(circle.gymIds) })
            .limit(100)
            .get();
          ((gRes && gRes.data) || []).forEach((g) => {
            gymDetails.push({
              _id: String(g._id || ""),
              name: safeText(g.name || g.gymName),
              city: safeText(g.city),
              address: safeText(g.address || g.addr)
            });
          });
        } catch (e) {}
      }

      let myMembership = null;
      const mine = rels.find((r) => safeText(r.openid) === openid);
      if (mine) {
        myMembership = {
          role: safeText(mine.role),
          status: safeText(mine.status),
          isAdmin: safeText(mine.role) === "admin" || safeText(circle.adminOpenid) === openid
        };
      }

      // issue #35: 成员/待审批头像 cloud:// 在云函数端换成临时 https URL（管理端权限）
      const resolvedMembers = await resolveCloudAvatarFields(members, "avatarUrl");
      const resolvedPendings = await resolveCloudAvatarFields(pendings, "avatarUrl");

      return ok(
        {
          circle,
          members: resolvedMembers,
          pendings: resolvedPendings,
          pendingCount: pendings.length,
          gyms: gymDetails,
          myMembership,
          isAdmin: safeText(circle.adminOpenid) === openid
        },
        tid
      );
    }

    if (action === "apply") {
      requireLogin();
      const circleId = safeText(event && event.circleId);
      if (!circleId) return fail("BAD_REQUEST", "缺少 circleId", tid);
      const cRes = await db.collection("RockCircles").doc(circleId).get();
      const circle = cRes && cRes.data ? cRes.data : null;
      if (!circle) return fail("NOT_FOUND", "圈不存在", tid);
      if (safeText(circle.status) !== "active") return fail("CLOSED", "圈已解散", tid);
      if (safeText(circle.adminOpenid) === openid) {
        return ok({ status: "already_admin" }, tid);
      }
      const exist = await db
        .collection("RockCircleMembers")
        .where({ circleId, openid })
        .limit(1)
        .get();
      const doc = exist && exist.data && exist.data[0] ? exist.data[0] : null;
      if (doc) {
        if (safeText(doc.status) === "accepted") return ok({ status: "already_member" }, tid);
        if (safeText(doc.status) === "pending") return ok({ status: "already_pending" }, tid);
        if (safeText(doc.status) === "rejected") {
          await db.collection("RockCircleMembers").doc(doc._id).update({
            data: { status: "pending", appliedAt: now, updatedAt: now, updated_at: db.serverDate() }
          });
          return ok({ status: "pending" }, tid);
        }
      }
      await db.collection("RockCircleMembers").add({
        data: {
          circleId,
          openid,
          role: "member",
          status: "pending",
          appliedAt: now,
          joinedAt: 0,
          createdAt: now,
          updatedAt: now,
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
      return ok({ status: "pending" }, tid);
    }

    if (action === "approve") {
      requireLogin();
      const circleId = safeText(event && event.circleId);
      const targetOpenid = safeText(event && event.openid);
      if (!circleId || !targetOpenid) return fail("BAD_REQUEST", "缺少参数", tid);
      const cRes = await db.collection("RockCircles").doc(circleId).get();
      const circle = cRes && cRes.data ? cRes.data : null;
      if (!circle) return fail("NOT_FOUND", "圈不存在", tid);
      if (safeText(circle.adminOpenid) !== openid) return fail("FORBIDDEN", "无权限", tid);
      const exist = await db
        .collection("RockCircleMembers")
        .where({ circleId, openid: targetOpenid, status: "pending" })
        .limit(1)
        .get();
      const doc = exist && exist.data && exist.data[0] ? exist.data[0] : null;
      if (!doc) return fail("NOT_FOUND", "申请不存在", tid);
      await db.collection("RockCircleMembers").doc(doc._id).update({
        data: { status: "accepted", joinedAt: now, updatedAt: now, updated_at: db.serverDate() }
      });
      await updateMemberCount(circleId);
      return ok({ status: "accepted" }, tid);
    }

    if (action === "reject") {
      requireLogin();
      const circleId = safeText(event && event.circleId);
      const targetOpenid = safeText(event && event.openid);
      if (!circleId || !targetOpenid) return fail("BAD_REQUEST", "缺少参数", tid);
      const cRes = await db.collection("RockCircles").doc(circleId).get();
      const circle = cRes && cRes.data ? cRes.data : null;
      if (!circle) return fail("NOT_FOUND", "圈不存在", tid);
      if (safeText(circle.adminOpenid) !== openid) return fail("FORBIDDEN", "无权限", tid);
      const exist = await db
        .collection("RockCircleMembers")
        .where({ circleId, openid: targetOpenid, status: "pending" })
        .limit(1)
        .get();
      const doc = exist && exist.data && exist.data[0] ? exist.data[0] : null;
      if (!doc) return fail("NOT_FOUND", "申请不存在", tid);
      await db.collection("RockCircleMembers").doc(doc._id).update({
        data: { status: "rejected", updatedAt: now, updated_at: db.serverDate() }
      });
      return ok({ status: "rejected" }, tid);
    }

    if (action === "remove") {
      requireLogin();
      const circleId = safeText(event && event.circleId);
      const targetOpenid = safeText(event && event.openid);
      if (!circleId || !targetOpenid) return fail("BAD_REQUEST", "缺少参数", tid);
      const cRes = await db.collection("RockCircles").doc(circleId).get();
      const circle = cRes && cRes.data ? cRes.data : null;
      if (!circle) return fail("NOT_FOUND", "圈不存在", tid);
      if (safeText(circle.adminOpenid) !== openid) return fail("FORBIDDEN", "无权限", tid);
      if (safeText(circle.adminOpenid) === targetOpenid) return fail("BAD_REQUEST", "不能移除管理员", tid);
      const exist = await db
        .collection("RockCircleMembers")
        .where({ circleId, openid: targetOpenid })
        .limit(1)
        .get();
      const doc = exist && exist.data && exist.data[0] ? exist.data[0] : null;
      if (doc) await db.collection("RockCircleMembers").doc(doc._id).remove();
      await updateMemberCount(circleId);
      return ok({ removed: true }, tid);
    }

    if (action === "leave") {
      requireLogin();
      const circleId = safeText(event && event.circleId);
      if (!circleId) return fail("BAD_REQUEST", "缺少 circleId", tid);
      const cRes = await db.collection("RockCircles").doc(circleId).get();
      const circle = cRes && cRes.data ? cRes.data : null;
      if (!circle) return fail("NOT_FOUND", "圈不存在", tid);
      if (safeText(circle.adminOpenid) === openid) return fail("FORBIDDEN", "管理员请先解散", tid);
      const exist = await db
        .collection("RockCircleMembers")
        .where({ circleId, openid })
        .limit(1)
        .get();
      const doc = exist && exist.data && exist.data[0] ? exist.data[0] : null;
      if (doc) await db.collection("RockCircleMembers").doc(doc._id).remove();
      await updateMemberCount(circleId);
      return ok({ left: true }, tid);
    }

    if (action === "post_create") {
      requireLogin();
      const circleId = safeText(event && event.circleId);
      const content = safeText(event && event.content);
      const images = Array.isArray(event && event.images) ? (event.images || []).filter(Boolean).slice(0, 9) : [];
      if (!circleId) return fail("BAD_REQUEST", "缺少 circleId", tid);
      if (!content && !images.length) return fail("BAD_REQUEST", "内容不能为空", tid);
      const cRes = await db.collection("RockCircles").doc(circleId).get();
      const circle = cRes && cRes.data ? cRes.data : null;
      if (!circle) return fail("NOT_FOUND", "圈不存在", tid);
      const memberRes = await db.collection("RockCircleMembers").where({ circleId, openid, status: "accepted" }).limit(1).get();
      const isMember = memberRes && memberRes.data && memberRes.data.length > 0;
      const isAdmin = safeText(circle.adminOpenid) === openid;
      if (!isMember && !isAdmin) return fail("FORBIDDEN", "不是圈成员", tid);
      let nickName = ""; let avatarUrl = "";
      try {
        const uRes = await db.collection("RockUsers").where(_.or([{ openid }, { _openid: openid }, { uid: openid }])).limit(1).get();
        const u = uRes && uRes.data && uRes.data[0] ? uRes.data[0] : null;
        if (u) { nickName = u.nickName || ""; avatarUrl = u.avatarUrl || ""; }
      } catch (e) {}
      const r = await db.collection("RockCirclePosts").add({
        data: {
          circleId,
          openid,
          _openid: openid,
          nickName,
          avatarUrl,
          content: String(content || "").slice(0, 2000),
          images,
          status: "active",
          createdAt: Date.now(),
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
      try { await db.collection("RockCircles").doc(circleId).update({ data: { lastPostAt: Date.now(), updated_at: db.serverDate() } }); } catch (e) {}
      return ok({ postId: r && r._id ? String(r._id) : "" }, tid);
    }

    if (action === "post_list") {
      const circleId = safeText(event && event.circleId);
      const limit = Math.min(50, Math.max(1, Number(event && event.limit) || 30));
      const skip = Math.max(0, Number(event && event.skip) || 0);
      if (!circleId) return fail("BAD_REQUEST", "缺少 circleId", tid);
      const cRes = await db.collection("RockCircles").doc(circleId).get();
      const circle = cRes && cRes.data ? cRes.data : null;
      if (!circle) return fail("NOT_FOUND", "圈不存在", tid);
      let adminOpenid = safeText(circle.adminOpenid);
      const wxctx = cloud.getWXContext();
      const openidCur = wxctx.OPENID;
      let canView = adminOpenid === openidCur;
      if (!canView) { try { const mr = await db.collection("RockCircleMembers").where({ circleId, openid: openidCur, status: "accepted" }).limit(1).get(); canView = mr && mr.data && mr.data.length > 0; } catch (e) {} }
      if (!canView && safeText(circle.public) !== "public" && circle.visibility !== "public") {
        if (circle.public !== true) return fail("FORBIDDEN", "非圈成员不可查看动态", tid);
      }
      const raw = await db.collection("RockCirclePosts").where({ circleId, status: _.neq("deleted") }).orderBy("createdAt", "desc").skip(skip).limit(limit).get();
      const list = (raw && raw.data) || [];
      const posts = list.map((p) => ({
        postId: String(p._id || ""),
        circleId: p.circleId || "",
        openid: p.openid || "",
        nickName: p.nickName || "",
        avatarUrl: p.avatarUrl || "",
        content: p.content || "",
        images: Array.isArray(p.images) ? p.images : [],
        isOwner: (p.openid || "") === openidCur,
        createdAt: Number(p.createdAt || 0)
      }));
      return ok({ posts, hasMore: posts.length >= limit }, tid);
    }

    if (action === "post_delete") {
      requireLogin();
      const postId = safeText(event && event.postId);
      if (!postId) return fail("BAD_REQUEST", "缺少 postId", tid);
      const doc = await db.collection("RockCirclePosts").doc(postId).get().catch(() => null);
      const post = doc && doc.data ? doc.data : null;
      if (!post) return fail("NOT_FOUND", "动态不存在", tid);
      let isAdmin = false;
      if (post.circleId) {
        try {
          const cRes = await db.collection("RockCircles").doc(String(post.circleId)).get();
          const c = cRes && cRes.data ? cRes.data : null;
          isAdmin = c && safeText(c.adminOpenid) === openid;
        } catch (e) {}
      }
      if ((post.openid || "") !== openid && !isAdmin) return fail("FORBIDDEN", "无权限删除", tid);
      await db.collection("RockCirclePosts").doc(postId).update({ data: { status: "deleted", deletedBy: openid, deletedAt: Date.now(), deleted_at: db.serverDate() } });
      return ok({ deleted: true }, tid);
    }

    return fail("UNKNOWN_ACTION", `未知 action: ${action}`, tid);
  } catch (e) {
    return fail("INTERNAL_ERROR", e && e.message ? e.message : "操作失败", tid);
  }
};
