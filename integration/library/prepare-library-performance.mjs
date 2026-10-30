/** Install reviewed activity derivatives and public runtime helpers into the
 * existing pack. Run optimize-library-assets.mjs first; originals stay intact. */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyLibraryPerformance} from './library-performance.mjs';
import {updateWorkAssets} from '../../deploy-assets/update-work-assets.mjs';
import {prepareLocal} from '../../deploy-assets/prepare-local.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..'),assets=path.join(root,'work-assets'),stage=path.join(root,'.staging/library-optimized');
const hash=b=>createHash('sha256').update(b).digest('hex'),report=JSON.parse(await readFile(path.join(stage,'report.json'),'utf8')),files=[];
async function versioned(source,name){const bytes=await readFile(source),sha=hash(bytes),file=`library/assets/${sha}/${name}`;await mkdir(path.dirname(path.join(assets,file)),{recursive:true});await writeFile(path.join(assets,file),bytes);files.push(file);return '/works/'+file;}
const library=await versioned(path.join(stage,report.assets.model.file),'model.glb'),hero=await versioned(path.join(stage,report.assets.hero.file),'hero.glb'),decoder=await versioned(path.join(stage,'meshopt-decoder.mjs'),'meshopt-decoder.mjs');
await versioned(path.join(root,'.tools/asset-optimizer/node_modules/meshoptimizer/LICENSE.md'),'meshopt-LICENSE.txt');
const config={schemaVersion:2,library:{url:library,original:'/works/library/model.glb'},hero:{url:hero,original:'/works/library/hero.glb'},meshoptDecoder:decoder};
await writeFile(path.join(assets,'library/performance-assets.json'),JSON.stringify(config,null,2)+'\n');files.push('library/performance-assets.json');
await copyFile(path.join(here,'library-asset-runtime.mjs'),path.join(assets,'library/library-asset-runtime.mjs'));files.push('library/library-asset-runtime.mjs');
const main=path.join(assets,'library/hub/main.mjs');await writeFile(main,applyLibraryPerformance(await readFile(main,'utf8')));files.push('library/hub/main.mjs');
const index=path.join(assets,'library/index.html');await writeFile(index,(await readFile(index,'utf8')).replace(/main\.mjs\?v=[^"']+/, 'main.mjs?v=assets-v2-20261030'));files.push('library/index.html');
const updated=await updateWorkAssets({files}),prepared=await prepareLocal();
const artifacts=path.join(root,'artifacts/performance-phase2-20261030');await mkdir(artifacts,{recursive:true});
await writeFile(path.join(artifacts,'library-assets.json'),JSON.stringify({report,config,updated,prepared,scope:'No original birthday source or original GLB was modified; ?assets=original selects preserved models.'},null,2)+'\n');
console.log(JSON.stringify({files,prepared,config},null,2));
