// Web-standard handler, shared by the Node host and a Worker deployment.
// The caller MUST obtain audienceId from its verified audience session/cookie.
import {createModelRequestQueue} from '../model-request-queue.mjs';
const json=(status,message,headers={})=>new Response(JSON.stringify({error:{message}}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const cancelled=()=>Object.assign(new Error('Request cancelled'),{code:'REQUEST_CANCELLED'});
// Race work which may not promptly reject on abort (body readers and quota
// adapters included), without leaving a signal listener after it settles.
function abortable(work,signal){
  if(signal.aborted)return Promise.reject(signal.reason||cancelled());
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason||cancelled());};
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(work).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
const retryAfter=value=>/^\d{1,3}$/.test(value||'')?String(Math.max(1,Math.min(120,Number(value)))):'10';
export function tasayModelConfig(env={},target='default'){
  const primary={apiKey:env.TASAY_LLM_API_KEY||env.VITE_LLM_API_KEY||'',baseUrl:env.TASAY_LLM_BASE_URL||env.VITE_LLM_BASE_URL||'https://api.openai.com/v1',model:env.TASAY_LLM_MODEL||env.VITE_LLM_MODEL||'gpt-4o-mini'};
  if(target==='fast'&&(env.TASAY_FAST_LLM_API_KEY||env.VITE_FAST_LLM_API_KEY))return {apiKey:env.TASAY_FAST_LLM_API_KEY||env.VITE_FAST_LLM_API_KEY,baseUrl:env.TASAY_FAST_LLM_BASE_URL||env.VITE_FAST_LLM_BASE_URL||primary.baseUrl,model:env.TASAY_FAST_LLM_MODEL||env.VITE_FAST_LLM_MODEL||primary.model};
  return primary;
}

export function createTasayProxy({env={},fetchImpl=fetch,now=Date.now,maxConcurrent=8,maxQueued=16,queueTimeoutMs=12000,maxPerMinute=6,maxPerAudience=40,timeoutMs=60000,rateLimit}={}){
  const rates=new Map(),queue=createModelRequestQueue({maxConcurrent,maxQueued,waitMs:queueTimeoutMs}),controllers=new Set();let disposed=false;
  async function handle(request,{audienceId}={}){
    const url=new URL(request.url),match=url.pathname.match(/^\/api\/works\/tasay\/(default|fast)\/chat\/completions$/);
    if(!match)return null;
    if(request.method!=='POST')return json(405,'请使用 POST 请求',{'Allow':'POST'});
    if(typeof audienceId!=='string'||!audienceId)return json(401,'请先从校园加入活动');
    if(request.headers.get('Origin')!==url.origin)return json(403,'模型请求来源不被允许');
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))return json(415,'请使用 JSON 请求');
    if(request.signal.aborted)return json(499,'请求已取消');
    if(disposed)return json(503,'模型服务已停止，请稍后重试',{'Retry-After':'10'});
    const config=tasayModelConfig(env,match[1]);
    if(!config.apiKey)return json(503,'此部署尚未配置模型服务；校园和故事游戏仍可使用');
    let endpoint;try{endpoint=new URL(config.baseUrl.replace(/\/+$/,'')+'/chat/completions');}catch{return json(503,'模型服务配置无效');}
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)return json(503,'模型服务必须使用可信 HTTPS 地址');
    const controller=new AbortController(),abort=()=>controller.abort(cancelled());let reader,input,timer,finished=false,release,output;
    const finish=()=>{if(finished)return;finished=true;release?.();clearTimeout(timer);controllers.delete(controller);request.signal.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',stop);};
    const stop=()=>{
      // A disconnected consumer might never read/cancel its Response again.
      // Abort upstream and release its slot immediately, not on a future pull.
      void input?.cancel().catch(()=>{});void reader?.cancel().catch(()=>{});
      try{output?.error(new Error('模型响应已取消'));}catch{}finish();
    };
    controllers.add(controller);request.signal.addEventListener('abort',abort,{once:true});controller.signal.addEventListener('abort',stop,{once:true});
    timer=setTimeout(()=>controller.abort(Object.assign(new Error('Request timed out'),{code:'REQUEST_TIMEOUT'})),timeoutMs);
    try{
      if(Number(request.headers.get('Content-Length')||0)>131072)return json(413,'对话内容过长');
      let size=0,raw='';const decoder=new TextDecoder();input=request.body?.getReader();
      if(!input)return json(400,'请提供对话内容');
      for(;;){const {done,value}=await abortable(input.read(),controller.signal);if(done)break;size+=value.byteLength;if(size>131072){void input.cancel().catch(()=>{});return json(413,'对话内容过长');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();input.releaseLock();input=null;
      let body;try{body=JSON.parse(raw);}catch{return json(400,'请求 JSON 无效');}
      if(!body||typeof body!=='object'||Array.isArray(body))return json(400,'请求 JSON 无效');
      if(!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>64)return json(400,'对话消息数量无效');
      let chars=0;const messages=[];
      for(const message of body.messages){if(!['system','user','assistant'].includes(message?.role)||typeof message.content!=='string')return json(400,'对话消息格式无效');chars+=message.content.length;messages.push({role:message.role,content:message.content});}
      if(chars>60000)return json(413,'对话内容过长');
      const payload={model:config.model,messages,stream:body.stream===true,max_tokens:finite(body.max_tokens)?Math.max(8,Math.min(2048,Math.trunc(body.max_tokens))):800,temperature:finite(body.temperature)?Math.max(0,Math.min(2,body.temperature)):.5};
      if(body.response_format?.type==='json_object')payload.response_format={type:'json_object'};

      release=await queue.acquire({key:audienceId,signal:controller.signal});
      if(controller.signal.aborted){release();throw controller.signal.reason;}
      const time=now();let rate=rates.get(audienceId);
      if(!rate){if(rates.size>=2000)return json(429,'模型服务繁忙，请稍后重试',{'Retry-After':'60'});rate={until:time+60000,count:0,total:0,pending:0};rates.set(audienceId,rate);}
      if(rate.until<=time){rate.until=time+60000;rate.count=0;}
      if(rate.count+rate.pending>=maxPerMinute||rate.total+rate.pending>=maxPerAudience)return json(429,'本场模型请求次数已达限额，请稍后或联系主持人',{'Retry-After':'60'});
      // Reserve local admission synchronously before the shared async quota.
      // Previously a burst could all pass concurrent/count checks before await.
      rate.pending++;
      let allowed;
      try{allowed=await abortable(rateLimit?rateLimit(audienceId):true,controller.signal);}finally{rate.pending--;}
      if(!allowed)return json(429,'模型请求频率过高，请稍后重试',{'Retry-After':'60'});
      if(controller.signal.aborted)throw controller.signal.reason;
      rate.count++;rate.total++;
      const fetching=fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${config.apiKey}`},body:JSON.stringify(payload),signal:controller.signal});
      // An injected fetch implementation may settle after cancellation. Do not
      // retain an unread late Response even in that case.
      void Promise.resolve(fetching).then(response=>{if(controller.signal.aborted)void response.body?.cancel().catch(()=>{});}).catch(()=>{});
      const response=await abortable(fetching,controller.signal);
      if(!response.ok){
        void response.body?.cancel().catch(()=>{});
        // Do not relay upstream diagnostics, credentials, or headers to visitors.
        if([400,404,415,422].includes(response.status)&&payload.response_format)return json(response.status,'response_format unsupported');
        return json(response.status===429?429:502,'模型服务暂时未能完成请求，请稍后重试',response.status===429?{'Retry-After':retryAfter(response.headers.get('Retry-After'))}:{});
      }
      if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw controller.signal.reason;}
      if(!response.body)return json(502,'模型服务返回空响应');
      reader=response.body.getReader();
      const stream=new ReadableStream({
        start(sink){output=sink;},
        async pull(sink){try{const result=await reader.read();if(finished)return;if(result.done){finish();sink.close();}else sink.enqueue(result.value);}catch{if(finished)return;finish();sink.error(new Error('模型响应中断'));}},
        cancel(){controller.abort(cancelled());finish();}
      });
      return new Response(stream,{status:200,headers:{'Content-Type':payload.stream?'text/event-stream; charset=utf-8':'application/json; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
    }catch(cause){
      if(request.signal.aborted||cause?.code==='REQUEST_CANCELLED')return json(499,'请求已取消');
      if(['QUEUE_FULL','QUEUE_TIMEOUT'].includes(cause?.code))return json(429,cause.code==='QUEUE_FULL'?'当前等候人数较多，请稍后重试':'等候模型服务超时，请稍后重试',{'Retry-After':'10'});
      if(disposed||cause?.code==='QUEUE_CLOSED')return json(503,'模型服务已停止，请稍后重试',{'Retry-After':'10'});
      return json(controller.signal.aborted?504:502,controller.signal.aborted?'模型请求超时，请稍后重试':'模型服务连接失败，请稍后重试');
    }finally{if(!reader){if(input){void input.cancel().catch(()=>{});try{input.releaseLock();}catch{}}finish();}}
  }
  handle.dispose=()=>{if(disposed)return;disposed=true;queue.dispose();for(const controller of [...controllers])controller.abort(Object.assign(new Error('Proxy stopped'),{code:'QUEUE_CLOSED'}));rates.clear();};
  return handle;
}
