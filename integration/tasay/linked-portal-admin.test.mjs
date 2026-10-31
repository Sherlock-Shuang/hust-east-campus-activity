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
import {normalizeC118Screen} from '../../src/c118-screen-state.js';
import {getC118FloodElapsed} from '../../src/c118-flood-state.js';
const dependencyRoots=process.env.TASAY_SOURCE?[path.join(process.env.TASAY_SOURCE,'package.json')]:[
  new URL('./.staging/package.json',import.meta.url),
  new URL('../../../../integration/tasay/.staging/package.json',import.meta.url),
];
let JSDOM;
for(const dependencyRoot of dependencyRoots){
  try{({JSDOM}=createRequire(dependencyRoot)('jsdom'));break;}
  catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
}
if(!JSDOM)throw new Error('Existing jsdom dependency is unavailable; set TASAY_SOURCE to the original ta-say project.');
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
async function fixture(t,{configure=()=>{}}={}){
  const html=await readFile(new URL('../../admin.html',import.meta.url),'utf8');
  const source=(await readFile(new URL('../../src/admin-control.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
  const dom=new JSDOM(html,{url:'https://campus.test/admin.html',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const win=dom.window;win.structuredClone=structuredClone;win.setInterval=()=>1;
  Object.assign(win,{normalizeC118Screen,getC118FloodElapsed,ACTIVITY_PHASES,ACTIVITY_WORKS,activityPortals,getTasayPortal,isTasayLinkedPortal,SHE_LOVE_POINT_ID,readAdminCoordinates,bindAdminCoordinateInputs,activitySelectionSignature,selectActivitiesNow,geoToLocal:()=>({x:0,z:0}),createLiveMapFrame:()=>({}),getLiveLocationPresets:()=>[],mountCueSidebar:()=>({resize(){}})});
  let state={...createDefaultLiveState(),portals:activityPortals()};configure(state);state=validateLiveState(state);
  const writes=[];let heldWrite=null;
  win.fetch=async(url,options={})=>{
    let data;
    if(url==='/api/admin/session')data={authenticated:true,csrfToken:'test-csrf'};
    else if(url==='/api/live/state')data={state:structuredClone(state),serverTime:Date.now()};
    else if(url==='/api/admin/state'){
      if(heldWrite){const hold=heldWrite;heldWrite=null;hold.enter();await hold.wait;}
      const body=JSON.parse(options.body);writes.push(body);assert.equal(body.expectedRevision,state.revision);state=validateLiveState({...body.state,revision:state.revision+1});data={state:structuredClone(state),serverTime:Date.now()};
    }
    else if(url.startsWith('/api/admin/audience'))data={summary:{totalParticipants:0,onlineParticipants:0,currentParticipants:0,points:[],works:[]},participants:[]};
    else return {ok:false,status:404,json:async()=>({error:'not found'})};
    return {ok:true,status:200,json:async()=>structuredClone(data)};
  };
  await vm.runInContext(`(async()=>{${source}\n})()`,dom.getInternalVMContext());await settle();
  const $=id=>win.document.getElementById(id);
  return {win,$,writes,get state(){return state;},
    submit:async id=>{$(id).dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));await settle();},
    change:(id,value)=>{$(id).value=value;$(id).dispatchEvent(new win.Event('change',{bubbles:true}));},
    choice:id=>$('activity-choices').querySelector(`input[value="${id}"]`),
    choiceRow:()=>$('activity-choices').querySelector(`input[value="${SHE_LOVE_POINT_ID}"]`).closest('.activity-choice'),
    independentToggle:()=>$('activity-choices').querySelector(`input[value="${SHE_LOVE_POINT_ID}"]`).closest('.activity-choice').querySelector('[data-action="toggle-independent"]'),
    row:()=>[...$('portal-list').children].find(row=>row.querySelector('strong').textContent===state.portals.find(point=>point.id===SHE_LOVE_POINT_ID).label),
    deferNextWrite(){
      let release,enter;const wait=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{enter=resolve;});
      heldWrite={wait,enter};t.after(release);return {entered,release};
    },
  };
}

test('dedicated she-love-me button toggles only that entry without changing other activities or schedules',async t=>{
  const at=Date.now(),f=await fixture(t,{configure(state){
    for(const point of state.portals){
      if(point.id===SHE_LOVE_POINT_ID)continue;
      Object.assign(point,{enabled:true,startAt:at+(point.workId==='wanyan'?60000:-60000),endAt:at+3600000});
    }
  }});
  const untouched=structuredClone(f.state.portals.filter(point=>point.id!==SHE_LOVE_POINT_ID));
  assert.equal(f.choice(SHE_LOVE_POINT_ID).disabled,false);
  assert.equal(f.choice(SHE_LOVE_POINT_ID).checked,false);
  assert.equal(f.choiceRow().tagName,'DIV');
  assert.ok(f.choiceRow().querySelector('label.activity-choice-select .activity-choice-copy'));
  assert.ok(f.choiceRow().querySelector('.activity-choice-actions .status-pill'));
  assert.equal(f.independentToggle().closest('label'),null,'button must not toggle the selection checkbox implicitly');
  assert.equal(f.independentToggle().textContent,'单独开启');
  assert.equal(f.independentToggle().getAttribute('aria-label'),`开启${f.state.portals.find(point=>point.id===SHE_LOVE_POINT_ID).label}`);
  f.independentToggle().click();await settle();
  assert.equal(f.state.portals.find(point=>point.id===SHE_LOVE_POINT_ID).enabled,true);
  assert.deepEqual(f.state.portals.filter(point=>point.id!==SHE_LOVE_POINT_ID),untouched);
  assert.equal(f.independentToggle().textContent,'单独关闭');
  assert.equal(f.independentToggle().getAttribute('aria-label'),`关闭${f.state.portals.find(point=>point.id===SHE_LOVE_POINT_ID).label}`);
  f.independentToggle().click();await settle();
  assert.equal(f.state.portals.find(point=>point.id===SHE_LOVE_POINT_ID).enabled,false);
  assert.deepEqual(f.state.portals.filter(point=>point.id!==SHE_LOVE_POINT_ID),untouched);
  assert.equal(f.writes.length,2);
});

test('batch selection can open she-love-me alone and close all activities without coupling to tasay',async t=>{
  const f=await fixture(t);
  f.choice(SHE_LOVE_POINT_ID).click();
  assert.equal(f.choice(SHE_LOVE_POINT_ID).checked,true);assert.equal(f.choice('point-tasay').checked,false);
  await f.submit('activity-launch-form');
  assert.deepEqual(f.state.portals.map(point=>point.enabled),[false,false,false,true]);
  f.choice('point-tasay').click();assert.equal(f.choice(SHE_LOVE_POINT_ID).checked,true);
  await f.submit('activity-launch-form');assert.deepEqual(f.state.portals.map(point=>point.enabled),[false,false,true,true]);
  f.choice('point-tasay').click();assert.equal(f.choice(SHE_LOVE_POINT_ID).checked,true);
  f.choice('point-library').click();await f.submit('activity-launch-form');
  assert.deepEqual(f.state.portals.map(point=>point.enabled),[true,false,false,true]);
  f.$('close-all-activities').click();await settle();assert.ok(f.state.portals.every(point=>!point.enabled));
  assert.equal(f.choice(SHE_LOVE_POINT_ID).disabled,false);
  assert.equal(f.independentToggle().textContent,'单独开启');
});

function assertEditorEnabled(f,enabled,context=''){
  for(const field of ['portal-work','portal-url','portal-enabled']){
    const control=f.$(field);assert.ok(control,`${field} exists ${context}`);assert.equal(control.disabled,!enabled,`${field} ${context}`);
  }
}

test('independent editor saves location, URL and admission while busy controls recover after refresh',{timeout:5000},async t=>{
  const f=await fixture(t,{configure(state){state.portals[0].enabled=true;}});
  const untouched=structuredClone(f.state.portals.filter(point=>point.id!==SHE_LOVE_POINT_ID));
  assert.equal(f.$('portal-work').querySelector('option[value="she-love-me"]').disabled,false);
  f.row().querySelector('[data-action="edit"]').click();
  assertEditorEnabled(f,true);
  assert.equal(f.$('portal-work').value,'she-love-me');
  assert.equal(f.$('portal-linked-note').hidden,false);assert.match(f.$('portal-linked-note').textContent,/独立控制/);
  assert.equal(f.$('location-x').disabled,false);assert.equal(f.$('portal-radius').disabled,false);
  for(const action of ['edit','toggle','delete'])assert.equal(f.row().querySelector(`[data-action="${action}"]`).disabled,false);
  f.$('location-x').value='852.4';f.$('location-z').value='-64.2';f.$('portal-radius').value='7';
  f.$('portal-url').value='/works/she-love-me/?demo=independent';f.$('portal-enabled').checked=true;
  await f.submit('portal-form');
  const independent=f.state.portals.find(point=>point.id===SHE_LOVE_POINT_ID);
  assert.deepEqual([independent.x,independent.z,independent.radius],[852.4,-64.2,7]);
  assert.equal(independent.url,'/works/she-love-me/?demo=independent');assert.equal(independent.enabled,true);
  assert.deepEqual(f.state.portals.filter(point=>point.id!==SHE_LOVE_POINT_ID),untouched);
  assert.equal(getTasayPortal(f.state.portals).enabled,false);
  f.row().querySelector('[data-action="edit"]').click();
  const hold=f.deferNextWrite();f.$('toggle-pause').click();await hold.entered;
  try{
    assertEditorEnabled(f,false,'while saving');
    assert.equal(f.choice(SHE_LOVE_POINT_ID).disabled,true);assert.equal(f.independentToggle().disabled,true);
  }finally{hold.release();}
  await settle();assert.equal(f.state.paused,true);assertEditorEnabled(f,true,'after save');
  assert.equal(f.choice(SHE_LOVE_POINT_ID).disabled,false);assert.equal(f.independentToggle().disabled,false);
  assert.equal(f.$('portal-url').value,independent.url);assert.equal(f.$('portal-enabled').checked,true);
  assert.deepEqual(f.state.portals.filter(point=>point.id!==SHE_LOVE_POINT_ID),untouched);
  f.change('portal-work','tasay');
  assert.ok(f.$('portal-linked-note').hidden||!/跟随|同步开关/.test(f.$('portal-linked-note').textContent));
  f.change('portal-work','she-love-me');assertEditorEnabled(f,true,'after reselecting the work');
  assert.equal(f.$('portal-linked-note').hidden,false);assert.match(f.$('portal-linked-note').textContent,/独立控制/);
});
