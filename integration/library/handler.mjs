import {readFile,stat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {isVersionedWorkAsset} from './versioned-assets.mjs';

// The manifest is the complete allowlist. Never serve source/authoring folders.
export async function createLibraryHandler({assetsRoot}){
  assetsRoot=await realpath(path.resolve(assetsRoot));
  const manifest=JSON.parse(await readFile(path.join(assetsRoot,'library-manifest.json'),'utf8'));
  const routes=new Map(manifest.entries.map(e=>[e.url,e]));
  return async function serveLibrary(req,res,url=new URL(req.url,'http://localhost')){
    let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return false;}
    if(!manifest.prefixes.some(prefix=>pathname===prefix.slice(0,-1)||pathname.startsWith(prefix)))return false;
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return true;}
    if(manifest.prefixes.some(prefix=>pathname===prefix.slice(0,-1))){res.writeHead(308,{Location:pathname+'/'+url.search});res.end();return true;}
    const entry=routes.get(pathname);
    if(!entry){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('作品资源不存在');return true;}
    const file=await realpath(path.join(assetsRoot,entry.file));
    if(file!==assetsRoot&&!file.startsWith(assetsRoot+path.sep))throw new Error('Asset outside runtime directory');
    const info=await stat(file),headers={'Content-Type':entry.contentType,'X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Cache-Control':isVersionedWorkAsset(pathname,entry.sha256)?'public, max-age=31536000, immutable':/\.(?:glb|wasm|data|swf|otf|png|jpg)$/.test(entry.file)?'public, max-age=3600':'no-cache','ETag':`"${entry.sha256}"`};
    if(req.headers['if-none-match']===headers.ETag){res.writeHead(304,headers);res.end();return true;}
    let start=0,end=info.size-1,status=200;
    if(req.headers.range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if(!match||(!match[1]&&!match[2])){res.writeHead(416,{...headers,'Content-Range':`bytes */${info.size}`});res.end();return true;}
      if(match[1]){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;}else start=Math.max(0,info.size-Number(match[2]));
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size){res.writeHead(416,{...headers,'Content-Range':`bytes */${info.size}`});res.end();return true;}
      status=206;headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length']=String(end-start+1);res.writeHead(status,headers);
    if(req.method==='HEAD')res.end();else{const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}
    return true;
  };
}
