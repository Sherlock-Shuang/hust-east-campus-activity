import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const here=path.dirname(fileURLToPath(import.meta.url));
const source=process.env.TASAY_SOURCE || path.join(here,'.staging');
const require=createRequire(path.join(source,'package.json'));
const {transformSync}=createRequire(import.meta.url)('esbuild');
// Model credentials and developer .env files are deliberately unavailable.
// Preserve each source module's real URL for authored relative image imports.
const testEnv={MODE:'test',DEV:false,PROD:false,SSR:false,BASE_URL:'/works/tasay/'};
function modules() {
  const cache=new Map();
  return function load(name) {
    if(cache.has(name))return cache.get(name).exports;
    const file=[path.join(here,'ui-overrides/src'),path.join(source,'src')]
      .map(root=>path.join(root,name+'.ts')).find(existsSync);
    assert.ok(file,`Module exists: ${name}`);
    const script=transformSync(readFileSync(file,'utf8'),{loader:'ts',format:'cjs',target:'es2022',sourcefile:file,
      define:{'import.meta.url':JSON.stringify(pathToFileURL(file).href),'import.meta.env':JSON.stringify(testEnv)}}).code;
    const module={exports:{}};cache.set(name,module);
    new Function('require','module','exports',script)(specifier=>{
      if(/\.(jpg|svg)$/.test(specifier))return {default:specifier};
      return specifier.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(name),specifier))):require(specifier);
    },module,module.exports);
    return module.exports;
  };
}
function fixture() {
  const load=modules();
  const {createEmptySession,createChatMessage}=load('types/session');
  const {fallbackReplyCopy}=load('config/hardcodedCopy');
  const {getFallbackReply}=load('features/reply/replyFallbacks');
  return {load,createChatMessage,copy:fallbackReplyCopy,getFallbackReply,
    session:{...createEmptySession(),taPronoun:'TA',stage:'normal_chat',pollutionCount:5,sendCount:8}};
}
function belongsTo(reply,pool) {
  return [...pool.one.map(line=>[line]),...pool.two].some(candidate=>JSON.stringify(candidate)===JSON.stringify(reply));
}

test('real send flow keeps the fifth scripted answer then uses chaos at exactly five rewrites',async t=>{
  const network=t.mock.method(globalThis,'fetch',()=>{throw new Error('Unexpected network/model call in authored-reply test');});
  const sockets=typeof globalThis.WebSocket==='function'?t.mock.method(globalThis,'WebSocket',()=>{throw new Error('Unexpected network socket in authored-reply test');}):null;
  const f=fixture();t.mock.method(Math,'random',()=>0);
  const {useAppStore}=f.load('app/store/useAppStore');
  useAppStore.getState().patchSession({...f.session,stage:'first_pollution',sendCount:6,pollutionCount:4,forcedPollutionRemaining:1,
    pollutedInputs:['我不爱你了','我觉得你又胖又丑','我现在更想一个人','别吵我，我要去打游戏了']});
  await useAppStore.getState().sendMessage('第五次改写');
  const fifth=useAppStore.getState().session;
  assert.equal(fifth.pollutionCount,5);assert.equal(fifth.forcedPollutionRemaining,0);
  assert.ok(belongsTo(fifth.chatHistory.filter(m=>m.role==='ta').map(m=>m.displayedText),f.copy.keywords['不用']));
  const offset=fifth.chatHistory.length;
  await useAppStore.getState().sendMessage('接下来呢');
  const next=useAppStore.getState().session;
  assert.equal(next.stage,'normal_chat');assert.equal(next.pollutionCount,5);
  assert.ok(belongsTo(next.chatHistory.slice(offset).filter(m=>m.role==='ta').map(m=>m.displayedText),f.copy.postThresholdChaos));
  assert.doesNotMatch(next.chatHistory.slice(offset).map(m=>m.displayedText).join(''),/你继续说|我有在认真看/);
  assert.equal(network.mock.callCount(),0,'real reply flow must remain local, even if an API failure is caught');
  if(sockets)assert.equal(sockets.mock.callCount(),0);
});

for(const lineCount of [1,2])test(`authored ${lineCount}-line replies are used without repeats, including after restoring saved history`,t=>{
  const f=fixture();t.mock.method(Math,'random',()=>0.4);
  const pool=lineCount===1?f.copy.postThresholdChaos.one.map(line=>[line]):f.copy.postThresholdChaos.two;
  let session=f.session;const seen=new Set();
  for(let i=0;i<pool.length;i++) {
    const reply=f.getFallbackReply(session,lineCount);
    assert.equal(reply.length,lineCount);assert.ok(belongsTo(reply,f.copy.postThresholdChaos));
    assert.ok(!seen.has(JSON.stringify(reply)));seen.add(JSON.stringify(reply));
    session=JSON.parse(JSON.stringify({...session,chatHistory:[...session.chatHistory,...reply.map(line=>f.createChatMessage('ta',line))]}));
  }
  const reply=f.getFallbackReply(session,lineCount);
  assert.ok(belongsTo(reply,f.copy.postThresholdChaos));
  assert.notDeepEqual(reply,session.chatHistory.slice(-lineCount).map(m=>m.displayedText));
});

test('player quotes do not consume an authored reply; prior TA replies do',t=>{
  const f=fixture();t.mock.method(Math,'random',()=>0);
  const line=f.copy.postThresholdChaos.one[0];
  f.session.chatHistory=[f.createChatMessage('user',line)];
  assert.deepEqual(f.getFallbackReply(f.session,1),[line]);
  f.session.chatHistory.push(f.createChatMessage('ta',' '+line+' '));
  assert.notDeepEqual(f.getFallbackReply(f.session,1),[line]);
});

test('final entity pool activates at five rewrites and does not repeat the previous pair',t=>{
  const f=fixture();t.mock.method(Math,'random',()=>0);
  f.session.stage='meta_break';
  const first=f.getFallbackReply(f.session,2);
  assert.ok(belongsTo(first,f.copy.finalEntityReplies));
  f.session.chatHistory=first.map(line=>f.createChatMessage('ta',line));
  const second=f.getFallbackReply(f.session,2);
  assert.ok(belongsTo(second,f.copy.finalEntityReplies));assert.notDeepEqual(first,second);
});

test('early dialogue and explicit story events keep their existing replies',()=>{
  const f=fixture();f.session.pollutionCount=4;
  assert.ok(belongsTo(f.getFallbackReply(f.session,2),f.copy.stage.normal_chat));
  f.session.pollutionCount=5;
  assert.ok(belongsTo(f.getFallbackReply(f.session,2,undefined,undefined,['draft_exposed']),f.copy.events.draft_exposed));
});
