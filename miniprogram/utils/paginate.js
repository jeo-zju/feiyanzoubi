function normalizePage(p) {
  const n = Number(p || 1);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function toSkipLimit(page, pageSize) {
  const p = normalizePage(page);
  const size = Number(pageSize || 10);
  const limit = Number.isFinite(size) && size > 0 ? Math.floor(size) : 10;
  return { page: p, limit, skip: (p - 1) * limit };
}

module.exports = {
  normalizePage,
  toSkipLimit
};

