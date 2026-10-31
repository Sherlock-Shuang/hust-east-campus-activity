import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createC118CodexScreen} from '../src/c118-codex-screen.js';

function fixture(){
 const texts=[],images=[],toggles=[],children=[],invalidations=[],measurements=[];
 const ctx={save(){},restore(){},scale(){},beginPath(){},moveTo(){},arcTo(){},closePath(){},fill(){},stroke(){},fillRect(){},rect(){},clip(){},drawImage(){},fillText(value){texts.push(value);},measureText(value){measurements.push(value);return {width:value.length*10};}};
 const element=()=>({value:'',disabled:false,listeners:new Map(),setAttribute(){},addEventListener(type,fn){this.listeners.set(type,fn);},dispatch(type,event={preventDefault(){}}){this.listeners.get(type)?.(event);},focus(){},remove(){this.removed=true;}});
 const input=element(),form=element(),send=element(),close=element(),newChat=element(),replyStatus=element(),dialog=element();
 form.requestSubmit=()=>form.dispatch('submit');dialog.querySelector=selector=>({'textarea':input,'form':form,'[type="submit"]':send,'.hc-close':close,'.hc-new-chat':newChat,'output':replyStatus})[selector];
 dialog.show=()=>{dialog.open=true;};dialog.showModal=()=>{throw new Error("must not make the whole hall inert");};dialog.close=()=>{dialog.open=false;dialog.dispatch('close');};
 const document={activeElement:{focus(){}},body:{append(child){children.push(child);}},createElement(tag){if(tag==='canvas')return {getContext:()=>ctx};if(tag==='dialog')return dialog;if(tag==='img'){const img={complete:false,naturalWidth:0};images.push(img);return img;}throw new Error(tag);}};
 const screen=new THREE.Mesh(new THREE.PlaneGeometry(9.8,6),new THREE.MeshBasicMaterial());screen.position.set(0,4,-16);screen.visible=false;
 const control=createC118CodexScreen({THREE,screen,document,onOpenChange:open=>toggles.push(open),onInvalidate:()=>invalidations.push(true)});
 return {control,screen,dialog,input,form,send,close,images,texts,toggles,children,invalidations,newChat,replyStatus,measurements};
}
const host={mediaId:'codex',revision:1,codexText:'主持人内容'};
test('Codex paints directly on the supplied stage video mesh with the same 16:9 fit',()=>{
 const f=fixture(),geometry=f.screen.geometry,material=f.screen.material,position=f.screen.position.clone();
 f.control.select(host);const texture=f.screen.material.map;
 assert.ok(texture.isCanvasTexture);assert.equal(texture.image.width,2560);assert.equal(texture.image.height,1440);
 assert.equal(f.screen.geometry,geometry);assert.equal(f.screen.material,material);assert.deepEqual(f.screen.position,position);
 assert.ok(Math.abs(9.8*f.screen.scale.x/(6*f.screen.scale.y)-16/9)<1e-10);assert.equal(f.screen.visible,true);
 assert.ok(f.texts.includes(host.codexText));const paints=f.texts.length;
 f.control.select(host);assert.equal(f.texts.length,paints);assert.equal(f.screen.material.map,texture);assert.equal(f.dialog.open,undefined);
 let freed=0;texture.addEventListener('dispose',()=>freed++);f.control.dispose();f.control.dispose();assert.equal(freed,1);assert.equal(f.dialog.removed,true);
});
test('local replies and drafts appear on the physical screen without sending anything to the host',()=>{
 const f=fixture();f.control.select(host);f.control.open();assert.ok(f.control.isOpen);assert.deepEqual(f.toggles,[true]);
 f.input.value='只在我的大屏显示';f.input.dispatch('input');assert.equal(f.send.disabled,false);assert.ok(f.texts.includes(f.input.value));assert.equal(f.invalidations.length,3,'host, focus and draft each invalidate the stage even while movement is frozen');
 f.form.requestSubmit();assert.equal(f.input.value,'');assert.equal(f.send.disabled,true);assert.ok(f.texts.includes('只在我的大屏显示'));assert.equal(host.codexText,'主持人内容');
 f.close.dispatch('click');assert.equal(f.control.isOpen,false);assert.deepEqual(f.toggles,[true,false]);f.control.dispose();
});
test('switching back to video closes the composer; late icon loads cannot reclaim video texture',()=>{
 const f=fixture();f.control.select(host);f.control.open();const callbacks=f.images.map(img=>img.onload);f.control.select({mediaId:'club-promo',revision:2});
 assert.equal(f.control.isOpen,false);const video=new THREE.Texture();f.screen.material.map=video;f.screen.scale.set(1,.7,1);
 callbacks.forEach(fn=>fn());assert.equal(f.screen.material.map,video);assert.equal(f.screen.scale.y,.7);
 f.control.select({...host,revision:3,codexText:'回来继续'});assert.ok(f.texts.includes('回来继续'));assert.notEqual(f.screen.material.map,video);
 f.control.dispose();callbacks.forEach(fn=>fn());assert.equal(f.screen.material.map,null);
});

const uv=(x,y)=>({x:x/1280,y:1-y/720});
test('painted stage controls open a nonmodal editor, submit and start a genuinely empty local chat',()=>{
 const f=fixture();f.control.select(host);
 assert.equal(f.control.activate(uv(750,625)),true);assert.equal(f.dialog.open,true);
 f.input.value='从屏幕发送';f.input.dispatch('input');assert.equal(f.control.activate(uv(1230,680)),true);
 assert.ok(f.texts.includes('从屏幕发送'));assert.equal(f.replyStatus.textContent,'已显示在你的大屏');
 f.input.value='未发送草稿';f.input.dispatch('input');f.texts.length=0;
 assert.equal(f.control.activate(uv(120,117)),true);assert.equal(f.input.value,'');assert.ok(f.texts.includes('我们来构建点什么？'));assert.ok(!f.texts.includes(host.codexText));
 f.control.select(host);assert.ok(!f.texts.includes(host.codexText),'unchanged host snapshot must not undo new chat');
 assert.equal(f.control.activate(uv(500,350)),true);assert.ok(f.input.value.includes('项目的结构'));
 f.control.dispose();assert.equal(f.input.value,'');
});
test('local new chat does not affect another viewer; a new host command still arrives after clearing',()=>{
 const a=fixture(),b=fixture();a.control.select(host);b.control.select(host);a.control.open();a.input.value='个人草稿';a.input.dispatch('input');a.newChat.dispatch('click');
 assert.equal(a.input.value,'');assert.ok(b.texts.includes(host.codexText));a.texts.length=0;
 a.control.select({...host,revision:2,codexText:'新的主持人消息'});assert.ok(a.texts.includes('新的主持人消息'));
 a.control.close();assert.equal(a.control.isOpen,false);assert.equal(a.dialog.open,false);a.control.dispose();b.control.dispose();
});

test('typing a draft does not remeasure a long existing transcript on every input event',()=>{
 const f=fixture();f.control.select({...host,codexText:'长消息'.repeat(1300)});f.control.open();f.measurements.length=0;
 f.input.value='短回复';f.input.dispatch('input');assert.ok(f.measurements.length<20,'only the short draft needs wrapping');f.control.dispose();
});
test('reply, clear and disposal never invoke network or browser storage APIs',()=>{
 const keys=['fetch','localStorage','sessionStorage'],previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 try{
  for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,get(){throw new Error('Unexpected reply persistence or network: '+key);}});
  const f=fixture();f.control.select(host);f.control.open();f.input.value='不留存的内容';f.input.dispatch('input');f.form.requestSubmit();f.newChat.dispatch('click');f.control.dispose();
 }finally{keys.forEach((key,i)=>{if(previous[i])Object.defineProperty(globalThis,key,previous[i]);else delete globalThis[key];});}
});
