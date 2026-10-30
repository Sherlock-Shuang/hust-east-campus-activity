/** Refresh only the small, public activity wrappers in the existing asset pack.
 * Models, Unity builds, story, and the original gift project are never read. */
import {readFile,writeFile,rename} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const wrappers=Object.freeze([
  ['/works/library/activity-adapter.js','activity-adapter.js'],
  ['/works/wanyan/activity-adapter.js','activity-adapter.js'],
  ['/works/wanyan/wanyan-touch.mjs','wanyan-touch.mjs'],
]);
export async function syncActivityAdapters({assetSource=path.join(here,'../../asset-source'),sourceRoot=here}={}){
  const manifestFile=path.join(assetSource,'manifest.json'),before=await readFile(manifestFile,'utf8'),manifest=JSON.parse(before);
  if(manifest.schemaVersion!==2||manifest.format!=='campus-static-assets-gzip-v1')throw new Error('Unsupported activity asset pack');
  const updates=[],chunks=new Map();
  for(const [url,file] of wrappers){
    const current=manifest.routes?.[url];if(!current||!current.mime?.startsWith('text/javascript'))throw new Error(`Missing expected wrapper route: ${url}`);
    const raw=await readFile(path.join(sourceRoot,file));
    if(raw.length>64*1024)throw new Error(`Unexpected activity wrapper size: ${file}`);
    const hash=sha(raw);if(current.sha256===hash&&current.bytes===raw.length)continue;
    const compressed=gzipSync(raw,{level:9}),name=sha(compressed)+'.bin';chunks.set(name,compressed);
    manifest.routes[url]={...current,bytes:raw.length,sha256:hash,chunks:[{url:'/_activity_assets/'+name,encoding:'gzip',bytes:raw.length,storedBytes:compressed.length,sha256:hash}]};
    updates.push({url,before:current.sha256,sha256:hash,bytes:raw.length});
  }
  if(!updates.length)return {updated:[],newChunks:0};
  for(const [name,bytes] of chunks)await writeFile(path.join(assetSource,'chunks',name),bytes);
  if(await readFile(manifestFile,'utf8')!==before)throw new Error('Asset manifest changed concurrently; retry without replacing it');
  const temporary=manifestFile+`.activity-${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(manifest,null,2)+'\n');await rename(temporary,manifestFile);
  // Keep formerly referenced chunks: deleting them could invalidate an old
  // deployment or another in-flight preparation that holds its manifest.
  return {updated:updates,newChunks:chunks.size};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await syncActivityAdapters(),null,2));
