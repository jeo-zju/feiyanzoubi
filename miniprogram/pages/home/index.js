const {callCloud}=require("../../services/cloud");
const {range,decorate,mergeListById,dateKey}=require("../../utils/plan");
const {ensureAppLogin}=require("../../utils/session");
const gymApi=require("../../services/api/gym");
Page({
  data:{city:"",citySheetVisible:false,cityOptions:["杭州","上海","北京","深圳","广州","成都","南京","武汉","自定义城市…"].map(n=>({name:n,custom:n==="自定义城市…"})),dateTab:"recent",dateTabs:[{key:"recent",label:"近期"},{key:"today",label:"今天"},{key:"tomorrow",label:"明天"},{key:"weekend",label:"周末"}],type:"",typeLabels:["全部类型","抱石","顶绳","先锋","自动锁"],typeIndex:0,gymId:"",gymName:"全部岩馆",list:[],loading:false,error:"",hasMore:false,cursor:"",onlyAvailable:false,gymPicker:false,gymKeyword:"",gyms:[],gymPage:0,gymHasMore:false,gymLoading:false,filterSheetVisible:false,draftTypeIndex:0,draftOnlyAvailable:false,filterCount:0},
  onLoad(){const app=getApp();let city="";try{city=wx.getStorageSync("home_city")||"";}catch(_){}city=city||(app.globalData.me||{}).city||"杭州";this.setData({city});},
  onShow(){this.refreshIfNeeded();},
  onUnload(){this._token=(this._token||0)+1;clearTimeout(this._searchTimer);},
  onShareAppMessage(){return {title:"一起爬，认识新岩友｜飞岩走壁",path:"/pages/home/index"};},
  onReachBottom(){if(this.data.hasMore&&!this.data.loading)this.load(false);},
  async onPullDownRefresh(){try{await this.load(true,{preserveList:true});}finally{wx.stopPullDownRefresh();}},
  // 返回首页缓存合同：同一用户/筛选/日期范围且 30 秒内、无写操作置脏时保留列表不重复请求；
  // 首次进入、筛选切换、跨午夜、切用户、数据过期或发布/报名写后置脏才刷新；刷新时保留旧列表可读。
  filterSignature(){
    try{
      const me=(getApp().globalData&&getApp().globalData.me)||{};
      return [dateKey(new Date()),this.data.city,this.data.dateTab,this.data.type,this.data.gymId,this.data.onlyAvailable?"1":"0",me.openid||""].join("|");
    }catch(_){return "sig-"+Date.now();}
  },
  async refreshIfNeeded(force){
    const sig=this.filterSignature();
    const first=!this._loadedOnce;
    const sigChanged=this._lastSig!==sig;
    const fresh=!!this._lastLoadAt && Date.now()-this._lastLoadAt<30000;
    let dirty=false;
    try{dirty=!!(getApp().globalData&&getApp().globalData.plansDirty);}catch(_){}
    if(force||first||sigChanged||!fresh||dirty){
      await this.load(true,{preserveList:!first&&!sigChanged});
    }
  },
  async load(reset,opts){
    opts=opts||{};
    if(!reset&&this.data.loading)return;
    const token=this._token=(this._token||0)+1;
    const params={mode:"discover",city:this.data.city,...range(this.data.dateTab),climbType:this.data.type,gymId:this.data.gymId,onlyAvailable:this.data.onlyAvailable,cursor:reset?"":this.data.cursor};
    this.setData({loading:true,error:"",...(reset&&!opts.preserveList?{list:[],cursor:"",hasMore:false}:{})});
    try{
      const r=await callCloud("calendar_query",params,{silent:true});
      if(token!==this._token)return;
      const incoming=(r.list||[]).map(decorate);
      const list=reset?incoming:mergeListById(this.data.list,incoming);
      this._lastLoadAt=Date.now();
      this.setData({list,hasMore:!!r.hasMore,cursor:r.cursor||""});
      this._lastSig=this.filterSignature();
      this._loadedOnce=true;
      // 脏标记仅在刷新成功后消费；弱网失败时保留，下次 onShow 自动重试
      try{const app=getApp();if(app.globalData&&app.globalData.plansDirty)app.globalData.plansDirty=false;}catch(_){}
    }
    catch(e){if(token===this._token)this.setData({error:e && e.code === "BAD_MODE" ? "云端约爬功能尚未更新，请重新上传 calendar_query 云函数" : "暂时没能加载约爬，请重试"});}
    finally{if(token===this._token)this.setData({loading:false});}
  },
  retry(){this.load(this.data.list.length===0);},
  pickDate(e){this.setData({dateTab:e.detail.value});this.load(true);},
  pickType(e){const index=Number(e.detail.value);this.setData({typeIndex:index,type:["","boulder","toprope","lead","auto"][index]});this.load(true);},
  toggleAvailable(e){this.setData({onlyAvailable:!!e.detail.value});this.load(true);},
  chooseCity(){this.openCitySheet();},
  openCitySheet(){this.setData({citySheetVisible:true});},
  closeCitySheet(){this.setData({citySheetVisible:false});},
  onPickCity(e){const ds=e.currentTarget.dataset;if(ds.custom){this.setData({citySheetVisible:false});wx.showModal({title:"输入城市",editable:true,placeholderText:"如：苏州",success:r=>{if(r.confirm&&r.content.trim()){const city=r.content.trim().slice(0,30);this.setData({city,gymId:"",gymName:"全部岩馆",citySheetVisible:false});wx.setStorageSync("home_city",city);this.load(true);}}});}else{const city=ds.city;this.setData({city,gymId:"",gymName:"全部岩馆",citySheetVisible:false});wx.setStorageSync("home_city",city);this.load(true);}},
  openPlan(e){wx.navigateTo({url:"/pages/plan-detail/index?planId="+encodeURIComponent(e.currentTarget.dataset.id)});},
  async publish(){try{await ensureAppLogin();wx.navigateTo({url:"/pages/calendar-publish/index?city="+encodeURIComponent(this.data.city)+"&gymId="+encodeURIComponent(this.data.gymId)+"&date="+range(this.data.dateTab).startDate+"&climbType="+encodeURIComponent(this.data.type||"")});}catch(_){wx.showToast({title:"登录失败，请重试",icon:"none"});}},
  clearFilters(){this.setData({dateTab:"recent",gymId:"",gymName:"全部岩馆",type:"",typeIndex:0,onlyAvailable:false,draftTypeIndex:0,draftOnlyAvailable:false,filterCount:0});this.load(true);},
  // ---- 筛选弹层：打开时拷贝当前值为草稿，取消不影响列表，应用一次更新 ----
  openFilterSheet(){this.setData({filterSheetVisible:true,draftTypeIndex:this.data.typeIndex,draftOnlyAvailable:this.data.onlyAvailable});},
  closeFilterSheet(){this.setData({filterSheetVisible:false});},
  pickDraftType(e){this.setData({draftTypeIndex:Number(e.currentTarget.dataset.index)||0});},
  toggleDraftAvailable(e){this.setData({draftOnlyAvailable:!!e.detail.value});},
  resetFilterDraft(){this.setData({draftTypeIndex:0,draftOnlyAvailable:false});},
  applyFilter(){
    const index=Number(this.data.draftTypeIndex)||0;
    const type=["","boulder","toprope","lead","auto"][index]||"";
    const onlyAvailable=!!this.data.draftOnlyAvailable;
    const count=(index>0?1:0)+(onlyAvailable?1:0);
    this.setData({filterSheetVisible:false,typeIndex:index,type,onlyAvailable,filterCount:count});
    this.load(true);
  },
  calendar(){wx.navigateTo({url:"/pages/calendar-overview/index"});},
  openGym(){this.setData({gymPicker:true,gymKeyword:"",gyms:[]});this.loadGyms(true);},
  closeGym(){this.setData({gymPicker:false});},noop(){},
  searchGym(e){this.setData({gymKeyword:e.detail.value});clearTimeout(this._searchTimer);this._searchTimer=setTimeout(()=>this.loadGyms(true),300);},
  async loadGyms(reset){if(!reset&&(this.data.gymLoading||!this.data.gymHasMore))return;const token=this._gymToken=(this._gymToken||0)+1;const page=reset?1:this.data.gymPage+1;this.setData({gymLoading:true});try{const r=await gymApi.list({city:this.data.city,keyword:this.data.gymKeyword,page,pageSize:20},{loading:false,silent:true});if(token!==this._gymToken)return;this.setData({gyms:(reset?[]:this.data.gyms).concat(r.gyms||[]),gymHasMore:!!r.hasNext,gymPage:page});}catch(_){wx.showToast({title:"岩馆加载失败，请重试",icon:"none"});}finally{if(token===this._gymToken)this.setData({gymLoading:false});}},
  moreGyms(){this.loadGyms(false);},
  pickGym(e){this.setData({gymId:e.currentTarget.dataset.id||"",gymName:e.currentTarget.dataset.name||"全部岩馆",gymPicker:false});this.load(true);}
});
