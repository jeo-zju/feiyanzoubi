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

async function consumeCredit(openid) {
  const date = shanghaiDateKey(Date.now());
  const col = db.collection("RockCardCredits");
  const found = await col.where({ openid, date }).limit(1).get();
  const doc = found && found.data && found.data[0] ? found.data[0] : null;
  const limit = doc && typeof doc.limit === "number" ? doc.limit : 10;
  const used = doc && typeof doc.used === "number" ? doc.used : 0;
  if (used >= limit) return { ok: false, limit, used, remaining: 0, date };
  if (!doc) {
    await col.add({ data: { openid, date, limit, used: 1, updated_at: db.serverDate() } });
    return { ok: true, limit, used: 1, remaining: Math.max(0, limit - 1), date };
  }
  await col.doc(doc._id).update({ data: { used: _.inc(1), updated_at: db.serverDate() } });
  return { ok: true, limit, used: used + 1, remaining: Math.max(0, limit - (used + 1)), date };
}

async function countReceivedCards(ownerOpenid) {
  const res = await db
    .collection("RockCards")
    .where(_.and([{ ownerOpenid: ownerOpenid }, { status: "active" }, { createdByOpenid: _.neq(ownerOpenid) }]))
    .count();
  return res && typeof res.total === "number" ? res.total : 0;
}

async function hasPrimary(ownerOpenid) {
  const res = await db.collection("RockCards").where({ ownerOpenid: ownerOpenid, status: "active", isPrimary: true }).limit(1).get();
  return !!(res && res.data && res.data[0]);
}

async function rollbackClaim(giftsCol, giftId, openid, now) {
  try {
    await giftsCol.where({ _id: giftId, status: "claimed", claimedByOpenid: openid }).update({
      data: { status: "pending", toOpenid: "", claimedByOpenid: "", claimedAt: 0, updated_at: db.serverDate(), updatedAt: now }
    });
  } catch (e) {}
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    const action = safeText(event && event.action);
    if (!action) return fail("BAD_REQUEST", "缺少 action", tid);

    const giftsCol = db.collection("RockCardGifts");
    const cardsCol = db.collection("RockCards");
    const now = Date.now();

    if (action === "create_link") {
      const cardId = safeText(event && event.cardId);
      if (!cardId) return fail("BAD_REQUEST", "缺少 cardId", tid);

      const cardRes = await cardsCol.doc(cardId).get();
      const card = cardRes && cardRes.data ? cardRes.data : null;
      if (!card) return fail("NOT_FOUND", "名片不存在", tid);
      if (safeText(card.createdByOpenid) !== openid) return fail("FORBIDDEN", "无权限", tid);
      if (safeText(card.ownerOpenid)) return fail("BAD_REQUEST", "名片已归属，无法创建领取链接", tid);
      if (safeText(card.status) !== "draft") return fail("BAD_REQUEST", "请先用草稿卡创建领取链接", tid);

      const credit = await consumeCredit(openid);
      if (!credit.ok) return fail("NO_CREDIT", "今日灵感额度已用完", tid);

      await cardsCol.doc(cardId).update({ data: { status: "active", updatedAt: now, updated_at: db.serverDate() } });

      const addRes = await giftsCol.add({
        data: {
          cardId,
          fromOpenid: openid,
          toOpenid: "",
          method: "link",
          status: "pending",
          claimedByOpenid: "",
          createdAt: now,
          claimedAt: 0,
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
      const giftId = addRes && addRes._id ? String(addRes._id) : "";
      return ok({ giftId, page: "pages/card-claim/index", scene: `giftId=${giftId}`, credit }, tid);
    }

    if (action === "create_direct") {
      const cardId = safeText(event && event.cardId);
      const toOpenid = safeText(event && event.toOpenid);
      if (!cardId) return fail("BAD_REQUEST", "缺少 cardId", tid);
      if (!toOpenid) return fail("BAD_REQUEST", "缺少 toOpenid", tid);

      const cardRes = await cardsCol.doc(cardId).get();
      const card = cardRes && cardRes.data ? cardRes.data : null;
      if (!card) return fail("NOT_FOUND", "名片不存在", tid);
      if (safeText(card.createdByOpenid) !== openid) return fail("FORBIDDEN", "无权限", tid);
      if (safeText(card.ownerOpenid)) return fail("BAD_REQUEST", "名片已归属，无法直送", tid);
      if (safeText(card.status) !== "draft") return fail("BAD_REQUEST", "请先用草稿卡直送", tid);

      const recvCount = await countReceivedCards(toOpenid);
      if (recvCount >= 100) return fail("WALLET_FULL", "对方名片夹已满（100）", tid);
      const primary = await hasPrimary(toOpenid);

      const credit = await consumeCredit(openid);
      if (!credit.ok) return fail("NO_CREDIT", "今日灵感额度已用完", tid);

      await cardsCol.doc(cardId).update({
        data: { ownerOpenid: toOpenid, status: "active", isPrimary: !primary, updatedAt: now, updated_at: db.serverDate() }
      });

      await giftsCol.add({
        data: {
          cardId,
          fromOpenid: openid,
          toOpenid,
          method: "direct",
          status: "claimed",
          claimedByOpenid: toOpenid,
          createdAt: now,
          claimedAt: now,
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });

      return ok({ delivered: true, credit }, tid);
    }

    if (action === "get") {
      const giftId = safeText(event && event.giftId);
      if (!giftId) return fail("BAD_REQUEST", "缺少 giftId", tid);
      const giftRes = await giftsCol.doc(giftId).get();
      const gift = giftRes && giftRes.data ? giftRes.data : null;
      if (!gift) return fail("NOT_FOUND", "赠送记录不存在", tid);

      const cardRes = await cardsCol.doc(String(gift.cardId)).get();
      const card = cardRes && cardRes.data ? cardRes.data : null;
      if (!card) return fail("NOT_FOUND", "名片不存在", tid);
      const giftStatus = safeText(gift.status);
      const fromOpenid = safeText(gift.fromOpenid);
      const toOpenid = safeText(gift.toOpenid);
      const claimedByOpenid = safeText(gift.claimedByOpenid);
      const canViewFullCard = openid && [fromOpenid, toOpenid, claimedByOpenid].includes(openid);
      if (giftStatus !== "pending" && !canViewFullCard) return fail("FORBIDDEN", "无权限查看", tid);

      return ok(
        {
          gift: {
            _id: giftId,
            method: safeText(gift.method),
            status: giftStatus,
            fromOpenid,
            createdAt: gift.createdAt || 0,
            claimedAt: gift.claimedAt || 0
          },
          card: {
            _id: String(card._id),
            front: card.front || {}
          }
        },
        tid
      );
    }

    if (action === "claim") {
      const giftId = safeText(event && event.giftId);
      if (!giftId) return fail("BAD_REQUEST", "缺少 giftId", tid);

      const giftRes = await giftsCol.doc(giftId).get();
      const gift = giftRes && giftRes.data ? giftRes.data : null;
      if (!gift) return fail("NOT_FOUND", "赠送记录不存在", tid);
      if (safeText(gift.status) !== "pending") return fail("BAD_REQUEST", "该名片已被领取或已取消", tid);

      const cardId = safeText(gift.cardId);
      const cardRes = await cardsCol.doc(cardId).get();
      const card = cardRes && cardRes.data ? cardRes.data : null;
      if (!card) return fail("NOT_FOUND", "名片不存在", tid);
      if (safeText(card.ownerOpenid)) return fail("BAD_REQUEST", "名片已归属，无法重复领取", tid);

      const recvCount = await countReceivedCards(openid);
      if (recvCount >= 100) return fail("WALLET_FULL", "你的名片夹已满（100）", tid);

      const claimGiftRes = await giftsCol.where({ _id: giftId, status: "pending" }).update({
        data: { status: "claimed", toOpenid: openid, claimedByOpenid: openid, claimedAt: now, updated_at: db.serverDate() }
      });
      const updated =
        claimGiftRes &&
        claimGiftRes.stats &&
        typeof claimGiftRes.stats.updated === "number" &&
        claimGiftRes.stats.updated === 1;
      if (!updated) return fail("BAD_REQUEST", "该名片已被领取或已取消", tid);

      const primary = await hasPrimary(openid);
      try {
        const claimCardRes = await cardsCol.where({ _id: cardId, ownerOpenid: "" }).update({
          data: { ownerOpenid: openid, status: "active", isPrimary: !primary, updatedAt: now, updated_at: db.serverDate() }
        });
        const cardUpdated =
          claimCardRes &&
          claimCardRes.stats &&
          typeof claimCardRes.stats.updated === "number" &&
          claimCardRes.stats.updated === 1;
        if (!cardUpdated) {
          await rollbackClaim(giftsCol, giftId, openid, now);
          return fail("BAD_REQUEST", "名片已归属，无法重复领取", tid);
        }
      } catch (e) {
        await rollbackClaim(giftsCol, giftId, openid, now);
        throw e;
      }

      return ok({ claimed: true, cardId }, tid);
    }

    if (action === "cancel") {
      const giftId = safeText(event && event.giftId);
      if (!giftId) return fail("BAD_REQUEST", "缺少 giftId", tid);
      const giftRes = await giftsCol.doc(giftId).get();
      const gift = giftRes && giftRes.data ? giftRes.data : null;
      if (!gift) return fail("NOT_FOUND", "赠送记录不存在", tid);
      if (safeText(gift.fromOpenid) !== openid) return fail("FORBIDDEN", "无权限", tid);
      if (safeText(gift.status) !== "pending") return fail("BAD_REQUEST", "无法取消", tid);
      const cardId = safeText(gift.cardId);
      if (cardId) {
        try {
          const cardRes = await cardsCol.doc(cardId).get();
          const card = cardRes && cardRes.data ? cardRes.data : null;
          if (
            card &&
            safeText(card.createdByOpenid) === openid &&
            !safeText(card.ownerOpenid) &&
            safeText(card.status) === "active"
          ) {
            await cardsCol.doc(cardId).update({
              data: { status: "draft", updatedAt: now, updated_at: db.serverDate() }
            });
          }
        } catch (e) {}
      }
      await giftsCol.doc(giftId).update({ data: { status: "cancelled", updated_at: db.serverDate() } });
      return ok({ cancelled: true }, tid);
    }

    return fail("BAD_REQUEST", "未知 action", tid);
  } catch (e) {
    return fail("GIFT_FAILED", e && e.message ? e.message : "操作失败", tid);
  }
};
