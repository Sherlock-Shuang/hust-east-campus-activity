// Shared, serializable timeline for the host-controlled C118 performance.
// Times are authoritative server milliseconds; consumers render from elapsed time.
export const C118_FLOOD_LEAD_MS=3000;
const MAX_TIME=8640000000000000;
function time(value,label){
  if(!Number.isSafeInteger(value)||value<0||value>MAX_TIME)throw new Error(`C118海啸${label}无效`);
  return value;
}
export function normalizeC118Flood(value){
  if(value==null)return null;
  if(typeof value!=='object'||Array.isArray(value))throw new Error('C118海啸状态格式不正确');
  if(typeof value.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(value.id))throw new Error('C118海啸标识无效');
  return {id:value.id,startAt:time(value.startAt,'开始时间'),
    pausedAt:value.pausedAt==null?null:time(value.pausedAt,'暂停时间'),
    pausedMs:time(value.pausedMs??0,'累计暂停时间')};
}

/** Returns only the reconciled field; called inside the server write queue.
 * Missing fields from legacy full-state writers preserve the current event.
 * Null is an explicit reset. Same-ID clients cannot rewrite the server clock.
 */
export function reconcileC118Flood(previousState,nextState,now){
  time(now,'服务时间');
  const previous=normalizeC118Flood(previousState.c118Flood);
  const requested=Object.hasOwn(nextState,'c118Flood')?normalizeC118Flood(nextState.c118Flood):previous;
  if(!requested)return null;
  if(!previous||requested.id!==previous.id){
    return {id:requested.id,startAt:now+C118_FLOOD_LEAD_MS,pausedAt:nextState.paused?now:null,pausedMs:0};
  }
  const current={...previous};
  if(nextState.paused&&current.pausedAt===null)current.pausedAt=now;
  else if(!nextState.paused&&current.pausedAt!==null){
    current.pausedMs+=Math.max(0,now-current.pausedAt);current.pausedAt=null;
  }
  return current;
}

/** Negative seconds are the shared countdown. Null means an ordinary dry room. */
export function getC118FloodElapsed(event,now){
  if(!event)return null;
  return ((event.pausedAt??now)-event.startAt-event.pausedMs)/1000;
}
