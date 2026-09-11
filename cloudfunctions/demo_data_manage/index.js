const cloud = require("wx-server-sdk");
const profileMod = require("./profile");
const { createRunApi } = require("./run");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const runApi = createRunApi({ db, cloud });

const BOOTSTRAP_ADMIN_IDS = ["42098a0769e3423400183ddf36230f95"];

function traceId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function ok(data, tid) { return { ok: true, data, traceId: tid }; }
function fail(code, message, tid, extra) {
  return { ok: false, error: Object.assign({ code, message }, extra || {}), traceId: tid };
}
function safeText(v) { return v == null ? "" : String(v).trim(); }

// 启用开关：云函数环境变量（控制台/CI 配置）或 RockAppConfig/demo.featureEnabled（运维经数据库翻转）。
// 缺省关闭；两种方式都只在服务端判定，客户端无法绕过。
async function demoFeatureEnabled() {
  if (process.env.ALLOW_DEMO_DATA === "true") return true;
  const doc = await db.collection("RockAppConfig").doc("demo").get().catch(() => null);
  return !!(doc && doc.data && doc.data.featureEnabled === true);
}

async function isAdmin(openid) {
  if (!openid) return false;
  if (BOOTSTRAP_ADMIN_IDS.includes(openid)) return true;
  const res = await db.collection("RockUsers")
    .where(_.or([{ openid }, { _openid: openid }, { uid: openid }]))
    .limit(1).get();
  const user = res && res.data && res.data[0] ? res.data[0] : null;
  return !!(user && (user.role === "admin" || user.isAdmin === true));
}

async function listAll(collection, where, orderByField) {
  const out = [];
  for (let skip = 0; ; skip += 100) {
    let q = db.collection(collection);
    if (where) q = q.where(where);
    if (orderByField) q = q.orderBy(orderByField, "asc");
    const r = await q.skip(skip).limit(100).get();
    out.push(...r.data);
    if (r.data.length < 100) return out;
  }
}

// 素材 → 身份对账：幂等。可由部署工具建池后重复调用修复，不读取任何本机路径。
async function provisionIdentities() {
  const assets = (await listAll("RockDemoAssets", { status: "ready" }, "demoUserId"))
    .filter(a => a && a.fileID && a.assetSha);
  const result = { assets: assets.length, created: 0, repaired: 0, users: 0, errors: [] };
  for (const asset of assets) {
    try {
      const index = Number(String(asset.demoUserId || "").replace(/^demo_/, "")) || 0;
      if (!index) { result.errors.push({ asset: asset._id, error: "bad demoUserId" }); continue; }
      const profile = profileMod.buildDemoProfile(index, { assetSha: asset.assetSha, fileID: asset.fileID });
      const found = await db.collection("RockUsers")
        .where(_.or([{ openid: profile.openid }, { _openid: profile.openid }, { uid: profile.openid }]))
        .limit(1).get().catch(() => ({ data: [] }));
      const existing = found && found.data && found.data[0] ? found.data[0] : null;
      const now = Date.now();
      const data = {
        accountType: "demo",
        datasetId: profileMod.DATASET_ID,
        demoUserId: profile.demoUserId,
        avatarFileId: asset.fileID,
        avatarUrl: asset.fileID,
        nickName: profile.nickName,
        displayName: profile.nickName,
        bio: profile.bio || "",
        climbSkills: profile.climbSkills,
        demoProfile: profile.demoProfile,
        demoCity: existing && existing.demoCity ? existing.demoCity : "",
        demoAllocated: !!(existing && existing.demoCity),
        role: "user",
        updatedAt: now
      };
      if (!existing) {
        await db.collection("RockUsers").add({ data: {
          ...data,
          openid: profile.openid, uid: profile.openid, city: data.demoCity, rockId: "",
          createdAt: now
        } });
        result.created += 1;
      } else {
        const repairs = {};
        ["accountType", "datasetId", "demoUserId", "avatarFileId", "avatarUrl", "nickName",
          "displayName", "bio", "climbSkills", "demoProfile", "role"].forEach((k) => {
          if (existing[k] === undefined || existing[k] === null || existing[k] === "") repairs[k] = data[k];
        });
        if (existing.accountType !== "demo") repairs.accountType = "demo";
        if (Object.keys(repairs).length) {
          await db.collection("RockUsers").doc(existing._id).update({ data: repairs });
          result.repaired += 1;
        }
      }
      result.users += 1;
    } catch (e) {
      result.errors.push({ asset: asset._id, error: e.errMsg || e.message || String(e) });
    }
  }
  return result;
}

async function assetsStatus() {
  const assets = await listAll("RockDemoAssets", null, "demoUserId");
  const byStatus = {};
  assets.forEach(a => { const k = a.status || "unknown"; byStatus[k] = (byStatus[k] || 0) + 1; });
  const users = await db.collection("RockUsers")
    .where({ accountType: "demo" }).count().catch(() => ({ total: 0 }));
  return {
    assetVersion: profileMod.ASSET_VERSION,
    datasetId: profileMod.DATASET_ID,
    total: assets.length,
    byStatus,
    demoUsers: users.total || 0,
    files: assets.map(a => ({
      demoUserId: a.demoUserId, sourceFile: a.sourceFile, status: a.status,
      bytes: a.bytes || 0, error: a.error || ""
    }))
  };
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID || "";
    const action = safeText(event && event.action);

    // 续跑只接受云函数间调度或管理员直连（见 run.js 的 continueToken），入口隐藏不等于鉴权
    const serverDispatch = wxctx.SOURCE === "云函数" && !openid && event && event.__serverDispatch === true;
    if (!(await isAdmin(openid)) && !(serverDispatch && action === "generate_continue")) {
      return fail("FORBIDDEN", "仅管理员可操作", tid);
    }
    if (!(await demoFeatureEnabled()) && !(serverDispatch && action === "generate_continue")) {
      return fail("DISABLED", "演示数据功能未在该环境启用", tid);
    }

    if (action === "assets_status") return ok(await assetsStatus(), tid);
    if (action === "provision_identities") return ok(await provisionIdentities(), tid);

    if (action === "preview") return ok(await runApi.preview(event), tid);
    if (action === "generate") return ok(await runApi.generate(event, { openid }), tid);
    if (action === "generate_continue") {
      const actor = serverDispatch ? { kind: "cloud" } : { openid };
      return ok(await runApi.generateContinue(safeText(event.runId), actor), tid);
    }
    if (action === "run_status") return ok(await runApi.status(safeText(event.runId)), tid);
    if (action === "list_runs") return ok({ runs: await runApi.listRuns(safeText(event.city)) }, tid);

    if (action === "hide") return ok(await runApi.setVisibility(false, { openid }), tid);
    if (action === "show_all") return ok(await runApi.setVisibility(true, { openid }), tid);
    if (action === "cleanup") return ok(await runApi.cleanup(event, { openid }), tid);
    return fail("BAD_ACTION", `支持 action: assets_status | provision_identities | preview | generate | generate_continue | run_status | list_runs | hide | show_all | cleanup。收到: ${action}`, tid);
  } catch (e) {
    return fail(e.code || "DEMO_DATA_FAILED", e.errMsg || e.message || String(e), tid);
  }
};
