// Discovery is deliberately a compact public projection. Never return raw plan documents.
function publicPlan(p) {
  const endAt=Number(p.endAt) || Date.parse(`${p.date}T${p.endTime}:00+08:00`);
  return {
    _id:p._id,title:p.title || "一起爬，认识新岩友",date:p.date,startTime:p.startTime,endTime:p.endTime,
    startAt:Number(p.startAt) || Date.parse(`${p.date}T${p.startTime}:00+08:00`),endAt,
    gymId:p.gymId || "",gymName:(p.gymSnapshot||{}).name || p.outdoorName || "攀岩馆",
    city:(p.gymSnapshot||{}).city || "",skillTags:p.skillTags || [],atmosphereTags:p.atmosphereTags || [],
    capacity:p.capacity || null,confirmedCount:Number(p.confirmedCount || 1),joinMode:p.joinMode || "direct",
    // 报名截止时间戳；旧数据缺失/为 0 时按结束时间兜底，与服务端 join 校验 joinDeadline||endAt 同一口径
    joinDeadline:Number(p.joinDeadline) || endAt,isFull:p.isFull === true,
    ownerId:p.openid || p._openid || p.uid || "",user:p.userSnapshot || {}
  };
}
function legacyPlan(p) {
  const out = {};
  for (const key of ["_id","openid","_openid","uid","date","startTime","endTime","gymId","gymSnapshot","mode","outdoorName","visibility","note","needPartner","skillTags","status","title","capacity","confirmedCount","joinMode"]) {
    if (p[key] !== undefined) out[key] = p[key];
  }
  const snapshot = p.userSnapshot || {};
  out.userSnapshot = {};
  for(const key of ["nickName","avatarUrl","displayName","title","rockId"]) if(typeof snapshot[key] === "string") out.userSnapshot[key] = snapshot[key];
  return out;
}
async function discover({db,cloud,event,openid}) {
  const _=db.command;
  const now=new Date(Date.now()+8*3600000).toISOString();
  const today=now.slice(0,10), hm=now.slice(11,16);
  const start=String(event.startDate || today), end=String(event.endDate || new Date(Date.now()+8*3600000+13*86400000).toISOString().slice(0,10));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end<start || Date.parse(end)-Date.parse(start)>13*86400000) throw new Error("日期范围应在 14 天内");
  const parts=[{status:"active",visibility:"public"},{date:_.gte(start)},{date:_.lte(end)},_.or([{date:_.gt(today)},{date:today,endTime:_.gt(hm)}])];
  const city=String(event.city || "").trim().replace(/市$/,"");
  if(city) parts.push(_.or([{cityKey:city},{"gymSnapshot.city":_.in([city,city+"市"])}]));
  if(event.gymId) parts.push({gymId:String(event.gymId)});
  if(event.climbType) parts.push({skillTags:String(event.climbType)});
  // 「可报名」与服务端 join_plan 校验保持同一口径：未截止（joinDeadline>now，旧数据缺字段按结束时间兜底）
  // 且未满员。审批活动满员时服务端同样拒绝（PLAN_FULL），所以满员不计入可报名。
  const nowMs=Date.now();
  // Keep the query contract aligned with join_plan: null/0/missing deadlines
  // fall back to endAt (the active/date filter already excludes ended slots).
  const openDeadline=_.or([{joinDeadline:_.gt(nowMs)},{joinDeadline:_.exists(false)},{joinDeadline:null},{joinDeadline:0}]);
  const closedDeadline=_.and([{joinDeadline:_.exists(true)},{joinDeadline:_.neq(null)},{joinDeadline:_.neq(0)},{joinDeadline:_.lte(nowMs)}]);
  const joinableWhere=_.and([{isFull:_.neq(true)},openDeadline]);
  const closedWhere=_.or([{isFull:true},closedDeadline]);
  if(event.onlyAvailable) parts.push(joinableWhere);
  if(openid) {
    const denied=[];
    for(let skip=0;;skip+=100) {
      const r=await db.collection("RockUserBlocks").where(_.or([{openid},{targetOpenid:openid}])).skip(skip).limit(100).get();
      r.data.forEach(b=>denied.push(b.openid===openid?b.targetOpenid:b.openid));
      if(r.data.length<100) break;
    }
    if(denied.length) for(const key of ["openid","_openid","uid"]) parts.push({[key]:_.nin(denied)});
  }
  // 「可加入优先」必须在查询层分段排序，禁止只对单页结果排序：
  // 段0=可报名（未截止且未满员），段1=其余（满员/已截止）；每段内部按 date/startTime/_id 升序键集分页。
  // 游标 [seg,date,startTime,_id]；空元组表示从该段开头开始。
  let seg=0, cDate="", cStart="", cId="";
  if(event.cursor) {
    let c;
    try { c=JSON.parse(String(event.cursor)); } catch (_) { throw new Error("分页参数无效，请刷新"); }
    // 兼容旧版三段游标 [date,startTime,_id]，视为段0
    if(Array.isArray(c)&&c.length===3&&c.every(x=>typeof x==="string")) c=["0",c[0],c[1],c[2]];
    if(!Array.isArray(c)||c.length!==4||c.slice(1).some(x=>typeof x!=="string")) throw new Error("分页参数无效，请刷新");
    seg=Number(c[0])||0; cDate=c[1]; cStart=c[2]; cId=c[3];
  }
  const limit=20;
  const maxSeg=event.onlyAvailable ? 0 : 1;
  const keyset=d => d ? _.or([{date:_.gt(d.date)},{date:d.date,startTime:_.gt(d.startTime)},{date:d.date,startTime:d.startTime,_id:_.gt(d._id)}]) : null;
  const raw=[];
  let nextCursor="", hasMore=false;
  for(let s=Math.max(0,seg); s<=maxSeg && raw.length<limit; s++) {
    const need=limit-raw.length;
    const segParts=parts.concat([s===0?joinableWhere:closedWhere]);
    if(s===seg && cDate) segParts.push(keyset({date:cDate,startTime:cStart,_id:cId}));
    const r=await db.collection("RockCalendarPlans").where(_.and(segParts)).orderBy("date","asc").orderBy("startTime","asc").orderBy("_id","asc").limit(need+1).get();
    const rows=r.data;
    raw.push(...rows.slice(0,need));
    if(rows.length>need) {
      hasMore=true;
      const last=raw[raw.length-1];
      nextCursor=JSON.stringify([String(s),last.date,last.startTime,last._id]);
      break;
    }
    if(s<maxSeg) { hasMore=true; nextCursor=JSON.stringify([String(s+1),"","",""]); }
    else { hasMore=false; nextCursor=""; }
  }
  const list=raw.map(publicPlan);
  const ids=[...new Set(list.map(p=>p.ownerId).filter(Boolean))];
  const users={};
  if(ids.length) {
    const u=await db.collection("RockUsers").where(_.or([{openid:_.in(ids)},{_openid:_.in(ids)},{uid:_.in(ids)}])).limit(100).get();
    u.data.forEach(x=>{for(const key of [x.openid,x._openid,x.uid]) if(key) users[key]=x;});
  }
  const avatars={};
  list.forEach(p=>{
    const u=users[p.ownerId] || p.user || {};
    // Whitelist both snapshot and current user fields; contact details never leave this endpoint.
    p.user={displayName:u.displayName || u.nickName || "岩友",avatarUrl:u.avatarUrl || "",climbSkills:u.climbSkills || {}};
  });
  const fileList=[...new Set(list.map(p=>p.user.avatarUrl).filter(v=>String(v).startsWith("cloud://")))];
  if(fileList.length) {
    const files=await cloud.getTempFileURL({fileList});
    (files.fileList||[]).forEach(f=>{if(f.tempFileURL) avatars[f.fileID]=f.tempFileURL;});
  }
  list.forEach(p=>{if(String(p.user.avatarUrl).startsWith("cloud://"))p.user.avatarUrl=avatars[p.user.avatarUrl] || "";});
  return {list,hasMore,cursor:hasMore?nextCursor:""};
}
module.exports={discover,publicPlan,legacyPlan};
