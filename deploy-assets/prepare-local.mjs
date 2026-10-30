import {mkdir,mkdtemp,readFile,writeFile,open,rename,rm,lstat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {materialize,outputPath} from './materialize.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const sha=data=>createHash('sha256').update(data).digest('hex');

async function fileHash(file){const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(file)){hash.update(chunk);bytes+=chunk.length;}return {bytes,sha256:hash.digest('hex')};}
async function safeTarget(root,relative){
  let current=root;
  for(const part of relative.split('/').slice(0,-1)){
    current=path.join(current,part);
    try{const info=await lstat(current);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Generated work directory contains a symlink or non-directory');}
    catch(error){if(error.code!=='ENOENT')throw error;await mkdir(current);}
  }
  const target=path.join(root,relative);try{if((await lstat(target)).isSymbolicLink())throw new Error('Generated work file is a symlink');}catch(error){if(error.code!=='ENOENT')throw error;}
  return target;
}

/** npm prestart: restore original local service mappings from the Git asset pack. */
export async function prepareLocal({assetSource=path.join(here,'../asset-source'),workAssets=path.join(here,'../work-assets')}={}){
  const sourceText=await readFile(path.join(assetSource,'manifest.json'),'utf8'),source=JSON.parse(sourceText),fingerprint=sha(sourceText);
  if(source.schemaVersion!==2||source.format!=='campus-static-assets-gzip-v1')throw new Error('Unsupported local activity asset pack');
  const files=new Map(),entries=[];
  for(const [url,entry] of Object.entries(source.routes)){
    if(!['/works/library/','/works/wanyan/','/works/tasay/'].some(prefix=>url.startsWith(prefix)))continue;
    const file=outputPath(url).slice('works/'.length);
    if(!/^(library|wanyan|tasay)\//.test(file))throw new Error('Unexpected local work mapping');
    if(files.has(file)&&files.get(file).sha256!==entry.sha256)throw new Error('Conflicting local work mapping');
    files.set(file,entry);
    if(!url.startsWith('/works/tasay/'))entries.push({url,file,bytes:entry.bytes,sha256:entry.sha256,contentType:entry.mime,...(entry.immutable?{immutable:true}:{})});
  }
  for(const file of ['library/index.html','library/model.glb','wanyan/index.html','wanyan/Build/wanyan.data','tasay/index.html'])if(!files.has(file))throw new Error(`Required local work missing: ${file}`);
  await mkdir(workAssets,{recursive:true});const root=await realpath(workAssets);
  const cacheFile=path.join(root,'.local-assets.json'),libraryFile=path.join(root,'library-manifest.json');
  const libraryText=JSON.stringify({schemaVersion:1,generatedBy:'deploy-assets/prepare-local.mjs',assetSourceFingerprint:fingerprint,prefixes:['/works/library/','/works/wanyan/'],entries},null,2)+'\n';
  let cache;try{cache=JSON.parse(await readFile(cacheFile,'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  async function verifyExisting(){
    try{
      if(await readFile(libraryFile,'utf8')!==libraryText)return false;
      for(const [file,expected] of files){
        const target=await realpath(path.join(root,file));if(!target.startsWith(root+path.sep))return false;
        const actual=await fileHash(target);if(actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)return false;
      }
      return true;
    }catch(error){if(['ENOENT','ENOTDIR','EISDIR'].includes(error.code))return false;throw error;}
  }
  // Reading and hashing existing bytes is intentionally cheaper than unpacking
  // them again, and detects same-size edits that an mtime/size-only cache misses.
  if(cache?.version===1&&cache.fingerprint===fingerprint&&await verifyExisting())return {prepared:false,reason:'verified-existing',files:files.size,bytes:cache.bytes,fingerprint};
  const lockFile=path.join(root,'.local-assets.lock');let lock;
  try{lock=await open(lockFile,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('Another local asset preparation is running; wait for it before starting again.');throw error;}
  let stage;
  try{
    await lock.writeFile(String(process.pid));stage=await mkdtemp(path.join(root,'.local-restore-'));
    await materialize({assetSource,outputDir:stage,includeCampus:false,configFile:false});
    for(const [file] of files){const target=await safeTarget(root,file);await rename(path.join(stage,'works',file),target);}
    const bytes=[...files.values()].reduce((sum,entry)=>sum+entry.bytes,0);
    const libraryTemp=await safeTarget(root,'library-manifest.json.local-preparing');await writeFile(libraryTemp,libraryText);await rename(libraryTemp,await safeTarget(root,'library-manifest.json'));
    const cacheTemp=await safeTarget(root,'.local-assets.json.local-preparing');await writeFile(cacheTemp,JSON.stringify({version:1,fingerprint,files:files.size,bytes})+'\n');await rename(cacheTemp,await safeTarget(root,'.local-assets.json'));
    return {prepared:true,reason:cache?.fingerprint===fingerprint?'missing-or-invalid-file':'new-asset-manifest',files:files.size,bytes,fingerprint};
  }finally{if(stage)await rm(stage,{recursive:true,force:true});await lock.close();await rm(lockFile,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  console.log(JSON.stringify(await prepareLocal({assetSource:get('--assets'),workAssets:get('--output')}),null,2));
}
