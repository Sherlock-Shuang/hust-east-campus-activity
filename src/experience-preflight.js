/** A cancelled/failed entry must not leave a pending HEAD request or admit an
 * iframe after the player has returned. This verifies HTTP reachability only;
 * actual ready messages still determine the experience's opened status. */
export async function preflightExperience(url,{signal,fetchImpl=fetch,timeoutMs=12000}={}) {
  const controller=new AbortController();let timedOut=false;
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)controller.abort();
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  try{
    if(controller.signal.aborted)throw new DOMException('Entry cancelled','AbortError');
    const response=await fetchImpl(url,{method:'HEAD',cache:'no-store',signal:controller.signal});
    if(controller.signal.aborted)throw new DOMException('Entry cancelled','AbortError');
    if(!response.ok)throw new Error(`作品服务暂不可用（${response.status}）`);
  }catch(error){if(timedOut&&!signal?.aborted)throw new Error('作品服务连接超时，请重试或返回校园。');throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
