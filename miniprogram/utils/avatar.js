// issue #35: 头像 cloud:// fileID 统一处理工具。
//
// 背景：<image src="cloud://..."> 在解析失败（文件不存在/无权限/环境异常）时，
// 渲染层会把它当成页面相对本地路径，报
//   Failed to load local image resource /pages/xxx/cloud://...  (HTTP 500)
// 且头像空白。客户端 wx.cloud.getTempFileURL 受云存储安全规则约束，读他人
// 头像文件可能被拒（表现：自己头像可见、他人头像不可见）。
//
// 约定：
// 1) 云函数端已用管理端权限把头像换成临时 https URL（不受存储规则限制）；
// 2) 前端这里做兜底：凡是 cloud:// 一律转临时 URL；转换失败的一律置空，
//    让 <image> 走 `src || defaultAvatar` 兜底，绝不让 cloud:// 进入渲染层。

function isCloudFileId(v) {
  return typeof v === "string" && v.indexOf("cloud://") === 0;
}

// 批量把 cloud:// fileID 换成临时 URL，返回 { fileID: tempFileURL }
// 单文件失败不影响其他文件；失败原因打 warn 便于在 vConsole 定位
function cloudIdsToTempUrl(ids) {
  const list = Array.from(new Set((ids || []).filter(isCloudFileId)));
  const map = {};
  if (!list.length) return Promise.resolve(map);
  const run = (batch) => new Promise((resolve) => {
    try {
      wx.cloud.getTempFileURL({
        fileList: batch,
        success: (r) => resolve((r && r.fileList) || []),
        fail: (err) => {
          console.warn("[avatar] getTempFileURL 调用失败", err && err.errMsg);
          resolve([]);
        }
      });
    } catch (e) {
      console.warn("[avatar] getTempFileURL 异常", e && e.message);
      resolve([]);
    }
  });
  return (async () => {
    for (let i = 0; i < list.length; i += 50) {
      const fileList = await run(list.slice(i, i + 50));
      fileList.forEach((it) => {
        if (it && it.fileID) {
          if (it.tempFileURL) {
            map[it.fileID] = it.tempFileURL;
          } else {
            console.warn("[avatar] 头像无法换取临时链接（文件不存在或无权限）",
              String(it.fileID).slice(0, 90), "status=", it.status, it.errMsg || "");
          }
        }
      });
    }
    return map;
  })();
}

// 批量转换列表项头像字段：list 为对象数组，field 为头像字段名（默认 avatarUrl）。
// 转换失败的 cloud:// 置为 ""（wxml 用 `|| defaultAvatar` 兜底）。
async function resolveCloudAvatars(list, field) {
  if (!Array.isArray(list) || !list.length) return list;
  const f = field || "avatarUrl";
  const ids = list.map((m) => (m && m[f]) || "").filter(isCloudFileId);
  const map = await cloudIdsToTempUrl(ids);
  return list.map((m) => {
    if (!m) return m;
    const v = m[f];
    if (!isCloudFileId(v)) return m;
    if (map[v]) return Object.assign({}, m, { [f]: map[v] });
    console.warn("[avatar] 头像转换失败，兜底默认头像", String(v).slice(0, 90));
    return Object.assign({}, m, { [f]: "" });
  });
}

module.exports = {
  isCloudFileId,
  cloudIdsToTempUrl,
  resolveCloudAvatars
};
