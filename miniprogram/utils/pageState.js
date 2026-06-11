function normalizePageValue(page) {
  const n = Number(page || 1);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function startPageLoad(pageCtx, reset) {
  if (!pageCtx || !pageCtx.data || pageCtx.data.loading) return null;
  const page = reset ? 1 : normalizePageValue(pageCtx.data.page);
  const pageSize = normalizePageValue(pageCtx.data.pageSize || 10);
  pageCtx.setData({ loading: true, page });
  return { page, pageSize };
}

function finishPageLoad(pageCtx) {
  if (!pageCtx || typeof pageCtx.setData !== "function") return;
  pageCtx.setData({ loading: false });
}

function turnToPrevPage(pageCtx, loader) {
  if (!pageCtx || !pageCtx.data || pageCtx.data.page <= 1) return;
  pageCtx.setData({ page: pageCtx.data.page - 1 });
  if (typeof loader === "function") loader.call(pageCtx, { reset: false });
}

function turnToNextPage(pageCtx, loader) {
  if (!pageCtx || !pageCtx.data || !pageCtx.data.hasNext) return;
  pageCtx.setData({ page: pageCtx.data.page + 1 });
  if (typeof loader === "function") loader.call(pageCtx, { reset: false });
}

module.exports = {
  startPageLoad,
  finishPageLoad,
  turnToPrevPage,
  turnToNextPage
};
