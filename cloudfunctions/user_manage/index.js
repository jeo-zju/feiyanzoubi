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
}

const ALLOWED_TOPLEVEL = new Set([
  "nickName", "avatarUrl", "city", "gender", "province", "country",
  "heightCm", "armspanCm", "title", "mbti", "displayName", "slogan"
]);
const ALLOWED_NESTED = new Set(["climbSkills", "giftWall"]);

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    if (!openid) return fail("NO_OPENID", "缺少 openid", tid);
    const action = (event && event.action) || "update";
    const col = db.collection("RockUsers");
    const found = await col.where(_.or([{ openid }, { _openid: openid }])).limit(1).get();
    const existing = found && found.data && found.data[0] ? found.data[0] : null;

    if (action === "login") {
      return loginFlow(col, openid, event, tid, existing);
    }

    if (!existing) return fail("NO_USER", "用户不存在", tid);

    if (action === "me") {
      const me = await hydrateMe(existing);
      return ok({ me }, tid);
    }
    if (action !== "update") {
      return fail("INVALID_ACTION", "仅支持 login / update / me", tid);
    }

    const payload = (event && event.payload) || {};
    const now = Date.now();
    const patch = { updatedAt: now };
    Object.keys(payload).forEach((k) => {
      if (ALLOWED_TOPLEVEL.has(k)) {
        const v = payload[k];
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v == null) patch[k] = v;
      }
    });
    if (payload.climbSkills && typeof payload.climbSkills === "object") {
      const skills = payload.climbSkills;
      const sanitized = {};
      ["boulder", "lead", "toprope", "difficulty", "protector"].forEach((k) => {
        if (k === "protector") {
          sanitized[k] = !!skills[k];
        } else if (skills[k] != null) {
          const v = String(skills[k]).trim();
          if (v.length <= 12) sanitized[k] = v;
        }
      });
      patch.climbSkills = Object.assign({}, existing.climbSkills || {}, sanitized);
    }
    if (payload.giftWall && typeof payload.giftWall === "object") {
      patch.giftWall = Object.assign({}, existing.giftWall || {}, payload.giftWall);
    }
    if (!existing.rockId) patch.rockId = hashOpenidToRockId(openid);
    await col.doc(existing._id).update({ data: patch });
    const q2 = await col.doc(existing._id).get();
    const me = await hydrateMe(q2.data);
    return ok({ me }, tid);
  } catch (e) {
    return fail("USER_MANAGE_FAILED", e && e.message ? e.message : "操作失败", tid);
  }
};

async function loginFlow(col, openid, event, tid, existing) {
  const userInfo = event && event.userInfo ? event.userInfo : null;
  const now = Date.now();
  const rockId = hashOpenidToRockId(openid);
  const patch = { updatedAt: now };
  if (rockId) patch.rockId = rockId;
  if (userInfo && typeof userInfo === "object") {
    if (userInfo.nickName) patch.nickName = userInfo.nickName;
    if (userInfo.avatarUrl) patch.avatarUrl = userInfo.avatarUrl;
    if (userInfo.gender != null) patch.gender = userInfo.gender;
    if (userInfo.city) patch.city = userInfo.city;
    if (userInfo.province) patch.province = userInfo.province;
    if (userInfo.country) patch.country = userInfo.country;
    patch.userInfoUpdatedAt = now;
  }
  if (!existing) {
    await col.add({
      data: {
        openid,
        rockId: rockId || "",
        nickName: patch.nickName || "",
        avatarUrl: patch.avatarUrl || "",
        createdAt: now,
        updatedAt: now
      }
    });
  } else {
    if (!(existing && existing.rockId) && rockId) {
      patch.rockId = rockId;
    } else if (existing && existing.rockId) {
      delete patch.rockId;
    }
    await col.doc(existing._id).update({ data: patch });
  }
  const latest = await col.where(_.or([{ openid }, { _openid: openid }])).limit(1).get();
  const userDoc = latest && latest.data && latest.data[0] ? latest.data[0] : {};
  const user = {
    openid,
    nickName: userDoc.nickName || "",
    avatarUrl: userDoc.avatarUrl || "",
    role: userDoc.role || "",
    projectName: userDoc.projectName || "Project",
    rockId: userDoc.rockId || rockId || ""
  };
  return ok({ user }, tid);
}

async function hydrateMe(doc) {
  const openid = doc.openid || doc._openid || "";
  const fCol = db.collection("RockFriendships");
  const acceptedCount = await fCol.where(_.and([
    _.or([{ fromOpenid: openid }, { toOpenid: openid }, { openid }, { targetOpenid: openid }]),
    _.or([{ status: "accepted" }, { status: _.exists(false) }])
  ])).count();
  return {
    _openid: openid,
    openid,
    nickName: doc.nickName || "",
    avatarUrl: doc.avatarUrl || "",
    displayName: doc.displayName || doc.nickName || "",
    city: doc.city || "",
    role: doc.role || "",
    rockId: doc.rockId || "",
    title: doc.title || "",
    mbti: doc.mbti || "",
    heightCm: doc.heightCm || doc.height || "",
    armspanCm: doc.armspanCm || doc.armspan || "",
    climbSkills: doc.climbSkills || {},
    giftWall: doc.giftWall || {},
    slogan: doc.slogan || "",
    acceptedCount: (acceptedCount && acceptedCount.total) || 0
  };
}
