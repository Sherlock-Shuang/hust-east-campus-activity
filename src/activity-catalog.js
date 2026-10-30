// Activity coordinates use the existing campus ENU frame. No source geometry is changed.
// Area centroid of east-field way/1023821172, on the central soccer surface.
// y matches its 0.066 m paint surface; the underlying grass is at 0.058 m.
export const LEARNING_BOARD = Object.freeze({
  id:'sports-learning-board',label:'操场留言板',
  x:428.44619,y:.066,z:58.80678,radius:12,maxPlayerY:5,
  yaw:.105,width:5.4,height:3.8,
});
export const ACTIVITY_WORKS = Object.freeze([
  {id:'library',name:'书境图书馆',description:'走进书境，探索原有旅程与书中游戏。',url:'/works/library/',ready:'runtime_ready'},
  {id:'wanyan',name:'黑神话.晚言',description:'进入晚言的真实 Unity 网页游戏。',url:'/works/wanyan/',ready:'runtime_ready'},
  {id:'tasay',name:'过拟合恋人',description:'一段逐渐偏离预期的恋爱与 Meta 恐怖体验。',url:'/works/tasay/',ready:'page_opened'},
  {id:'she-love-me',name:'她不一样 · 恋情分析室',description:'在爱因斯坦广场直接体验聊天观察：示例、导入、本地统计与可选 AI 解读；无需通关。',url:'/works/she-love-me/',ready:'page_opened'},
]);
export const ACTIVITY_PHASES = Object.freeze([
  {id:'explore',label:'自由探索',guidance:'自由探索校园；作品开放与集合安排以主持人通知为准。'},
  {id:'gather',label:'集合',guidance:'请留意主持人通知，前往指定集合地点。'},
  {id:'film',label:'短片',guidance:'请看向现场主屏幕，一起观看短片。'},
  {id:'share',label:'分享',guidance:'请听主持人引导，分享你的体验。'},
]);
export function activityPortals(){
  // East-library gate (way/98867853): place the entry on the clear eastern approach.
  const positions=[[584.66,332.64],[449.91,-119.96],[58.19,17.55],[848.45,-61.39]];
  return ACTIVITY_WORKS.map((work,i)=>({id:`point-${work.id}`,workId:work.id,label:work.name,description:work.description,url:work.url,x:positions[i][0],z:positions[i][1],radius:work.id==='library'?8:work.id==='she-love-me'?6:16,enabled:false,startAt:null,endAt:null}));
}

export const SHE_LOVE_POINT_ID='point-she-love-me';
export function isTasayLinkedPortal(portal){return portal?.workId==='she-love-me'||portal?.id===SHE_LOVE_POINT_ID;}
export function getTasayPortal(portals){return portals.find(portal=>portal.id==='point-tasay'&&portal.workId==='tasay')||portals.find(portal=>portal.workId==='tasay');}
// A read-time projection also upgrades existing three-point databases. It never
// changes the master's location/schedule, drops a custom point, or writes storage.
export function synchronizeActivityPortals(portals,{occupiedIds=[]}={}){
  const master=getTasayPortal(portals);
  let points=portals;
  if(master&&!points.some(point=>point.id===SHE_LOVE_POINT_ID)&&points.length<12&&!occupiedIds.includes(SHE_LOVE_POINT_ID)){
    points=[...points,activityPortals().find(point=>point.id===SHE_LOVE_POINT_ID)];
  }
  return points.map(point=>isTasayLinkedPortal(point)?{...point,workId:'she-love-me',url:'/works/she-love-me/',enabled:master?.enabled===true,startAt:master?.startAt??null,endAt:master?.endAt??null}:point);
}
