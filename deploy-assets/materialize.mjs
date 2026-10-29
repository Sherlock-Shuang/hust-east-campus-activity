import {mkdir,readFile,writeFile,open,rename,rm,realpath,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const digest=data=>createHash('sha256').update(data).digest('hex');
const regexEscape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export function outputPath(url){
  if(typeof url!=='string'||!url.startsWith('/')||/[\\?#\x00-\x1f]/.test(url)||url.split('/').some(p=>p==='..'||p==='.'))throw new Error('Unsafe static URL');
  if(url==='/')return 'index.html';
  if(url==='/admin')return 'admin.html';
  if(url==='/api/games'||url==='/works/library/api/games')return 'works/library/api/games.json';
  return url.slice(1)+(url.endsWith('/')?'index.html':'');
}
export function createRoutes(manifest){
  // This fragment intentionally puts the static games availability JSON ahead
  // of the single API function, and puts that API ahead of the ta-say SPA.
  const routes=[{src:'^/(.*)$',headers:{'X-Content-Type-Options':'nosniff'},continue:true}];
  for(const [url,entry] of Object.entries(manifest.routes)){
    const source='^'+regexEscape(encodeURI(url))+'$';
    const hashedAsset=url.startsWith('/assets/')||url.startsWith('/works/tasay/assets/');
    const mutableDocument=/^(?:text\/(?:html|javascript|css)|application\/json)/.test(entry.mime);
    routes.push({src:source,headers:{'Content-Type':entry.mime,'Cache-Control':hashedAsset?'public, max-age=31536000, immutable':mutableDocument?'no-cache':'public, max-age=3600'},continue:true});
  }
  routes.push(
    {src:'^/api/games/?$',dest:'/works/library/api/games.json',methods:['GET','HEAD']},
    {src:'^/works/library/api/games/?$',dest:'/works/library/api/games.json',methods:['GET','HEAD']},
    {src:'^/admin/?$',dest:'/admin.html'},
    ...['library','wanyan','tasay','she-love-me'].map(work=>({src:`^/works/${work}$`,status:308,headers:{Location:`/works/${work}/`}})),
    {src:'^/works/library/games/isaac$',status:308,headers:{Location:'/works/library/games/isaac/'}},
    {src:'^/works/she-love-me/(?:index\\.html|project\\.(?:css|js))?$',headers:{'Cache-Control':'no-cache'},continue:true},
    {src:'^/works/she-love-me/$',dest:'/works/she-love-me/index.html',methods:['GET','HEAD']},
    {src:'^/api/(.*)$',dest:'/api/activity?__activity_path=$1'},
    {handle:'filesystem'},
    {src:'^/works/tasay/(?!api(?:/|$)|assets(?:/|$))[^.]*$',dest:'/works/tasay/index.html',methods:['GET','HEAD']},
    {src:'^/works/.*$',status:404}
  );
  return {routes};
}
async function safeTarget(root,relative){
  const base=await realpath(root),parts=relative.split('/');let current=base;
  for(const part of parts.slice(0,-1)){
    current=path.join(current,part);try{const info=await lstat(current);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Invalid output directory');}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(current);}
  }
  const target=path.join(base,relative);try{if((await lstat(target)).isSymbolicLink())throw new Error('Refusing symlink output');}catch(error){if(error.code!=='ENOENT')throw error;}
  return target;
}
/** Materialize static files at build time. No runtime asset function is needed. */
export async function materialize({assetSource=path.join(here,'../asset-source'),outputDir=path.join(here,'../dist'),includeCampus=false,configFile=path.join(here,'routes.generated.json')}={}){
  const sourceRoot=await realpath(assetSource),manifest=JSON.parse(await readFile(path.join(sourceRoot,'manifest.json'),'utf8'));
  if(manifest.schemaVersion!==2||manifest.format!=='campus-static-assets-gzip-v1')throw new Error('Unsupported static source manifest');
  await mkdir(outputDir,{recursive:true});const outputs=new Map();
  for(const [url,entry] of Object.entries(manifest.routes)){
    if(!includeCampus&&!url.startsWith('/works/')&&url!=='/api/games')continue;
    const file=outputPath(url);if(outputs.has(file)&&outputs.get(file).sha256!==entry.sha256)throw new Error(`Conflicting static route: ${url}`);outputs.set(file,entry);
  }
  let totalBytes=0,maximumStaticFileBytes=0;
  for(const [file,entry] of outputs){
    const target=await safeTarget(outputDir,file),temporary=target+'.materializing';
    try{if((await lstat(temporary)).isSymbolicLink())throw new Error('Refusing symlink temporary output');}catch(error){if(error.code!=='ENOENT')throw error;}
    const handle=await open(temporary,'w'),whole=createHash('sha256');let bytes=0;
    try{
      for(const chunk of entry.chunks){
        if(chunk.encoding!=='gzip'||!/^\/_activity_assets\/[a-f0-9]{64}\.bin$/.test(chunk.url)||chunk.storedBytes>=50*1024*1024||chunk.bytes>16*1024*1024)throw new Error('Invalid compressed source chunk');
        const source=await realpath(path.join(sourceRoot,'chunks',path.basename(chunk.url)));
        if(!source.startsWith(sourceRoot+path.sep))throw new Error('Source chunk escapes whitelist');
        const compressed=await readFile(source);if(compressed.length!==chunk.storedBytes||digest(compressed)!==path.basename(chunk.url,'.bin'))throw new Error(`Compressed asset hash mismatch: ${file}`);
        const raw=gunzipSync(compressed,{maxOutputLength:16*1024*1024});if(raw.length!==chunk.bytes||digest(raw)!==chunk.sha256)throw new Error(`Decompressed asset hash mismatch: ${file}`);
        whole.update(raw);bytes+=raw.length;
        for(let offset=0;offset<raw.length;){const written=await handle.write(raw,offset,raw.length-offset);offset+=written.bytesWritten;}
      }
      if(bytes!==entry.bytes||whole.digest('hex')!==entry.sha256)throw new Error(`Static file hash mismatch: ${file}`);
    }catch(error){await handle.close();await rm(temporary,{force:true});throw error;}
    await handle.close();await rename(temporary,target);totalBytes+=bytes;maximumStaticFileBytes=Math.max(maximumStaticFileBytes,bytes);
  }
  // Normal app builds retain their freshly compiled index/assets. The route
  // fragment must be merged before deploying; it is not a runtime handler.
  if(configFile){await mkdir(path.dirname(configFile),{recursive:true});await writeFile(configFile,JSON.stringify(createRoutes(manifest),null,2)+'\n');}
  return {files:outputs.size,bytes:totalBytes,maximumStaticFileBytes,includeCampus,outputDir,configFile};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  console.log(JSON.stringify(await materialize({assetSource:get('--assets'),outputDir:get('--output'),configFile:get('--config'),includeCampus:args.includes('--include-campus')}),null,2));
}
