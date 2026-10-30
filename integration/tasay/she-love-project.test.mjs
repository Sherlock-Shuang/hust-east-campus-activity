import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = process.env.TASAY_SOURCE || path.join(here, '.staging');
const require = createRequire(path.join(sourceRoot, 'package.json'));
const ts = require('typescript');
const React = require('react');
const {JSDOM} = require('jsdom');
const overrideRoot = path.join(here, 'ui-overrides/src');

function modules(mocks = {}) {
  const cache = new Map();
  return function load(name) {
    if (name in mocks) return mocks[name];
    if (cache.has(name)) return cache.get(name);
    const file = [overrideRoot, path.join(sourceRoot, 'src')].flatMap(root => ['.ts', '.tsx'].map(ext => path.join(root, name + ext))).find(existsSync);
    assert.ok(file, `Source module exists: ${name}`);
    const script = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
    const module = {exports: {}};
    cache.set(name, module.exports);
    new Function('require', 'module', 'exports', script)(specifier => {
      if (specifier.endsWith('.css')) return {};
      return specifier.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier))) : require(specifier);
    }, module, module.exports);
    return module.exports;
  };
}

async function fixture(t, {finished = false, phone = false, legacy, blockedStorage = false} = {}) {
  const dom = new JSDOM('<div id="root"></div>', {url: 'https://campus.test/works/tasay/chat', pretendToBeVisual: true});
  const win = dom.window;
  const globals = {window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, localStorage: win.localStorage, requestAnimationFrame: win.requestAnimationFrame.bind(win), cancelAnimationFrame: win.cancelAnimationFrame.bind(win), IS_REACT_ACT_ENVIRONMENT: true};
  const descriptors = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  win.matchMedia = () => ({matches: phone, addEventListener() {}, removeEventListener() {}});
  // JSDOM has no top layer. Browser verification checks its native focus trap/backdrop.
  win.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  win.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  if (legacy !== undefined) {
    win.localStorage.setItem('ta-say:persisted', legacy);
    win.localStorage.setItem('ta-say:she-love-me:completed', 'true');
  }
  if (blockedStorage) {
    Object.defineProperty(win, 'localStorage', {get() { throw new Error('blocked'); }});
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new Error('blocked'); }});
  }
  let state, mountKey = 0;
  const useAppStore = selector => selector(state);
  useAppStore.getState = () => state;
  const load = modules({
    'app/store/useAppStore': {useAppStore},
    'hooks/useChatViewport': {useChatViewport() {}},
  });
  // Keep real routing and ChatPage rendering; only the session/viewport inputs are controlled.
  const router = require('react-router-dom');
  const {createRoot} = require('react-dom/client');
  const {createEmptySession} = load('types/session');
  state = {
    session: {...createEmptySession(), taPronoun: 'TA', stage: finished ? 'wake_up' : 'warmup', hasFinishedGame: finished},
    isReplying: false, isTaTyping: false, pendingUserMessages: [], draftWhisper: '', draftEditCount: 0, draftPauseLevel: 0,
    sendMessage() {}, updateDraft() {}, rollbackToMessage() {}, visitSpace() {}, exitAttempt() {},
    sendLocationTurnBack() {}, enterTruthReveal() {}, revealLocationLie() {}, revealLocationOmnipresence() {}, getSpaceLabel: () => '朋友圈',
    resetForReplay() {
      // The real store rebuilds a playable session from persisted defaults.
      state.session = {...createEmptySession(), taPronoun: 'TA', stage: 'warmup', hasFinishedGame: blockedStorage ? false : state.session.hasFinishedGame};
      render();
    }
  };
  const {ChatPage} = load('pages/ChatPage/ChatPage');
  const root = createRoot(win.document.getElementById('root'));
  const render = () => root.render(React.createElement(router.MemoryRouter, {key: mountKey, future: {v7_startTransition: true, v7_relativeSplatPath: true}}, React.createElement(ChatPage)));
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  await React.act(async () => render());
  const click = async node => {
    assert.ok(node, 'click target exists');
    node.focus();
    await React.act(async () => node.dispatchEvent(new win.MouseEvent('click', {bubbles: true})));
  };
  return {win, state, click, load, document: win.document,
    buttons: text => [...win.document.querySelectorAll('button')].filter(node => node.textContent === text),
    async remount() { mountKey += 1; await React.act(async () => render()); },
    async finish() { state.session = {...state.session, stage: 'wake_up', hasFinishedGame: true}; await React.act(async () => render()); }
  };
}


const pageRoot = path.resolve(here, '../../public/works/she-love-me');
const pageHtml = readFileSync(path.join(pageRoot, 'index.html'), 'utf8');
const pageScript = readFileSync(path.join(pageRoot, 'project.js'), 'utf8').replace(/^import .*;\n/gm,'');
const bridgeScript = readFileSync(path.resolve(here, '../../public/experiences/activity-bridge.js'), 'utf8');
const engine = await import('../../public/works/she-love-me/analyzer.js');
const {demos} = await import('../../public/works/she-love-me/demo.js');
const aiResult={summary:'双方都在延续话题。',observations:[{title:'一起安排活动',detail:'这可以说明对这次活动有兴趣。',evidence:[1,2]}],suggestions:['直接确认见面时间。'],limitations:'抽样不能确定真实心意。'};
function pageFixture(t, {embedded=false,fetchImpl=async()=>Response.json({analysis:aiResult})}={}) {
 const dom=new JSDOM(embedded?'<iframe src="/works/she-love-me/?campusAttempt=platform-test"></iframe>':pageHtml,{url:'https://campus.test/works/she-love-me/',runScripts:'outside-only',pretendToBeVisual:true});
 t.after(()=>dom.window.close());
 const win=embedded?dom.window.document.querySelector('iframe').contentWindow:dom.window;
 if(embedded){win.document.open();win.document.write(pageHtml);win.document.close();}
 const messages=[],requests=[];if(embedded)dom.window.postMessage=(message,origin)=>messages.push({message,origin});
 Object.defineProperty(win,'localStorage',{get(){throw new Error('Storage unavailable');}});
 Object.assign(win,engine,{demos});win.matchMedia=()=>({matches:false});win.fetch=async(url,init)=>{requests.push({url,init});return fetchImpl(url,init);};
 const script=win.document.querySelector('script[data-work="she-love-me"]');Object.defineProperty(win.document,'currentScript',{configurable:true,get:()=>script});win.eval(bridgeScript);win.eval(pageScript);win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
 return {win,document:win.document,messages,requests,
 async click(id){const target=win.document.querySelector(id);assert.ok(target,id);const e=new win.MouseEvent('click',{bubbles:true,cancelable:true});target.dispatchEvent(e);await new Promise(r=>setImmediate(r));return e;},
 consent(){const n=win.document.getElementById('consent');n.checked=true;n.dispatchEvent(new win.Event('change'));},
 hostMessage(data,origin='https://campus.test'){win.dispatchEvent(new win.MessageEvent('message',{source:dom.window,origin,data:{attemptId:'platform-test',...data}}));}
 };
}
test('examples run without storage or network, render stats, export safely and clear',async t=>{
 const f=pageFixture(t);assert.ok(f.document.querySelector('input[type=file]'));await f.click('#analyze');assert.equal(f.requests.length,0);assert.equal(f.document.getElementById('report').hidden,false);assert.match(f.document.getElementById('report-meta').textContent,/24 条/);assert.equal(f.document.getElementById('ai-analyze').disabled,true);
 let blob;f.win.URL.createObjectURL=x=>{blob=x;return 'blob:test';};f.win.URL.revokeObjectURL=()=>{};f.win.HTMLAnchorElement.prototype.click=function(){assert.match(this.download,/\.md$/);};await f.click('#export');assert.ok(blob.size>0);assert.equal(f.win.document.querySelector("#export-preview").hidden,false);assert.match(f.win.document.querySelector("#export-text").value,/# 她不一样/);
 await f.click('#clear');assert.equal(f.document.getElementById('chat-text').value,'');assert.equal(f.document.getElementById('report').hidden,true);assert.equal(f.document.getElementById('sample-preview').textContent,'');
});
test('raw input and model content render as text; changing selection invalidates consent and report',async t=>{
 const malicious='<img src=x onerror="alert(1)">';const f=pageFixture(t,{fetchImpl:async()=>Response.json({analysis:{...aiResult,summary:malicious}})});await f.click('#tab-paste');const input=f.document.getElementById('chat-text');input.value=`甲: ${malicious}\n乙: 好呀\n甲: 来看看\n乙: 好的`;input.dispatchEvent(new f.win.Event('input'));await f.click('#local-analyze');assert.equal(f.document.querySelector('#report img'),null);assert.match(f.document.getElementById('sample-preview').textContent,/<img/);
 f.consent();await f.click('#ai-analyze');assert.equal(f.requests.length,1);const sent=JSON.parse(f.requests[0].init.body);assert.equal(sent.consent,true);assert.equal(sent.messages.length,4);assert.equal(f.document.getElementById('ai-result').textContent.includes(malicious),true);assert.equal(f.document.querySelector('#ai-result img'),null);
 f.document.getElementById('self-select').dispatchEvent(new f.win.Event('change'));assert.equal(f.document.getElementById('report').hidden,true);assert.equal(f.document.getElementById('consent').checked,false);
});
test('failed model request retains stats and offers nickname when unauthenticated',async t=>{
 const f=pageFixture(t,{fetchImpl:async()=>Response.json({error:{message:'请先加入'}},{status:401})});await f.click('#analyze');f.consent();await f.click('#ai-analyze');assert.equal(f.document.getElementById('join-box').hidden,false);assert.equal(f.document.getElementById('report').hidden,false);assert.equal(f.document.getElementById('ai-result').hidden,true);assert.equal(f.document.getElementById('ai-analyze').disabled,false);
});
test('embedded bridge ignores other origins, pauses and aborts AI, suppresses stale results and disposes raw data',async t=>{
 let resolve;const f=pageFixture(t,{embedded:true,fetchImpl:()=>new Promise(r=>{resolve=r;})});await f.click('#analyze');f.consent();await f.click('#ai-analyze');const signal=f.requests[0].init.signal;
 const ready=f.messages.find(x=>x.message.type==='campus:ready');assert.equal(ready.message.workId,'she-love-me');assert.equal(ready.message.level,'page_opened');
 f.hostMessage({type:'campus:activity',paused:true},'https://foreign.test');assert.equal(f.document.getElementById('project').inert,false);
 f.hostMessage({type:'campus:activity',paused:true});assert.equal(f.document.getElementById('project').inert,true);assert.equal(signal.aborted,true);resolve(Response.json({analysis:aiResult}));await new Promise(r=>setImmediate(r));assert.equal(f.document.getElementById('ai-result').hidden,true);
 await f.click('#return-to-campus');assert.equal(f.messages.some(x=>x.message.type==='campus:exit'),false);
 f.hostMessage({type:'campus:activity',paused:false});assert.equal(f.document.getElementById('project').inert,false);await f.click('#return-to-campus');assert.equal(f.messages.filter(x=>x.message.type==='campus:exit').length,1);
 f.hostMessage({type:'campus:dispose'});assert.equal(f.document.getElementById('project').inert,true);assert.equal(f.document.getElementById('sample-preview').textContent,'');assert.match(f.document.getElementById('activity-status').textContent,/已结束/);
});
test('standalone return keeps normal campus navigation',async t=>{const f=pageFixture(t);let prevented;f.document.getElementById('return-to-campus').addEventListener('click',e=>{prevented=e.defaultPrevented;e.preventDefault();});await f.click('#return-to-campus');assert.equal(prevented,false);});

test('chat has no hidden project entry before or after completion, including old completion markers', async t => {
  const f = await fixture(t, {phone: true, legacy: '{"version":2,"hasFinishedGame":true}'});
  const assertNoEntry = () => {
    assert.doesNotMatch(f.document.body.textContent, /她不一样|恋情分析室/);
    assert.equal(f.document.querySelector('dialog'), null);
    assert.equal(f.document.querySelector('a[href*="she-love-me"]'), null);
  };
  assertNoEntry();
  await f.finish();
  assert.ok(f.document.querySelector('.game-ending'));
  assertNoEntry();
  await f.click(f.document.querySelector('[aria-label="聊天信息与操作"]'));
  assertNoEntry();
  await f.click(f.buttons('重新开始这段故事')[0]);
  assert.equal(f.document.querySelector('.game-ending'), null);
  assertNoEntry();
  await f.click(f.document.querySelector('[aria-label="返回会话列表"]'));
  await f.click(f.document.querySelector('.wx-tabbar button[aria-label="我"]') || [...f.document.querySelectorAll('.wx-tabbar button')].find(button => button.textContent === '我'));
  assert.ok(f.document.querySelector('.wx-profile'));
  assertNoEntry();
  for (const name of ['SheLoveProject.tsx', 'sheLoveCompletion.ts', 'she-love-project.css']) assert.equal(existsSync(path.join(overrideRoot, 'components', name)), false);
});

test('AI import requires consent, previews editable rows and only analyzes after confirmation',async t=>{
 const imported={messages:['我','对方','我','对方'].map((sender,i)=>({sender,content:i===1?'<img src=x onerror=alert(1)>':'消息 '+i,timestamp:null,uncertain:i===1})),warnings:['缺少日期'],truncated:false};
 const f=pageFixture(t,{fetchImpl:async()=>Response.json({imported})});await f.click('#tab-paste');const input=f.document.querySelector('#chat-text');input.value='我\n明天一起看展\n对方\n好呀';input.dispatchEvent(new f.win.Event('input'));
 await f.click('#analyze');assert.equal(f.requests.length,0);const consent=f.document.querySelector('#import-consent');consent.checked=true;consent.dispatchEvent(new f.win.Event('change'));await f.click('#analyze');
 assert.equal(f.requests[0].url,'/api/works/she-love-me/import');assert.equal(JSON.parse(f.requests[0].init.body).text,input.value);assert.equal(f.document.querySelector('#import-review').hidden,false);assert.equal(f.document.querySelector('#report').hidden,true);assert.equal(f.document.querySelector('#review-rows img'),null);assert.equal(f.document.querySelectorAll('.review-row').length,4);
 const message=f.document.querySelector('.review-row textarea');message.value='修改过的消息';message.dispatchEvent(new f.win.Event('input'));await f.click('#analyze');assert.equal(f.document.querySelector('#report').hidden,false);assert.match(f.document.querySelector('#sample-preview').textContent,/修改过/);assert.equal(f.requests.length,1);
 await f.click('#clear');assert.equal(f.document.querySelectorAll('.review-row').length,0);assert.equal(f.document.querySelector('#import-consent').checked,false);
});
test('changing source or pausing cancels import and prevents stale result replacing input',async t=>{
 let resolve;const f=pageFixture(t,{embedded:true,fetchImpl:()=>new Promise(r=>{resolve=r;})});await f.click('#tab-paste');const input=f.document.querySelector('#chat-text');input.value='任意聊天';input.dispatchEvent(new f.win.Event('input'));f.document.querySelector('#import-consent').checked=true;await f.click('#analyze');const signal=f.requests[0].init.signal;
 f.hostMessage({type:'campus:activity',paused:true});assert.equal(signal.aborted,true);resolve(Response.json({imported:{messages:[],warnings:[],truncated:false}}));await new Promise(r=>setImmediate(r));assert.equal(f.document.querySelector('#import-review').hidden,true);
 f.hostMessage({type:'campus:activity',paused:false});assert.equal(f.document.querySelector('#analyze').disabled,false);assert.equal(input.value,'任意聊天');
});
