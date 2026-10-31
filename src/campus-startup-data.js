// Shared by the small entry module and the scene: downloads can overlap the
// scene's JavaScript without downloading successful files again on a retry.
const MAP_URL='./data/east-campus.geojson';
const MANIFEST_URL='./data/source-manifest.json';
const EXTENSION_URL='./data/opto-southeast.geojson';

function fallbackManifest(){
  // Matches source-manifest.json. Hand-authored world positions depend on this
  // origin, so a missing metadata request must never move the campus frame.
  return {suggestedLocalOrigin:{coordinateSystem:'EPSG:4326',coordinates:[114.42123985,30.51575845]}};
}

export function createCampusStartupDataLoader({
  fetchImpl=globalThis.fetch,timeoutMs=45000,manifestTimeoutMs=12000,random=Math.random,
  waitImpl=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  setTimer=setTimeout,clearTimer=clearTimeout,
}={}){
  let pending;
  async function attempt(url,label,deadlineMs=timeoutMs){
    const controller=new AbortController();let timer;
    const deadline=new Promise((_,reject)=>{
      timer=setTimer(()=>{
        const error=Object.assign(new Error(`${label}加载超时，请检查现场网络后重试。`),{retryable:true});
        // Settle independently of fetch so even a stalled body is bounded.
        reject(error);controller.abort();
      },deadlineMs);
    });
    try{
      return await Promise.race([deadline,(async()=>{
        const response=await fetchImpl(url,{signal:controller.signal});
        if(!response.ok){
          // Release an error response rather than downloading its unused body.
          response.body?.cancel?.().catch(()=>{});
          throw Object.assign(new Error(`${label}暂时无法载入（HTTP ${response.status}），请重新载入。`),{
            retryable:response.status===429||(response.status>=500&&response.status<600),
          });
        }
        return await response.json();
      })()]);
    }finally{clearTimer(timer);}
  }
  async function load(url,label){
    for(let number=0;number<2;number++){
      try{return await attempt(url,label);}
      catch(error){
        const network=error?.name==='TypeError'||error?.name==='NetworkError';
        if(number===0&&(error?.retryable||network)){
          // A room full of phones must not repeat failed requests in lockstep.
          const sample=Math.max(0,Math.min(1,Number(random())||0));
          await waitImpl(1000+sample*3000);continue;
        }
        if(network)throw new Error(`${label}网络连接失败，请检查现场网络后重试。`);
        if(error?.name==='SyntaxError')throw new Error(`${label}数据不完整，请重新载入。`);
        throw error;
      }
    }
  }
  return function getData(){
    if(!pending)pending=Promise.all([
      load(MAP_URL,'校园地图'),
      // Metadata must not hold up playable map data through another retry.
      attempt(MANIFEST_URL,'地图说明',manifestTimeoutMs).then(manifest=>({...fallbackManifest(),...manifest}),()=>fallbackManifest()),
      load(EXTENSION_URL,'光电大楼补充地图'),
    ]);
    return pending;
  };
}

export const getCampusStartupData=createCampusStartupDataLoader();
