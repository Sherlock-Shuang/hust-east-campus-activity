import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';
import * as THREE from 'three';
import {createDefaultLiveState} from '../../src/live-state.js';
import {activityPortals} from '../../src/activity-catalog.js';
import {CAMPUS_TSUNAMI_PLACEMENT as wave} from '../../src/campus-tsunami-timeline.js';
const {JSDOM}=createRequire(process.env.TASAY_SOURCE?path.join(process.env.TASAY_SOURCE,'package.json'):new URL('./.staging/package.json',import.meta.url))('jsdom');
// Bundle the actual dependency graph into the DOM realm. Stripping every import
// silently omitted newly added viewport, announcement, entry and effect helpers.
// Only network transport / audience identity stay controlled by this fixture.
const bundled=await build({entryPoints:[fileURLToPath(new URL('../../src/live-experience.js',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'CampusEntryUnderTest',platform:'browser',loader:{'.css':'empty'},
  plugins:[{name:'entry-test-network-boundary',setup(builder){
    builder.onResolve({filter:/(?:^|\/)(?:live-client|audience-ui)\.js$/},args=>({path:args.path,namespace:'entry-test-network'}));
    builder.onLoad({filter:/.*/,namespace:'entry-test-network'},args=>({contents:args.path.endsWith('/live-client.js')
      ?'export const createLiveClient=options=>globalThis.__entryNetwork.createLiveClient(options);'
      :'export const mountAudienceUI=(...args)=>globalThis.__entryNetwork.mountAudienceUI(...args);',loader:'js'}));
  }}]});
const script=bundled.outputFiles[0].text;
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
async function fixture(t,{enabled=false,holdOpening=false}={}){
  const dom=new JSDOM('<main id="host"><canvas tabindex="0"></canvas></main>',{url:'https://campus.test/',runScripts:'outside-only',pretendToBeVisual:true});
  let experience;t.after(()=>{try{experience?.dispose();}finally{dom.window.close();}});
  const win=dom.window;win.setInterval=()=>1;
  // This is a DOM admission test, not a WebGL/pixel test. The main project's
  // optional learning-board artwork already supports a missing 2D context.
  win.HTMLCanvasElement.prototype.getContext=()=>null;
  win.fetch=async()=>({ok:true});
  let clock=1000000;
  const events=[],suspensions=[],point={...activityPortals()[0],x:0,z:0,enabled},player={active:true,state:{x:0,y:0,z:0},captureActivityPose:()=>({x:0,y:0,z:0})};
  const client={state:{...createDefaultLiveState(),portals:[point]},now:()=>clock,connected:true,dispose(){}};
  let onState,resolveOpening;
  const openingGate=holdOpening?new Promise(resolve=>resolveOpening=resolve):Promise.resolve();
  const audience={registered:true,phase(){},dispose(){},client:{identity:{id:'viewer'},event:async(type,details)=>{events.push({type,...details});if(type==='opening')await openingGate;}}};
  win.__entryNetwork={createLiveClient:options=>{onState=options.onState;return client;},mountAudienceUI:()=>audience};
  const create=vm.runInContext(`${script}\nCampusEntryUnderTest.createLiveExperience`,dom.getInternalVMContext());
  const canvas=win.document.querySelector('canvas'),container=win.document.getElementById('host');
  experience=create({THREE,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),canvas,container,getPlayer:()=>player,setSuspended(value){suspensions.push(value);},invalidate(){},notify(){}});
  experience.sync();
  assert.equal(win.document.documentElement.style.getPropertyValue('--campus-visible-height'),`${win.innerHeight}px`,'the actual viewport helper is mounted');
  return {events,suspensions,win,canvas,player,experience,get state(){return client.state;},get now(){return clock;},root:win.document.getElementById('live-experience'),open:()=>win.document.querySelector('.live-portal-prompt').click(),resolveOpening,
    async setState(patch,at=clock){clock=at;client.state={...client.state,...patch,revision:client.state.revision+1};onState();await settle();},
    async tick(at){clock=at;experience.tick(clock);await settle();},
    async close(){client.state={...client.state,revision:client.state.revision+1,portals:client.state.portals.map(p=>({...p,enabled:false}))};onState();await settle();}};
}

const floodEvent=(id='civilization-ui-event',startAt=1000000)=>({id,startAt,pausedAt:null,pausedMs:0});
function secondArrivalAt(event,position){
  const u=(position.x-wave.x)/(wave.width/2);
  return event.startAt+(wave.interval+(wave.shoreFront+u*u*wave.arcDepth-position.z)/wave.speed)*1000;
}
const exactMessage='第1036号文明在海浪中进入暂停，下一个文明的辉煌，就靠诸位了';
test('closed activities render no beacon, entry prompt or visit event even at their exact location',async t=>{
  const f=await fixture(t);await settle();assert.equal(f.root.dataset.portalCount,'0');
  assert.equal(f.root.querySelector('.live-portal-prompt').hidden,true);assert.equal(f.root.querySelectorAll('.live-marker-labels .live-map-label').length,0);
  // The local project additionally has a separate learning board; closing an
  // activity does not delete that feature, and it stays hidden from this point.
  for(const marker of f.root.querySelectorAll('.learning-board-marker'))assert.equal(marker.hidden,true);
  assert.equal(f.events.length,0);
});
test('closing during the opening request prevents iframe creation and settles the accepted attempt',async t=>{
  const f=await fixture(t,{enabled:true,holdOpening:true});f.open();await settle();assert.ok(f.events.some(e=>e.type==='opening'));
  await f.close();f.resolveOpening();await settle();
  assert.equal(f.root.querySelectorAll('iframe').length,0);assert.equal(f.root.querySelector('.live-portal-view').hidden,true);
  assert.equal(f.events.at(-1).type,'returned');
});
test('closing admission hides beacons while an already admitted iframe stays available until return',async t=>{
  const f=await fixture(t,{enabled:true});f.open();await settle();
  assert.equal(f.root.querySelectorAll('iframe').length,1);
  await f.close();assert.equal(f.root.dataset.portalCount,'0');assert.equal(f.root.querySelectorAll('.live-marker-labels .live-map-label').length,0);
  assert.equal(f.root.querySelectorAll('iframe').length,1);assert.equal(f.root.querySelector('.live-portal-view').hidden,false);
  f.root.querySelector('.live-portal-bar button').click();await settle();
  assert.equal(f.root.querySelectorAll('iframe').length,0);assert.equal(f.events.at(-1).type,'returned');
});

test('the real outdoor experience freezes at the second crest and continues without repeating that event',async t=>{
  const f=await fixture(t,{enabled:true}),event=floodEvent(),arrival=secondArrivalAt(event,f.player.state);
  await f.setState({c118Flood:event},arrival-100);
  const panel=f.root.querySelector('.civilization-pause'),button=panel.querySelector('button');
  assert.equal(panel.hidden,true,'the first crest and pre-arrival exterior remain playable');
  assert.equal(f.experience.frozen,false);
  await f.tick(arrival+100);
  assert.equal(panel.hidden,false);
  assert.equal(panel.querySelector('p').textContent,exactMessage);
  assert.equal(button.textContent,'继续遨游');assert.equal(button.disabled,false);
  assert.equal(f.experience.frozen,true);assert.equal(f.canvas.inert,true);
  assert.equal(f.suspensions.at(-1),true);
  assert.equal(f.root.dataset.civilizationPaused,'true');
  const openingCount=f.events.filter(e=>e.type==='opening').length;
  f.open();await settle();
  assert.equal(f.root.querySelectorAll('iframe').length,0,'stale entry controls cannot bypass the civilization pause');
  assert.equal(f.events.filter(e=>e.type==='opening').length,openingCount);
  button.click();await settle();
  assert.equal(panel.hidden,true);assert.equal(f.experience.frozen,false);assert.equal(f.canvas.inert,false);
  assert.equal(f.suspensions.at(-1),false);
  assert.equal(f.win.sessionStorage.getItem('campus-civilization-continued-v1'),event.id);
  await f.tick(arrival+100000);
  await f.setState({c118Flood:{...event}});
  assert.equal(panel.hidden,true);assert.equal(f.experience.frozen,false,'later clocks and snapshots cannot repeat an acknowledged event');
});

test('host pause keeps the local continue action disabled and cannot be cleared by it',async t=>{
  const f=await fixture(t),event=floodEvent(),arrival=secondArrivalAt(event,f.player.state);
  await f.setState({c118Flood:event},arrival+100);
  const panel=f.root.querySelector('.civilization-pause'),button=panel.querySelector('button');
  assert.equal(panel.hidden,false);assert.equal(f.experience.frozen,true);
  const held={...event,pausedAt:arrival+200};
  await f.setState({paused:true,c118Flood:held},arrival+1000);
  assert.equal(button.disabled,true);assert.equal(panel.inert,true);
  button.click();await settle();
  assert.equal(f.state.paused,true);assert.equal(f.experience.frozen,true);assert.equal(panel.hidden,false);
  assert.equal(f.win.sessionStorage.getItem('campus-civilization-continued-v1'),null,'a blocked continue is not saved as accepted');
  await f.setState({paused:false,c118Flood:{...event,pausedMs:800}},arrival+1100);
  assert.equal(button.disabled,false);assert.equal(panel.inert,false);
  button.click();await settle();
  assert.equal(panel.hidden,true);assert.equal(f.experience.frozen,false);
});

test('reset releases the local overlay and a fresh sea event can show its own civilization interlude',async t=>{
  const f=await fixture(t),event=floodEvent(),arrival=secondArrivalAt(event,f.player.state);
  await f.setState({c118Flood:event},arrival+100);
  const panel=f.root.querySelector('.civilization-pause');
  assert.equal(panel.hidden,false);assert.equal(f.canvas.inert,true);
  await f.setState({c118Flood:null});
  assert.equal(panel.hidden,true);assert.equal(f.experience.frozen,false);assert.equal(f.canvas.inert,false);
  const next=floodEvent('civilization-ui-next',f.now+3000),nextArrival=secondArrivalAt(next,f.player.state);
  await f.setState({c118Flood:next});
  assert.equal(panel.hidden,true,'a new event starts at its own countdown');
  await f.tick(nextArrival+100);assert.equal(panel.hidden,false);
  panel.querySelector('button').click();await settle();assert.equal(panel.hidden,true);
  await f.setState({c118Flood:floodEvent('civilization-ui-third',f.now-200000)});
  assert.equal(panel.hidden,false,'continuing one civilization does not dismiss a new event');
});

test('an admitted indoor work does not show the outdoor second-wave interlude',async t=>{
  const f=await fixture(t,{enabled:true});f.open();await settle();
  assert.equal(f.root.querySelectorAll('iframe').length,1);
  const event=floodEvent(),arrival=secondArrivalAt(event,f.player.state);
  await f.setState({c118Flood:event},arrival+100);
  await f.tick(arrival+100000);
  assert.equal(f.root.querySelector('.civilization-pause').hidden,true);
  assert.equal(f.root.dataset.civilizationPaused,'false');
  assert.equal(f.root.querySelectorAll('iframe').length,1,'the admitted experience remains available');
  assert.equal(f.root.querySelector('.live-portal-view').hidden,false);
});
