function safeText(v, fallback) {
  const s = v == null ? "" : String(v);
  const t = s.trim();
  return t ? t : fallback || "";
}

function clipText(v, max) {
  const s = safeText(v, "");
  const m = Number(max || 0);
  if (!m || s.length <= m) return s;
  return `${s.slice(0, m)}…`;
}

module.exports = {
  safeText,
  clipText
};

