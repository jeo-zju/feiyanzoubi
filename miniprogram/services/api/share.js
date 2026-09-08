const { callCloud } = require("../cloud");

async function render(payload) {
  return callCloud("share_card_render", payload || {}, { loading: true, loadingTitle: "生成中" });
}

module.exports = {
  render
};

