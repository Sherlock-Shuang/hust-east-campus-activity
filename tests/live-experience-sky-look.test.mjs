import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import {createDefaultLiveState} from '../src/live-state.js';

// Execute the production coordinator with its external UI/network/effect
// boundaries replaced. Its refresh, reconnect callback and return paths remain
// unchanged; camera-limit behavior itself belongs to player-experience tests.
const source=readFileSync(new URL('../src/live-experience.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace('export function createLiveExperience','function createLiveExperience');
class Element {
  constructor(){this.handlers=new Map();this.nodes=new Map();this.children=[];this.dataset={};this.style={setProperty(){}};this.hidden=false;this.isConnected=true;this.contentWindow={postMessage(){}};const classes=new Set();this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),toggle(x,value){value?classes.add(x):classes.delete(x);}};}
  querySelector(selector){if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector);}
  querySelectorAll(){return [];}
  addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,new Set());this.handlers.get(type).add(fn);}
  removeEventListener(type,fn){this.handlers.get(type)?.delete(fn);}
  emit(type,values={}){for(const fn of this.handlers.get(type)||[])fn({target:this,...values});}
  append(child){this.children.push(child);}
  replaceChildren(...children){this.children=children;}
  setAttribute(){}
  focus(){}
  remove(){this.isConnected=false;}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function player(name='player'){
  const calls=[];
  return {name,calls,active:true,state:{x:0,y:.14,z:0},gate:undefined,
    setSkyQrVisible(value){this.gate=value;calls.push({kind:'gate',value});},
    captureActivityPose(){return {mode:'spider',view:'third',pitch:-1.5,skyQrVisible:true,state:{x:0,y:.14,z:0,yaw:0}};},
    restoreActivityPose(pose){calls.push({kind:'restore',gate:this.gate,pose});return true;}};
}
function fixture(t,{initialState={},initialPlayer=player(),savedPose,registered=true,interior=false}={}){
  const document=new Element(),window=new Element(),canvas=new Element(),container=new Element(),storage=new Map(),timers=new Map();let timerId=0;
  document.hidden=false;document.querySelector=()=>null;document.activeElement=canvas;document.createElement=()=>new Element();document.exitPointerLock=()=>{};
  const sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  window.sessionStorage=sessionStorage;
  if(savedPose)sessionStorage.setItem('campus-return-pose',JSON.stringify({audienceId:'audience-test',pose:savedPose}));
  let clientOptions,audienceOptions,currentPlayer=initialPlayer;
  const client={state:{...createDefaultLiveState(),...initialState},connected:true,now:()=>Date.now(),dispose(){}};
  const audience={registered,client:{identity:{id:'audience-test'},event:async()=>({})},phase(){},dispose(){}};
  const entry={id:'test-interior',kind:'building-interior',label:'Test interior',url:'/interior',workId:'opto-c118'};
  const context=vm.createContext({document,window,sessionStorage,location:{href:'http://localhost/',origin:'http://localhost',search:''},URL,URLSearchParams,Date,Math,JSON,Promise,queueMicrotask,AbortController,
    setInterval:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),setTimeout:()=>++timerId,clearTimeout(){},
    createClientId:()=> 'attempt-test',preflightExperience:async()=>({ok:true}),
    createLiveClient:options=>{clientOptions=options;return client;},
    mountAnnouncementNotice:()=>({update(){},dispose(){}}),projectWallTextRects:()=>[],avoidWallText:()=>0,isEventActive:()=>false,
    mountAudienceUI:(_root,options)=>{audienceOptions=options;return audience;},ACTIVITY_WORKS:[],mountMobileViewport:()=>()=>{},
    createSkyQrExperience:()=>({isOpen:false,refresh(){},dispose(){}}),
    nearbyInterior:()=>interior?entry:null,crossedInteriorDoor:()=>null,interiorReturnSnapshot:pose=>pose,interiorExitEntry:()=>entry,
    createActivityBridgeMessage:()=>({}),createCampusTsunami:()=>({active:false,resident:false,update:()=>false,setQuality:()=>false,releaseResources(){},dispose(){}}),
    mountCampusTsunamiNotice:()=>({update(){},dispose(){}}),campusEffectBudget:()=>({level:2}),getC118FloodElapsed:()=>null,
    createCivilizationPause:()=>({active:false,update(){},continueExploring:()=>false}),CIVILIZATION_PAUSE_MESSAGE:'paused',CIVILIZATION_CONTINUE_LABEL:'continue'});
  vm.runInContext(source,context,{filename:'src/live-experience.js'});
  const live=context.createLiveExperience({THREE,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),canvas,container,getPlayer:()=>currentPlayer,getInteriors:()=>interior?[entry]:[],setSuspended(){},invalidate(){},notify(){}});
  const root=container.children[0];t.after(()=>live.dispose());
  return {live,root,client,audience,initialPlayer,storage,setPlayer:value=>{currentPlayer=value;},
    async receive(patch){client.state={...client.state,...patch};clientOptions.onState(client.state);await flush();},
    async reconnect(patch){client.connected=false;clientOptions.onConnection(false);client.state={...client.state,...patch};client.connected=true;clientOptions.onConnection(true);clientOptions.onState(client.state);await flush();},
    async register(){audience.registered=true;audienceOptions.onChange();await flush();},
    refresh(){for(const callback of timers.values())callback();}};
}

test('live sky look follows strict host booleans on initial sync, show, hide and reconnect',async t=>{
  const f=fixture(t),p=f.initialPlayer;f.live.sync();assert.equal(p.gate,false);
  for(const value of [true,false,'true',1,null,undefined,true]){
    const before=p.calls.length;await f.receive({skyQrVisible:value});
    assert.equal(p.gate,value===true);assert.ok(p.calls.length>before,'each snapshot synchronizes the player');
  }
  await f.reconnect({skyQrVisible:false});assert.equal(p.gate,false,'reconnection applies a hide missed while disconnected');
  await f.reconnect({skyQrVisible:true});assert.equal(p.gate,true);
});

test('unchanged periodic refresh synchronizes late-created and replaced players',t=>{
  const f=fixture(t,{initialState:{skyQrVisible:true},initialPlayer:null});f.live.sync();
  const first=player('late');f.setPlayer(first);f.refresh();assert.equal(first.gate,true);
  const replacement=player('replacement');f.setPlayer(replacement);f.refresh();assert.equal(replacement.gate,true);
  replacement.gate=false;f.refresh();assert.equal(replacement.gate,true,'an unchanged UI signature does not skip current player synchronization');
});

for(const hostVisible of [false,true])test(`saved activity pose cannot override host sky flag ${hostVisible}`,t=>{
  const savedPose={mode:'spider',view:'third',pitch:-1.5,skyQrVisible:!hostVisible,state:{x:0,y:.14,z:0,yaw:0}};
  const f=fixture(t,{initialState:{skyQrVisible:hostVisible},savedPose}),p=f.initialPlayer;
  f.live.sync();const restoreIndex=p.calls.findIndex(call=>call.kind==='restore');
  assert.ok(restoreIndex>0,'the host sky flag is applied before pose restoration');
  assert.equal(p.calls[restoreIndex].gate,hostVisible);
  assert.equal(p.calls[restoreIndex-1].kind,'gate');assert.equal(p.calls[restoreIndex-1].value,hostVisible);
  assert.equal(p.gate,hostVisible);assert.ok(p.calls.filter(call=>call.kind==='gate').every(call=>call.value===hostVisible));
});

test('registration and delayed player creation synchronize before restoring a stored pose',async t=>{
  const f=fixture(t,{initialPlayer:null,registered:false,initialState:{skyQrVisible:false},savedPose:{mode:'spider',pitch:-1.5,skyQrVisible:true}});
  f.live.sync();await f.receive({skyQrVisible:true});await f.register();
  const p=player('registered-late');f.setPlayer(p);f.live.sync();
  const restore=p.calls.findIndex(call=>call.kind==='restore');assert.ok(restore>0);
  assert.equal(p.calls[restore-1].kind,'gate');assert.equal(p.calls[restore].gate,true);
});

test('interior return reapplies the current host flag before restoring an old overhead pose',async t=>{
  const f=fixture(t,{initialState:{skyQrVisible:true},interior:true}),p=f.initialPlayer;
  f.live.sync();f.root.querySelector('.live-portal-prompt').emit('click');assert.equal(f.live.portalOpen,true);
  await f.receive({skyQrVisible:false});p.calls.length=0;
  f.root.querySelector('.live-portal-bar button').emit('click');assert.equal(f.live.portalOpen,false);
  const restore=p.calls.findIndex(call=>call.kind==='restore');assert.ok(restore>0,'interior return must synchronize too');
  assert.equal(p.calls[restore-1].kind,'gate');assert.equal(p.calls[restore].gate,false);
  assert.equal(p.calls[restore].pose.skyQrVisible,true,'the stale pose remains input data, not authority for the gate');
});

test('optional sky-look API keeps older embedding players compatible',t=>{
  const p=player();delete p.setSkyQrVisible;const f=fixture(t,{initialPlayer:p,initialState:{skyQrVisible:true}});
  assert.doesNotThrow(()=>{f.live.sync();f.refresh();});
});
