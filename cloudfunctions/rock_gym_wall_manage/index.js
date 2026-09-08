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

function safeText(v) {
  return v == null ? "" : String(v).trim();
}

// issue #35: 云函数端用管理端权限批量把 cloud:// fileID 换成临时 https URL。
// 客户端 wx.cloud.getTempFileURL 受云存储安全规则约束，读他人头像可能被拒
// （现象：自己头像可见、他人头像空白，渲染层报 /pages/.../cloud:// 500）；
// 云函数端为管理端权限，不受存储规则限制。返回 { fileID: tempFileURL }。
async function cloudIdsToTempUrl(ids) {
  const list = Array.from(new Set((ids || []).filter((v) => v && String(v).indexOf("cloud://") === 0)));
  const map = {};
  if (!list.length) return map;
  try {
    for (let i = 0; i < list.length; i += 50) {
      const r = await cloud.getTempFileURL({ fileList: list.slice(i, i + 50) });
      ((r && r.fileList) || []).forEach((fi) => {
        if (fi && fi.fileID && fi.tempFileURL) map[fi.fileID] = fi.tempFileURL;
      });
    }
  } catch (e) {}
  return map;
}

function snapshotFromCard(card, avatarUrl) {
  const front = card && card.front && typeof card.front === "object" ? card.front : {};
  return {
    displayName: safeText(front.displayName),
    title: safeText(front.title),
    mbti: safeText(front.mbti),
    oneLiner: safeText(front.oneLiner),
    oneLinerStyle: safeText(front.oneLinerStyle) === "encourage" ? "encourage" : "humor",
    avatarMode: safeText(front.avatarMode) === "custom" ? "custom" : "wechat",
    avatarFileId: safeText(front.avatarFileId),
    avatarUrl: safeText(front.avatarUrl || avatarUrl)
  };
}

async function getGym(gymId) {
  const res = await db.collection("RockGyms").doc(gymId).get();
  return res && res.data ? res.data : null;
}

async function getUserAvatarUrl(openid) {
  if (!openid) return "";
  const res = await db.collection("RockUsers").where({ openid }).limit(1).get();
  const u = res && res.data && res.data[0] ? res.data[0] : null;
  return u && u.avatarUrl ? String(u.avatarUrl) : "";
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;

    const action = safeText(event && event.action) || "get";
    const gymId = safeText(event && event.gymId);
    if (!gymId) return fail("BAD_REQUEST", "缺少 gymId", tid);

    const gym = await getGym(gymId);
    if (!gym) return fail("NOT_FOUND", "岩馆不存在", tid);

    const wallCol = db.collection("RockGymWallCards");
    const capacity = 100;

    if (action === "get") {
      const countRes = await wallCol.where({ gymId }).count();
      const total = countRes && typeof countRes.total === "number" ? countRes.total : 0;
      return ok({ gym: { _id: gym._id, name: gym.name || "", city: gym.city || "" }, capacity, total }, tid);
    }

    if (action === "list_cards") {
      const res = await wallCol.where({ gymId }).orderBy("hungAt", "desc").limit(capacity).get();
      const list = (res && res.data) || [];
      // issue #35: snapshot.avatarFileId / snapshot.avatarUrl 都可能是 cloud://，
      // 云函数端（管理端权限）统一换成临时 https URL，他人浏览岩馆墙也能看到头像
      const cloudIds = [];
      list.forEach((c) => {
        const s = c && c.snapshot;
        if (!s) return;
        [s.avatarFileId, s.avatarUrl].forEach((v) => {
          if (v && String(v).indexOf("cloud://") === 0 && cloudIds.indexOf(v) < 0) cloudIds.push(String(v));
        });
      });
      const urlMap = await cloudIdsToTempUrl(cloudIds);
      const cards = list.map((c) => {
        const s = c && c.snapshot;
        if (!s) return c;
        const fix = (v) => (v && String(v).indexOf("cloud://") === 0 ? (urlMap[v] || v) : v);
        return Object.assign({}, c, {
          snapshot: Object.assign({}, s, {
            avatarFileId: fix(s.avatarFileId),
            avatarUrl: fix(s.avatarUrl)
          })
        });
      });
      return ok({ gymId, capacity, cards }, tid);
    }

    if (action === "hang") {
      const cardId = safeText(event && event.cardId);
      if (!cardId) return fail("BAD_REQUEST", "缺少 cardId", tid);

      const cardRes = await db.collection("RockCards").doc(cardId).get();
      const card = cardRes && cardRes.data ? cardRes.data : null;
      if (!card) return fail("NOT_FOUND", "名片不存在", tid);

      const owner = safeText(card.ownerOpenid);
      const createdBy = safeText(card.createdByOpenid);
      if (owner !== openid && createdBy !== openid) return fail("FORBIDDEN", "无权限", tid);
      if (safeText(card.status) !== "active") return fail("BAD_REQUEST", "名片不可上墙", tid);

      const existed = await wallCol.where({ gymId, cardId }).limit(1).get();
      const ex = existed && existed.data && existed.data[0] ? existed.data[0] : null;
      if (ex) await wallCol.doc(ex._id).remove();

      const now = Date.now();
      const snapAvatarUrl = safeText(card && card.front && card.front.avatarMode) === "custom" ? "" : await getUserAvatarUrl(owner);
      await wallCol.add({
        data: {
          gymId,
          wallId: gymId,
          cardId,
          ownerOpenid: owner,
          createdByOpenid: createdBy,
          snapshot: snapshotFromCard(card, snapAvatarUrl),
          hungByOpenid: openid,
          hungAt: now,
          created_at: db.serverDate()
        }
      });

      const oldRes = await wallCol.where({ gymId }).orderBy("hungAt", "asc").limit(120).get();
      const all = (oldRes && oldRes.data) || [];
      const extra = all.length - capacity;
      if (extra > 0) {
        for (let i = 0; i < extra; i++) {
          const d = all[i];
          if (d && d._id) {
            try {
              await wallCol.doc(d._id).remove();
            } catch (e) {}
          }
        }
      }

      return ok({ hung: true }, tid);
    }

    if (action === "unhang") {
      const cardId = safeText(event && event.cardId);
      if (!cardId) return fail("BAD_REQUEST", "缺少 cardId", tid);

      const existed = await wallCol.where({ gymId, cardId }).limit(1).get();
      const ex = existed && existed.data && existed.data[0] ? existed.data[0] : null;
      if (!ex) return ok({ removed: true }, tid);

      const owner = safeText(ex.ownerOpenid);
      const createdBy = safeText(ex.createdByOpenid);
      const hungBy = safeText(ex.hungByOpenid);
      if (owner !== openid && createdBy !== openid && hungBy !== openid) return fail("FORBIDDEN", "无权限", tid);

      await wallCol.doc(ex._id).remove();
      return ok({ removed: true }, tid);
    }

    return fail("BAD_REQUEST", "未知 action", tid);
  } catch (e) {
    return fail("WALL_FAILED", e && e.message ? e.message : "操作失败", tid);
  }
};
