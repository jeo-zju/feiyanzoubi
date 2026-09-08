const { callCloud } = require("../cloud");

async function upsertGym(payload) {
  return callCloud("gym_owner_upsert", payload || {}, { loading: true, loadingTitle: "保存中" });
}

async function manageGym(payload) {
  try {
    return await callCloud("gym_owner_manage", payload || {}, { loading: true, loadingTitle: "处理中" });
  } catch (err) {
    const message = String((err && err.message) || "");
    if (message.includes("FUNCTION_NOT_FOUND") || message.includes("FunctionName parameter could not be found")) {
      const friendly = new Error("云函数 gym_owner_manage 未部署，请先在云开发部署后再试");
      friendly.code = "FUNCTION_NOT_FOUND";
      throw friendly;
    }
    throw err;
  }
}

module.exports = {
  upsertGym,
  manageGym
};

