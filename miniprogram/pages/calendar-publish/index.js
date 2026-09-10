const calendarApi = require("../../services/api/calendar");
const gymApi = require("../../services/api/gym");
const { ensureAppLogin } = require("../../utils/session");
const { safeText } = require("../../utils/format");
const cache = require("../../utils/cache");
const { validateSlot, sanitizePrefill, slotsToRange, rangeToSlots, suggestedSlots, timeSlotText, TIME_SLOT_DEFS } = require("../../utils/plan");
const TIME_SLOT_KEYS = TIME_SLOT_DEFS.map(d => d.key);
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
    planId: "", version: 0, title: "", capacity: 4, capacityMin: 2, joinMode: "direct", atmosphereTags: [], atmosphereOptions: ["欢迎新手","休闲爬","认真训练"], meetingPoint: "", contact: "", submitting: false, moreOpen: false, formLoading: true, formError: false,
    // 二轮紧凑版：单行日期标签
    dateLabelText: "",
    // 时段（上午/下午/晚上，可多选；startTime/endTime 由所选时段并集推导）
    timeSlots: [],
    timeSlotOptions: TIME_SLOT_DEFS.map(d => ({ key: d.key, label: d.label, on: false })),
    // 同时段互斥反馈：SCHEDULE_CONFLICT 时展示反馈条并标红冲突时段，不清空已选
    conflictText: "",
    conflictSlots: [],
    // 选填折叠区
    noteOpen: false,
    contactOpen: false,
    // 设置弹层（草稿态，完成才应用）
    settingsOpen: false,
    settingsSummary: "公开 · 直接加入",
    settingsExtra: "",
    dTitle: "",
    dAtmosphereTags: [],
    dProtector: false,
    dVisibility: "public",
    dJoinMode: "direct",
    dVisibilityHint: "",
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
        wkLabel: i === 0 ? "今天" : i === 1 ? "明天" : "周" + WEEK_SHORT[d.getDay()],
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
    if (options && options.planId) {
      // 编辑：以原计划为准，日期时间不重选、不套用再约预填
      this.setData({planId:String(options.planId)});
      try {
        const d=await callCloud("calendar_plan_publish",{action:"detail",planId:String(options.planId)},{silent:true});
        if(!d.isOwner) throw new Error("仅发起人可编辑");
        const p=d.plan;
        // 时段：新数据直接用 timeSlots；旧计划（无该字段）按时间区间推断
        const editSlots=(Array.isArray(p.timeSlots)&&p.timeSlots.length)
          ? p.timeSlots.filter(k=>TIME_SLOT_KEYS.includes(k))
          : rangeToSlots(p.startTime,p.endTime);
        const editRange=slotsToRange(editSlots);
        this.setData({version:p.version,title:p.title,capacity:p.capacity||Math.max(4,p.confirmedCount),capacityMin:Math.max(2,Number(p.confirmedCount)||0),joinMode:p.joinMode,atmosphereTags:p.atmosphereTags||[],meetingPoint:d.meetingPoint,contact:d.contact,selectedGymId:p.gymId,selectedGymName:(p.gymSnapshot||{}).name||"",city:(p.gymSnapshot||{}).city||"",selectedDate:p.date,startTime:editRange.startTime,endTime:editRange.endTime,timeSlots:editSlots,timeSlotOptions:this.data.timeSlotOptions.map(o=>({...o,on:editSlots.includes(o.key)})),note:p.note,visibility:p.visibility,skillTags:this.data.skillTags.map(t=>({...t,on:(p.skillTags||[]).includes(t.key)})),dateCells:cells.map(c=>({...c,selected:c.date===p.date}))});
      } catch(e) {this.setData({formError:true});wx.showModal({title:"无法编辑",content:e.message||"请返回详情重试",showCancel:false});}
    } else {
      // 新建（含「再约一次」/首页带参）：预填白名单清洗。日期非法/过期/超范围时
      // 回落到有效推荐时段并显式提示，不静默沿用旧日期；联系方式与集合点不复制。
      const pre=sanitizePrefill({skillTags:options.skillTags,climbType:options.climbType,atmosphere:options.atmosphere,capacity:options.capacity,joinMode:options.joinMode,date}, new Date());
      // 时段：「再约一次」带参优先；否则按推荐时间区间推断；所选时段今天已过期则推荐下一个可约时段
      const optSlots=[...new Set(String(options.timeSlots||"").split(",").map(s=>s.trim()).filter(k=>TIME_SLOT_KEYS.includes(k)))];
      let slots=optSlots.length?optSlots:rangeToSlots(pre.startTime,pre.endTime);
      let initDate=pre.date;
      let range=slotsToRange(slots);
      const slotCheck=validateSlot({date:initDate,startTime:range.startTime,endTime:range.endTime},new Date());
      if(!slotCheck.ok&&(slotCheck.code==="NOT_STARTED"||slotCheck.code==="DATE_PAST")){
        const sug=suggestedSlots(new Date());
        slots=sug.timeSlots;
        initDate=sug.date;
        range=slotsToRange(slots);
      }
      const patch={selectedDate:initDate,startTime:range.startTime,endTime:range.endTime,timeSlots:slots,timeSlotOptions:this.data.timeSlotOptions.map(o=>({...o,on:slots.includes(o.key)})),timeQuickKey:"custom",dateCells:cells.map(c=>({...c,selected:c.date===initDate}))};
      if(pre.skillTags) patch.skillTags=this.data.skillTags.map(t=>({...t,on:pre.skillTags.includes(t.key)}));
      if(pre.atmosphereTags) patch.atmosphereTags=pre.atmosphereTags;
      if(pre.capacity!=null) patch.capacity=pre.capacity;
      if(pre.joinMode) patch.joinMode=pre.joinMode;
      this.setData(patch);
      if(pre.dateAdjusted) wx.showToast({title:"预填日期不可用，已推荐最近可约时段",icon:"none"});
    }
    this.setData({formLoading:false});
    this.recomputeDuration();
    this.refreshDateLabel();
    this.refreshSettingsSummary();
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
    // 二轮：允许未选岩馆取消返回表单，发布时再提示缺馆，不把用户困在弹层
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

  // 二轮：14 天横滑日期条（每格带星期），范围与校验仍由 validateSlot 兜底
  onPickDate(e) {
    const date = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.date) || "";
    if (!date || date === this.data.selectedDate) return;
    this.setData({
      selectedDate: date,
      dateLabelText: this.dateLabelFor(date),
      conflictText: "",
      conflictSlots: [],
      dateCells: this.data.dateCells.map(c => ({ ...c, selected: c.date === date }))
    });
  },

  // ---- 时段：上午/下午/晚上多选，startTime/endTime 由并集推导 ----
  onToggleTimeSlot(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!TIME_SLOT_KEYS.includes(key)) return;
    let slots = (this.data.timeSlots || []).slice();
    slots = slots.includes(key) ? slots.filter(k => k !== key) : slots.concat(key);
    this.syncTimeSlots(slots);
  },

  // 规范化时段顺序并同步派生时间/标签选中态
  syncTimeSlots(slots) {
    const uniq = [];
    (slots || []).forEach(k => { if (TIME_SLOT_KEYS.includes(k) && !uniq.includes(k)) uniq.push(k); });
    uniq.sort((a, b) => TIME_SLOT_KEYS.indexOf(a) - TIME_SLOT_KEYS.indexOf(b));
    const range = slotsToRange(uniq);
    this.setData({
      timeSlots: uniq,
      startTime: range.startTime,
      endTime: range.endTime,
      conflictText: "",
      conflictSlots: [],
      timeSlotOptions: this.data.timeSlotOptions.map(o => ({ ...o, on: uniq.includes(o.key) }))
    });
    return uniq;
  },

  refreshDateLabel() {
    this.setData({ dateLabelText: this.dateLabelFor(this.data.selectedDate) });
  },

  // 「明天 · 9月11日 周五」；非今/明显示「周五 · 9月12日」
  dateLabelFor(ymd) {
    const d = parseYMD(ymd);
    if (!d) return "";
    const weekday = WEEK_SHORT[d.getDay()];
    const md = `${d.getMonth() + 1}月${d.getDate()}日`;
    const today = todayYMD();
    const tomorrow = todayYMD(addDays(new Date(), 1));
    if (ymd === today) return `今天 · ${md} 周${weekday}`;
    if (ymd === tomorrow) return `明天 · ${md} 周${weekday}`;
    return `周${weekday} · ${md}`;
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
    const cap=Number(this.data.capacity);
    if(!Number.isInteger(cap)||cap<2||cap>12) {
      wx.showToast({ title: "总人数需为 2–12 人（含发起人）", icon: "none" });
      return;
    }
    // 时段：至少选一个；startTime/endTime 由所选时段并集推导
    const slots=(this.data.timeSlots||[]).filter(k=>TIME_SLOT_KEYS.includes(k));
    if(!slots.length){wx.showToast({title:"请选择活动时段（上午/下午/晚上）",icon:"none"});return;}
    const range=slotsToRange(slots);
    // 提交前重新校验：页面可能停留到时段过期。过期时先推荐下一个可约时段并请用户确认，
    // 不静默改期后直接提交；其余非法值直接拦截。
    const slot=validateSlot({date:this.data.selectedDate,startTime:range.startTime,endTime:range.endTime},new Date());
    if(!slot.ok) {
      if(slot.code==="NOT_STARTED"||slot.code==="DATE_PAST") {
        if(this.data.planId) { wx.showToast({title:"该时段已开始或已过期，请返回详情查看",icon:"none"}); return; }
        const sug=suggestedSlots(new Date());
        const dayLabel=sug.date===todayYMD()?"今天":"明天";
        const useSuggestion=await new Promise(resolve=>{
          wx.showModal({title:"时段需要更新",content:`所选时段已过期，是否改用${dayLabel} ${timeSlotText(sug.timeSlots)}？`,confirmText:"改用推荐",cancelText:"返回修改",success:r=>resolve(!!r.confirm),fail:()=>resolve(false)});
        });
        if(!useSuggestion) return;
        const sugRange=slotsToRange(sug.timeSlots);
        this.setData({selectedDate:sug.date,timeSlots:sug.timeSlots,startTime:sugRange.startTime,endTime:sugRange.endTime,timeSlotOptions:this.data.timeSlotOptions.map(o=>({...o,on:sug.timeSlots.includes(o.key)})),dateLabelText:this.dateLabelFor(sug.date),dateCells:this.data.dateCells.map(c=>({...c,selected:c.date===sug.date}))});
      } else {
        const msgs={DATE_INVALID:"日期无效",DATE_TOO_FAR:"仅支持未来 14 天内的计划",TIME_INVALID:"时间格式错误",TIME_ORDER:"结束时间需晚于开始时间",DURATION_SHORT:"时间段至少 30 分钟",DURATION_LONG:"单次计划最多 12 小时"};
        wx.showToast({title:msgs[slot.code]||"请检查发布时间",icon:"none"});
        return;
      }
    }
    const skillTags = this.data.skillTags.filter((x) => x.on).map((x) => x.key);
    if(!skillTags.some(x=>x!=="protector")){wx.showToast({title:"请选择攀爬类型",icon:"none"});return;}
    // 提交用时时段：timeSlots 为用户选择，startTime/endTime 为其并集（服务端校验口径不变）
    const submitSlots=this.data.timeSlots||[];
    const submitRange=slotsToRange(submitSlots);
    // issue #27: 云函数 calendar_plan_publish 读 event.payload.date 等嵌套字段，
    // action 读 event 顶层 → 这里包一层 payload（原来平铺导致云端 payload={} 报缺 date）
    const payload = {
      action: this.data.planId ? "update" : "create",
      planId: this.data.planId,
      payload: {
        version:this.data.version,title:this.data.title,capacity:Number(this.data.capacity),joinMode:this.data.joinMode,atmosphereTags:this.data.atmosphereTags,meetingPoint:this.data.meetingPoint,contact:this.data.contact,
        mode: "gym",
        date: this.data.selectedDate,
        startTime: submitRange.startTime,
        endTime: submitRange.endTime,
        timeSlots: submitSlots,
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
      const code = e && e.code;
      if (code === "SCHEDULE_CONFLICT") {
        // 保留已选日期/时段，在时段区就地反馈；只说日期+时段名，不显示钟点
        const info = e.conflict || {};
        const slotKeys = Array.isArray(info.slots) ? info.slots.filter(k => TIME_SLOT_KEYS.includes(k)) : [];
        this.setData({ conflictText: e.message || "该时段你已有约爬", conflictSlots: slotKeys });
        wx.showToast({ title: "该时段已有约爬", icon: "none" });
      } else if (code === "PLAN_TIME_LOCKED") {
        wx.showModal({ title: "暂不能修改时间", content: (e && e.message) || "已有岩友报名或待审批，暂不能修改时间", showCancel: false });
      } else if (code === "SCHEDULE_MAINTENANCE") {
        wx.showModal({ title: "约爬系统维护中", content: (e && e.message) || "暂时不能发起，请稍后再试", showCancel: false });
      } else {
        wx.showModal({ title: "暂未保存", content: (e && e.message) || "请稍后重试", showCancel: false });
      }
    } finally {this.setData({submitting:false});}
  },
  onField(e){const key=e.currentTarget.dataset.key;if(["title","capacity","meetingPoint","contact"].includes(key))this.setData({[key]:e.detail.value});},
  onApproval(e){this.setData({joinMode:e.detail.value?"approval":"direct"});},
  onAtmosphere(e){const value=e.currentTarget.dataset.value;let tags=this.data.atmosphereTags||[];tags=tags.includes(value)?tags.filter(x=>x!==value):tags.concat(value).slice(0,3);this.setData({atmosphereTags:tags});},

  // ---- 二轮：总人数步进器（2–12；编辑时下限不低于已确认人数，服务端限制不变） ----
  onCapacityMinus(){
    const min=Number(this.data.capacityMin)||2;
    let c=Number(this.data.capacity)||4;
    if(c<=min)return;
    this.setData({capacity:c-1});
  },
  onCapacityPlus(){
    let c=Number(this.data.capacity)||4;
    if(c>=12)return;
    this.setData({capacity:c+1});
  },

  // ---- 选填折叠区：展开自动聚焦，数据始终保留在表单 ----
  toggleNote(){this.setData({noteOpen:!this.data.noteOpen});},
  toggleContact(){this.setData({contactOpen:!this.data.contactOpen});},

  // ---- 设置弹层：打开拷贝草稿，取消不改，完成才应用 ----
  openSettings(){
    this.setData({
      settingsOpen:true,
      dTitle:this.data.title||"",
      dAtmosphereTags:(this.data.atmosphereTags||[]).slice(),
      dProtector:this.data.skillTags.some(t=>t.key==="protector"&&t.on),
      dVisibility:this.data.visibility,
      dJoinMode:this.data.joinMode,
      dVisibilityHint:this.visibilityHintFor(this.data.visibility)
    });
  },
  closeSettings(){this.setData({settingsOpen:false});},
  onDraftTitle(e){this.setData({dTitle:(e&&e.detail&&e.detail.value)||""});},
  onDraftVisibilityChange(e){
    const v=(e&&e.detail&&e.detail.value)||"public";
    this.setData({dVisibility:v,dVisibilityHint:this.visibilityHintFor(v)});
  },
  onDraftApproval(e){this.setData({dJoinMode:e.detail.value?"approval":"direct"});},
  onToggleDraftAtmosphere(e){
    const value=e.currentTarget.dataset.value;
    let tags=(this.data.dAtmosphereTags||[]).slice();
    tags=tags.includes(value)?tags.filter(x=>x!==value):tags.concat(value).slice(0,3);
    this.setData({dAtmosphereTags:tags});
  },
  onToggleDraftProtector(e){this.setData({dProtector:!!(e&&e.detail&&e.detail.value)});},
  applySettings(){
    const v=this.data.dVisibility;
    const nextTitle=this.data.dTitle;
    const nextAtmosphereTags=this.data.dAtmosphereTags;
    const nextJoinMode=this.data.dJoinMode;
    const nextProtector=this.data.dProtector;
    this.setData({
      settingsOpen:false,
      title:nextTitle,
      atmosphereTags:nextAtmosphereTags,
      visibility:v,
      joinMode:nextJoinMode,
      // 沿用原联动：公开时保留求搭子标记，非公开关闭
      needPartner:v==="public",
      skillTags:this.data.skillTags.map(t=>t.key==="protector"?{...t,on:nextProtector}:t)
    });
    // setData 异步完成后再依据已应用值计算摘要，避免点击“完成”后摘要落后一拍。
    this.setData({
      settingsSummary:`${({public:"公开",friends:"仅岩友可见",circle:"仅岩友圈可见"}[v]||"公开")} · ${nextJoinMode==="approval"?"需发起人确认":"直接加入"}`,
      settingsExtra:[
        nextTitle?"已设标题":"",
        nextAtmosphereTags.length?"氛围 "+nextAtmosphereTags.join("·"):"",
        nextProtector?"需要保护员":""
      ].filter(Boolean).join(" · ")
    });
  },

  // 设置摘要：公开/范围 + 报名方式；非默认低频项有值时副行提示
  refreshSettingsSummary(){
    const visLabel={public:"公开",friends:"仅岩友可见",circle:"仅岩友圈可见"}[this.data.visibility]||"公开";
    const joinLabel=this.data.joinMode==="approval"?"需发起人确认":"直接加入";
    const extra=[];
    if(this.data.title) extra.push("已设标题");
    if((this.data.atmosphereTags||[]).length) extra.push("氛围 "+this.data.atmosphereTags.join("·"));
    if(this.data.skillTags.some(t=>t.key==="protector"&&t.on)) extra.push("需要保护员");
    this.setData({settingsSummary:`${visLabel} · ${joinLabel}`,settingsExtra:extra.join(" · ")});
  },

  // v2：底部弹层用 catchtap 阻止冒泡，空 handler 仅作事件占位
  noop(){}
});
