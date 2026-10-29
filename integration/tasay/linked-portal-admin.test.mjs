import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import {ACTIVITY_PHASES,ACTIVITY_WORKS,activityPortals,getTasayPortal,isTasayLinkedPortal,SHE_LOVE_POINT_ID} from '../../src/activity-catalog.js';
import {readAdminCoordinates,bindAdminCoordinateInputs} from '../../src/admin-coordinates.js';
import {activitySelectionSignature,selectActivitiesNow} from '../../src/activity-launch.js';
import {createDefaultLiveState,validateLiveState} from '../../src/live-state.js';
const dependencyRoot=process.env.TASAY_SOURCE?path.join(process.env.TASAY_SOURCE,'package.json'):new URL('./.staging/package.json',import.meta.url);
const {JSDOM}=createRequire(dependencyRoot)('jsdom');
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
async function fixture(t){
  const html=await readFile(new URL('../../admin.html',import.meta.url),'utf8');
  const source=(await readFile(new URL('../../src/admin-control.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
  const dom=new JSDOM(html,{url:'https://campus.test/admin.html',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const win=dom.window;win.structuredClone=structuredClone;win.setInterval=()=>1;
  Object.assign(win,{ACTIVITY_PHASES,ACTIVITY_WORKS,activityPortals,getTasayPortal,isTasayLinkedPortal,SHE_LOVE_POINT_ID,readAdminCoordinates,bindAdminCoordinateInputs,activitySelectionSignature,selectActivitiesNow,geoToLocal:()=>({x:0,z:0}),createLiveMapFrame:()=>({}),getLiveLocationPresets:()=>[]});
  let state=validateLiveState({...createDefaultLiveState(),portals:activityPortals()});const writes=[];
  win.fetch=async(url,options={})=>{
    let data;
    if(url==='/api/admin/session')data={authenticated:true,csrfToken:'test-csrf'};
    else if(url==='/api/live/state')data={state:structuredClone(state),serverTime:Date.now()};
    else if(url==='/api/admin/state'){const body=JSON.parse(options.body);writes.push(body);assert.equal(body.expectedRevision,state.revision);state=validateLiveState({...body.state,revision:state.revision+1});data={state:structuredClone(state),serverTime:Date.now()};}
    else if(url.startsWith('/api/admin/audience'))data={summary:{totalParticipants:0,onlineParticipants:0,currentParticipants:0,points:[],works:[]},participants:[]};
    else return {ok:false,status:404,json:async()=>({error:'not found'})};
    return {ok:true,status:200,json:async()=>structuredClone(data)};
  };
  await vm.runInContext(`(async()=>{${source}\n})()`,dom.getInternalVMContext());await settle();
  const $=id=>win.document.getElementById(id);
  return {win,$,writes,get state(){return state;},submit:async id=>{$(id).dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));await settle();},choice:id=>$('activity-choices').querySelector(`input[value="${id}"]`),row:()=>[...$('portal-list').children].find(row=>row.querySelector('strong').textContent===state.portals.find(point=>point.id===SHE_LOVE_POINT_ID).label)};
}

test('host controls one checkbox for the pair and busy refresh never re-enables the linked controls',async t=>{
  const f=await fixture(t);assert.equal(f.choice(SHE_LOVE_POINT_ID).disabled,true);assert.equal(f.choice(SHE_LOVE_POINT_ID).checked,false);
  assert.match(f.choice(SHE_LOVE_POINT_ID).closest('label').textContent,/随过拟合恋人/);
  f.choice('point-tasay').click();assert.equal(f.choice(SHE_LOVE_POINT_ID).checked,true);
  await f.submit('activity-launch-form');assert.deepEqual(f.state.portals.map(point=>point.enabled),[false,false,true,true]);
  assert.equal(f.choice(SHE_LOVE_POINT_ID).disabled,true);
  for(const action of ['toggle','delete'])assert.equal(f.row().querySelector(`[data-action="${action}"]`).disabled,true);
  f.$('toggle-pause').click();await settle();assert.equal(f.state.paused,true);assert.equal(f.choice(SHE_LOVE_POINT_ID).disabled,true);
  f.choice('point-tasay').click();assert.equal(f.choice(SHE_LOVE_POINT_ID).checked,false);f.choice('point-library').click();await f.submit('activity-launch-form');assert.deepEqual(f.state.portals.map(point=>point.enabled),[true,false,false,false]);
  f.$('close-all-activities').click();await settle();assert.ok(f.state.portals.every(point=>!point.enabled));
});

test('linked editor preserves independent location edits while schedule and admission remain tied to tasay',async t=>{
  const f=await fixture(t);f.choice('point-tasay').click();await f.submit('activity-launch-form');
  f.row().querySelector('[data-action="edit"]').click();
  for(const field of ['portal-work','portal-url','portal-enabled','portal-start','portal-end'])assert.equal(f.$(field).disabled,true,field);
  assert.equal(f.$('portal-linked-note').hidden,false);assert.equal(f.$('location-x').disabled,false);assert.equal(f.$('portal-radius').disabled,false);
  f.$('location-x').value='852.4';f.$('location-z').value='-64.2';f.$('portal-radius').value='7';await f.submit('portal-form');
  const linked=f.state.portals.find(point=>point.id===SHE_LOVE_POINT_ID);assert.deepEqual([linked.x,linked.z,linked.radius],[852.4,-64.2,7]);assert.equal(linked.enabled,true);
  assert.equal(f.choice(SHE_LOVE_POINT_ID).disabled,true);f.row().querySelector('[data-action="edit"]').click();
  f.$('toggle-pause').click();await settle();for(const field of ['portal-work','portal-url','portal-enabled','portal-start','portal-end'])assert.equal(f.$(field).disabled,true,field+' after save');
});
