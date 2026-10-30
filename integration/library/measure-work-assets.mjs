import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {brotliCompressSync,constants} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=path.join(root,'work-assets'),library=JSON.parse(await readFile(path.join(base,'library/performance-assets.json'),'utf8')),wanyan=JSON.parse(await readFile(path.join(base,'wanyan/performance-builds.json'),'utf8')),rows=[];
for(const [label,url]of [['library-original',library.library.original],['library-optimized',library.library.url],['hero-original',library.hero.original],['hero-optimized',library.hero.url],['wanyan-desktop-data',wanyan.desktop.dataUrl],['wanyan-mobile-data',wanyan.mobile.dataUrl]]){
 const bytes=await readFile(path.join(base,url.slice('/works/'.length))),brotli=brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:5}});rows.push({label,url,rawBytes:bytes.length,brotliQuality5Bytes:brotli.length});
}
const out=path.join(root,'artifacts/performance-phase2-20261030/asset-transfer.json');await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify({rows,scope:'Exact bytes from local Brotli quality=5 encoding; not a measured CDN response or download duration. Production transport settings may differ.'},null,2)+'\n');console.log(JSON.stringify({out,rows},null,2));
