import {Readable} from 'node:stream';
import {createActivityHandler} from './handler.mjs';

// Vercel rewrite: /api/:path* -> /api/activity?__activity_path=:path*
// The explicit path survives framework rewrites while ordinary query strings
// (for example the admin nickname filter) stay available to the actual API.
export function createNodeActivityHandler(options={}){
  const activity=options.activity||createActivityHandler(options);
  return async function handler(req,res){
    const abort=new AbortController(),cancel=()=>abort.abort();
    req.once('aborted',cancel);res.once('close',cancel);
    try{
      const protocol=String(req.headers['x-forwarded-proto']||'https').split(',')[0].trim();
      const url=new URL(req.url,`${protocol==='http'?'http':'https'}://${req.headers.host}`);
      const original=url.searchParams.get('__activity_path');
      if(original!=null){
        if(!/^(?:live|admin|audience|works\/tasay)(?:\/|$)/.test(original)||original.split('/').some(part=>part==='.'||part==='..')){res.writeHead(404);res.end();return;}
        url.pathname='/api/'+original;url.searchParams.delete('__activity_path');
      }
      const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value!=null)headers.set(name,Array.isArray(value)?value.join(', '):String(value));
      const init={method:req.method,headers,signal:abort.signal};
      if(!['GET','HEAD'].includes(req.method)){
        if(req.body!==undefined){init.body=typeof req.body==='string'||Buffer.isBuffer(req.body)?req.body:JSON.stringify(req.body);headers.delete('content-length');}
        else{init.body=Readable.toWeb(req);init.duplex='half';}
      }
      const response=await activity(new Request(url,init));
      for(const [name,value] of response.headers)if(name.toLowerCase()!=='set-cookie')res.setHeader(name,value);
      const cookies=response.headers.getSetCookie?.()||[];if(cookies.length)res.setHeader('Set-Cookie',cookies);
      res.writeHead(response.status);res.flushHeaders?.();
      if(!response.body){res.end();return;}
      // Await the stream so the invocation remains alive until normal expiry or
      // client disconnect; a close aborts the Web Request and its SSE timers.
      await new Promise((resolve,reject)=>{
        const stream=Readable.fromWeb(response.body),complete=()=>{stream.removeListener('error',fail);res.removeListener('finish',complete);res.removeListener('close',closed);resolve();};
        const closed=()=>{stream.destroy();complete();},fail=()=>{stream.destroy();res.destroy();complete();};
        stream.once('error',fail);res.once('finish',complete);res.once('close',closed);stream.pipe(res);
      });
    }catch{
      if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'活动服务暂不可用'}));}else res.destroy();
    }finally{req.removeListener('aborted',cancel);res.removeListener('close',cancel);}
  };
}
