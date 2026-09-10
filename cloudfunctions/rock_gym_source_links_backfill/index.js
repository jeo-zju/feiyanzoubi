const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const BOOTSTRAP_ADMIN_IDS = ["42098a0769e3423400183ddf36230f95"];

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

function isBootstrapAdminId(value) {
  return BOOTSTRAP_ADMIN_IDS.includes(String(value == null ? "" : value).trim());
}

async function isAdmin(openid) {
  if (!openid) return false;
  if (isBootstrapAdminId(openid)) return true;
  const res = await db
    .collection("RockUsers")
    .where(_.or([{ openid }, { _openid: openid }, { uid: openid }]))
    .limit(1)
    .get();
  const user = res && res.data && res.data[0] ? res.data[0] : null;
  if (!user) return false;
  return user.role === "admin" || user.isAdmin === true;
}

function buildSourceLinkId(provider, providerPoiId) {
  const crypto = require("crypto");
  const key = `${safeText(provider)}::${safeText(providerPoiId)}`;
  return crypto.createHash("sha1").update(key).digest("hex");
}

/**
 * 回填 RockGymSourceLinks：从 RockGyms.sourceRefs 扫描并创建来源映射。
 *
 * - 同一 provider+providerPoiId 映射到多个馆时，标记 conflicts，不自动选择
 * - 已存在的 SourceLink 不覆盖（保留人工处理结果）
 * - dryRun=true 时只输出报告，不写入
 */
exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    if (!(await isAdmin(wxctx.OPENID))) return fail("FORBIDDEN", "无权限", tid);

    const dryRun = event && event.dryRun !== false;
    const now = Date.now();

    // 分页扫描所有 RockGyms
    const pageSize = 100;
    let page = 0;
    let totalGyms = 0;
    let totalSourceRefs = 0;
    let linksCreated = 0;
    let linksSkippedExisting = 0;
    const conflicts = []; // 一来源多主馆
    const seenLinks = {}; // linkId -> gymId

    while (true) {
      const res = await db
        .collection("RockGyms")
        .skip(page * pageSize)
        .limit(pageSize)
        .get();
      const list = (res && res.data) || [];
      if (!list.length) break;

      for (const gym of list) {
        totalGyms += 1;
        const gymId = safeText(gym._id);
        const sourceRefs = Array.isArray(gym.sourceRefs) ? gym.sourceRefs : [];
        const gymStatus = safeText(gym.status).toLowerCase() || "active";

        for (const ref of sourceRefs) {
          const provider = safeText(ref && ref.provider);
          const providerPoiId = safeText(ref && ref.providerPoiId);
          if (!provider || !providerPoiId) continue;
          totalSourceRefs += 1;

          const linkId = buildSourceLinkId(provider, providerPoiId);

          // 检查是否已存在
          if (seenLinks[linkId]) {
            // 同一来源映射到多个馆 → 冲突
            if (!conflicts.some((c) => c.linkId === linkId)) {
              conflicts.push({
                linkId,
                provider,
                providerPoiId,
                gymIds: [seenLinks[linkId], gymId]
              });
            } else {
              const c = conflicts.find((x) => x.linkId === linkId);
              if (!c.gymIds.includes(gymId)) c.gymIds.push(gymId);
            }
            continue;
          }
          seenLinks[linkId] = gymId;

          if (!dryRun) {
            // 检查 SourceLinks 是否已存在
            try {
              const existing = await db.collection("RockGymSourceLinks").doc(linkId).get();
              if (existing && existing.data) {
                linksSkippedExisting += 1;
                continue;
              }
            } catch (e) {
              // 不存在则创建
            }
            const linkStatus = gymStatus === "deleted" ? "deleted" : gymStatus === "merged" ? "merged" : "active";
            const doc = {
              _id: linkId,
              provider,
              providerPoiId,
              gymId,
              status: linkStatus,
              redirectGymId: gymStatus === "merged" ? safeText(gym.mergedIntoGymId) : "",
              createdAt: now,
              updatedAt: now
            };
            try {
              await db.collection("RockGymSourceLinks").add({ data: doc });
              linksCreated += 1;
            } catch (e) {
              // 可能已存在（竞态），跳过
              linksSkippedExisting += 1;
            }
          } else {
            linksCreated += 1;
          }
        }
      }

      page += 1;
      if (list.length < pageSize) break;
    }

    return ok(
      {
        dryRun,
        totalGyms,
        totalSourceRefs,
        linksCreated,
        linksSkippedExisting,
        conflictCount: conflicts.length,
        conflicts: conflicts.slice(0, 50)
      },
      tid
    );
  } catch (e) {
    return fail("BACKFILL_FAILED", e && e.message ? e.message : "回填失败", tid);
  }
};
