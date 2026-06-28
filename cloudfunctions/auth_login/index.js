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

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    const userInfo = event && event.userInfo ? event.userInfo : null;

    const col = db.collection("RockUsers");
    const now = Date.now();

    const found = await col.where(_.or([{ openid }, { _openid: openid }])).limit(1).get();
    const existing = found && found.data && found.data[0] ? found.data[0] : null;

    const patch = {
      updatedAt: now
    };
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
          nickName: patch.nickName || "",
          avatarUrl: patch.avatarUrl || "",
          createdAt: now,
          updatedAt: now
        }
      });
    } else {
      await col.doc(existing._id).update({ data: patch });
    }

    const latest = await col.where(_.or([{ openid }, { _openid: openid }])).limit(1).get();
    const userDoc = latest && latest.data && latest.data[0] ? latest.data[0] : {};
    const user = {
      openid,
      nickName: userDoc.nickName || "",
      avatarUrl: userDoc.avatarUrl || "",
      role: userDoc.role || "",
      projectName: userDoc.projectName || ""
    };
    return ok({ user }, tid);
  } catch (e) {
    return fail("AUTH_LOGIN_FAILED", e && e.message ? e.message : "登录失败", tid);
  }
};

