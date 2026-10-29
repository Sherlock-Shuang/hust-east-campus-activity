import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/admin-control.js',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const functions=extract('async function mutate(', 'function renderState(')+extract('function fillObjectForm(', 'function previewAnnouncement(');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(type='portal'){
  const original={id:'point-1',label:'原名称',x:10,z:20,enabled:true,radius:5,startAt:null,endAt:null,
    ...(type==='portal'?{workId:'library',description:'说明',url:'/works/library/'}:{color:'#ffffff',height:25})};
  const fields=new Map(),notices=[],writes=[];
  const field=key=>{if(!fields.has(key))fields.set(key,{value:'',checked:false,focus(){},reset(){}});return fields.get(key);};
  const state={revision:1,portals:type==='portal'?[structuredClone(original)]:[],markers:type==='marker'?[structuredClone(original)]:[]};
  const context={busy:false,loggedIn:true,state,snapshot:{state},objectEditBases:new Map(),clone:structuredClone,ACTIVITY_WORKS:[{id:'library'}],
    $:field,document:{querySelector:()=>({open:false})},toLocalInput:()=>'',syncCustomWork(){},
    setSelection(x,z){field('location-x').value=String(x);field('location-z').value=String(z);},
    coordinateInputs:{read:()=>({x:Number(field('location-x').value),z:Number(field('location-z').value)})},
    schedule:()=>({startAt:null,endAt:null}),setBusy(){},applySnapshot(){},showNotice:message=>notices.push(message),
    id:()=> 'new-point',request:async(path,options)=>{
      if(path==='/api/live/state')return {state:structuredClone(state)};
      const body=JSON.parse(options.body);writes.push(body);return {state:body.state};
    }};
  vm.createContext(context);vm.runInContext(functions,context);
  context.fillObjectForm(type,original);
  return {context,state,field,notices,writes,submit:async()=>{context.submitObject(type,{preventDefault(){}});await settle();}};
}
for(const type of ['portal','marker'])test(`${type}: editing a stale form preserves another host's changes and retains the draft`,async()=>{
  const f=fixture(type),key=type==='portal'?'portals':'markers';
  f.field(`${type}-label`).value='我的草稿';f.state[key][0].x=99;f.state.revision++;
  await f.submit();
  assert.equal(f.writes.length,0);assert.equal(f.state[key][0].x,99);
  assert.equal(f.field(`${type}-label`).value,'我的草稿');assert.match(f.notices.at(-1),/其他管理员修改/);
  // Reloading via the real edit action establishes a new baseline.
  f.context.fillObjectForm(type,f.state[key][0]);f.field(`${type}-label`).value='重新编辑';await f.submit();
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].state[key][0].x,99);
  assert.equal(f.writes[0].state[key][0].label,'重新编辑');
});
test('an unrelated host change does not block saving an unchanged object',async()=>{
  const f=fixture();f.state.paused=true;f.state.revision=2;f.field('portal-label').value='新名称';await f.submit();
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].expectedRevision,2);
  assert.equal(f.writes[0].state.paused,true);assert.equal(f.writes[0].state.portals[0].label,'新名称');
});
test('an object deleted by another host cannot be recreated by saving its old form',async()=>{
  const f=fixture();f.state.portals=[];await f.submit();assert.equal(f.writes.length,0);assert.match(f.notices.at(-1),/已被删除/);
});
test('clearing an edit allows a new object without reusing the old baseline',async()=>{
  const f=fixture();f.context.clearObjectForm('portal');f.field('portal-label').value='新入口';await f.submit();
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].state.portals.length,2);
  assert.equal(f.context.objectEditBases.has('portal'),false);
});
