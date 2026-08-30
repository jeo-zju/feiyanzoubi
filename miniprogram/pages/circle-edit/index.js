const circleApi = require("../../services/api/circle");
const gymApi = require("../../services/api/gym");
const { safeText } = require("../../utils/format");
const { CIRCLE_COLORS } = require("../../utils/constants");
const cache = require("../../utils/cache");

const CITY_PRESETS = ["上海", "北京", "深圳", "广州", "杭州", "成都", "南京", "武汉"];

Page({
  data: {
    mode: "create",
    circleId: "",
    circleColors: CIRCLE_COLORS,
    selectedColorIndex: 0,
    name: "",
    description: "",
    city: "",
    cityOptions: [],
    gymIds: [],
    gymMap: {},
    gymSheetVisible: false,
    citySheetVisible: false,
    gymOptions: [],
    saving: false
  },

  onLoad(options) {
    const mode = (safeText(options && options.mode) === "edit") ? "edit" : "create";
    const circleId = safeText(options && options.circleId);
    const cityFromOpt = decodeURIComponent(safeText(options && options.city));
    const gymIdFromOpt = safeText(options && options.gymId);
    const gymIds = gymIdFromOpt ? [gymIdFromOpt] : [];
    const cityOptions = CITY_PRESETS.map((n) => ({ name: n }));
    cityOptions.push({ name: "自定义…", custom: true });
    this.setData({
      mode,
      circleId,
      city: cityFromOpt || "上海",
      gymIds,
      cityOptions,
      selectedColorIndex: Math.floor(Math.random() * CIRCLE_COLORS.length)
    });
  },

  async onShow() {
    if (this.data.mode === "edit" && this.data.circleId) {
      await this.loadCircle();
    }
    await this.refreshGymOptions();
  },

  noop() {},

  async loadCircle() {
    try {
      const r = await circleApi.detail({ circleId: this.data.circleId });
      const circle = r && r.circle;
      if (!circle) return;
      const colorIdx = Math.max(
        0,
        CIRCLE_COLORS.indexOf(safeText(circle.avatarColor))
      );
      this.setData({
        name: safeText(circle.name),
        description: safeText(circle.description),
        city: safeText(circle.city),
        gymIds: Array.isArray(circle.gymIds) ? circle.gymIds.slice() : [],
        selectedColorIndex: colorIdx < 0 ? 0 : colorIdx
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  async refreshGymOptions() {
    try {
      const city = String(safeText(this.data.city) || "").trim().toLowerCase();
      const cacheKey = `${cache.CACHE_KEYS.GYM_LIST_PREFIX}${city}_n50`;
      const r = await cache.get(cacheKey, {
        ttlMin: 120,
        useL2: true,
        loader: async () => await gymApi.list(
          { city: this.data.city, keyword: "", page: 1, pageSize: 50 },
          { loading: false }
        )
      });
      const gyms = (r && r.gyms) || [];
      const map = {};
      const options = gyms.map((g) => {
        const id = String(g._id || "");
        map[id] = { _id: id, name: safeText(g.name) };
        return { _id: id, name: safeText(g.name) };
      }).filter((o) => o._id);
      this.setData({ gymOptions: options, gymMap: map });
    } catch (e) {
      this.setData({ gymOptions: [], gymMap: {} });
    }
  },

  onPickColor(e) {
    const idx = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.idx);
    if (!Number.isFinite(idx) || idx < 0 || idx >= CIRCLE_COLORS.length) return;
    this.setData({ selectedColorIndex: idx });
  },

  onInputName(e) {
    this.setData({ name: safeText(e && e.detail && e.detail.value).slice(0, 12) });
  },
  onInputDesc(e) {
    this.setData({ description: safeText(e && e.detail && e.detail.value).slice(0, 40) });
  },

  openCitySheet() { this.setData({ citySheetVisible: true }); },
  closeCitySheet() { this.setData({ citySheetVisible: false }); },
  onPickCity(e) {
    const name = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name);
    const custom = !!(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.custom);
    if (custom) {
      this.setData({ citySheetVisible: false });
      const self = this;
      wx.showModal({
        title: "输入城市",
        editable: true,
        placeholderText: "如：苏州",
        success(r) {
          if (r.confirm && safeText(r.content)) {
            const newCity = safeText(r.content);
            self.setData({ city: newCity, gymIds: [], gymMap: {}, gymOptions: [] });
            self.refreshGymOptions();
          }
        }
      });
      return;
    }
    if (!name) return;
    this.setData({ city: name, citySheetVisible: false, gymIds: [], gymMap: {}, gymOptions: [] });
    this.refreshGymOptions();
  },

  openGymSheet() { this.setData({ gymSheetVisible: true }); },
  closeGymSheet() { this.setData({ gymSheetVisible: false }); },
  toggleGym(e) {
    const id = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!id) return;
    const arr = this.data.gymIds.slice();
    const idx = arr.indexOf(id);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(id);
    this.setData({ gymIds: arr });
  },

  async onSave() {
    if (this.data.saving) return;
    const name = safeText(this.data.name);
    if (!name) { wx.showToast({ title: "请填写圈名", icon: "none" }); return; }
    const city = safeText(this.data.city);
    if (!city) { wx.showToast({ title: "请选择城市", icon: "none" }); return; }
    const avatarColor = CIRCLE_COLORS[this.data.selectedColorIndex] || CIRCLE_COLORS[0];
    try {
      this.setData({ saving: true });
      if (this.data.mode === "edit" && this.data.circleId) {
        await circleApi.update({
          circleId: this.data.circleId,
          name,
          description: safeText(this.data.description),
          gymIds: this.data.gymIds.slice(),
          avatarColor
        });
        try { cache.invalidate(cache.CACHE_KEYS.MY_CIRCLES); } catch (_) {}
        wx.showToast({ title: "已保存", icon: "success" });
      } else {
        const r = await circleApi.create({
          name,
          city,
          description: safeText(this.data.description),
          gymIds: this.data.gymIds.slice(),
          avatarColor
        });
        try { cache.invalidate(cache.CACHE_KEYS.MY_CIRCLES); } catch (_) {}
        wx.showToast({ title: "已创建", icon: "success" });
        if (r && r.circleId) {
          setTimeout(() => {
            wx.redirectTo({ url: `/pages/circle-detail/index?circleId=${r.circleId}` });
          }, 500);
          this.setData({ saving: false });
          return;
        }
      }
      setTimeout(() => wx.navigateBack(), 400);
    } catch (e) {
      wx.showToast({ title: e && e.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  goBack() { wx.navigateBack(); }
});
