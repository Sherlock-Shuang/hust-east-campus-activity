import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';
import {ACTIVITY_PHASES,ACTIVITY_WORKS,activityPortals} from '../../src/activity-catalog.js';
import {selectActivitiesNow} from '../../src/activity-launch.js';
import {createDefaultLiveState} from '../../src/live-state.js';
const dependencyRoot=process.env.TASAY_SOURCE?path.join(process.env.TASAY_SOURCE,'package.json'):new URL('./.staging/package.json',import.meta.url);
const {JSDOM}=createRequire(dependencyRoot)('jsdom');
// Keep the actual controller and helper imports, including screen/flood and
// linked activity rules. Only browser networking and polling timers are faked.
// ESM output retains the entry's top-level await; the DOM realm below wraps it
// in an async function without stripping any runtime dependencies.
const bundled=await build({entryPoints:[fileURLToPath(new URL('../../src/admin-control.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',loader:{'.css':'empty'}});
const source=bundled.outputFiles[0].text;
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
async function fixture(t){
  const html=await readFile(new URL('../../admin.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'https://campus.test/admin.html',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const win=dom.window;win.structuredClone=structuredClone;win.setInterval=()=>1;
  const at=Date.now();
  const person={id:'visitor-one',nickname:'<img src=x onerror=alert(1)>',joinedAt:at,lastSeenAt:at,online:true,visitedPoints:[{pointId:'point-tasay',label:'过拟合恋人',firstAt:at,lastAt:at}],openedWorks:[{workId:'tasay',openCount:1,readyLevel:'page_opened'}],currentExperiences:[],lastStatus:'returned',attempts:[{id:'a1',workId:'tasay',status:'returned',startedAt:at,endedAt:at,readyLevel:'page_opened'},{id:'a2',workId:'wanyan',status:'failed',startedAt:at,endedAt:at}],events:[{type:'visit',pointId:'point-tasay',at},{type:'returned',status:'returned',workId:'tasay',at},{type:'open_failed',status:'failed',workId:'wanyan',at}]};
  let state=createDefaultLiveState();state.portals=[];
  const calls=[],writes=[];
  win.fetch=async(url,options={})=>{
    calls.push({url,options});let data;
    if(url==='/api/admin/session')data={authenticated:true,csrfToken:'test-csrf'};
    else if(url==='/api/live/state')data={state:structuredClone(state),serverTime:at,onlineCount:99,onlineAudienceCount:2};
    else if(url==='/api/admin/state'){const body=JSON.parse(options.body);assert.equal(options.headers['X-CSRF-Token'],'test-csrf');assert.equal(body.expectedRevision,state.revision);writes.push(body);state={...body.state,revision:state.revision+1};data={state:structuredClone(state),serverTime:at,onlineAudienceCount:2};}
    else if(url==='/api/admin/audience/visitor-one')data={audience:structuredClone(person)};
    else if(url.startsWith('/api/admin/audience'))data={summary:{totalParticipants:3,onlineParticipants:2,currentParticipants:1,points:[{id:'point-tasay',label:'过拟合恋人',visitors:1}],works:ACTIVITY_WORKS.map(work=>({id:work.id,label:work.name,openedParticipants:work.id==='tasay'?1:0,currentParticipants:0}))},participants:url.includes('?q=missing')?[]:[person]};
    else if(url.startsWith('/api/admin/learning-requests'))data={total:0,participants:0,messages:[]};
    else return {ok:false,status:404,json:async()=>({error:'not found'})};
    return {ok:true,status:200,json:async()=>structuredClone(data)};
  };
  await vm.runInContext(`(async()=>{${source}\n})()`,dom.getInternalVMContext());await settle();
  const $=id=>win.document.getElementById(id);
  const change=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new win.Event('change',{bubbles:true}));};
  const submit=async id=>{$(id).dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));await settle();};
  return {win,$,change,submit,calls,writes,person,get state(){return state;},set state(value){state=value;}};
}
test('admin shows private deduplicated audience statistics, safe names, failed and returned records',async t=>{
  const f=await fixture(t);
  assert.equal(f.$('online-count').textContent,'2');assert.equal(f.$('stat-participants').textContent,'3');assert.equal(f.$('stat-experiencing').textContent,'1');
  f.$('tab-audience').click();await settle();assert.equal(f.$('panel-audience').hidden,false);
  assert.equal(f.$('audience-list').querySelector('img'),null);assert.match(f.$('audience-list').textContent,/<img src=x/);
  f.$('audience-list').querySelector('button').click();await settle();
  assert.match(f.$('audience-detail').textContent,/已返回校园/);assert.match(f.$('audience-detail').textContent,/加载失败/);assert.match(f.$('audience-detail').textContent,/页面已打开（不代表全部资源就绪）/);assert.doesNotMatch(f.$('audience-detail').textContent,/已完成|已通关/);
  f.$('audience-list').querySelector('button').click();await settle();assert.doesNotMatch(f.$('audience-detail').textContent,/正在读取/);
  f.$('audience-search').value='missing';await f.submit('audience-search-form');assert.equal(f.$('audience-list').children.length,0);assert.equal(f.$('stat-participants').textContent,'3');
  assert.ok(f.calls.filter(c=>c.url.startsWith('/api/admin/audience')).every(c=>c.options.credentials==='same-origin'));
});
test('phase changes do not change pause or portals; concurrent phase edits are rejected without overwriting',async t=>{
  const f=await fixture(t);const before=structuredClone(f.state);f.change('activity-phase','share');await f.submit('phase-form');
  assert.equal(f.state.phase.id,'share');assert.equal(f.state.paused,before.paused);assert.deepEqual(f.state.portals,before.portals);
  f.change('activity-phase','film');f.state={...f.state,revision:f.state.revision+1,phase:{...ACTIVITY_PHASES[1]}};const count=f.writes.length;await f.submit('phase-form');
  assert.equal(f.writes.length,count);assert.equal(f.state.phase.id,'gather');assert.match(f.$('admin-notice').textContent,/其他管理员/);
});
test('loading catalog points merges stable ids while retaining edited entries and choosing real URLs',async t=>{
  const f=await fixture(t);const original={...activityPortals()[0],label:'自定义保留名称',enabled:false};f.state.portals=[original];
  f.$('load-activity-portals').click();await settle();assert.equal(f.state.portals.length,4);assert.deepEqual(f.state.portals.map(p=>p.workId),['library','wanyan','tasay','she-love-me']);assert.deepEqual(f.state.portals.find(p=>p.id===original.id),original);
  f.$('load-activity-portals').click();await settle();assert.equal(f.state.portals.length,4);
  f.change('portal-work','tasay');assert.equal(f.$('portal-url').value,'/works/tasay/');assert.equal(f.$('portal-custom-work-field').hidden,true);
  f.change('portal-work','');assert.equal(f.$('portal-custom-work-field').hidden,false);
});

test('host selects multiple activities, starts beacons and admission together, and closes all without touching the stage',async t=>{
  const f=await fixture(t);f.$('load-activity-portals').click();await settle();
  assert.ok(f.state.portals.every(p=>!p.enabled));
  for(const id of ['point-library','point-tasay'])f.$('activity-choices').querySelector(`input[value="${id}"]`).click();
  assert.ok(f.state.portals.every(p=>!p.enabled),'checkboxes only edit a draft');
  await f.submit('activity-launch-form');
  assert.deepEqual(f.state.portals.map(p=>p.enabled),[true,false,true,true]);
  assert.equal(f.$('portal-count').textContent,'3');
  assert.match(f.$('activity-launch-status').textContent,/3 个活动开放/);
  f.$('close-all-activities').click();await settle();
  assert.ok(f.state.portals.every(p=>!p.enabled));assert.equal(f.state.phase.id,'explore');
  assert.match(f.$('activity-launch-status').textContent,/等待主持人/);
});
test('stale activity selection cannot overwrite another host and an explicit sync reloads the selection',async t=>{
  const f=await fixture(t);f.$('load-activity-portals').click();await settle();
  f.$('activity-choices').querySelector('input[value="point-library"]').click();
  f.state={...f.state,revision:f.state.revision+1,portals:selectActivitiesNow(f.state.portals,['point-wanyan'])};
  const count=f.writes.length;await f.submit('activity-launch-form');
  assert.equal(f.writes.length,count);assert.match(f.$('admin-notice').textContent,/其他管理员/);
  f.$('reset-activity-selection').click();assert.equal(f.$('activity-choices').querySelector('input[value="point-wanyan"]').checked,true);
  assert.equal(f.$('activity-choices').querySelector('input[value="point-library"]').checked,false);
});
