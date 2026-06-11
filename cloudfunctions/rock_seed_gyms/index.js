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

function defaultCycle() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const mm = m < 10 ? `0${m}` : String(m);
  const startDate = `${y}-${mm}-01`;
  return {
    name: `${y}年${m}月`,
    startDate,
    boulderGrades: ["V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7+"],
    difficultyGrades: ["5.9", "5.10a", "5.10b", "5.10c", "5.11a", "5.11b"]
  };
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const force = !!(event && event.force);
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;

    const gymsCol = db.collection("RockGyms");
    const count = await gymsCol.count();
    if (!force && count && count.total > 0) {
      return ok({ seeded: 0, skipped: true }, tid);
    }

    const seed = [
      { name: "喧呐攀岩星光店", city: "杭州", address: "" },
      { name: "GOLINK", city: "杭州", address: "" },
      { name: "升升不息", city: "杭州", address: "" },
      { name: "向山攀岩", city: "杭州", address: "" },
      { name: "顽攀", city: "杭州", address: "" }
    ];
    const now = Date.now();
    const cycle = defaultCycle();

    let seeded = 0;
    for (let i = 0; i < seed.length; i++) {
      const g = seed[i];
      await gymsCol.add({
        data: {
          name: g.name,
          city: g.city,
          address: g.address,
          ownerOpenid: openid,
          managers: [openid],
          managerOpenids: [openid],
          currentCycle: cycle,
          routes: {
            boulder: { limits: { V0: 14, V1: 12, V2: 18, V3: 18, V4: 10, V5: 4, V6: 1, "V7+": 1 } },
            difficulty: { limits: { "5.9": 10, "5.10a": 10, "5.10b": 10, "5.10c": 10, "5.11a": 6, "5.11b": 4 } }
          },
          visitCount: 0,
          createdAt: now,
          updatedAt: now
        }
      });
      seeded += 1;
    }
    return ok({ seeded }, tid);
  } catch (e) {
    return fail("SEED_FAILED", e && e.message ? e.message : "写入失败", tid);
  }
};

