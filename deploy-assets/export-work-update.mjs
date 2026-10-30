/** Read-only deployment-to-local update plan. Does not overwrite the local project. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {outputPath} from './materialize.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const base=arg('--base','a120315'),manifest=JSON.parse(await readFile(path.join(root,'asset-source/manifest.json'),'utf8')),previous=JSON.parse(execFileSync('git',['show',base+':asset-source/manifest.json'],{cwd:root,encoding:'utf8'}));
const files=new Map(),entries=[];
for(const [url,entry]of Object.entries(manifest.routes)){
 if(!/^\/works\/(library|wanyan|tasay)\//.test(url)||previous.routes[url]?.sha256===entry.sha256)continue;
 const file=outputPath(url).slice('works/'.length),prior=previous.routes[url];
 const existing=files.get(file);if(existing&&existing.sha256!==entry.sha256)throw new Error('Conflicting aliases: '+file);
 files.set(file,{file,bytes:entry.bytes,sha256:entry.sha256,expectedPreviousSha256:prior?.sha256||existing?.expectedPreviousSha256||null});
 if(!url.startsWith('/works/tasay/'))entries.push({url,file,bytes:entry.bytes,sha256:entry.sha256,contentType:entry.mime,...(entry.immutable?{immutable:true}:{})});
}
const report={schemaVersion:1,base,files:[...files.values()],libraryManifestEntries:entries,preserveMetadata:['sourceChecks','unityRuntime','transforms'],scope:'Copy only these reviewed runtime files from materialized work-assets after checking destination hashes. Upsert library manifest entries; preserve all other local files and manifest metadata. Do not copy source projects, .staging, .tools or asset-source into the non-Git local project.'};
const output=path.resolve(arg('--output',path.join(root,'artifacts/performance-phase2-20261030/work-assets-update.json')));await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,files:files.size,entries:entries.length}));
