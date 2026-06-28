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

function resolveSourceMode(card, openid) {
  const createdByOpenid = safeText(card && card.createdByOpenid);
  const ownerOpenid = safeText(card && card.ownerOpenid);
  const status = safeText(card && card.status);
  if (createdByOpenid !== openid) return "";
  if (ownerOpenid === openid && status === "active") return "self";
  if (!ownerOpenid && status === "draft") return "giftDraft";
  return "";
}

async function cloneCardForRecipient(cardsCol, sourceCard, toOpenid, isPrimary, now) {
  const addRes = await cardsCol.add({
    data: {
      ownerOpenid: toOpenid,
      createdByOpenid: safeText(sourceCard && sourceCard.createdByOpenid),
      status: "active",
      isPrimary: !!isPrimary,
      front: sourceCard && sourceCard.front ? sourceCard.front : {},
      back: sourceCard && sourceCard.back ? sourceCard.back : {},
      createdAt: now,
      updatedAt: now,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });
  return addRes && addRes._id ? String(addRes._id) : "";
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
      const sourceMode = resolveSourceMode(card, openid);
      if (!sourceMode) return fail("FORBIDDEN", "当前名片不可分享", tid);

      if (sourceMode === "giftDraft") {
        await cardsCol.doc(cardId).update({ data: { status: "active", updatedAt: now, updated_at: db.serverDate() } });
      }

      const addRes = await giftsCol.add({
        data: {
          cardId,
          fromOpenid: openid,
          sourceMode,
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
      return ok({ giftId, page: "pages/card-claim/index", scene: `giftId=${giftId}`, sourceMode }, tid);
    }

    if (action === "create_direct") {
      const cardId = safeText(event && event.cardId);
      const toOpenid = safeText(event && event.toOpenid);
      if (!cardId) return fail("BAD_REQUEST", "缺少 cardId", tid);
      if (!toOpenid) return fail("BAD_REQUEST", "缺少 toOpenid", tid);

      const cardRes = await cardsCol.doc(cardId).get();
      const card = cardRes && cardRes.data ? cardRes.data : null;
      if (!card) return fail("NOT_FOUND", "名片不存在", tid);
      const sourceMode = resolveSourceMode(card, openid);
      if (!sourceMode) return fail("FORBIDDEN", "当前名片不可赠送", tid);
      if (toOpenid === openid) return fail("BAD_REQUEST", "不能送给自己", tid);

      const recvCount = await countReceivedCards(toOpenid);
      if (recvCount >= 100) return fail("WALLET_FULL", "对方名片夹已满（100）", tid);
      const primary = await hasPrimary(toOpenid);
      let deliveredCardId = "";
      if (sourceMode === "self") {
        deliveredCardId = await cloneCardForRecipient(cardsCol, card, toOpenid, !primary, now);
      } else {
        await cardsCol.doc(cardId).update({
          data: { ownerOpenid: toOpenid, status: "active", isPrimary: !primary, updatedAt: now, updated_at: db.serverDate() }
        });
        deliveredCardId = cardId;
      }

      await giftsCol.add({
        data: {
          cardId: deliveredCardId || cardId,
          fromOpenid: openid,
          sourceMode,
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

      return ok({ delivered: true, cardId: deliveredCardId || cardId, sourceMode }, tid);
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
      const sourceMode = safeText(gift.sourceMode) || "giftDraft";
      const canViewFullCard = openid && [fromOpenid, toOpenid, claimedByOpenid].includes(openid);
      if (giftStatus !== "pending" && !canViewFullCard) return fail("FORBIDDEN", "无权限查看", tid);

      return ok(
        {
          gift: {
            _id: giftId,
            method: safeText(gift.method),
            sourceMode,
            status: giftStatus,
            fromOpenid,
            createdAt: gift.createdAt || 0,
            claimedAt: gift.claimedAt || 0
          },
          card: {
            _id: String(card._id),
            front: card.front || {},
            back: giftStatus === "pending" && !canViewFullCard ? {} : card.back || {}
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
      if (safeText(gift.fromOpenid) === openid && safeText(gift.sourceMode) === "self") {
        return fail("BAD_REQUEST", "不能领取自己分享的名片", tid);
      }

      const cardId = safeText(gift.cardId);
      const cardRes = await cardsCol.doc(cardId).get();
      const card = cardRes && cardRes.data ? cardRes.data : null;
      if (!card) return fail("NOT_FOUND", "名片不存在", tid);
      const sourceMode = safeText(gift.sourceMode) || "giftDraft";
      if (sourceMode !== "self" && safeText(card.ownerOpenid)) return fail("BAD_REQUEST", "名片已归属，无法重复领取", tid);

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
        let claimedCardId = cardId;
        if (sourceMode === "self") {
          claimedCardId = await cloneCardForRecipient(cardsCol, card, openid, !primary, now);
          if (!claimedCardId) {
            await rollbackClaim(giftsCol, giftId, openid, now);
            return fail("BAD_REQUEST", "名片领取失败，请重试", tid);
          }
          await giftsCol.doc(giftId).update({
            data: { cardId: claimedCardId, updated_at: db.serverDate(), updatedAt: now }
          });
        } else {
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
        }
        return ok({ claimed: true, cardId: claimedCardId, sourceMode }, tid);
      } catch (e) {
        await rollbackClaim(giftsCol, giftId, openid, now);
        throw e;
      }
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
            safeText(card.status) === "active" &&
            safeText(gift.sourceMode) !== "self"
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
