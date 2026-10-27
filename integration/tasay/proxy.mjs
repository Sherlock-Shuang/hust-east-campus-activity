// Web-standard handler, shared by the Node host and a Worker deployment.
// The caller MUST obtain audienceId from its verified audience session/cookie.
const json=(status,message,headers={})=>new Response(JSON.stringify({error:{message}}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function tasayModelConfig(env={},target='default'){
  const primary={apiKey:env.TASAY_LLM_API_KEY||env.VITE_LLM_API_KEY||'',baseUrl:env.TASAY_LLM_BASE_URL||env.VITE_LLM_BASE_URL||'https://api.openai.com/v1',model:env.TASAY_LLM_MODEL||env.VITE_LLM_MODEL||'gpt-4o-mini'};
  if(target==='fast'&&(env.TASAY_FAST_LLM_API_KEY||env.VITE_FAST_LLM_API_KEY))return {apiKey:env.TASAY_FAST_LLM_API_KEY||env.VITE_FAST_LLM_API_KEY,baseUrl:env.TASAY_FAST_LLM_BASE_URL||env.VITE_FAST_LLM_BASE_URL||primary.baseUrl,model:env.TASAY_FAST_LLM_MODEL||env.VITE_FAST_LLM_MODEL||primary.model};
  return primary;
}

export function createTasayProxy({env={},fetchImpl=fetch,now=Date.now,maxConcurrent=8,maxPerMinute=6,maxPerAudience=40,timeoutMs=60000,rateLimit}={}){
  const rates=new Map();let concurrent=0;
  return async function handle(request,{audienceId}={}){
    const url=new URL(request.url),match=url.pathname.match(/^\/api\/works\/tasay\/(default|fast)\/chat\/completions$/);
    if(!match)return null;
    if(request.method!=='POST')return json(405,'请使用 POST 请求',{'Allow':'POST'});
    if(typeof audienceId!=='string'||!audienceId)return json(401,'请先从校园加入活动');
    if(request.headers.get('Origin')!==url.origin)return json(403,'模型请求来源不被允许');
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))return json(415,'请使用 JSON 请求');
    const config=tasayModelConfig(env,match[1]);
    if(!config.apiKey)return json(503,'此部署尚未配置模型服务；校园和故事游戏仍可使用');
    let endpoint;try{endpoint=new URL(config.baseUrl.replace(/\/+$/,'')+'/chat/completions');}catch{return json(503,'模型服务配置无效');}
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)return json(503,'模型服务必须使用可信 HTTPS 地址');
    const time=now();let rate=rates.get(audienceId)||{until:time+60000,count:0,total:0};
    if(rate.until<=time)rate={...rate,until:time+60000,count:0};
    if(rate.count>=maxPerMinute||rate.total>=maxPerAudience)return json(429,'本场模型请求次数已达限额，请稍后或联系主持人',{'Retry-After':'60'});
    if(concurrent>=maxConcurrent)return json(429,'模型服务正在处理其他观众的请求，请稍后重试',{'Retry-After':'10'});
    if(rates.size>=2000&&!rates.has(audienceId))return json(429,'模型服务繁忙，请稍后重试');
    if(rateLimit&&!await rateLimit(audienceId))return json(429,'模型请求频率过高，请稍后重试',{'Retry-After':'60'});
    rates.set(audienceId,{...rate,count:rate.count+1,total:rate.total+1});concurrent++;
    const controller=new AbortController(),abort=()=>controller.abort();let reader,timer,finished=false;
    const finish=()=>{if(finished)return;finished=true;concurrent--;clearTimeout(timer);request.signal.removeEventListener('abort',abort);};
    request.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,timeoutMs);
    try{
      if(Number(request.headers.get('Content-Length')||0)>131072)return json(413,'对话内容过长');
      let size=0,raw='';const decoder=new TextDecoder(),input=request.body?.getReader();
      if(!input)return json(400,'请提供对话内容');
      for(;;){const {done,value}=await input.read();if(done)break;size+=value.byteLength;if(size>131072){await input.cancel();return json(413,'对话内容过长');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
      let body;try{body=JSON.parse(raw);}catch{return json(400,'请求 JSON 无效');}
      if(!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>64)return json(400,'对话消息数量无效');
      let chars=0;const messages=[];
      for(const message of body.messages){if(!['system','user','assistant'].includes(message?.role)||typeof message.content!=='string')return json(400,'对话消息格式无效');chars+=message.content.length;messages.push({role:message.role,content:message.content});}
      if(chars>60000)return json(413,'对话内容过长');
      const payload={model:config.model,messages,stream:body.stream===true,max_tokens:finite(body.max_tokens)?Math.max(8,Math.min(2048,Math.trunc(body.max_tokens))):800,temperature:finite(body.temperature)?Math.max(0,Math.min(2,body.temperature)):.5};
      if(body.response_format?.type==='json_object')payload.response_format={type:'json_object'};
      const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${config.apiKey}`},body:JSON.stringify(payload),signal:controller.signal});
      if(!response.ok){
        // Do not relay upstream diagnostics, credentials, or headers to visitors.
        if([400,404,415,422].includes(response.status)&&payload.response_format)return json(response.status,'response_format unsupported');
        return json(response.status===429?429:502,'模型服务暂时未能完成请求，请稍后重试');
      }
      if(!response.body)return json(502,'模型服务返回空响应');
      reader=response.body.getReader();
      const stream=new ReadableStream({
        async pull(sink){try{const result=await reader.read();if(result.done){finish();sink.close();}else sink.enqueue(result.value);}catch{finish();sink.error(new Error('模型响应中断'));}},
        async cancel(){controller.abort();try{await reader.cancel();}finally{finish();}}
      });
      return new Response(stream,{status:200,headers:{'Content-Type':payload.stream?'text/event-stream; charset=utf-8':'application/json; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
    }catch{return json(controller.signal.aborted?504:502,controller.signal.aborted?'模型请求超时，请稍后重试':'模型服务连接失败，请稍后重试');}
    finally{if(!reader)finish();}
  };
}
