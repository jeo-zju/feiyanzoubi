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

function shanghaiDateKey(ts) {
  const t = typeof ts === "number" ? ts : Date.now();
  const d = new Date(t + 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function isCollectionNotExistError(e) {
  const msg = e && e.message ? String(e.message) : "";
  return msg.includes("database collection not exists") || msg.includes("Db or Table not exist") || msg.includes("-502005");
}

async function getCredit(openid) {
  const date = shanghaiDateKey(Date.now());
  const col = db.collection("RockCardCredits");
  try {
    const res = await col.where({ openid, date }).limit(1).get();
    const doc = res && res.data && res.data[0] ? res.data[0] : null;
    const limit = doc && typeof doc.limit === "number" ? doc.limit : 10;
    const used = doc && typeof doc.used === "number" ? doc.used : 0;
    return { date, limit, used, remaining: Math.max(0, limit - used) };
  } catch (e) {
    if (isCollectionNotExistError(e)) return { date, limit: 10, used: 0, remaining: 10 };
    throw e;
  }
}

function pickCardSnapshot(card, userAvatarUrl) {
  const front = card && card.front && typeof card.front === "object" ? card.front : {};
  return {
    cardId: card && card._id ? String(card._id) : "",
    displayName: safeText(front.displayName),
    title: safeText(front.title),
    mbti: safeText(front.mbti),
    oneLiner: safeText(front.oneLiner),
    oneLinerStyle: safeText(front.oneLinerStyle) === "encourage" ? "encourage" : "humor",
    avatarMode: safeText(front.avatarMode) === "custom" ? "custom" : "wechat",
    avatarFileId: safeText(front.avatarFileId),
    avatarUrl: safeText(front.avatarUrl || userAvatarUrl)
  };
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    const full = !!(event && event.full);

    const userRes = await db.collection("RockUsers").where(_.or([{ openid }, { _openid: openid }])).limit(1).get();
    const userDoc = userRes && userRes.data && userRes.data[0] ? userRes.data[0] : null;
    const userAvatarUrl = userDoc && userDoc.avatarUrl ? String(userDoc.avatarUrl) : "";

    const cardsCol = db.collection("RockCards");
    let owned = [];
    try {
      const ownedRes = await cardsCol.where({ ownerOpenid: openid, status: "active" }).orderBy("updatedAt", "desc").limit(120).get();
      owned = (ownedRes && ownedRes.data) || [];
    } catch (e) {
      if (!isCollectionNotExistError(e)) throw e;
    }

    const primary = owned.find((c) => !!c && c.isPrimary) || null;
    const received = owned.filter((c) => !!c && safeText(c.createdByOpenid) && safeText(c.createdByOpenid) !== openid);

    const receivedCount = received.length;
    const receivedThumbs = received
      .slice(0, 6)
      .map((c) => pickCardSnapshot(c, userAvatarUrl))
      .filter((x) => x && x.cardId);

    const credit = await getCredit(openid);

    const payload = {
      openid,
      credit,
      myPrimaryCard: primary ? pickCardSnapshot(primary, userAvatarUrl) : null,
      receivedCount,
      receivedThumbs
    };

    if (full) {
      payload.receivedCards = received
        .slice(0, 100)
        .map((c) => ({ ...pickCardSnapshot(c, userAvatarUrl), createdAt: c && c.createdAt ? c.createdAt : 0 }))
        .filter((x) => x && x.cardId);

      let sentRes = null;
      try {
        sentRes = await cardsCol.where({ createdByOpenid: openid, status: "active" }).orderBy("updatedAt", "desc").limit(200).get();
      } catch (e) {
        if (isCollectionNotExistError(e)) sentRes = { data: [] };
        else sentRes = await cardsCol.where({ createdByOpenid: openid, status: "active" }).limit(200).get();
      }
      const sent = (sentRes && sentRes.data) || [];
      payload.myCreatedGiftedCards = sent
        .filter((c) => !!c && safeText(c.ownerOpenid) && safeText(c.ownerOpenid) !== openid)
        .slice(0, 50)
        .map((c) => ({ ...pickCardSnapshot(c, userAvatarUrl), createdAt: c && c.createdAt ? c.createdAt : 0 }))
        .filter((x) => x && x.cardId);
    }

    return ok(payload, tid);
  } catch (e) {
    return fail("CARD_LIST_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};
