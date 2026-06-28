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

function uniqueModes(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const mode = safeText(item).toLowerCase();
    if (!mode) return;
    if (!["boulder", "difficulty", "lead"].includes(mode)) return;
    if (seen[mode]) return;
    seen[mode] = true;
    out.push(mode);
  });
  return out;
}

async function isAdmin(openid) {
  if (!openid) return false;
  const res = await db.collection("RockUsers").where({ openid }).limit(1).get();
  const user = res && res.data && res.data[0] ? res.data[0] : null;
  if (!user) return false;
  return user.role === "admin" || user.isAdmin === true;
}

function normalizeQueueDoc(doc) {
  const item = doc || {};
  return {
    _id: item._id || "",
    batchId: safeText(item.batchId),
    provider: safeText(item.provider),
    providerPoiId: safeText(item.providerPoiId),
    name: safeText(item.name),
    city: safeText(item.city),
    district: safeText(item.district),
    address: safeText(item.address),
    phone: safeText(item.phone),
    gymId: safeText(item.gymId),
    writeAction: safeText(item.writeAction),
    matchScore: Number(item.matchScore) || 0,
    supportedModes: uniqueModes(item.supportedModes),
    modeConfidence: Number(item.modeConfidence) || 0,
    modeReasons: Array.isArray(item.modeReasons) ? item.modeReasons : [],
    reviewState: safeText(item.reviewState) || "pending",
    reviewReason: safeText(item.reviewReason),
    reviewNote: safeText(item.reviewNote),
    finalSupportedModes: uniqueModes(item.finalSupportedModes),
    createdAt: Number(item.createdAt) || 0,
    reviewedAt: Number(item.reviewedAt) || 0,
    reviewedByOpenid: safeText(item.reviewedByOpenid)
  };
}

async function listQueue(event) {
  const page = Math.max(1, Number(event && event.page ? event.page : 1));
  const pageSize = Math.max(1, Math.min(50, Number(event && event.pageSize ? event.pageSize : 20)));
  const skip = (page - 1) * pageSize;
  const state = safeText(event && event.state) || "pending";
  const keyword = safeText(event && event.keyword).toLowerCase();
  const where = state === "all" ? {} : { reviewState: state };
  let res;
  try {
    res = await db.collection("RockGymReviewQueue").where(where).orderBy("createdAt", "desc").limit(200).get();
  } catch (e) {
    res = await db.collection("RockGymReviewQueue").where(where).limit(200).get();
  }
  const list = ((res && res.data) || []).filter((doc) => {
    if (!keyword) return true;
    const text = `${safeText(doc && doc.name)} ${safeText(doc && doc.city)} ${safeText(doc && doc.district)} ${safeText(doc && doc.address)}`.toLowerCase();
    return text.includes(keyword);
  });
  const hasNext = list.length > skip + pageSize;
  const items = list.slice(skip, skip + pageSize).map(normalizeQueueDoc);
  return { items, hasNext, page, state, keyword };
}

async function reviewQueueItem(event, openid) {
  const id = safeText(event && event.id);
  const decision = safeText(event && event.decision);
  const note = safeText(event && event.note);
  if (!id) throw Object.assign(new Error("缺少审核记录 id"), { code: "BAD_REQUEST" });
  if (!["approved", "rejected"].includes(decision)) {
    throw Object.assign(new Error("decision 仅支持 approved/rejected"), { code: "BAD_REQUEST" });
  }
  const ref = db.collection("RockGymReviewQueue").doc(id);
  const res = await ref.get();
  const doc = res && res.data ? res.data : null;
  if (!doc) throw Object.assign(new Error("审核记录不存在"), { code: "NOT_FOUND" });

  const finalSupportedModes =
    decision === "approved" ? uniqueModes((event && event.supportedModes) || doc.finalSupportedModes || doc.supportedModes) : [];
  if (decision === "approved" && !finalSupportedModes.length) {
    throw Object.assign(new Error("通过审核时至少选择一种模式"), { code: "BAD_REQUEST" });
  }

  const now = Date.now();
  const patch = {
    reviewState: decision,
    reviewNote: note,
    reviewedAt: now,
    reviewedByOpenid: openid,
    updatedAt: now
  };
  if (decision === "approved") patch.finalSupportedModes = finalSupportedModes;

  await ref.update({ data: patch });

  const gymId = safeText(doc.gymId);
  if (decision === "approved" && gymId) {
    try {
      await db.collection("RockGyms").doc(gymId).update({
        data: {
          supportedModes: finalSupportedModes,
          supportedModesSource: "manual_review",
          supportedModesConfidence: 1,
          updatedAt: now,
          updated_at: db.serverDate()
        }
      });
    } catch (e) {}
  }

  return {
    id,
    decision,
    gymId,
    finalSupportedModes
  };
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    if (!(await isAdmin(openid))) return fail("FORBIDDEN", "无权限", tid);

    const action = safeText(event && event.action) || "list";
    if (action === "list") {
      return ok(await listQueue(event), tid);
    }
    if (action === "review") {
      return ok(await reviewQueueItem(event, openid), tid);
    }
    return fail("BAD_REQUEST", "未知 action", tid);
  } catch (e) {
    return fail(e && e.code ? e.code : "REVIEW_QUEUE_FAILED", e && e.message ? e.message : "执行失败", tid);
  }
};
