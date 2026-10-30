/** Update an explicit public runtime whitelist; never scan an authoring project. */
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isVersionedWorkAsset} from '../integration/library/versioned-assets.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
const mime={'.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.html':'text/html; charset=utf-8','.glb':'model/gltf-binary','.wasm':'application/wasm','.data':'application/octet-stream','.txt':'text/plain; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
export async function updateWorkAssets({files,assetSource=path.join(here,'../asset-source'),workAssets=path.join(here,'../work-assets')}={}){
 if(!Array.isArray(files)||!files.length)throw new Error('Explicit public runtime files required');
 const root=await realpath(workAssets),manifestPath=path.join(assetSource,'manifest.json'),source=await readFile(manifestPath,'utf8'),manifest=JSON.parse(source),changes=[];
 if(manifest.schemaVersion!==2||manifest.format!=='campus-static-assets-gzip-v1')throw new Error('Unsupported activity asset pack');
 for(const file of files){
  if(!/^(?:library|wanyan|tasay)\//.test(file)||file.split('/').some(p=>['.','..',''].includes(p))||!mime[path.extname(file)])throw new Error('Not a public runtime path: '+file);
  const absolute=await realpath(path.join(root,file));if(!absolute.startsWith(root+path.sep))throw new Error('Runtime escapes work-assets');
  const bytes=await readFile(absolute),sha256=hash(bytes),url='/works/'+file,chunks=[];
  for(let offset=0;offset<bytes.length;offset+=16*1024*1024){const part=bytes.subarray(offset,offset+16*1024*1024),compressed=gzipSync(part,{level:9}),name=hash(compressed)+'.bin';await writeFile(path.join(assetSource,'chunks',name),compressed);chunks.push({url:'/_activity_assets/'+name,encoding:'gzip',bytes:part.length,storedBytes:compressed.length,sha256:hash(part)});}
  const entry={chunks,mime:mime[path.extname(file)],bytes:bytes.length,sha256};if(isVersionedWorkAsset(url,sha256))entry.immutable=true;
  const old=manifest.routes[url];manifest.routes[url]=entry;
  // Existing aliases retain the exact same new document, without adding routes
  // outside the explicit library/Wanyan runtime families.
  if(file.endsWith('/index.html')){const alias='/works/'+file.slice(0,-10);if(manifest.routes[alias])manifest.routes[alias]=entry;}
  changes.push({url,before:old?.sha256||null,sha256,bytes:bytes.length,immutable:!!entry.immutable});
 }
 if(await readFile(manifestPath,'utf8')!==source)throw new Error('Manifest changed during asset update');
 await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');return {changes};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const list=JSON.parse(await readFile(process.argv[2],'utf8'));console.log(JSON.stringify(await updateWorkAssets({files:list}),null,2));
}
