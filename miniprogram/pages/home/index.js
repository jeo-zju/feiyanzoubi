const {callCloud}=require("../../services/cloud");
const {range,decorate}=require("../../utils/plan");
const {ensureAppLogin}=require("../../utils/session");
const gymApi=require("../../services/api/gym");
Page({
  data:{city:"",citySheetVisible:false,cityOptions:["杭州","上海","北京","深圳","广州","成都","南京","武汉","自定义城市…"].map(n=>({name:n,custom:n==="自定义城市…"})),dateTab:"recent",dateTabs:[{key:"recent",label:"近期"},{key:"today",label:"今天"},{key:"tomorrow",label:"明天"},{key:"weekend",label:"周末"}],type:"",typeLabels:["全部类型","抱石","顶绳","先锋","自动锁"],typeIndex:0,gymId:"",gymName:"全部岩馆",list:[],loading:false,error:"",hasMore:false,cursor:"",onlyAvailable:false,gymPicker:false,gymKeyword:"",gyms:[],gymPage:0,gymHasMore:false,gymLoading:false},
  onLoad(){const app=getApp();let city="";try{city=wx.getStorageSync("home_city")||"";}catch(_){}city=city||(app.globalData.me||{}).city||"杭州";this.setData({city});},
  onShow(){this.load(true);},
  onUnload(){this._token=(this._token||0)+1;clearTimeout(this._searchTimer);},
  onShareAppMessage(){return {title:"一起爬，认识新岩友｜飞岩走壁",path:"/pages/home/index"};},
  onReachBottom(){if(this.data.hasMore&&!this.data.loading)this.load(false);},
  async onPullDownRefresh(){try{await this.load(true);}finally{wx.stopPullDownRefresh();}},
  async load(reset){
    if(!reset&&this.data.loading)return;
    const token=this._token=(this._token||0)+1;
    const params={mode:"discover",city:this.data.city,...range(this.data.dateTab),climbType:this.data.type,gymId:this.data.gymId,onlyAvailable:this.data.onlyAvailable,cursor:reset?"":this.data.cursor};
    this.setData({loading:true,error:"",...(reset?{list:[],cursor:"",hasMore:false}:{})});
    try{const r=await callCloud("calendar_query",params,{silent:true});if(token!==this._token)return;this._lastLoadAt=Date.now();this.setData({list:(reset?[]:this.data.list).concat((r.list||[]).map(decorate)),hasMore:!!r.hasMore,cursor:r.cursor||""});}
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
  clearFilters(){this.setData({dateTab:"recent",gymId:"",gymName:"全部岩馆",type:"",typeIndex:0,onlyAvailable:false});this.load(true);},
  calendar(){wx.navigateTo({url:"/pages/calendar-overview/index"});},
  notifications(){wx.navigateTo({url:"/pages/notifications/index"});},
  openGym(){this.setData({gymPicker:true,gymKeyword:"",gyms:[]});this.loadGyms(true);},
  closeGym(){this.setData({gymPicker:false});},noop(){},
  searchGym(e){this.setData({gymKeyword:e.detail.value});clearTimeout(this._searchTimer);this._searchTimer=setTimeout(()=>this.loadGyms(true),300);},
  async loadGyms(reset){if(!reset&&(this.data.gymLoading||!this.data.gymHasMore))return;const token=this._gymToken=(this._gymToken||0)+1;const page=reset?1:this.data.gymPage+1;this.setData({gymLoading:true});try{const r=await gymApi.list({city:this.data.city,keyword:this.data.gymKeyword,page,pageSize:20},{loading:false,silent:true});if(token!==this._gymToken)return;this.setData({gyms:(reset?[]:this.data.gyms).concat(r.gyms||[]),gymHasMore:!!r.hasNext,gymPage:page});}catch(_){wx.showToast({title:"岩馆加载失败，请重试",icon:"none"});}finally{if(token===this._gymToken)this.setData({gymLoading:false});}},
  moreGyms(){this.loadGyms(false);},
  pickGym(e){this.setData({gymId:e.currentTarget.dataset.id||"",gymName:e.currentTarget.dataset.name||"全部岩馆",gymPicker:false});this.load(true);}
});
