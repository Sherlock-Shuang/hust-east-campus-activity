// Audience domain state is deliberately independent of HTTP, Node and storage.
// Only the HTTP adapter can associate a private identity hash with a visitor.
export const PRESENCE_TTL = 65000;
const TYPES = new Set(['visit','opening','opened','open_failed','returned']);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const copy = value => structuredClone(value);
const fail = (message, status=400) => { throw Object.assign(new Error(message),{status}); };
export function validId(value,label='标识') {
  if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value)||['__proto__','constructor','prototype'].includes(value))fail(`${label}无效`);
  return value;
}
export function normalizeNickname(value) {
  if(typeof value!=='string')fail('请输入昵称');
  const name=value.trim();
  if(!name||[...name].length>24||/[\u0000-\u001f\u007f]/.test(name))fail('昵称需为 1 至 24 个字符');
  return name;
}
export function createAudienceData(){return {schemaVersion:1,audiences:{}};}
export function createAudienceRecord({id,identityHash,nickname},now){
  validId(id,'观众标识');
  if(typeof identityHash!=='string'||!/^[a-f0-9]{64}$/.test(identityHash))fail('身份凭据无效');
  return {id,identityHash,nickname:normalizeNickname(nickname),joinedAt:now,lastSeenAt:now,visits:{},attempts:{},tabs:{},events:[],seenEvents:{}};
}
export function validateAudienceData(input){
  if(input?.schemaVersion!==1||!input.audiences||typeof input.audiences!=='object'||Array.isArray(input.audiences))fail('观众数据格式无效');
  for(const [id,record] of Object.entries(input.audiences)){
    if(record.id!==id)fail('观众数据标识不一致');
    createAudienceRecord(record,record.joinedAt);
    if(!finite(record.joinedAt)||!finite(record.lastSeenAt)||!record.visits||!record.attempts||!record.tabs||!record.seenEvents||!Array.isArray(record.events))fail('观众记录损坏');
  }
  return copy(input);
}
function pointFor(points,pointId){
  const point=points.find(p=>p.id===pointId);
  if(!point)fail('活动点位不存在',404);
  return point;
}
function active(point,now){return point.enabled!==false&&(point.startAt==null||now>=point.startAt)&&(point.endAt==null||now<point.endAt);}
function near(point,position){
  if(!position||!finite(position.x)||!finite(position.y)||!finite(position.z))fail('缺少有效的点位到访位置');
  if(position.y< -8||position.y>12||Math.hypot(position.x-point.x,position.z-point.z)>point.radius+.25)fail('尚未进入点位范围',403);
}
export function touchAudience(record,tabId,now){
  validId(tabId,'窗口标识');
  const next=copy(record),old=next.tabs[tabId];
  if(!old&&Object.keys(next.tabs).length>=40){
    for(const [id,tab] of Object.entries(next.tabs))if(now-tab.lastSeenAt>PRESENCE_TTL)delete next.tabs[id];
    if(Object.keys(next.tabs).length>=40)fail('打开的活动窗口过多',429);
  }
  next.tabs[tabId]={...old,lastSeenAt:now};next.lastSeenAt=Math.max(next.lastSeenAt,now);return next;
}
export function applyAudienceEvent(record,event,{points=[],paused=false,now=Date.now()}={}){
  if(!event||typeof event!=='object')fail('事件格式无效');
  validId(event.eventId,'事件标识');validId(event.tabId,'窗口标识');
  if(!TYPES.has(event.type))fail('不支持的观众事件');
  if(Object.hasOwn(record.seenEvents,event.eventId))return {record,duplicate:true};
  if(Object.keys(record.seenEvents).length>=20000)fail('本场事件数量已达到上限',429);
  if(record.events.length>=10000)fail('本场体验记录已达到上限',429);
  let next=touchAudience(record,event.tabId,now);
  validId(event.pointId,'点位标识');
  const normalized={eventId:event.eventId,tabId:event.tabId,type:event.type,pointId:event.pointId,at:now};
  if(event.type==='visit'||event.type==='opening'){
    const point=pointFor(points,event.pointId);near(point,event.position);
    if(!active(point,now))fail('入口尚未开放',409);
    if(paused&&event.type==='opening')fail('活动已暂停',409);
    if(event.type==='visit'){
      const previous=next.visits[point.id];
      next.visits[point.id]={pointId:point.id,label:point.label,firstAt:previous?.firstAt??now,lastAt:now};
      if(previous){next.seenEvents[event.eventId]=now;return {record:next,duplicate:true};}
    }else{
      if(!next.visits[point.id])fail('请先到访这个点位',409);
      const attemptId=validId(event.attemptId,'体验标识'),workId=validId(point.workId||point.id,'作品标识');
      if(event.workId!=null&&event.workId!==workId)fail('作品与点位不匹配');
      if(next.attempts[attemptId]){
        const old=next.attempts[attemptId];
        if(old.tabId!==event.tabId||old.pointId!==point.id)fail('体验标识已被使用',409);
        next.seenEvents[event.eventId]=now;return {record:next,duplicate:true};
      }
      const oldId=next.tabs[event.tabId].currentAttemptId;
      if(oldId&&next.attempts[oldId]&&!next.attempts[oldId].endedAt){next.attempts[oldId].status='interrupted';next.attempts[oldId].endedAt=now;}
      next.attempts[attemptId]={id:attemptId,tabId:event.tabId,pointId:point.id,pointLabel:point.label,workId,status:'opening',startedAt:now,openedAt:null,readyLevel:null,endedAt:null};
      next.tabs[event.tabId].currentAttemptId=attemptId;
      Object.assign(normalized,{attemptId,workId});
    }
  }else{
    const attemptId=validId(event.attemptId,'体验标识'),attempt=next.attempts[attemptId];
    if(!attempt||attempt.pointId!==event.pointId||attempt.tabId!==event.tabId)fail('体验记录不存在或不属于本窗口',409);
    if(event.workId!=null&&event.workId!==attempt.workId)fail('作品与体验不匹配');
    Object.assign(normalized,{attemptId,workId:attempt.workId});
    if(event.type==='opened'){
      const readyLevel=event.readyLevel||'page_opened';
      if(!['page_opened','runtime_ready'].includes(readyLevel))fail('未知的作品加载状态');
      if(attempt.endedAt!=null){next.seenEvents[event.eventId]=now;return {record:next,duplicate:true};}
      if(attempt.status==='opened'&&(attempt.readyLevel==='runtime_ready'||attempt.readyLevel===readyLevel)){next.seenEvents[event.eventId]=now;return {record:next,duplicate:true};}
      attempt.status='opened';attempt.openedAt??=now;attempt.readyLevel=readyLevel;normalized.readyLevel=readyLevel;
    }else{
      if(attempt.endedAt!=null){next.seenEvents[event.eventId]=now;return {record:next,duplicate:true};}
      attempt.endedAt=now;attempt.status=event.type==='open_failed'?'failed':attempt.openedAt!=null?'returned':'cancelled';
      if(next.tabs[event.tabId].currentAttemptId===attemptId)delete next.tabs[event.tabId].currentAttemptId;
      normalized.status=attempt.status;
      if(event.type==='open_failed'&&typeof event.reason==='string')normalized.reason=event.reason.slice(0,160);
    }
  }
  next.events.push(normalized);next.seenEvents[event.eventId]=now;
  return {record:next,duplicate:false};
}
export function summarizeAudience(record,{now=Date.now()}={}){
  const liveTabs=Object.entries(record.tabs).filter(([,tab])=>now-tab.lastSeenAt<=PRESENCE_TTL);
  const currentExperiences=liveTabs.map(([tabId,tab])=>record.attempts[tab.currentAttemptId]).filter(a=>a&&a.endedAt==null).map(a=>({id:a.id,pointId:a.pointId,workId:a.workId,status:a.status,readyLevel:a.readyLevel,startedAt:a.startedAt}));
  const opened=new Map();
  for(const attempt of Object.values(record.attempts))if(attempt.openedAt!=null){
    const old=opened.get(attempt.workId);
    opened.set(attempt.workId,{workId:attempt.workId,firstOpenedAt:Math.min(old?.firstOpenedAt??Infinity,attempt.openedAt),lastOpenedAt:Math.max(old?.lastOpenedAt??0,attempt.openedAt),openCount:(old?.openCount||0)+1,readyLevel:old?.readyLevel==='runtime_ready'||attempt.readyLevel==='runtime_ready'?'runtime_ready':'page_opened'});
  }
  const last=record.events.at(-1);
  return {id:record.id,nickname:record.nickname,joinedAt:record.joinedAt,lastSeenAt:record.lastSeenAt,online:liveTabs.length>0,visitedPoints:Object.values(record.visits),openedWorks:[...opened.values()],currentExperiences,lastStatus:currentExperiences.length?'experiencing':last?.status||last?.type||'exploring'};
}
export function audienceDetail(record,options){return {...summarizeAudience(record,options),events:copy(record.events),attempts:copy(Object.values(record.attempts))};}
export function aggregateAudiences(records,{points=[],works=[],now=Date.now(),query=''}={}){
  const participants=records.map(record=>summarizeAudience(record,{now}));
  const pointMap=new Map(points.map(p=>[p.id,{id:p.id,label:p.label,visitors:0}]));
  const workEntries=Array.isArray(works)?works:Object.entries(works||{}).map(([id,work])=>({id,...work}));
  const workMap=new Map(workEntries.map(w=>[w.id,{id:w.id,label:w.name||w.label||w.id,openedParticipants:0,currentParticipants:0}]));
  for(const p of points){const id=p.workId||p.id;if(!workMap.has(id))workMap.set(id,{id,label:p.label,openedParticipants:0,currentParticipants:0});}
  for(const participant of participants){
    for(const visit of participant.visitedPoints){if(!pointMap.has(visit.pointId))pointMap.set(visit.pointId,{id:visit.pointId,label:visit.label,visitors:0});pointMap.get(visit.pointId).visitors++;}
    for(const work of participant.openedWorks){if(!workMap.has(work.workId))workMap.set(work.workId,{id:work.workId,label:work.workId,openedParticipants:0,currentParticipants:0});workMap.get(work.workId).openedParticipants++;}
    for(const id of new Set(participant.currentExperiences.filter(a=>a.status==='opened').map(a=>a.workId))){if(!workMap.has(id))workMap.set(id,{id,label:id,openedParticipants:0,currentParticipants:0});workMap.get(id).currentParticipants++;}
  }
  const search=query.trim().toLocaleLowerCase();
  return {summary:{totalParticipants:participants.length,onlineParticipants:participants.filter(p=>p.online).length,currentParticipants:participants.filter(p=>p.currentExperiences.some(a=>a.status==='opened')).length,points:[...pointMap.values()],works:[...workMap.values()]},participants:participants.filter(p=>!search||p.nickname.toLocaleLowerCase().includes(search)||p.id.includes(search)).sort((a,b)=>b.lastSeenAt-a.lastSeenAt)};
}
export function createAudienceStore({initial=createAudienceData(),persist=async()=>{},now=Date.now,idFactory=()=>crypto.randomUUID(),presenceFlushMs=0}={}){
  let data=validateAudienceData(initial),queue=Promise.resolve();
  let presenceDirty=false,presenceTimer;
  const clearPresenceTimer=()=>{clearTimeout(presenceTimer);presenceTimer=undefined;};
  const enqueue=operation=>{const job=queue.then(operation);queue=job.catch(()=>{});return job;};
  const flushPresence=()=>enqueue(async()=>{if(!presenceDirty)return;await persist(copy(data));presenceDirty=false;});
  function schedulePresence(){if(presenceTimer||!presenceDirty)return;presenceTimer=setTimeout(()=>{presenceTimer=undefined;flushPresence().catch(()=>{schedulePresence();});},Math.max(100,Math.min(5000,presenceFlushMs)));presenceTimer.unref?.();}
  const transact=operation=>{
    return enqueue(async()=>{const next=copy(data),result=operation(next);await persist(next);data=next;presenceDirty=false;clearPresenceTimer();return copy(result);});
  };
  const requireRecord=(state,id)=>{validId(id,'观众标识');const record=Object.hasOwn(state.audiences,id)?state.audiences[id]:null;if(!record)fail('观众身份已失效，请重新加入',401);return record;};
  return {
    byIdentity(identityHash){const r=Object.values(data.audiences).find(a=>a.identityHash===identityHash);return r?copy(r):null;},
    get(id){return copy(requireRecord(data,id));},
    snapshot(){return copy(data);},
    async join({identityHash,nickname,tabId}){return transact(next=>{
      let record=Object.values(next.audiences).find(a=>a.identityHash===identityHash);
      if(record){record.nickname=normalizeNickname(nickname);}else{if(Object.keys(next.audiences).length>=5000)fail('本场参与人数已达上限',429);record=createAudienceRecord({id:idFactory(),identityHash,nickname},now());}
      record=touchAudience(record,tabId,now());next.audiences[record.id]=record;return summarizeAudience(record,{now:now()});
    });},
    async heartbeat(id,tabId){
      if(presenceFlushMs<=0)return transact(next=>{const r=touchAudience(requireRecord(next,id),tabId,now());next.audiences[id]=r;return summarizeAudience(r,{now:now()});});
      // Presence is ephemeral. Coalesce only its disk writes, not exploration
      // receipts; all operations remain serialized with durable transactions.
      return enqueue(()=>{const r=touchAudience(requireRecord(data,id),tabId,now());data.audiences[id]=r;presenceDirty=true;schedulePresence();return summarizeAudience(r,{now:now()});});
    },
    async event(id,event,context){return transact(next=>{const result=applyAudienceEvent(requireRecord(next,id),event,{...(typeof context==='function'?context():context),now:now()});next.audiences[id]=result.record;return {duplicate:result.duplicate,audience:summarizeAudience(result.record,{now:now()})};});},
    statistics(options){return aggregateAudiences(Object.values(data.audiences),{...options,now:now()});},
    detail(id){return audienceDetail(requireRecord(data,id),{now:now()});},
    async flush(){clearPresenceTimer();await flushPresence();},
  };
}
