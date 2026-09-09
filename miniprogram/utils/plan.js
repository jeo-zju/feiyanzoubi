const TYPE_LABELS = { boulder: "抱石", lead: "先锋", toprope: "顶绳", auto: "自动锁", protector: "求保护员" };
function decorate(p) {
  const user=p.user || {};
  const skill=user.climbSkills || {};
  const skills=Object.keys(skill).filter(k=>k !== "protector" && skill[k]).map(k=>String(skill[k])).join(" · ");
  const count=Number(p.confirmedCount || p.joinedCount || 1);
  const full=p.isFull === true || (!!p.capacity && count>=p.capacity);
  // 报名截止时间：服务端 joinDeadline 缺失时按开场时间兜底，与云端 join_plan 校验口径一致
  const deadline=Number(p.joinDeadline) || Number(p.endAt) || 0;
  const joinClosed=!!deadline && deadline<=Date.now();
  const joinable=!full && !joinClosed;
  return {...p,typeText:(p.skillTags||[]).map(k=>TYPE_LABELS[k]||k).join(" · ")||"一起攀岩",atmosphereText:(p.atmosphereTags||[]).join(" · "),skillText:skills?"常爬 "+skills:"欢迎认识新岩友",countText:p.capacity?"已有 "+count+" 人 · "+(full?"已满员":joinClosed?"报名已截止":"还可加入 "+(p.capacity-count)+" 人"):"已有 "+count+" 人",full,joinClosed,joinable};
}
function dateKey(d) { return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-"); }
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
module.exports={decorate,range,dateKey,suggestedTime,TYPE_LABELS};
