function db() {
  return wx.cloud.database();
}

function _() {
  return db().command;
}

function collection(name) {
  return db().collection(name);
}

module.exports = {
  db,
  _,
  collection
};

