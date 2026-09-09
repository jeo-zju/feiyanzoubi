const calendarApi = require("../../services/api/calendar");
const gymApi = require("../../services/api/gym");
const { ensureAppLogin } = require("../../utils/session");
const { safeText } = require("../../utils/format");
const cache = require("../../utils/cache");
const { suggestedTime } = require("../../utils/plan");
const { callCloud } = require("../../services/cloud");

const MAX_DAYS = 14;
const WEEK_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
// issue #44: 时段细化——上午/下午/晚上，与时间轴可视窗口（START_HOUR=10 / END_HOUR=22）对齐。
const TIME_QUICK = [
  { key: "allday", label: "全天", hint: "10:00-22:00", startTime: "10:00", endTime: "22:00" },
  { key: "morning", label: "上午", hint: "10:00-14:00", startTime: "10:00", endTime: "14:00" },
  { key: "afternoon", label: "下午", hint: "14:00-18:00", startTime: "14:00", endTime: "18:00" },
  { key: "evening", label: "晚上", hint: "18:00-22:00", startTime: "18:00", endTime: "22:00" },
  { key: "custom", label: "时间段", hint: "自定义", startTime: "", endTime: "" }
];

function pad2(n) { return n < 10 ? `0${n}` : String(n); }
function addDays(baseDate, days) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  d.setDate(d.getDate() + days);
  return d;
}
function todayYMD(baseDate) {
  const d = baseDate || new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseYMD(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function hmLabel(v) { return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`; }

Page({
  data: {
    planId: "", version: 0, title: "", capacity: 4, joinMode: "direct", atmosphereTags: [], atmosphereOptions: ["欢迎新手","休闲爬","认真训练"], meetingPoint: "", contact: "", submitting: false, moreOpen: false, formLoading: true, formError: false,
    city: "",
    selectedGymId: "",
    selectedGymName: "",
    gymPickOpen: false,
    gymKeyword: "",
    gymOptions: [],
    // #26③: 岩馆列表分页状态（对齐首页 home loadGymPicker：20/页 + 滚动加载）
    _gymPickerState: { page: 0, hasMore: false, loading: false },
    dateCells: [],
    selectedDate: "",
    dateRangeLabel: "",
    startTime: "10:00",
    endTime: "22:00",
    hourOptions: (() => { const arr = []; for (let h = 6; h <= 23; h++) arr.push(`${h < 10 ? "0" + h : h}:00`); return arr; })(),
    startHourIdx: 4,
    endHourIdx: 16,
    durationHourText: "12 小时",
    timeQuickKey: "allday",
    timeQuickLabel: "全天",
    timeQuick: TIME_QUICK,
    visibility: "public",
    visibilityTabs: [
      { key: "public", label: "公开发布" },
      { key: "friends", label: "对岩友发布" },
      { key: "circle", label: "对岩友圈发布" }
    ],
    visibilityHint: "",
    advancedOpen: true,
    note: "",
    needPartner: true,
    skillTags: [
      { key: "boulder", label: "抱石", on: true, warn: true },
      { key: "lead", label: "先锋", on: false },
      { key: "toprope", label: "顶绳", on: false },
      { key: "auto", label: "自动锁", on: false },
      { key: "protector", label: "求保护员", on: false }
    ]
  },

  async onLoad(options) {
    try { await ensureAppLogin(); } catch (e) {}
    const city = decodeURIComponent(safeText(options && options.city) || "");
    const gymId = safeText(options && options.gymId) || "";
    const date = safeText(options && options.date) || todayYMD();

    const baseDate = new Date();
    const cells = [];
    for (let i = 0; i < MAX_DAYS; i++) {
      const d = addDays(baseDate, i);
      const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const isToday = i === 0;
      const crossMonth = i > 0 && d.getMonth() !== addDays(baseDate, i - 1).getMonth();
      let label;
      if (crossMonth || i === 0) {
        label = `${d.getMonth() + 1}/${d.getDate()}`;
      } else {
        label = String(d.getDate());
      }
      cells.push({
        date: ymd,
        label,
        isToday,
        weekdayShort: isToday ? "" : WEEK_SHORT[d.getDay()],
        selected: ymd === date
      });
    }
    const startLabel = `${parseYMD(cells[0].date).getMonth() + 1}月${parseYMD(cells[0].date).getDate()}日`;
    const endLabel = `${parseYMD(cells[MAX_DAYS - 1].date).getMonth() + 1}月${parseYMD(cells[MAX_DAYS - 1].date).getDate()}日`;
    let gymName = "";
    if (gymId) {
      try {
        const g = await gymApi.get({ gymId });
        if (g && g.gym) gymName = g.gym.name || g.gym.gymName || "";
      } catch (e) {}
    }
    this.setData({
      city,
      selectedGymId: gymId,
      selectedGymName: gymName,
      dateCells: cells,
      selectedDate: date,
      dateRangeLabel: `${startLabel} - ${endLabel}`
    });
    const suggestion = suggestedTime(date);
    this.setData({ selectedDate: suggestion.date, startTime:suggestion.startTime, endTime:suggestion.endTime, timeQuickKey:"custom", dateCells:cells.map(c=>({...c,selected:c.date===suggestion.date})) });
    // 「再约一次」/首页带类型发布：预填岩馆、攀爬类型、氛围、人数、报名方式。
    // 日期时间必须重新选择（上方 suggestedTime 已处理），联系方式与集合点不复制。
    if (!options.planId) {
      const typeKeys = String(options.skillTags || options.climbType || "").split(",").map(s=>s.trim()).filter(Boolean);
      const atmoKeys = String(options.atmosphere || "").split(",").map(s=>s.trim()).filter(Boolean);
      const capacityNum = Math.floor(Number(options.capacity) || 0);
      const patch = {};
      if (typeKeys.length) patch.skillTags = this.data.skillTags.map(t=>({...t,on:typeKeys.includes(t.key)}));
      if (atmoKeys.length) patch.atmosphereTags = this.data.atmosphereOptions.filter(o=>atmoKeys.includes(o));
      if (capacityNum >= 2 && capacityNum <= 20) patch.capacity = capacityNum;
      if (options.joinMode === "approval") patch.joinMode = "approval";
      if (Object.keys(patch).length) this.setData(patch);
    }
    if (options && options.planId) {
      this.setData({planId:String(options.planId)});
      try {
        const d=await callCloud("calendar_plan_publish",{action:"detail",planId:String(options.planId)},{silent:true});
        if(!d.isOwner) throw new Error("仅发起人可编辑");
        const p=d.plan;
        this.setData({version:p.version,title:p.title,capacity:p.capacity||Math.max(4,p.confirmedCount),joinMode:p.joinMode,atmosphereTags:p.atmosphereTags||[],meetingPoint:d.meetingPoint,contact:d.contact,selectedGymId:p.gymId,selectedGymName:(p.gymSnapshot||{}).name||"",city:(p.gymSnapshot||{}).city||"",selectedDate:p.date,startTime:p.startTime,endTime:p.endTime,note:p.note,visibility:p.visibility,skillTags:this.data.skillTags.map(t=>({...t,on:(p.skillTags||[]).includes(t.key)})),dateCells:cells.map(c=>({...c,selected:c.date===p.date}))});
      } catch(e) {this.setData({formError:true});wx.showModal({title:"无法编辑",content:e.message||"请返回详情重试",showCancel:false});}
    }
    this.setData({formLoading:false});
    this.recomputeDuration();
    if (!this.data.selectedGymId) {
      // #26①: 进入时未带岩馆 → 复用「今日打卡」拦截模式（home onTapCheckin：未选直接提示），
      // 提示先选岩馆并自动打开选择/搜索，发布前必须完成岩馆绑定
      wx.showToast({ title: "请先选择岩馆", icon: "none" });
      this.openGymPicker();
    }
  },

  onUnload() {
    this._clearGymPickerTimer();
  },

  // #26③: 岩馆选择/搜索整体对齐首页 home 的 loadGymPicker 模式：
  // 搜索框 + 300ms 防抖 + 分页(20/页) + 滚动加载(hasNext)，支持城市列表直接浏览
  openGymPicker() {
    if (this.data.gymPickOpen) return;
    this._clearGymPickerTimer();
    this.setData({
      gymPickOpen: true,
      gymKeyword: "",
      gymOptions: [],
      "_gymPickerState.page": 0,
      "_gymPickerState.hasMore": false,
      "_gymPickerState.loading": false
    });
    this.loadGymPicker(true);
  },

  onTapChangeGym() {
    if (!this.data.gymPickOpen) this.openGymPicker();
  },

  onCloseGymPicker() {
    if (!this.data.selectedGymId) return;
    this._clearGymPickerTimer();
    this.setData({ gymPickOpen: false, gymKeyword: "", gymOptions: [] });
  },

  onGymKeywordInput(e) {
    const keyword = safeText(e && e.detail && e.detail.value);
    this.setData({ gymKeyword: keyword, gymOptions: [], "_gymPickerState.loading": true });
    if (this._gymKeywordTimer) clearTimeout(this._gymKeywordTimer);
    const self = this;
    this._gymKeywordTimer = setTimeout(() => {
      self._gymKeywordTimer = null;
      self.loadGymPicker(true);
    }, 300);
  },

  onGymPickerScrollLower() {
    this.onGymPickerLoadMore();
  },

  onGymPickerLoadMore() {
    const st = this.data._gymPickerState || {};
    if (st.loading || !st.hasMore) return;
    this.loadGymPicker(false);
  },

  async loadGymPicker(reset) {
    const st = this.data._gymPickerState || { page: 0, hasMore: false, loading: false };
    if (!reset && (st.loading || !st.hasMore)) return;
    const keyword = safeText(this.data.gymKeyword);
    const page = reset ? 1 : Math.max(1, Number(st.page || 0) + 1);
    this._gymPickerToken = (this._gymPickerToken || 0) + 1;
    const token = this._gymPickerToken;
    this.setData({ "_gymPickerState.loading": true });
    try {
      const res = await gymApi.list(
        { city: safeText(this.data.city), keyword, page, pageSize: 20 },
        { loading: false }
      );
      if (token !== this._gymPickerToken) return;
      const list = (res && res.gyms) || [];
      const hasMore = !!(res && res.hasNext);
      const options = (Array.isArray(list) ? list : [])
        .map((x) => ({
          _id: String((x && x._id) || ""),
          name: safeText(x && (x.name || x.gymName)) || "未命名岩馆",
          city: safeText(x && (x.city || x.cityName || "")),
          address: safeText(x && (x.address || x.addr || ""))
        }))
        .filter((o) => o._id);
      const merged = reset ? options : (this.data.gymOptions || []).concat(options);
      this.setData({
        gymOptions: merged,
        "_gymPickerState.page": page,
        "_gymPickerState.hasMore": hasMore,
        "_gymPickerState.loading": false
      });
    } catch (e) {
      if (token !== this._gymPickerToken) return;
      console.warn("[calendar-publish] loadGymPicker failed", e && e.message);
      this.setData({ "_gymPickerState.loading": false });
    }
  },

  // #26②: 选择后回到「已选态」直接展示岩馆，顶部模块语义清晰
  onPickGym(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const gymId = String(ds.gymid || "");
    if (!gymId) return;
    this._clearGymPickerTimer();
    this.setData({
      selectedGymId: gymId,
      selectedGymName: String(ds.gymname || ""),
      gymPickOpen: false,
      gymKeyword: "",
      gymOptions: []
    });
  },

  _clearGymPickerTimer() {
    if (this._gymKeywordTimer) {
      clearTimeout(this._gymKeywordTimer);
      this._gymKeywordTimer = null;
    }
    this._gymPickerToken = (this._gymPickerToken || 0) + 1;
  },

  onSelectDate(e) {
    const date = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.date;
    if (!date) return;
    const cells = this.data.dateCells.map((x) => ({ ...x, selected: x.date === date }));
    this.setData({ dateCells: cells, selectedDate: date });
  },

  onSelectTimeQuick(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    const preset = TIME_QUICK.find((x) => x.key === key);
    if (!preset) return;
    const patch = { timeQuickKey: key, timeQuickLabel: preset.label };
    if (key !== "custom" && preset.startTime && preset.endTime) {
      patch.startTime = preset.startTime;
      patch.endTime = preset.endTime;
    }
    // #20: 同步整点下拉索引（非整点时间就近取整）
    const roundHour = (hm) => {
      const m = this.timeHMToMin(hm || "10:00");
      const h = Math.max(6, Math.min(23, Math.round(m / 60)));
      return `${h < 10 ? "0" + h : h}:00`;
    };
    const sVal = key === "custom" ? this.data.startTime : patch.startTime || this.data.startTime;
    const eVal = key === "custom" ? this.data.endTime : patch.endTime || this.data.endTime;
    const sRound = roundHour(sVal);
    const eRound = roundHour(eVal);
    patch.startHourIdx = Math.max(0, this.data.hourOptions.indexOf(sRound));
    patch.endHourIdx = Math.max(0, this.data.hourOptions.indexOf(eRound));
    if (key === "custom") {
      patch.startTime = sRound;
      patch.endTime = eRound;
    }
    this.setData(patch, () => this.recomputeDuration());
  },

  onStartHourChange(e) {
    const idx = Math.max(0, Number((e && e.detail && e.detail.value) || 0));
    const v = this.data.hourOptions[idx] || "10:00";
    const startMin = this.timeHMToMin(v);
    let end = this.data.endTime;
    if (this.timeHMToMin(end) - startMin < 60) {
      end = hmLabel(Math.min(23 * 60, startMin + 120));
    }
    const endIdx = Math.max(0, this.data.hourOptions.indexOf(end));
    this.setData({ startTime: v, startHourIdx: idx, endTime: end, endHourIdx: endIdx });
    this.recomputeDuration();
  },
  onEndHourChange(e) {
    const idx = Math.max(0, Number((e && e.detail && e.detail.value) || 0));
    const v = this.data.hourOptions[idx] || "22:00";
    if (this.timeHMToMin(v) <= this.timeHMToMin(this.data.startTime)) {
      wx.showToast({ title: "结束时间需晚于开始时间", icon: "none" });
      return;
    }
    this.setData({ endTime: v, endHourIdx: idx });
    this.recomputeDuration();
  },
  onStartTimeChange(e) {
    const v = (e && e.detail && e.detail.value) || "";
    if (!v) return;
    const startMin = this.timeHMToMin(v);
    let end = this.data.endTime;
    if (this.timeHMToMin(end) - startMin < 30) {
      end = hmLabel(Math.min(23 * 60 + 30, startMin + 120));
    }
    this.setData({ startTime: v, endTime: end, timeQuickKey: "custom", timeQuickLabel: "时间段" });
    this.recomputeDuration();
  },

  onEndTimeChange(e) {
    const v = (e && e.detail && e.detail.value) || "";
    if (!v) return;
    if (this.timeHMToMin(v) <= this.timeHMToMin(this.data.startTime)) {
      wx.showToast({ title: "结束时间需晚于开始时间", icon: "none" });
      return;
    }
    this.setData({ endTime: v, timeQuickKey: "custom", timeQuickLabel: "时间段" });
    this.recomputeDuration();
  },

  timeHMToMin(hm) {
    const m = String(hm || "").match(/^(\d{2}):(\d{2})$/);
    if (!m) return 0;
    return Number(m[1]) * 60 + Number(m[2]);
  },

  recomputeDuration() {
    const s = this.timeHMToMin(this.data.startTime);
    const e = this.timeHMToMin(this.data.endTime);
    const diff = Math.max(30, e - s);
    const hours = Math.floor(diff / 60);
    const mins = diff - hours * 60;
    let txt = mins ? `${hours} 小时 ${mins} 分` : `${hours} 小时`;
    this.setData({ durationHourText: txt });
  },

  onVisibilityChange(e) {
    const v = (e && e.detail && e.detail.value) || "public";
    const patch = { visibility: v, visibilityHint: this.visibilityHintFor(v) };
    if (v === "public") {
      // 公开发布：默认勾选「求搭子」并展开高级选项
      patch.needPartner = true;
      patch.advancedOpen = true;
    } else {
      // #21: 对岩友/岩友圈发布不展示「求搭子」，联动关闭
      patch.needPartner = false;
      patch.advancedOpen = true;
    }
    this.setData(patch);
  },

  visibilityHintFor(v) {
    if (v === "friends") return "对岩友发布——只有你的岩友能看到你的发布";
    if (v === "circle") return "对岩友圈发布——仅已加入的关联岩友圈成员可见";
    return "";
  },

  onToggleAdvanced() { this.setData({ advancedOpen: !this.data.advancedOpen }); },

  onNoteInput(e) { this.setData({ note: (e && e.detail && e.detail.value) || "" }); },

  onTogglePartner(e) { this.setData({ needPartner: !!(e && e.detail && e.detail.value) }); },

  onToggleSkillTag(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    const tags = this.data.skillTags.map((x) => (x.key === key ? { ...x, on: !x.on } : x));
    this.setData({ skillTags: tags });
  },

  async onPublish() {
    if(this.data.submitting || this.data.formLoading || this.data.formError) return;
    if (!this.data.selectedGymId) {
      wx.showToast({ title: "请先选择岩馆", icon: "none" });
      return;
    }
    if (!this.data.selectedDate) {
      wx.showToast({ title: "请选择日期", icon: "none" });
      return;
    }
    const start = this.timeHMToMin(this.data.startTime);
    const end = this.timeHMToMin(this.data.endTime);
    if (end - start < 30) {
      wx.showToast({ title: "时间段至少 30 分钟", icon: "none" });
      return;
    }
    if (end - start > 12 * 60) {
      wx.showToast({ title: "单次计划最多 12 小时", icon: "none" });
      return;
    }
    const skillTags = this.data.skillTags.filter((x) => x.on).map((x) => x.key);
    if(!skillTags.some(x=>x!=="protector")){wx.showToast({title:"请选择攀爬类型",icon:"none"});return;}
    // issue #27: 云函数 calendar_plan_publish 读 event.payload.date 等嵌套字段，
    // action 读 event 顶层 → 这里包一层 payload（原来平铺导致云端 payload={} 报缺 date）
    const payload = {
      action: this.data.planId ? "update" : "create",
      planId: this.data.planId,
      payload: {
        version:this.data.version,title:this.data.title,capacity:Number(this.data.capacity),joinMode:this.data.joinMode,atmosphereTags:this.data.atmosphereTags,meetingPoint:this.data.meetingPoint,contact:this.data.contact,
        mode: "gym",
        date: this.data.selectedDate,
        startTime: this.data.startTime,
        endTime: this.data.endTime,
        visibility: this.data.visibility,
        note: this.data.note || "",
        needPartner: !!this.data.needPartner,
        skillTags,
        capacity: Number(this.data.capacity || 4),
        joinMode: this.data.joinMode || "direct",
        title: this.data.title || "",
        atmosphereTags: this.data.atmosphereTags || [],
        meetingPoint: this.data.meetingPoint || "",
        contact: this.data.contact || "",
        gymId: this.data.selectedGymId
      }
    };
    const signature=JSON.stringify(payload);
    if(this._publishSignature!==signature){this._publishSignature=signature;this._publishId=Date.now()+"_"+Math.random().toString(36).slice(2);}
    payload.requestId=this._publishId;
    this.setData({submitting:true});
    try {
      const res = await calendarApi.publish(payload);
      wx.hideLoading();
      try {
        cache.invalidate(cache.CACHE_KEYS.CALENDAR_SUMMARY);
        cache.invalidate(cache.CACHE_KEYS.STATS_30DAY);
        getApp().globalData.plansDirty=true;
      } catch (_) {}
      wx.showToast({ title: this.data.planId ? "修改已保存" : "发布成功", icon: "success" });
      setTimeout(() => {
        wx.redirectTo({url:"/pages/plan-detail/index?planId="+encodeURIComponent(res.planId)});
      }, 450);
    } catch (e) {
      wx.showModal({ title: "暂未保存", content: (e && e.message) || "请稍后重试", showCancel: false });
    } finally {this.setData({submitting:false});}
  },
  onField(e){const key=e.currentTarget.dataset.key;if(["title","capacity","meetingPoint","contact"].includes(key))this.setData({[key]:e.detail.value});},
  onApproval(e){this.setData({joinMode:e.detail.value?"approval":"direct"});},
  onAtmosphere(e){const value=e.currentTarget.dataset.value;let tags=this.data.atmosphereTags||[];tags=tags.includes(value)?tags.filter(x=>x!==value):tags.concat(value).slice(0,3);this.setData({atmosphereTags:tags});},
  toggleMore(){this.setData({moreOpen:!this.data.moreOpen});}
});
