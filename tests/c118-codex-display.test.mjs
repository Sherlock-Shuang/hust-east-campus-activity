import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createC118CodexScreen} from '../src/c118-codex-screen.js';

function fixture(){
 const texts=[],images=[],toggles=[],children=[],invalidations=[];
 const ctx={save(){},restore(){},scale(){},beginPath(){},moveTo(){},arcTo(){},closePath(){},fill(){},stroke(){},fillRect(){},rect(){},clip(){},drawImage(){},fillText(value){texts.push(value);},measureText(value){return {width:value.length*10};}};
 const element=()=>({value:'',disabled:false,listeners:new Map(),setAttribute(){},addEventListener(type,fn){this.listeners.set(type,fn);},dispatch(type,event={preventDefault(){}}){this.listeners.get(type)?.(event);},focus(){},remove(){this.removed=true;}});
 const input=element(),form=element(),send=element(),close=element(),dialog=element();
 form.requestSubmit=()=>form.dispatch('submit');dialog.querySelector=selector=>({'textarea':input,'form':form,'[type="submit"]':send,'.hc-close':close})[selector];
 dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.dispatch('close');};
 const document={activeElement:{focus(){}},body:{append(child){children.push(child);}},createElement(tag){if(tag==='canvas')return {getContext:()=>ctx};if(tag==='dialog')return dialog;if(tag==='img'){const img={complete:false,naturalWidth:0};images.push(img);return img;}throw new Error(tag);}};
 const screen=new THREE.Mesh(new THREE.PlaneGeometry(9.8,6),new THREE.MeshBasicMaterial());screen.position.set(0,4,-16);screen.visible=false;
 const control=createC118CodexScreen({THREE,screen,document,onOpenChange:open=>toggles.push(open),onInvalidate:()=>invalidations.push(true)});
 return {control,screen,dialog,input,form,send,close,images,texts,toggles,children,invalidations};
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
