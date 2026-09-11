const cloud = require("wx-server-sdk");
const guard = require("./demo-guard");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const USER_BATCH_SIZE = 100;
const BOOTSTRAP_ADMIN_IDS = ["42098a0769e3423400183ddf36230f95"];
const DOC_COLLECTIONS = [
  "RockUsers",
  "RockGyms",
  "RockGymCycles",
  "RockGymSourceRecords",
  "RockGymSyncRuns",
  "RockGymReviewQueue",
  "RockCheckinRecords",
  "RockUserDailyProgress",
  "RockUserCycleProgress",
  "RockFriendships",
  "RockCalendarJoins",
  "RockCirclePosts",
  "RockCards",
  "RockCardCredits",
  "RockCardGifts",
  "RockCircles",
  "RockCircleMembers",
  "RockCalendarPlans",
  "RockGymWallCards"
];

function traceId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ok(data, tid) {
  return { ok: true, data, traceId: tid };
}

function fail(code, message, tid) {
  return { ok: false, error: { code, message }, traceId: tid };
}

function isBootstrapAdminId(value) {
  const id = String(value == null ? "" : value).trim();
  return !!id && BOOTSTRAP_ADMIN_IDS.includes(id);
}

function isBootstrapAdminUser(openid, userDoc) {
  return isBootstrapAdminId(openid) || !!(userDoc && isBootstrapAdminId(userDoc._id));
}

function safeText(value) {
  return String(value == null ? "" : value).trim();
}

function uniqueList(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const value = safeText(item);
    if (!value || seen[value]) return;
    seen[value] = true;
    out.push(value);
  });
  return out;
}

function normalizeTokenList(value) {
  if (Array.isArray(value)) return uniqueList(value);
  return uniqueList(
    String(value == null ? "" : value)
      .replace(/\r/g, "\n")
      .split(/[\n,，]/)
  );
}

function uniqueModes(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const mode = safeText(item).toLowerCase();
    if (!mode || !["boulder", "difficulty", "lead"].includes(mode) || seen[mode]) return;
    seen[mode] = true;
    out.push(mode);
  });
  return out;
}

async function isAdmin(openid) {
  if (isBootstrapAdminId(openid)) {
    return true;
  }
  const res = await db
    .collection("RockUsers")
    .where(_.or([{ openid }, { _openid: openid }, { uid: openid }]))
    .limit(1)
    .get();
  const u = res && res.data && res.data[0] ? res.data[0] : null;
  if (isBootstrapAdminUser(openid, u)) return true;
  if (!u) return false;
  return u.role === "admin" || u.isAdmin === true;
}

async function getUserDocByOpenid(openid) {
  const res = await db
    .collection("RockUsers")
    .where(_.or([{ openid }, { _openid: openid }, { uid: openid }]))
    .limit(1)
    .get();
  return res && res.data && res.data[0] ? res.data[0] : null;
}

async function safeCount(name) {
  try {
    const res = await db.collection(name).count();
    return { name, total: res && typeof res.total === "number" ? res.total : null, ok: true };
  } catch (e) {
    return { name, ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function normalizeRole(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase();
}

function normalizeRoleFilter(value) {
  const role = normalizeRole(value);
  return role || "all";
}

function normalizeKeyword(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase();
}

function formatUser(doc) {
  const role = normalizeRole(doc && doc.role);
  return {
    _id: doc && doc._id ? doc._id : "",
    openid: (doc && (doc.openid || doc._openid)) || "",
    uid: (doc && doc.uid) || "",
    nickName: (doc && doc.nickName) || "",
    avatarUrl: (doc && doc.avatarUrl) || "",
    projectName: (doc && doc.projectName) || "",
    role,
    isAdmin: role === "admin" || !!(doc && doc.isAdmin),
    createdAt: Number((doc && doc.createdAt) || 0),
    updatedAt: Number((doc && doc.updatedAt) || 0)
  };
}

function formatGym(gym) {
  const item = gym || {};
  return {
    _id: item._id || "",
    name: item.name || item.gymName || item.title || "",
    city: item.city || item.cityName || item.locationCity || "",
    address: item.address || item.addr || item.location || "",
    ownerOpenid: item.ownerOpenid || "",
    owner_uid: item.owner_uid || "",
    updatedAt: Number(item.updatedAt || item.updated_at || 0)
  };
}

function formatGymPermissionDoc(gym) {
  const item = gym || {};
  return {
    _id: item._id || "",
    name: item.name || item.gymName || item.title || "",
    city: item.city || item.cityName || item.locationCity || "",
    address: item.address || item.addr || item.location || "",
    ownerOpenid: item.ownerOpenid || "",
    owner_uid: item.owner_uid || "",
    managers: Array.isArray(item.managers) ? item.managers : [],
    managerOpenids: Array.isArray(item.managerOpenids) ? item.managerOpenids : [],
    manager_uids: Array.isArray(item.manager_uids) ? item.manager_uids : [],
    updatedAt: Number(item.updatedAt || item.updated_at || 0)
  };
}

function formatReviewQueueDoc(doc) {
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
    updatedAt: Number(item.updatedAt) || 0,
    reviewedAt: Number(item.reviewedAt) || 0,
    reviewedByOpenid: safeText(item.reviewedByOpenid)
  };
}

function formatCardDoc(doc) {
  const item = doc || {};
  return {
    _id: item._id || "",
    ownerOpenid: safeText(item.ownerOpenid),
    createdByOpenid: safeText(item.createdByOpenid),
    status: safeText(item.status),
    isPrimary: !!item.isPrimary,
    createdAt: Number(item.createdAt) || 0,
    updatedAt: Number(item.updatedAt) || 0,
    front: item.front && typeof item.front === "object" ? item.front : {}
  };
}

function buildUserLookupWhere(key) {
  return _.or([{ openid: key }, { _openid: key }, { uid: key }]);
}

function matchRole(doc, roleFilter) {
  if (roleFilter === "all") return true;
  const role = normalizeRole(doc && doc.role);
  if (roleFilter === "empty") return !role;
  return role === roleFilter;
}

function matchKeyword(doc, keyword) {
  if (!keyword) return true;
  const haystacks = [
    doc && doc.nickName,
    doc && doc.projectName,
    doc && doc.openid,
    doc && doc._openid,
    doc && doc.uid
  ];
  return haystacks.some((value) => String(value || "").toLowerCase().includes(keyword));
}

async function listUsers(event, tid) {
  const page = Math.max(1, Number((event && event.page) || 1) || 1);
  const pageSize = Math.min(50, Math.max(1, Number((event && event.pageSize) || 20) || 20));
  const roleFilter = normalizeRoleFilter(event && event.role);
  const keyword = normalizeKeyword(event && event.keyword);
  const start = (page - 1) * pageSize;

  // 对外用户总数只统计真实用户（accountType 缺省即真实）；
  // scanTotal 含模拟用户，仅用于全表分批遍历的终止边界，避免漏掉尾部真实用户
  const realWhere = { accountType: _.neq("demo") };
  const countRes = await db.collection("RockUsers").where(realWhere).count();
  const total = Number((countRes && countRes.total) || 0);
  const scanTotalRes = await db.collection("RockUsers").count();
  const scanTotal = Number((scanTotalRes && scanTotalRes.total) || total);

  let skip = 0;
  let filteredTotal = 0;
  const picked = [];

  while (skip < scanTotal) {
    const batchRes = await db
      .collection("RockUsers")
      .orderBy("updatedAt", "desc")
      .skip(skip)
      .limit(USER_BATCH_SIZE)
      .get();
    const rows = Array.isArray(batchRes && batchRes.data) ? batchRes.data : [];
    if (!rows.length) break;

    rows.forEach((doc) => {
      // 模拟用户不进后台用户列表与统计
      if (doc.accountType === "demo" || guard.isDemoId(doc.openid || doc._openid || doc.uid)) return;
      if (!matchRole(doc, roleFilter) || !matchKeyword(doc, keyword)) return;
      filteredTotal += 1;
      if (filteredTotal > start && picked.length < pageSize + 1) {
        picked.push(formatUser(doc));
      }
    });

    skip += rows.length;
  }

  return ok(
    {
      items: picked.slice(0, pageSize),
      page,
      pageSize,
      hasNext: filteredTotal > start + pageSize,
      total,
      filteredTotal,
      role: roleFilter,
      keyword
    },
    tid
  );
}

async function updateUserRole(event, tid) {
  const userId = String((event && (event.userId || event.id)) || "").trim();
  if (!userId) return fail("BAD_REQUEST", "缺少用户 ID", tid);

  // 模拟身份不可授予任何角色
  const beforeRes = await db.collection("RockUsers").doc(userId).get().catch(() => null);
  const before = beforeRes && beforeRes.data ? beforeRes.data : null;
  if (before && (before.accountType === "demo" || guard.isDemoId(before.openid || before._openid || before.uid))) {
    return fail("FORBIDDEN", "该用户不可操作", tid);
  }

  const role = normalizeRole(event && event.role);
  const patch = {
    role,
    isAdmin: role === "admin",
    updatedAt: Date.now()
  };

  await db.collection("RockUsers").doc(userId).update({ data: patch });
  const res = await db.collection("RockUsers").doc(userId).get();
  const user = res && res.data ? formatUser(res.data) : formatUser({ _id: userId, ...patch });
  return ok({ user }, tid);
}

async function getUserDetail(event, tid) {
  const userId = safeText(event && (event.userId || event.id));
  const keyword = safeText(event && (event.keyword || event.openid || event.uid));
  let userDoc = null;

  if (userId) {
    try {
      const docRes = await db.collection("RockUsers").doc(userId).get();
      userDoc = docRes && docRes.data ? docRes.data : null;
    } catch (e) {
      userDoc = null;
    }
  }

  if (!userDoc && keyword) {
    const userRes = await db.collection("RockUsers").where(buildUserLookupWhere(keyword)).limit(1).get();
    userDoc = userRes && userRes.data && userRes.data[0] ? userRes.data[0] : null;
  }

  if (!userDoc) {
    return ok(
      {
        found: false,
        keyword: keyword || userId,
        user: null,
        rawUser: null,
        stats: {
          followingCount: 0,
          followerCount: 0,
          cardCount: 0,
          primaryCardCount: 0,
          checkinCount: 0
        }
      },
      tid
    );
  }

  const user = formatUser(userDoc);
  const openid = safeText(user.openid);
  const uid = safeText(user.uid);
  const identityKeys = uniqueList([openid, uid]);

  const followingRes = openid
    ? await db.collection("RockFriendships").where(_.or([{ openid }, { _openid: openid }])).count()
    : { total: 0 };
  const followerRes = openid ? await db.collection("RockFriendships").where({ targetOpenid: openid }).count() : { total: 0 };
  const cardRes = openid ? await db.collection("RockCards").where({ ownerOpenid: openid }).count() : { total: 0 };
  const primaryCardRes = openid
    ? await db.collection("RockCards").where({ ownerOpenid: openid, isPrimary: true, status: "active" }).count()
    : { total: 0 };
  const checkinRes = identityKeys.length
    ? await db.collection("RockCheckinRecords").where({ uid: _.in(identityKeys) }).count()
    : { total: 0 };

  return ok(
    {
      found: true,
      keyword: keyword || userId,
      user,
      rawUser: userDoc,
      stats: {
        followingCount: Number((followingRes && followingRes.total) || 0),
        followerCount: Number((followerRes && followerRes.total) || 0),
        cardCount: Number((cardRes && cardRes.total) || 0),
        primaryCardCount: Number((primaryCardRes && primaryCardRes.total) || 0),
        checkinCount: Number((checkinRes && checkinRes.total) || 0)
      }
    },
    tid
  );
}

async function updateUserProfile(event, tid) {
  const userId = safeText(event && (event.userId || event.id));
  if (!userId) return fail("BAD_REQUEST", "缺少用户 ID", tid);

  const patch = {
    updatedAt: Date.now()
  };

  if (Object.prototype.hasOwnProperty.call(event || {}, "nickName")) {
    patch.nickName = safeText(event && event.nickName);
  }
  if (Object.prototype.hasOwnProperty.call(event || {}, "projectName")) {
    patch.projectName = safeText(event && event.projectName);
  }
  if (Object.prototype.hasOwnProperty.call(event || {}, "role")) {
    const role = normalizeRole(event && event.role);
    patch.role = role;
    patch.isAdmin = role === "admin";
  }

  await db.collection("RockUsers").doc(userId).update({ data: patch });
  const latestRes = await db.collection("RockUsers").doc(userId).get();
  return ok({ user: formatUser(latestRes && latestRes.data) }, tid);
}

async function authDebug(openid, tid) {
  const userDoc = await getUserDocByOpenid(openid);
  const managedWhere = _.or([
    { owner_uid: openid },
    { ownerOpenid: openid },
    { owner_uid: _.in([openid]) },
    { managerOpenids: _.in([openid]) },
    { managers: _.in([openid]) }
  ]);
  const totalRes = await db.collection("RockGyms").where(managedWhere).count();
  let gyms = [];
  try {
    const gymRes = await db
      .collection("RockGyms")
      .where(managedWhere)
      .orderBy("updatedAt", "desc")
      .limit(10)
      .get();
    gyms = Array.isArray(gymRes && gymRes.data) ? gymRes.data.map(formatGym) : [];
  } catch (e) {
    const gymRes = await db.collection("RockGyms").where(managedWhere).limit(10).get();
    gyms = Array.isArray(gymRes && gymRes.data) ? gymRes.data.map(formatGym) : [];
  }

  return ok(
    {
      context: {
        openid
      },
      user: formatUser(userDoc),
      rawUser: userDoc || null,
      managedGyms: gyms,
      managedGymCount: Number((totalRes && totalRes.total) || 0)
    },
    tid
  );
}

async function getDocument(event, tid) {
  const collection = String((event && event.collection) || "").trim();
  const id = String((event && (event.id || event.docId || event._id)) || "").trim();
  if (!collection || !id) return fail("BAD_REQUEST", "缺少 collection 或文档 ID", tid);
  if (!DOC_COLLECTIONS.includes(collection)) return fail("BAD_REQUEST", "该集合不允许调试查询", tid);

  let res = null;
  try {
    res = await db.collection(collection).doc(id).get();
  } catch (e) {
    return ok(
      {
        collection,
        id,
        document: null,
        found: false,
        allowedCollections: DOC_COLLECTIONS
      },
      tid
    );
  }
  return ok(
    {
      collection,
      id,
      document: res && res.data ? res.data : null,
      found: !!(res && res.data),
      allowedCollections: DOC_COLLECTIONS
    },
    tid
  );
}

async function getGymPermission(event, tid) {
  const gymId = String((event && (event.gymId || event.id || event.docId)) || "").trim();
  if (!gymId) return fail("BAD_REQUEST", "缺少岩馆 ID", tid);

  let res = null;
  try {
    res = await db.collection("RockGyms").doc(gymId).get();
  } catch (e) {
    return ok(
      {
        gymId,
        found: false,
        gym: null
      },
      tid
    );
  }

  return ok(
    {
      gymId,
      found: !!(res && res.data),
      gym: res && res.data ? formatGymPermissionDoc(res.data) : null,
      rawGym: res && res.data ? res.data : null
    },
    tid
  );
}

async function updateGymPermission(event, tid) {
  const gymId = safeText(event && (event.gymId || event.id || event.docId));
  if (!gymId) return fail("BAD_REQUEST", "缺少岩馆 ID", tid);

  const payload = event || {};
  const patch = {
    updatedAt: Date.now(),
    updated_at: db.serverDate()
  };

  if (Object.prototype.hasOwnProperty.call(payload, "ownerOpenid")) {
    patch.ownerOpenid = safeText(payload.ownerOpenid);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "owner_uid")) {
    patch.owner_uid = safeText(payload.owner_uid);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "managers")) {
    patch.managers = normalizeTokenList(payload.managers);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "managerOpenids")) {
    patch.managerOpenids = normalizeTokenList(payload.managerOpenids);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "manager_uids")) {
    patch.manager_uids = normalizeTokenList(payload.manager_uids);
  }

  await db.collection("RockGyms").doc(gymId).update({ data: patch });
  const latestRes = await db.collection("RockGyms").doc(gymId).get();
  return ok(
    {
      gymId,
      gym: formatGymPermissionDoc(latestRes && latestRes.data),
      rawGym: latestRes && latestRes.data ? latestRes.data : null
    },
    tid
  );
}

async function getReviewDetail(event, tid) {
  const reviewId = safeText(event && (event.reviewId || event.id || event.docId));
  if (!reviewId) return fail("BAD_REQUEST", "缺少审核记录 ID", tid);

  let queueDoc = null;
  try {
    const queueRes = await db.collection("RockGymReviewQueue").doc(reviewId).get();
    queueDoc = queueRes && queueRes.data ? queueRes.data : null;
  } catch (e) {
    queueDoc = null;
  }

  if (!queueDoc) {
    return ok(
      {
        found: false,
        reviewId,
        queue: null,
        rawQueue: null,
        gym: null,
        rawGym: null,
        sourceRecords: []
      },
      tid
    );
  }

  let gymDoc = null;
  const gymId = safeText(queueDoc.gymId);
  if (gymId) {
    try {
      const gymRes = await db.collection("RockGyms").doc(gymId).get();
      gymDoc = gymRes && gymRes.data ? gymRes.data : null;
    } catch (e) {
      gymDoc = null;
    }
  }

  let sourceRecords = [];
  const provider = safeText(queueDoc.provider);
  const providerPoiId = safeText(queueDoc.providerPoiId);
  if (provider && providerPoiId) {
    try {
      const sourceRes = await db
        .collection("RockGymSourceRecords")
        .where({ provider, providerPoiId })
        .orderBy("createdAt", "desc")
        .limit(5)
        .get();
      sourceRecords = Array.isArray(sourceRes && sourceRes.data) ? sourceRes.data : [];
    } catch (e) {
      const sourceRes = await db.collection("RockGymSourceRecords").where({ provider, providerPoiId }).limit(5).get();
      sourceRecords = Array.isArray(sourceRes && sourceRes.data) ? sourceRes.data : [];
    }
  }

  return ok(
    {
      found: true,
      reviewId,
      queue: formatReviewQueueDoc(queueDoc),
      rawQueue: queueDoc,
      gym: gymDoc ? formatGymPermissionDoc(gymDoc) : null,
      rawGym: gymDoc,
      sourceRecords
    },
    tid
  );
}

async function updateReviewDetail(event, openid, tid) {
  const reviewId = safeText(event && (event.reviewId || event.id || event.docId));
  if (!reviewId) return fail("BAD_REQUEST", "缺少审核记录 ID", tid);

  const ref = db.collection("RockGymReviewQueue").doc(reviewId);
  const foundRes = await ref.get();
  const current = foundRes && foundRes.data ? foundRes.data : null;
  if (!current) return fail("NOT_FOUND", "审核记录不存在", tid);

  const nextState = safeText(event && event.reviewState) || safeText(current.reviewState) || "pending";
  if (!["pending", "approved", "rejected"].includes(nextState)) {
    return fail("BAD_REQUEST", "reviewState 仅支持 pending/approved/rejected", tid);
  }

  const nextReason = safeText(event && event.reviewReason);
  const nextNote = safeText(event && event.reviewNote);
  const nextModes =
    nextState === "approved"
      ? uniqueModes(
          Object.prototype.hasOwnProperty.call(event || {}, "finalSupportedModes")
            ? event.finalSupportedModes
            : current.finalSupportedModes || current.supportedModes
        )
      : [];
  if (nextState === "approved" && !nextModes.length) {
    return fail("BAD_REQUEST", "通过审核时至少选择一种模式", tid);
  }

  const now = Date.now();
  const patch = {
    reviewState: nextState,
    reviewReason: nextReason,
    reviewNote: nextNote,
    updatedAt: now
  };

  if (nextState === "pending") {
    patch.finalSupportedModes = [];
    patch.reviewedAt = 0;
    patch.reviewedByOpenid = "";
  } else {
    patch.reviewedAt = now;
    patch.reviewedByOpenid = openid;
    patch.finalSupportedModes = nextState === "approved" ? nextModes : [];
  }

  await ref.update({ data: patch });

  const gymId = safeText(current.gymId);
  if (gymId && nextState === "approved") {
    try {
      await db.collection("RockGyms").doc(gymId).update({
        data: {
          supportedModes: nextModes,
          supportedModesSource: "manual_review",
          supportedModesConfidence: 1,
          reviewState: "approved",
          updatedAt: now,
          updated_at: db.serverDate()
        }
      });
    } catch (e) {}
  }

  const latestRes = await ref.get();
  return ok(
    {
      reviewId,
      queue: formatReviewQueueDoc(latestRes && latestRes.data),
      rawQueue: latestRes && latestRes.data ? latestRes.data : null
    },
    tid
  );
}

async function getCardDetail(event, tid) {
  const cardId = safeText(event && (event.cardId || event.id || event.docId));
  if (!cardId) return fail("BAD_REQUEST", "缺少名片 ID", tid);

  let cardDoc = null;
  try {
    const cardRes = await db.collection("RockCards").doc(cardId).get();
    cardDoc = cardRes && cardRes.data ? cardRes.data : null;
  } catch (e) {
    cardDoc = null;
  }

  if (!cardDoc) {
    return ok(
      {
        found: false,
        cardId,
        card: null,
        rawCard: null,
        ownerUser: null,
        creatorUser: null
      },
      tid
    );
  }

  let ownerUser = null;
  let creatorUser = null;
  const ownerOpenid = safeText(cardDoc.ownerOpenid);
  const createdByOpenid = safeText(cardDoc.createdByOpenid);
  if (ownerOpenid) {
    ownerUser = await getUserDocByOpenid(ownerOpenid);
  }
  if (createdByOpenid) {
    creatorUser = await getUserDocByOpenid(createdByOpenid);
  }

  return ok(
    {
      found: true,
      cardId,
      card: formatCardDoc(cardDoc),
      rawCard: cardDoc,
      ownerUser: ownerUser ? formatUser(ownerUser) : null,
      creatorUser: creatorUser ? formatUser(creatorUser) : null
    },
    tid
  );
}

async function updateCardDetail(event, tid) {
  const cardId = safeText(event && (event.cardId || event.id || event.docId));
  if (!cardId) return fail("BAD_REQUEST", "缺少名片 ID", tid);

  const cardsCol = db.collection("RockCards");
  const cardRes = await cardsCol.doc(cardId).get();
  const cardDoc = cardRes && cardRes.data ? cardRes.data : null;
  if (!cardDoc) return fail("NOT_FOUND", "名片不存在", tid);

  const ownerOpenid = Object.prototype.hasOwnProperty.call(event || {}, "ownerOpenid")
    ? safeText(event && event.ownerOpenid)
    : safeText(cardDoc.ownerOpenid);
  const status = Object.prototype.hasOwnProperty.call(event || {}, "status")
    ? safeText(event && event.status)
    : safeText(cardDoc.status);
  let isPrimary = Object.prototype.hasOwnProperty.call(event || {}, "isPrimary") ? !!event.isPrimary : !!cardDoc.isPrimary;

  if (!["active", "draft"].includes(status)) {
    return fail("BAD_REQUEST", "status 仅支持 active/draft", tid);
  }
  if (!ownerOpenid) {
    isPrimary = false;
  }
  if (status !== "active") {
    isPrimary = false;
  }

  const now = Date.now();
  const patch = {
    ownerOpenid,
    status,
    isPrimary,
    updatedAt: now,
    updated_at: db.serverDate()
  };

  if (isPrimary && ownerOpenid) {
    await cardsCol.where({ ownerOpenid, isPrimary: true }).update({
      data: {
        isPrimary: false,
        updatedAt: now,
        updated_at: db.serverDate()
      }
    });
  }

  await cardsCol.doc(cardId).update({ data: patch });
  const latestRes = await cardsCol.doc(cardId).get();
  return ok(
    {
      cardId,
      card: formatCardDoc(latestRes && latestRes.data),
      rawCard: latestRes && latestRes.data ? latestRes.data : null
    },
    tid
  );
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    const adminAllowed = await isAdmin(openid);
    if (!adminAllowed) return fail("FORBIDDEN", "无权限", tid);

    const action = (event && event.action) || "health";
    if (action === "health") {
      const names = [
        "RockUsers",
        "RockGyms",
        "RockGymCycles",
        "RockGymSourceRecords",
        "RockGymSyncRuns",
        "RockGymReviewQueue",
        "RockCheckinRecords",
        "RockUserDailyProgress",
        "RockUserCycleProgress",
        "RockComments",
        "RockFriendships",
        "RockBlackTalkDictionary"
      ];
      const checks = [];
      for (let i = 0; i < names.length; i++) {
        checks.push(await safeCount(names[i]));
      }
      return ok({ checks }, tid);
    }

    if (action === "echo") {
      return ok({ event }, tid);
    }

    if (action === "listUsers") {
      return await listUsers(event, tid);
    }

    if (action === "updateUserRole") {
      return await updateUserRole(event, tid);
    }

    if (action === "authDebug") {
      return await authDebug(openid, tid);
    }

    if (action === "getDocument") {
      return await getDocument(event, tid);
    }

    if (action === "getGymPermission") {
      return await getGymPermission(event, tid);
    }

    if (action === "getUserDetail") {
      return await getUserDetail(event, tid);
    }

    if (action === "updateUserProfile") {
      return await updateUserProfile(event, tid);
    }

    if (action === "updateGymPermission") {
      return await updateGymPermission(event, tid);
    }

    if (action === "getReviewDetail") {
      return await getReviewDetail(event, tid);
    }

    if (action === "updateReviewDetail") {
      return await updateReviewDetail(event, openid, tid);
    }

    if (action === "getCardDetail") {
      return await getCardDetail(event, tid);
    }

    if (action === "updateCardDetail") {
      return await updateCardDetail(event, tid);
    }

    return fail("BAD_REQUEST", "未知 action", tid);
  } catch (e) {
    return fail("ADMIN_FAILED", e && e.message ? e.message : "执行失败", tid);
  }
};

