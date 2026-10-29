import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtemp,mkdir,symlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {patchGamepad,skillPlugin,activityBuilder,prepareWanyanActivity} from './prepare-wanyan-activity.mjs';

test('skill bridge reports the native flags and values without estimating readiness',()=>{
 const functions={},window={};vm.runInNewContext(skillPlugin,{window,LibraryManager:{library:functions},mergeInto:(target,input)=>Object.assign(target,input)});
 functions.BookRealm_PublishSkill(50,100,50,0,7);assert.deepEqual(JSON.parse(JSON.stringify(window.bookrealmNativeSkill)),{version:1,focus:50,maxEnergy:100,cost:50,cooldown:0,charged:true,canCast:true,active:true});assert(Object.isFrozen(window.bookrealmNativeSkill));
 functions.BookRealm_PublishSkill(100,100,50,0,5);assert.equal(window.bookrealmNativeSkill.charged,true);assert.equal(window.bookrealmNativeSkill.canCast,false,'native action/health locks override apparently sufficient resources');
 functions.BookRealm_PublishSkill(49,100,50,0,4);assert.equal(window.bookrealmNativeSkill.charged,false);
 functions.BookRealm_PublishSkill(100,100,50,2,0);assert.equal(window.bookrealmNativeSkill.active,false);assert.equal(window.bookrealmNativeSkill.cooldown,2);
});
test('source patch fails closed on unknown or duplicate native bridge definitions',()=>{
 assert.throws(()=>patchGamepad('class ChangedGamepad {}'),/exactly one existing controls declaration/);
 assert.throws(()=>activityBuilder('class ChangedBuild {}'),/exactly one original build class/);
});
test('original project is protected through aliased output ancestors before cloning or launching Unity',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'campus-wanyan-patch-test-'));
 try{const original=path.join(root,'original');await mkdir(original);await symlink(original,path.join(root,'alias'));
 await assert.rejects(prepareWanyanActivity({sourceRoot:original,outputRoot:path.join(root,'alias/new/runtime'),unityEditor:'/unused-editor'}),/outside the original gift project/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('existing output files are not silently replaced by a fresh Unity build',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'campus-wanyan-output-test-'));
 try{const original=path.join(root,'original'),output=path.join(root,'output');await mkdir(original);await mkdir(output);
 await assert.rejects(prepareWanyanActivity({sourceRoot:original,outputRoot:output,unityEditor:'/unused-editor'}),/Output already exists/);
 }finally{await rm(root,{recursive:true,force:true});}
});
