const { callCloud } = require("../cloud");

async function list(params) {
  return callCloud("dictionary_list", params || {}, { loading: false });
}

module.exports = {
  list
};

