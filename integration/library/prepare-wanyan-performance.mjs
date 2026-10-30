/** Install a verified ASTC Mobile build alongside the preserved desktop runtime. */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadWanyanRuntime} from './wanyan-runtime.mjs';
import {publicWanyanData} from './wanyan-public-text.mjs';
import {applyWanyanQuality} from './wanyan-quality.mjs';
import {updateWorkAssets} from '../../deploy-assets/update-work-assets.mjs';
import {prepareLocal} from '../../deploy-assets/prepare-local.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),assets=path.join(root,'work-assets'),files=[],hash=b=>createHash('sha256').update(b).digest('hex');
const buildRoot=path.join(root,'work-assets-source/wanyan-mobile'),provenance=JSON.parse(await readFile(path.join(buildRoot,'provenance.json'),'utf8'));
if(provenance.build.qualityProfile!=='Mobile'||provenance.build.textureSubtarget!=='ASTC')throw new Error('Only the real reviewed Mobile ASTC build is allowed');
const {files:mobileFiles}=await loadWanyanRuntime(buildRoot);
async function versioned(bytes,name){const sha=hash(bytes),file=`wanyan/assets/${sha}/${name}`;await mkdir(path.dirname(path.join(assets,file)),{recursive:true});await writeFile(path.join(assets,file),bytes);files.push(file);return '/works/'+file;}
const desktop={qualityProfile:'PC'},mobile={qualityProfile:'Mobile',textureSubtarget:'ASTC',build:provenance.build,validation:provenance.validation},sizes={desktop:{},mobile:{}};
for(const [name,key] of [['wanyan.loader.js','loaderUrl'],['wanyan.framework.js','frameworkUrl'],['wanyan.wasm','codeUrl'],['wanyan.data','dataUrl']]){
 const original=await readFile(path.join(assets,'wanyan/Build',name));desktop[key]=await versioned(original,name);sizes.desktop[name]=original.length;
 let bytes=mobileFiles.get('Build/'+name);if(name.endsWith('.data'))bytes=publicWanyanData(bytes);
 mobile[key]=await versioned(bytes,name);sizes.mobile[name]=bytes.length;
}
const config={schemaVersion:2,desktop,mobile};
await writeFile(path.join(assets,'wanyan/performance-builds.json'),JSON.stringify(config,null,2)+'\n');files.push('wanyan/performance-builds.json');
await copyFile(path.join(root,'integration/library/wanyan-quality.mjs'),path.join(assets,'wanyan/wanyan-quality.mjs'));files.push('wanyan/wanyan-quality.mjs');
const index=path.join(assets,'wanyan/index.html');await writeFile(index,applyWanyanQuality(await readFile(index,'utf8')));files.push('wanyan/index.html');
const updated=await updateWorkAssets({files}),prepared=await prepareLocal(),report={files,sizes,config,updated,prepared,build:provenance.build,validation:provenance.validation};
await mkdir(path.join(root,'artifacts/performance-phase2-20261030'),{recursive:true});await writeFile(path.join(root,'artifacts/performance-phase2-20261030/wanyan-assets.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
