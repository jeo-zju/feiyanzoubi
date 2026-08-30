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

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    if (!openid) return fail("NO_OPENID", "缺少 openid", tid);

    const userInfo = (event && event.userInfo) || null;
    const col = db.collection("RockUsers");
    const found = await col.where(_.or([{ openid }, { _openid: openid }])).limit(1).get();
    const existing = found && found.data && found.data[0] ? found.data[0] : null;

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
  } catch (e) {
    return fail("AUTH_LOGIN_FAILED", e && e.message ? e.message : "登录失败", tid);
  }
};
