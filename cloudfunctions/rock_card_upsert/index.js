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

function clampText(s, maxLen) {
  const t = safeText(s);
  if (!t) return "";
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen);
}

function normalizeGyms(list) {
  const gyms = Array.isArray(list) ? list : [];
  const out = [];
  gyms.forEach((g) => {
    if (!g) return;
    if (typeof g === "string") {
      const name = safeText(g);
      if (!name) return;
      out.push({ gymId: "", name, city: "" });
      return;
    }
    if (typeof g !== "object") return;
    const gymId = safeText(g.gymId || g._id);
    const name = safeText(g.name || g.gymName || g.title);
    const city = safeText(g.city || g.cityName);
    if (!name && !gymId) return;
    out.push({ gymId, name, city });
  });
  return out.slice(0, 3);
}

function normalizeCard(input) {
  const card = input && typeof input === "object" ? input : {};
  const front = card.front && typeof card.front === "object" ? card.front : {};

  const wanderer = !!front.wanderer;
  const gyms = wanderer ? [] : normalizeGyms(front.gyms);

  return {
    front: {
      displayName: clampText(front.displayName, 24),
      title: clampText(front.title, 24),
      mbti: clampText(front.mbti, 8),
      gyms,
      wanderer,
      avatarMode: safeText(front.avatarMode) === "custom" ? "custom" : "wechat",
      avatarFileId: safeText(front.avatarFileId),
      avatarUrl: safeText(front.avatarUrl),
      oneLiner: clampText(front.oneLiner, 60),
      oneLinerStyle: safeText(front.oneLinerStyle) === "encourage" ? "encourage" : "humor"
    }
  };
}

async function ensureUser(openid) {
  const col = db.collection("RockUsers");
  const res = await col.where(_.or([{ openid }, { _openid: openid }])).limit(1).get();
  const doc = res && res.data && res.data[0] ? res.data[0] : null;
  if (doc) return doc;
  const now = Date.now();
  await col.add({ data: { openid, createdAt: now, updatedAt: now } });
  const again = await col.where(_.or([{ openid }, { _openid: openid }])).limit(1).get();
  return again && again.data && again.data[0] ? again.data[0] : null;
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

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    const userDoc = await ensureUser(openid);
    const userAvatarUrl = userDoc && userDoc.avatarUrl ? String(userDoc.avatarUrl) : "";

    const mode = safeText(event && event.mode) === "giftDraft" ? "giftDraft" : "self";
    const cardId = safeText(event && event.cardId);

    const normalized = normalizeCard(event && event.card ? event.card : null);
    if (normalized.front.avatarMode === "wechat" && !normalized.front.avatarFileId) {
      if (!normalized.front.avatarUrl && userAvatarUrl) normalized.front.avatarUrl = userAvatarUrl;
    }

    const now = Date.now();
    const cardsCol = db.collection("RockCards");

    let existing = null;
    if (cardId) {
      const res = await cardsCol.doc(cardId).get();
      existing = res && res.data ? res.data : null;
      if (!existing) return fail("NOT_FOUND", "名片不存在", tid);
    }

    if (mode === "self") {
      if (existing) {
        if (safeText(existing.ownerOpenid) !== openid) return fail("FORBIDDEN", "无权限", tid);
        if (safeText(existing.status) !== "active") return fail("FORBIDDEN", "名片不可编辑", tid);
      }
    } else {
      if (existing) {
        if (safeText(existing.createdByOpenid) !== openid) return fail("FORBIDDEN", "无权限", tid);
        if (safeText(existing.ownerOpenid)) return fail("FORBIDDEN", "名片已赠送/已归属，无法编辑草稿", tid);
        if (safeText(existing.status) !== "draft") return fail("FORBIDDEN", "草稿不可编辑", tid);
      }
    }

    const credit = await consumeCredit(openid);
    if (!credit.ok) return fail("NO_CREDIT", "今日灵感额度已用完", tid);

    let outId = cardId;
    if (!existing) {
      let isPrimary = false;
      if (mode === "self") {
        const primaryRes = await cardsCol.where({ ownerOpenid: openid, isPrimary: true, status: "active" }).limit(1).get();
        const hasPrimary = !!(primaryRes && primaryRes.data && primaryRes.data[0]);
        isPrimary = !hasPrimary;
      }

      const doc = {
        ownerOpenid: mode === "self" ? openid : "",
        createdByOpenid: openid,
        status: mode === "self" ? "active" : "draft",
        isPrimary,
        front: normalized.front,
        createdAt: now,
        updatedAt: now,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      };
      const addRes = await cardsCol.add({ data: doc });
      outId = addRes && addRes._id ? String(addRes._id) : "";
    } else {
      const patch = {
        front: { ...(existing.front || {}), ...(normalized.front || {}) },
        updatedAt: now,
        updated_at: db.serverDate()
      };
      await cardsCol.doc(existing._id).update({ data: patch });
      outId = String(existing._id);
    }

    return ok({ cardId: outId, credit }, tid);
  } catch (e) {
    return fail("CARD_UPSERT_FAILED", e && e.message ? e.message : "保存失败", tid);
  }
};
