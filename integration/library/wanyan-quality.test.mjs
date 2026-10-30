import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectWanyanQuality,supportsAstc,applyWanyanQuality} from './wanyan-quality.mjs';
const manifest={desktop:{id:'desktop'},mobile:{id:'mobile',textureSubtarget:'ASTC'}};
test('mobile selection checks real ASTC capability and keeps a complete desktop fallback',()=>{
 assert.equal(selectWanyanQuality({manifest,mobile:true,astc:true}).variant.id,'desktop','larger ASTC candidate is opt-in until physical-device measurement');
 assert.equal(selectWanyanQuality({manifest,mobile:true,astc:false}).variant.id,'desktop');
 assert.equal(selectWanyanQuality({manifest,mobile:false,astc:true}).variant.id,'desktop');
 assert.equal(selectWanyanQuality({manifest,mobile:true,astc:true,requested:'desktop'}).variant.id,'desktop');
 assert.equal(selectWanyanQuality({manifest,mobile:false,astc:true,requested:'mobile'}).variant.id,'mobile');
 assert.equal(selectWanyanQuality({manifest:{desktop:manifest.desktop},mobile:true,astc:true}).variant.id,'desktop');
});
test('capability probe disposes its temporary GL context, including unsupported devices',()=>{
 for(const astc of [true,false]){let lost=0,removed=0;
  assert.equal(supportsAstc(()=>({getContext:()=>({getExtension:name=>name==='WEBGL_compressed_texture_astc'?(astc?{}:null):{loseContext(){lost++;}}}),remove(){removed++;}})),astc);
  assert.equal(lost,1);assert.equal(removed,1);
 }
 assert.equal(supportsAstc(()=>({getContext(){throw new Error('GPU denied');},remove(){}})),false);
});
test('quality transform is scoped to the activity loader and retains game readiness, pointer-lock and touch hooks',async()=>{
 const current=await readFile(new URL('../../work-assets/wanyan/index.html',import.meta.url),'utf8');
 const transformed=applyWanyanQuality(current);assert.equal(applyWanyanQuality(transformed),transformed);
 assert(transformed.includes('qualityController.abort()'));assert(transformed.includes("ready('runtime_ready')"));assert(transformed.includes('campusWanyanTouchReady'));
 assert.throws(()=>applyWanyanQuality('<html>another runtime</html>'),/runtime changed/);
});
test('real compiled Mobile build preserves skill observations and reports actual ASTC build parameters',async()=>{
 const config=JSON.parse(await readFile(new URL('../../work-assets/wanyan/performance-builds.json',import.meta.url),'utf8')),provenance=config.mobile;
 assert.equal(provenance.build.result,'Succeeded');assert.equal(provenance.build.errors,0);assert.equal(provenance.build.qualityProfile,'Mobile');assert.equal(provenance.build.textureSubtarget,'ASTC');assert.equal(provenance.validation.skillPropertyChecks,14);
 const wasm=await WebAssembly.compile(await readFile(new URL('../../work-assets/'+config.mobile.codeUrl.slice('/works/'.length),import.meta.url)));
 assert(WebAssembly.Module.imports(wasm).some(entry=>entry.name==='BookRealm_PublishSkill'));
});
