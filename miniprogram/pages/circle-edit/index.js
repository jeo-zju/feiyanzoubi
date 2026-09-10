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
    gymKeyword: "",
    _gymOptionsCache: [],
    _gymPickerState: { page: 0, hasMore: false, loading: false },
    saving: false,
    gymSummaryName: "选择常去的岩馆"
  },

  onLoad(options) {
    const mode = (safeText(options && options.mode) === "edit") ? "edit" : "create";
    const circleId = safeText(options && options.circleId);
    const cityFromOpt = decodeURIComponent(safeText(options && options.city));
    const gymIdFromOpt = safeText(options && options.gymId);
    const gymIds = gymIdFromOpt ? [gymIdFromOpt] : [];
    const cityOptions = CITY_PRESETS.map((n) => ({ name: n }));
    cityOptions.push({ name: "自定义…", custom: true });
    // 页名交原生导航
    wx.setNavigationBarTitle({ title: mode === "edit" ? "编辑岩友圈" : "新建岩友圈" });
    this.setData({
      mode,
      circleId,
      city: cityFromOpt || "杭州",
      gymIds,
      cityOptions,
      selectedColorIndex: Math.floor(Math.random() * CIRCLE_COLORS.length)
    });
    this.refreshGymSummary();
  },

  // 正文馆摘要：最多两个馆名，其余以「共 N 家」表达
  refreshGymSummary() {
    const ids = this.data.gymIds || [];
    if (!ids.length) {
      this.setData({ gymSummaryName: "选择常去的岩馆" });
      return;
    }
    const names = ids.slice(0, 2).map((id) => {
      const g = (this.data.gymMap || {})[id];
      return g && g.name ? g.name : "";
    }).filter(Boolean);
    const gymSummaryName = names.length
      ? names.join("、") + (ids.length > 2 ? " 等" : "")
      : `已选 ${ids.length} 家岩馆`;
    this.setData({ gymSummaryName });
  },

  async onShow() {
    if (this.data.mode === "edit" && this.data.circleId) {
      await this.loadCircle();
    }
    await this.refreshGymOptions(true);
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
      // 详情带回的馆名补进 map，保证未出现在分页列表中的已选馆也能显示
      const gymMap = Object.assign({}, this.data.gymMap);
      (Array.isArray(r.gyms) ? r.gyms : []).forEach((g) => {
        const id = String(g && g._id || "");
        if (id && g.name) gymMap[id] = { _id: id, name: safeText(g.name) };
      });
      this.setData({
        name: safeText(circle.name),
        description: safeText(circle.description),
        city: safeText(circle.city),
        gymIds: Array.isArray(circle.gymIds) ? circle.gymIds.slice() : [],
        gymMap,
        selectedColorIndex: colorIdx < 0 ? 0 : colorIdx
      });
      this.refreshGymSummary();
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  // 岩馆选择：支持搜索（关键词）+ 翻页（滚动到底/加载更多），对齐首页 loadGymPicker
  async refreshGymOptions(reset) {
    const st = this.data._gymPickerState || { page: 0, hasMore: false, loading: false };
    if (!reset && (st.loading || !st.hasMore)) return;
    const keyword = safeText(this.data.gymKeyword);
    const page = reset ? 1 : Math.max(1, Number(st.page || 0) + 1);
    this._gymPickerToken = (this._gymPickerToken || 0) + 1;
    const token = this._gymPickerToken;
    this.setData({ "_gymPickerState.loading": true });
    try {
      const loader = async () => await gymApi.list(
        { city: safeText(this.data.city), keyword, page, pageSize: 20 },
        { loading: false }
      );
      let r;
      if (reset && !keyword) {
        const city = String(safeText(this.data.city) || "").trim().toLowerCase();
        const cacheKey = `${cache.CACHE_KEYS.GYM_LIST_PREFIX}${city}_n20`;
        r = await cache.get(cacheKey, { ttlMin: 120, useL2: true, loader });
      } else {
        r = await loader();
      }
      if (token !== this._gymPickerToken) return;
      const gyms = (r && r.gyms) || [];
      const hasMore = !!(r && r.hasNext);
      const map = {};
      const options = gyms.map((g) => {
        const id = String(g._id || "");
        map[id] = { _id: id, name: safeText(g.name) };
        return {
          _id: id,
          name: safeText(g.name),
          checked: this.data.gymIds.indexOf(id) >= 0
        };
      }).filter((o) => o._id);
      const merged = reset ? options : (this.data.gymOptions || []).concat(options);
      const patch = {
        gymOptions: merged,
        gymMap: Object.assign({}, this.data.gymMap, map),
        "_gymPickerState.page": page,
        "_gymPickerState.hasMore": hasMore,
        "_gymPickerState.loading": false
      };
      if (reset && !keyword) patch._gymOptionsCache = merged;
      this.setData(patch);
    } catch (e) {
      if (token !== this._gymPickerToken) return;
      console.warn("[circle-edit] load gym options failed", e && e.message);
      this.setData({ "_gymPickerState.loading": false });
    }
  },

  onGymKeywordInput(e) {
    const keyword = safeText(e && e.detail && e.detail.value);
    this.setData({ gymKeyword: keyword, gymOptions: [], "_gymPickerState.loading": true });
    if (this._gymKeywordTimer) clearTimeout(this._gymKeywordTimer);
    const self = this;
    this._gymKeywordTimer = setTimeout(() => {
      self._gymKeywordTimer = null;
      self.refreshGymOptions(true);
    }, 300);
  },
  onGymPickerScrollLower() {
    this.onGymPickerLoadMore();
  },
  async onGymPickerLoadMore() {
    const st = this.data._gymPickerState || {};
    if (st.loading || !st.hasMore) return;
    await this.refreshGymOptions(false);
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
            self.setData({
              city: newCity,
              gymIds: [],
              gymMap: {},
              gymOptions: [],
              _gymOptionsCache: [],
              gymKeyword: "",
              _gymPickerState: { page: 0, hasMore: false, loading: false }
            });
            self.refreshGymSummary();
            self.refreshGymOptions(true);
          }
        }
      });
      return;
    }
    if (!name) return;
    this.setData({
      city: name,
      citySheetVisible: false,
      gymIds: [],
      gymMap: {},
      gymOptions: [],
      _gymOptionsCache: [],
      gymKeyword: "",
      _gymPickerState: { page: 0, hasMore: false, loading: false }
    });
    this.refreshGymSummary();
    this.refreshGymOptions(true);
  },

  openGymSheet() {
    const cached = (this.data._gymOptionsCache || []).slice();
    this.setData({
      gymSheetVisible: true,
      gymKeyword: "",
      gymOptions: cached.length ? cached : this.data.gymOptions,
      "_gymPickerState.page": 0,
      "_gymPickerState.hasMore": false,
      "_gymPickerState.loading": false
    });
    this.refreshGymOptions(true);
  },
  closeGymSheet() {
    if (this._gymKeywordTimer) {
      clearTimeout(this._gymKeywordTimer);
      this._gymKeywordTimer = null;
    }
    this.setData({ gymSheetVisible: false });
  },
  toggleGym(e) {
    const id = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!id) return;
    const arr = this.data.gymIds.slice();
    const idx = arr.indexOf(id);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(id);
    const gymOptions = (this.data.gymOptions || []).map((o) => ({
      _id: o._id,
      name: o.name,
      checked: arr.indexOf(o._id) >= 0
    }));
    this.setData({ gymIds: arr, gymOptions });
    this.refreshGymSummary();
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
  }
});
