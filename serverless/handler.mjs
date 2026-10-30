import {createTursoDatabase} from './database.mjs';
import {handleActivityAPI,authenticatedAudience,consumeModelQuota} from './activity-api.mjs';
import {createTasayProxy} from '../integration/tasay/proxy.mjs';
import {createSheLoveProxy} from '../integration/she-love-me/proxy.mjs';

// Instantiate once at module scope in api/activity.mjs. Database rows, rather
// than this instance, own identity, sessions, activity state and model budgets.
export function createActivityHandler({env=process.env,db,streamClock,diagnostics}={}){
  let configured=db,proxy,sheLove;
  return async function activity(request){
    const path=new URL(request.url).pathname;
    if(!/^\/api\/(?:live|admin|audience|works\/(?:tasay|she-love-me))(?:\/|$)/.test(path))return new Response('Not found',{status:404});
    try{
      configured??=createTursoDatabase(env);
      const runtime={...env,DB:configured,...(streamClock?{STREAM_CLOCK:streamClock}:{}),...(diagnostics?{ACTIVITY_DIAGNOSTICS:diagnostics}:{})};
      if(path.startsWith('/api/works/tasay/')||path.startsWith('/api/works/she-love-me/')){
        const audience=await authenticatedAudience(request,runtime);
        proxy??=createTasayProxy({env,rateLimit:id=>consumeModelQuota(id,runtime)});
        sheLove??=createSheLoveProxy({proxy});
        return await (path.startsWith('/api/works/she-love-me/')?sheLove:proxy)(request,{audienceId:audience?.id})||new Response('Not found',{status:404});
      }
      return await handleActivityAPI(request,runtime)||new Response('Not found',{status:404});
    }catch{
      // Do not expose SQL, database URLs, upstream errors or secrets.
      return Response.json({error:'活动服务暂不可用，请确认服务端数据库及配置'},{status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
  };
}
