function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function formatDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function today() {
  return formatDate(new Date());
}

function todayYMD() {
  return formatDate(new Date());
}

function addDays(ymd, days) {
  const d = parseYMD(ymd) || new Date();
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function monthLabel(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

function parseYMD(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

module.exports = {
  pad2,
  formatDate,
  today,
  todayYMD,
  addDays,
  monthLabel,
  parseYMD
};

