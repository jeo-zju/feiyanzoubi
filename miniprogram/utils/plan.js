const TYPE_LABELS = { boulder: "抱石", lead: "先锋", toprope: "顶绳", auto: "自动锁", protector: "求保护员" };
// 预填白名单：再约一次/首页带参只接受这些值，未知类型不得清掉页面默认有效类型
const PREFILL_SKILLS = ["boulder", "lead", "toprope", "auto"];
const PREFILL_ATMOSPHERE = ["欢迎新手", "休闲爬", "认真训练"];
const CAPACITY_MIN = 2, CAPACITY_MAX = 12, MAX_DAY_SPAN = 13;
// 时间签展示字段：周六 · 09.12（纯展示，业务日期仍用 p.date）
const WEEK_LABELS=["周日","周一","周二","周三","周四","周五","周六"];
// 时段模型：上午/下午/晚上可多选，不指定具体时间。startTime/endTime 始终由所选时段
// 并集推导（最早开始–最晚结束），服务端既有时间校验与截止逻辑不变。
const TIME_SLOT_DEFS=[
  {key:"morning",label:"上午",start:"10:00",end:"14:00"},
  {key:"afternoon",label:"下午",start:"14:00",end:"18:00"},
  {key:"evening",label:"晚上",start:"18:00",end:"22:00"}
];
const TIME_SLOT_KEYS=TIME_SLOT_DEFS.map(d=>d.key);
function slotsToRange(slots){
  const picked=TIME_SLOT_DEFS.filter(d=>(slots||[]).indexOf(d.key)>=0);
  if(!picked.length) return {startTime:"",endTime:""};
  const s=Math.min.apply(null,picked.map(d=>hmToMin(d.start)));
  const e=Math.max.apply(null,picked.map(d=>hmToMin(d.end)));
  return {startTime:pad2(Math.floor(s/60))+":"+pad2(s%60),endTime:pad2(Math.floor(e/60))+":"+pad2(e%60)};
}
// 旧数据/预填：按时间区间与各时段的重叠推断所选时段
function rangeToSlots(startTime,endTime){
  const s=hmToMin(startTime),e=hmToMin(endTime);
  if(s==null||e==null||e<=s) return [];
  return TIME_SLOT_DEFS.filter(d=>{
    const ds=hmToMin(d.start),de=hmToMin(d.end);
    return Math.min(e,de)-Math.max(s,ds)>0;
  }).map(d=>d.key);
}
function timeSlotText(slots){
  const uniq=[];
  (slots||[]).forEach(k=>{if(TIME_SLOT_KEYS.indexOf(k)>=0&&uniq.indexOf(k)<0)uniq.push(k);});
  if(!uniq.length) return "";
  if(uniq.length===TIME_SLOT_KEYS.length) return "全天";
  uniq.sort((a,b)=>TIME_SLOT_KEYS.indexOf(a)-TIME_SLOT_KEYS.indexOf(b));
  return uniq.map(k=>TIME_SLOT_DEFS.find(d=>d.key===k).label).join(" · ");
}
// 推荐下一个可约时段：今天取第一个开始时间尚在未来的时段；今天没有则明天晚上
function suggestedSlots(now){
  now=now||new Date();
  const base=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const cur=now.getHours()*60+now.getMinutes();
  const todaySlot=TIME_SLOT_DEFS.find(d=>hmToMin(d.start)>cur);
  if(todaySlot) return {date:dateKey(base),timeSlots:[todaySlot.key]};
  return {date:dateKey(addDaysLocal(base,1)),timeSlots:["evening"]};
}
function ticketParts(dateStr) {
  const d=parseYMD(dateStr);
  if(!d) return {weekdayText:"",mdText:""};
  return {weekdayText:WEEK_LABELS[d.getDay()],mdText:pad2(d.getMonth()+1)+"."+pad2(d.getDate())};
}
function decorate(p) {
  const user=p.user || {};
  const skill=user.climbSkills || {};
  const skills=Object.keys(skill).filter(k=>k !== "protector" && skill[k]).map(k=>String(skill[k])).join(" · ");
  const count=Number(p.confirmedCount || p.joinedCount || 1);
  const full=p.isFull === true || (!!p.capacity && count>=p.capacity);
  // 报名截止时间：服务端 joinDeadline 缺失/为 0 时按结束时间兜底，与云端 join_plan 校验口径一致
  const deadline=Number(p.joinDeadline) || Number(p.endAt) || 0;
  const joinClosed=!!deadline && deadline<=Date.now();
  const joinable=!full && !joinClosed;
  const ticket=ticketParts(p.date);
  return {...p,typeText:(p.skillTags||[]).map(k=>TYPE_LABELS[k]||k).join(" · ")||"一起攀岩",atmosphereText:(p.atmosphereTags||[]).join(" · "),skillText:skills?"常爬 "+skills:"欢迎认识新岩友",countText:p.capacity?"已有 "+count+" 人 · "+(full?"已满员":joinClosed?"报名已截止":"还可加入 "+(p.capacity-count)+" 人"):"已有 "+count+" 人",
    // v2 展示字段（增量，不改写上述业务文案）：时间签 + 座位状态
    weekdayText:ticket.weekdayText,mdText:ticket.mdText,
    timeSlotText:timeSlotText(p.timeSlots),
    seatsText:p.capacity?count+"/"+p.capacity+" 人":count+" 人",
    seatsNote:full?"已满员":joinClosed?"报名已截止":p.capacity?"还可加入 "+(p.capacity-count)+" 人":"",
    // 二轮样板：卡片右侧两行文案（主：名额/状态；副：剩余提示或查看入口）。未知上限不猜容量。
    seatsMain:full?"名额已满":joinClosed?"报名已截止":p.capacity?count+"/"+p.capacity+" 人":"已有 "+count+" 人",
    seatsSub:full||joinClosed?"查看约爬 ›":p.capacity?"还可加入 "+(p.capacity-count)+" 人":"查看约爬 ›",
    stateKey:full?"full":joinClosed?"closed":"open",
    full,joinClosed,joinable};
}
function pad2(n) { return n < 10 ? "0" + n : String(n); }
function dateKey(d) { return [d.getFullYear(),pad2(d.getMonth()+1),pad2(d.getDate())].join("-"); }
function parseYMD(ymd) {
  const m=String(ymd||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return null;
  const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
  if(d.getFullYear()!==Number(m[1])||d.getMonth()!==Number(m[2])-1||d.getDate()!==Number(m[3])) return null;
  return d;
}
function hmToMin(hm) {
  const m=String(hm||"").match(/^(\d{2}):(\d{2})$/);
  if(!m) return null;
  const h=Number(m[1]),mm=Number(m[2]);
  if(h<0||h>23||mm<0||mm>59) return null;
  return h*60+mm;
}
function addDaysLocal(d,n) { const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()+n); return x; }
// 提交前统一校验：合法 YMD/HH:mm、今天起 14 天内、未开始、结束晚于开始、30 分钟至 12 小时、不跨日
function validateSlot(input, now) {
  now = now || new Date();
  const fail = code => ({ok:false,code});
  const date=String((input&&input.date)||"");
  const s=hmToMin(input&&input.startTime), e=hmToMin(input&&input.endTime);
  if(!parseYMD(date)) return fail("DATE_INVALID");
  if(s==null||e==null) return fail("TIME_INVALID");
  const today=dateKey(new Date(now.getFullYear(),now.getMonth(),now.getDate()));
  const maxDate=dateKey(addDaysLocal(new Date(now.getFullYear(),now.getMonth(),now.getDate()),MAX_DAY_SPAN));
  if(date<today) return fail("DATE_PAST");
  if(date>maxDate) return fail("DATE_TOO_FAR");
  if(e<=s) return fail("TIME_ORDER");
  const dur=e-s;
  if(dur<30) return fail("DURATION_SHORT");
  if(dur>12*60) return fail("DURATION_LONG");
  const startAt=Date.parse(date+"T"+String(input.startTime)+":00+08:00");
  if(!Number.isFinite(startAt)||startAt<=now.getTime()) return fail("NOT_STARTED");
  return {ok:true};
}
function sanitizeCapacity(v) {
  const n=Number(v);
  if(!Number.isInteger(n)||n<CAPACITY_MIN||n>CAPACITY_MAX) return null;
  return n;
}
// 预填清洗（再约一次/首页带参）：白名单过滤类型/氛围，人数 2–12，日期非法或超范围时
// 回落到 suggestedTime 的有效建议并标记 dateAdjusted；联系方式/集合点不在此处理（不复制）。
function sanitizePrefill(input, now) {
  now = now || new Date();
  input = input || {};
  const list = v => String(v||"").split(",").map(s=>s.trim()).filter(Boolean);
  const skills=[...new Set(list(input.skillTags||input.climbType).filter(k=>PREFILL_SKILLS.includes(k)))];
  const atmo=[...new Set(list(input.atmosphere).filter(k=>PREFILL_ATMOSPHERE.includes(k)).slice(0,3))];
  const today=dateKey(new Date(now.getFullYear(),now.getMonth(),now.getDate()));
  const maxDate=dateKey(addDaysLocal(new Date(now.getFullYear(),now.getMonth(),now.getDate()),MAX_DAY_SPAN));
  const rawDate=String(input.date||"");
  const dateValid=!!parseYMD(rawDate)&&rawDate>=today&&rawDate<=maxDate;
  const sug=suggestedTime(dateValid?rawDate:undefined,now);
  return {
    date:sug.date, startTime:sug.startTime, endTime:sug.endTime, dateAdjusted:!dateValid,
    skillTags:skills.length?skills:null,
    atmosphereTags:atmo.length?atmo:null,
    capacity:sanitizeCapacity(input.capacity),
    joinMode:input.joinMode==="approval"?"approval":null
  };
}
// 翻页合并去重：实时列表合同下，计划在页间改变分段（满员/截止/取消报名）可能被服务端
// 再次返回；客户端按 _id 去重防重复。状态变化导致的漏项由下拉/返回刷新补齐。
function mergeListById(oldList,newList) {
  const seen=new Set(), out=[];
  (Array.isArray(oldList)?oldList:[]).concat(Array.isArray(newList)?newList:[]).forEach(x=>{
    if(x&&x._id!=null&&!seen.has(x._id)){seen.add(x._id);out.push(x);}
  });
  return out;
}
function range(key, now=new Date()) {
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()), end=new Date(start);
  if(key === "tomorrow") {start.setDate(start.getDate()+1);end.setDate(end.getDate()+1);}
  else if(key === "weekend") {const day=start.getDay();start.setDate(start.getDate()+(day===0?0:(6-day+7)%7));end.setTime(start.getTime());if(day!==0)end.setDate(end.getDate()+1);}
  else if(key !== "today") end.setDate(end.getDate()+13);
  return {startDate:dateKey(start),endDate:dateKey(end)};
}
function suggestedTime(date, now=new Date()) {
  let target=date || dateKey(now), hour=19;
  if(target===dateKey(now))hour=Math.max(6,now.getHours()+1);
  if(hour>21) {const next=new Date(now);next.setDate(next.getDate()+1);target=dateKey(next);hour=19;}
  return {date:target,startTime:String(hour).padStart(2,"0")+":00",endTime:String(hour+2).padStart(2,"0")+":00"};
}
module.exports={decorate,range,dateKey,suggestedTime,TYPE_LABELS,PREFILL_SKILLS,PREFILL_ATMOSPHERE,CAPACITY_MIN,CAPACITY_MAX,validateSlot,sanitizePrefill,sanitizeCapacity,mergeListById,TIME_SLOT_DEFS,TIME_SLOT_KEYS,slotsToRange,rangeToSlots,timeSlotText,suggestedSlots};
