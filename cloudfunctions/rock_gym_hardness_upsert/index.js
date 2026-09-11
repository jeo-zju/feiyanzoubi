const cloud = require("wx-server-sdk");
const guard = require("./demo-guard");

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

function toValidScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const score = Math.round(n);
  if (score < 1 || score > 10) return null;
  return score;
}

function roundAvg(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

async function findUser(openid) {
  if (!openid) return null;
  const res = await db
    .collection("RockUsers")
    .where(_.or([{ openid }, { _openid: openid }, { uid: openid }]))
    .limit(1)
    .get();
  return res && res.data && res.data[0] ? res.data[0] : null;
}

async function recalcGymHardness(gymId) {
  const res = await db.collection("RockGymHardnessRatings").where({ gymId }).limit(1000).get();
  const list = (res && res.data) || [];
  let total = 0;
  let count = 0;
  list.forEach((item) => {
    const score = toValidScore(item && item.score);
    if (score == null) return;
    total += score;
    count += 1;
  });
  return {
    hardnessCount: count,
    hardnessAvg: count ? roundAvg(total / count) : null
  };
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    if (!openid) return fail("UNAUTHORIZED", "用户未登录", tid);
    // 模拟身份不得提交难度/打分——纵深防御
    await guard.assertRealActor(openid);

    const gymId = safeText(event && event.gymId);
    const score = toValidScore(event && event.score);
    if (!gymId) return fail("BAD_REQUEST", "缺少 gymId", tid);
    if (score == null) return fail("BAD_REQUEST", "评分必须为 1-10 的整数", tid);

    const gymRes = await db.collection("RockGyms").doc(gymId).get();
    if (!(gymRes && gymRes.data)) return fail("NOT_FOUND", "岩馆不存在", tid);

    const user = await findUser(openid);
    const userId = user && user._id ? String(user._id) : "";
    const now = Date.now();
    const ratingCol = db.collection("RockGymHardnessRatings");
    const existRes = await ratingCol.where({ gymId, openid }).limit(1).get();
    const existing = existRes && existRes.data && existRes.data[0] ? existRes.data[0] : null;

    if (existing && existing._id) {
      await ratingCol.doc(existing._id).update({
        data: {
          score,
          userId,
          updatedAt: now
        }
      });
    } else {
      await ratingCol.add({
        data: {
          gymId,
          openid,
          userId,
          score,
          createdAt: now,
          updatedAt: now
        }
      });
    }

    const summary = await recalcGymHardness(gymId);
    await db.collection("RockGyms").doc(gymId).update({
      data: {
        hardnessAvg: summary.hardnessAvg,
        hardnessCount: summary.hardnessCount,
        hardnessUpdatedAt: now
      }
    });

    return ok(
      {
        score,
        myHardnessScore: score,
        hardnessAvg: summary.hardnessAvg,
        hardnessCount: summary.hardnessCount
      },
      tid
    );
  } catch (e) {
    return fail("HARDNESS_UPSERT_FAILED", e && e.message ? e.message : "保存评分失败", tid);
  }
};
