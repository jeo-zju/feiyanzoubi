const { callCloud } = require("../cloud");

async function complete(payload) {
  return callCloud("llm", payload || {}, { loading: true, loadingTitle: "生成中" });
}

module.exports = {
  complete
};

