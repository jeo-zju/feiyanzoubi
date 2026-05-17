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

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;

    const action = safeText(event && event.action) || "list";
    const targetOpenid = safeText(event && event.targetOpenid);
    const col = db.collection("RockFriendships");
    const now = Date.now();

    if (action === "follow") {
      if (!targetOpenid) return fail("BAD_REQUEST", "缺少 targetOpenid", tid);
      const found = await col.where(_.or([{ openid, targetOpenid }, { _openid: openid, targetOpenid }])).limit(1).get();
      if (found && found.data && found.data[0]) return ok({ followed: true }, tid);
      await col.add({ data: { openid, targetOpenid, createdAt: now, updatedAt: now } });
      return ok({ followed: true }, tid);
    }

    if (action === "unfollow") {
      if (!targetOpenid) return fail("BAD_REQUEST", "缺少 targetOpenid", tid);
      const found = await col.where(_.or([{ openid, targetOpenid }, { _openid: openid, targetOpenid }])).limit(1).get();
      const doc = found && found.data && found.data[0] ? found.data[0] : null;
      if (doc) await col.doc(doc._id).remove();
      return ok({ followed: false }, tid);
    }

    const page = Math.max(1, Number(event && event.page ? event.page : 1));
    const pageSize = Math.max(1, Math.min(50, Number(event && event.pageSize ? event.pageSize : 20)));
    const skip = (page - 1) * pageSize;

    const res = await col.where(_.or([{ openid }, { _openid: openid }])).orderBy("createdAt", "desc").skip(skip).limit(pageSize + 1).get();
    const list = (res && res.data) || [];
    const hasNext = list.length > pageSize;
    const targetIds = Array.from(new Set(list.slice(0, pageSize).map((x) => x.targetOpenid).filter(Boolean)));
    let users = [];
    if (targetIds.length) {
      const usersRes = await db.collection("RockUsers").where({ openid: _.in(targetIds) }).limit(100).get();
      users = (usersRes && usersRes.data) || [];
    }
    const userMap = users.reduce((m, u) => {
      m[u.openid] = u;
      return m;
    }, {});
    return ok(
      {
        list: list.slice(0, pageSize).map((x) => ({
          ...x,
          user: userMap[x.targetOpenid]
            ? { openid: x.targetOpenid, nickName: userMap[x.targetOpenid].nickName || "", avatarUrl: userMap[x.targetOpenid].avatarUrl || "" }
            : null
        })),
        hasNext
      },
      tid
    );
  } catch (e) {
    return fail("FRIENDSHIP_FAILED", e && e.message ? e.message : "操作失败", tid);
  }
};

