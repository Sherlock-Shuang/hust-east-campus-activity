// Shared, dependency-free schema for the activity console and campus clients.
export function createDefaultLiveState() {
  return {schemaVersion:1,revision:0,paused:false,skyQrVisible:false,pauseMessage:'请稍候，活动即将继续',phase:{id:'explore',label:'自由探索',guidance:'自由探索校园；作品开放与集合安排以主持人通知为准。'},announcement:null,markers:[],portals:[]};
}
export function isEventActive(item, now = Date.now()) {
  return !!item && item.enabled !== false && (item.startAt == null || now >= item.startAt) && (item.endAt == null || now < item.endAt);
}
function fail(message) { throw new Error(message); }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式不正确`); return value; }
function text(value, label, max, fallback, required=false) {
  if (value === undefined && fallback !== undefined) value=fallback;
  if (typeof value !== 'string' || value.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${label}最多 ${max} 字符`);
  value=value.trim(); if(required&&!value)fail(`请填写${label}`);return value;
}
function number(value,label,min,max,fallback) {
  if(value===undefined&&fallback!==undefined)value=fallback;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${label}须在 ${min} 至 ${max} 之间`);return value;
}
function bool(value,label,fallback) { if(value===undefined)value=fallback;if(typeof value!=='boolean')fail(`${label}格式不正确`);return value; }
function id(value) { if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(value))fail('项目标识只能使用字母、数字、下划线和短横线');return value; }
function schedule(value) {
  const result={};
  for(const key of ['startAt','endAt'])result[key]=value[key]==null?null:number(value[key],'活动时间',0,8640000000000000);
  if(result.startAt!==null&&result.endAt!==null&&result.endAt<=result.startAt)fail('结束时间须晚于开始时间');
  return result;
}
export function validatePortalUrl(value) {
  const url=text(value,'入口地址',2048,undefined,true);
  if(/[\s\\\u0000-\u001f\u007f]/.test(url)||url.startsWith('//'))fail('入口地址必须是 HTTP(S) 地址或以 / 开头的站内路径');
  if(url.startsWith('/'))return url;
  let parsed;try{parsed=new URL(url);}catch{fail('入口地址无效');}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)fail('入口地址必须使用 HTTP(S)，且不能包含账号密码');
  return parsed.href;
}
export function validateLiveState(input) {
  const value=object(input,'活动状态');
  if(value.schemaVersion!==1)fail('不支持的活动状态版本');
  const revision=number(value.revision,'版本',0,Number.MAX_SAFE_INTEGER);
  if(!Number.isInteger(revision))fail('版本必须是整数');
  const output={schemaVersion:1,revision,paused:bool(value.paused,'暂停状态'),skyQrVisible:bool(value.skyQrVisible,'天空二维码显示状态',false),pauseMessage:text(value.pauseMessage,'暂停提示',240,'请稍候，活动即将继续'),announcement:null,markers:[],portals:[]};
  const phase=value.phase??createDefaultLiveState().phase;object(phase,'活动阶段');
  output.phase={id:id(phase.id),label:text(phase.label,'阶段名称',40,undefined,true),guidance:text(phase.guidance,'阶段引导',400,'')};
  if(value.announcement!=null){
    const a=object(value.announcement,'公告');
    if(!['info','celebrate','urgent'].includes(a.tone))fail('公告样式无效');
    output.announcement={id:id(a.id),title:text(a.title,'公告标题',100,undefined,true),body:text(a.body,'公告正文',1600,''),tone:a.tone,...schedule(a)};
  }
  const seen=new Set();
  for(const key of ['markers','portals']){
    if(!Array.isArray(value[key])||value[key].length>12)fail(`${key==='markers'?'光柱':'入口'}最多 12 个`);
    output[key]=value[key].map(entry=>{
      const e=object(entry,'地图项目'),entryId=id(e.id);
      if(seen.has(entryId))fail('光柱和入口标识不能重复');seen.add(entryId);
      const common={id:entryId,label:text(e.label,'地点名称',80,undefined,true),x:number(e.x,'X 坐标',-6000,6000),z:number(e.z,'Z 坐标',-6000,6000),enabled:bool(e.enabled,'启用状态',false),...schedule(e)};
      if(key==='portals')return {...common,...(e.workId?{workId:id(e.workId)}:{}),description:text(e.description,'入口说明',400,''),url:validatePortalUrl(e.url),radius:number(e.radius,'触发距离',2,120,10)};
      if(typeof e.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(e.color))fail('光柱颜色须为六位十六进制色值');
      return {...common,color:e.color.toLowerCase(),height:number(e.height,'光柱高度',5,180,40),radius:number(e.radius,'光柱半径',.5,25,3)};
    });
  }
  return output;
}
