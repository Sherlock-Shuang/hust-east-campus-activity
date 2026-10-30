import {readFile,stat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLibraryHandler} from './library/handler.mjs';
import {createTasayProxy} from './tasay/proxy.mjs';
import {createSheLoveProxy} from './she-love-me/proxy.mjs';
import {loadTasayServerEnv} from './tasay/config.mjs';
export async function createWorkRouter({assetsRoot,env=process.env,publicOrigin}={}){
  let library;try{library=await createLibraryHandler({assetsRoot});}catch{}
  const proxy=createTasayProxy({env:await loadTasayServerEnv({env})});
  const sheLove=createSheLoveProxy({proxy});
  const tasayRoot=path.resolve(assetsRoot,'tasay');
  const mime={'.txt':'text/plain; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'};
  return async (req,res,url,{audience}={})=>{
    if(url.pathname.startsWith('/api/works/tasay/')||url.pathname.startsWith('/api/works/she-love-me/')){
      const origin=publicOrigin||`http://${req.headers.host}`;
      const controller=new AbortController();req.on('aborted',()=>controller.abort());res.on('close',()=>{if(!res.writableEnded)controller.abort();});
      const request=new Request(new URL(req.url,origin),{method:req.method,headers:req.headers,signal:controller.signal,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
      const handler=url.pathname.startsWith('/api/works/she-love-me/')?sheLove:proxy;
      const result=await handler(request,{audienceId:audience?.id});
      if(!result)return false;
      res.writeHead(result.status,Object.fromEntries(result.headers));if(result.body)Readable.fromWeb(result.body).pipe(res);else res.end();return true;
    }
    if(library&&await library(req,res,url))return true;
    if(url.pathname==='/works/tasay'){res.writeHead(308,{Location:'/works/tasay/'+url.search});res.end();return true;}
    if(url.pathname.startsWith('/works/tasay/')){
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return true;}
      const relative=decodeURIComponent(url.pathname.slice('/works/tasay/'.length));
      let file=path.resolve(tasayRoot,relative||'index.html');
      if(!file.startsWith(tasayRoot+path.sep)){res.writeHead(403);res.end();return true;}
      try{if(!(await stat(file)).isFile())file=path.join(tasayRoot,'index.html');}
      catch{if(!path.extname(relative))file=path.join(tasayRoot,'index.html');else{res.writeHead(404);res.end('作品资源不存在');return true;}}
      try{const actual=await realpath(file);if(!actual.startsWith(tasayRoot+path.sep))throw new Error();const info=await stat(actual);res.writeHead(200,{'Content-Type':mime[path.extname(actual)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache'});if(req.method==='HEAD')res.end();else createReadStream(actual).pipe(res);}
      catch{res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('作品尚未构建，请运行 npm run build:works');}
      return true;
    }
    // The browser analysis app is authored in public and copied by Vite.
    // Only its explicit static assets are exposed here.
    if(url.pathname==='/works/she-love-me'){res.writeHead(308,{Location:'/works/she-love-me/'+url.search});res.end();return true;}
    if(url.pathname.startsWith('/works/she-love-me/')){
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return true;}
      let relative;try{relative=decodeURIComponent(url.pathname.slice('/works/she-love-me/'.length))||'index.html';}catch{res.writeHead(400);res.end();return true;}
      if(!['index.html','project.css','project.js','analyzer.js','demo.js','LICENSE.txt'].includes(relative)){res.writeHead(404);res.end();return true;}
      try{
        const base=await realpath(fileURLToPath(new URL('../public/works/she-love-me/',import.meta.url)));
        const actual=await realpath(path.join(base,relative));
        if(!actual.startsWith(base+path.sep))throw new Error('Outside project files');
        const info=await stat(actual);if(!info.isFile())throw new Error('Not a file');
        res.writeHead(200,{'Content-Type':mime[path.extname(actual)],'Content-Length':info.size,'Cache-Control':'no-cache'});
        if(req.method==='HEAD')res.end();else createReadStream(actual).pipe(res);
      }catch{res.writeHead(404);res.end('项目页面不存在');}
      return true;
    }
    if(url.pathname.startsWith('/works/')){res.writeHead(404);res.end('作品不存在或尚未构建');return true;}
    return false;
  };
}
