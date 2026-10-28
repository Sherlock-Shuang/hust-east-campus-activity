import {decodeSpiderGeometryAsset} from './spider-geometry-asset.js';
import {usePrecomputedSpiderGeometry} from './spider-skin-template.js';

let preloaded=false,pending=null;
const ASSET_URL='./data/spider-skin-v1.bin';
function install(buffer){usePrecomputedSpiderGeometry(decodeSpiderGeometryAsset(buffer));preloaded=true;return true;}

/** Start during campus loading, not on the first suit pickup. Production uses a
 * module worker and transfers the exact authored geometry without downloading a
 * multi-megabyte model. Unsupported/blocked workers resolve false, preserving
 * the original synchronous fallback. An explicit fetch is only for authoring
 * or offline prebaked deployments; the normal entry never fetches ASSET_URL. */
export function preloadSpiderGeometry(fetcher,{url=ASSET_URL,timeoutMs=12000}={}){
  if(preloaded)return Promise.resolve(true);
  if(pending)return pending;
  const explicitFetch=typeof fetcher==='function';
  if(!explicitFetch&&typeof Worker!=='function')return Promise.resolve(false);
  let timer,worker,controller;
  const work=explicitFetch?new Promise((resolve,reject)=>{
    controller=new AbortController();
    Promise.resolve().then(()=>fetcher(url,{signal:controller.signal})).then(response=>{
      if(!response?.ok)throw new Error('Spider geometry request failed');return response.arrayBuffer();
    }).then(resolve,reject);
  }):new Promise((resolve,reject)=>{
    try {
      worker=new Worker(new URL('./spider-geometry-worker.js',import.meta.url),{type:'module'});
      worker.onmessage=event=>event.data?.type==='ready'?resolve(event.data.buffer):reject(new Error('Spider geometry worker failed'));
      worker.onerror=()=>reject(new Error('Spider geometry worker could not load'));
      worker.onmessageerror=()=>reject(new Error('Spider geometry worker sent invalid data'));
      worker.postMessage({type:'generate'});
    }catch(error){reject(error);}
  });
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Spider geometry preload timed out')),Number.isFinite(timeoutMs)?Math.max(1,timeoutMs):12000);});
  pending=Promise.race([work,timeout]).then(install).catch(()=>false).finally(()=>{
    clearTimeout(timer);controller?.abort();if(worker){worker.onmessage=worker.onerror=worker.onmessageerror=null;worker.terminate();}pending=null;
  });
  return pending;
}
