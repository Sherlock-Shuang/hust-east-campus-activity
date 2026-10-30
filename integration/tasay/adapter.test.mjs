import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('./activity-adapter.js',import.meta.url),'utf8')).replace('__CAMPUS_ALLOWED_ORIGINS__','[]');
function runtime({foreign=false}={}){
  let clock=0,id=1;const scheduled=new Map(),listeners=new Map(),messages=[],app={inert:false};
  const timeout=(fn,delay=0,...args)=>{const token=id++;scheduled.set(token,{fn:()=>fn(...args),due:clock+delay,interval:0});return token;};
  const interval=(fn,delay)=>{const token=id++;scheduled.set(token,{fn,due:clock+delay,interval:delay});return token;};
  const parent={postMessage:(message,origin)=>messages.push({message,origin})};
  const window={parent,setTimeout:timeout,setInterval:interval,clearTimeout:key=>scheduled.delete(key),clearInterval:key=>scheduled.delete(key),requestAnimationFrame:fn=>timeout(()=>fn(clock),16),cancelAnimationFrame:key=>scheduled.delete(key),addEventListener:(name,fn)=>{const all=listeners.get(name)||[];all.push(fn);listeners.set(name,all);},removeEventListener:(name,fn)=>listeners.set(name,(listeners.get(name)||[]).filter(listener=>listener!==fn)),dispatchEvent:event=>{for(const fn of [...(listeners.get(event.type)||[])])fn(event);return true;}};
  const document={head:{append(){}},documentElement:{dataset:{}},createElement:()=>({}),getElementById:()=>app,querySelector:()=>({}),querySelectorAll:()=>[],activeElement:{blur(){}},exitPointerLock(){}};
  const context=vm.createContext({window,parent,document,location:{origin:'https://campus.example',search:`?campusParentOrigin=${encodeURIComponent(foreign?'https://bad.example':'https://campus.example')}&campusAttempt=attempt-1`},performance:{now:()=>clock},URLSearchParams,Event,sessionStorage:{getItem:()=>null,setItem(){}},MutationObserver:class{observe(){}disconnect(){}},Map,Set});
  vm.runInContext(source,context);
  const advance=amount=>{const target=clock+amount;for(;;){const next=[...scheduled].filter(([,value])=>value.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;clock=next[1].due;scheduled.delete(next[0]);next[1].fn();if(next[1].interval)scheduled.set(next[0],{...next[1],due:clock+next[1].interval});}clock=target;};
  // The host bridge now authenticates each attempt in addition to parent and
  // origin. Tests send the real envelope unless explicitly testing rejection.
  const message=(data,origin='https://campus.example',source=parent)=>(listeners.get('message')||[]).forEach(fn=>fn({data:{attemptId:'attempt-1',...data},origin,source}));
  return {window,document,app,messages,listeners,advance,message,scheduled};
}
test('reports actual page open with attempt ID, without synthetic completion or Escape override',()=>{
  const r=runtime();assert.equal(r.messages[0].message.type,'campus:ready');assert.equal(r.messages[0].message.level,'page_opened');assert.equal(r.messages[0].message.attemptId,'attempt-1');assert.equal(r.listeners.has('keydown'),false);
});
test('rejects untrusted parent origins, frames and stale/missing attempts',()=>{
  assert.equal(runtime({foreign:true}).messages.length,0);
  const r=runtime();r.message({type:'campus:activity',paused:true},'https://bad.example');assert.equal(r.app.inert,false);
  r.message({type:'campus:activity',paused:true},'https://campus.example',{});assert.equal(r.app.inert,false);
  for(const attemptId of ['stale-attempt',undefined]){
    r.message({type:'campus:activity',paused:true,attemptId});assert.equal(r.app.inert,false);
    r.message({type:'campus:dispose',attemptId});assert.notEqual(r.document.documentElement.dataset.campusDisposed,'true');
  }
});
test('timeout pauses with remaining duration and resumes once',()=>{
  const r=runtime();let fired=0;r.window.setTimeout(()=>fired++,1000);r.advance(400);r.message({type:'campus:activity',paused:true});r.advance(10000);assert.equal(fired,0);assert.equal(r.app.inert,true);
  r.message({type:'campus:activity',paused:false});r.advance(599);assert.equal(fired,0);r.advance(1);assert.equal(fired,1);r.advance(2000);assert.equal(fired,1);
});
test('interval and RAF suspend, then dispose cancels pending story work',()=>{
  const r=runtime();let ticks=0,frames=0;const timer=r.window.setInterval(()=>ticks++,1000);r.advance(500);r.window.requestAnimationFrame(()=>frames++);r.message({type:'campus:activity',paused:true});r.advance(4000);assert.equal(ticks,0);assert.equal(frames,0);
  r.message({type:'campus:activity',paused:false});r.advance(500);assert.equal(ticks,1);assert.equal(frames,1);r.window.clearInterval(timer);r.window.setTimeout(()=>ticks++,100);r.window.requestAnimationFrame(()=>frames++);
  let unmounts=0;r.window.addEventListener('campus:dispose',()=>unmounts++);r.message({type:'campus:dispose'});r.advance(500);assert.equal(ticks,1);assert.equal(frames,1);assert.equal(unmounts,1);assert.equal(r.scheduled.size,0);assert.equal(r.listeners.get('message').length,0);
  r.message({type:'campus:activity',paused:false});r.window.setTimeout(()=>ticks++,1);r.window.requestAnimationFrame(()=>frames++);r.advance(1000);assert.equal(ticks,1);assert.equal(frames,1);assert.equal(unmounts,1);assert.equal(r.app.inert,true);
});
