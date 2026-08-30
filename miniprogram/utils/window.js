function getWindowInfoSafe() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo();
  } catch (e) {}
  try {
    const legacyGetter = wx["getSystemInfoSync"];
    if (legacyGetter) return legacyGetter.call(wx);
  } catch (e) {}
  return {};
}

function getWindowWidth() {
  const info = getWindowInfoSafe();
  return Number(info && info.windowWidth) || 375;
}

function rpxToPx(rpx) {
  return (Number(rpx || 0) * getWindowWidth()) / 750;
}

module.exports = {
  getWindowWidth,
  rpxToPx
};
