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

exports.main = async (event) => {
  const tid = traceId();
  try {
    const gymId = safeText(event && event.gymId);
    const page = safeText(event && event.page) || "pages/home/index";
    const scene = safeText(event && event.scene) || (gymId ? `gymId=${gymId}` : `t=${Date.now()}`);
    let gym = null;
    if (gymId) {
      const res = await db.collection("RockGyms").doc(gymId).get();
      gym = (res && res.data) || null;
    }

    let fileID = null;
    try {
      const codeRes = await cloud.openapi.wxacode.getUnlimited({
        page,
        scene,
        isHyaline: true,
        width: 280
      });
      if (codeRes && codeRes.buffer) {
        const uploadRes = await cloud.uploadFile({
          cloudPath: `share/${tid}.png`,
          fileContent: codeRes.buffer
        });
        fileID = uploadRes && uploadRes.fileID ? uploadRes.fileID : null;
      }
    } catch (e) {}

    return ok(
      {
        fileID,
        title: gym ? gym.name : "飞岩录",
        subtitle: gym && gym.city ? gym.city : "",
        page,
        scene
      },
      tid
    );
  } catch (e) {
    return fail("SHARE_FAILED", e && e.message ? e.message : "生成失败", tid);
  }
};

