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
const pageScript = readFileSync(path.join(pageRoot, 'project.js'), 'utf8');
const bridgeScript = readFileSync(path.resolve(here, '../../public/experiences/activity-bridge.js'), 'utf8');

function pageFixture(t, {embedded = false, clipboard} = {}) {
  const dom = new JSDOM(embedded ? '<iframe src="/works/she-love-me/?campusAttempt=guide-test"></iframe>' : pageHtml, {
    url: 'https://campus.test/works/she-love-me/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  t.after(() => dom.window.close());
  const win = embedded ? dom.window.document.querySelector('iframe').contentWindow : dom.window;
  if (embedded) { win.document.open(); win.document.write(pageHtml); win.document.close(); }
  const messages = [];
  if (embedded) dom.window.postMessage = (message, origin) => messages.push({message, origin});
  if (clipboard) Object.defineProperty(win.navigator, 'clipboard', {configurable: true, value: clipboard});
  Object.defineProperty(win, 'localStorage', {get() { throw new Error('Storage unavailable'); }});
  win.fetch = () => { throw new Error('The guide must not make data requests'); };
  const bridgeElement = win.document.querySelector('script[data-work="she-love-me"]');
  assert.ok(bridgeElement);
  Object.defineProperty(win.document, 'currentScript', {configurable: true, get: () => bridgeElement});
  win.eval(bridgeScript);
  win.eval(pageScript);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  return {win, document: win.document, messages,
    async click(selector) {
      const target = win.document.querySelector(selector);
      assert.ok(target, selector);
      const event = new win.MouseEvent('click', {bubbles: true, cancelable: true});
      target.dispatchEvent(event);
      await new Promise(resolve => setImmediate(resolve));
      return event;
    },
    hostMessage(data, origin = 'https://campus.test') {
      win.dispatchEvent(new win.MessageEvent('message', {source: dom.window, origin, data: {attemptId: 'guide-test', ...data}}));
    }
  };
}

test('independent guide is available without story/storage and retains project attribution and selectable instructions', t => {
  const f = pageFixture(t);
  assert.equal(f.document.querySelector('h1').textContent, '她不一样');
  assert.match(f.document.body.textContent, /爱因斯坦广场/);
  assert.doesNotMatch(f.document.body.textContent, /通关|解锁|过拟合恋人/);
  assert.equal(f.document.querySelector('input[type=file], form'), null);
  const instruction = f.document.getElementById('ai-instruction');
  assert.equal(instruction.readOnly, true);
  assert.match(instruction.value, /符合项目支持格式的 JSON 或 Markdown/);
  assert.match(instruction.value, /不要自动读取微信、QQ/);
  assert.match(f.document.body.textContent, /运行在电脑上的 AI 编程助手中/);
  assert.equal(f.document.querySelector('link[rel=stylesheet]').getAttribute('href'), './project.css');
  assert.equal(f.document.querySelectorAll('script').length, 2);
  for (const link of f.document.querySelectorAll('a[target="_blank"]')) {
    assert.equal(link.rel, 'noopener noreferrer');
    assert.ok(link.href.startsWith('https://github.com/863401402/she-love-me'));
  }
  assert.ok(f.document.querySelector('a[href$="/LICENSE"]'));
  assert.equal(f.document.getElementById('return-to-campus').getAttribute('href'), '/');
});

test('clipboard success copies the exact visible instruction', async t => {
  let copied;
  const f = pageFixture(t, {clipboard: {async writeText(value) { copied = value; }}});
  await f.click('#copy-instruction');
  assert.equal(copied, f.document.getElementById('ai-instruction').value);
  assert.match(f.document.getElementById('copy-status').textContent, /已复制/);
});

test('missing or denied clipboard selects the instruction for manual copying', async t => {
  for (const clipboard of [undefined, {async writeText() { throw new Error('Permission denied'); }}]) {
    const f = pageFixture(t, {clipboard});
    await f.click('#copy-instruction');
    const field = f.document.getElementById('ai-instruction');
    assert.equal(f.document.activeElement, field);
    assert.equal(field.selectionStart, 0);
    assert.equal(field.selectionEnd, field.value.length);
    assert.match(f.document.getElementById('copy-status').textContent, /请长按或使用复制快捷键/);
  }
});

test('activity bridge reports the independent work, pauses the whole guide, and exits only from the return control', async t => {
  let copies = 0;
  const f = pageFixture(t, {embedded: true, clipboard: {async writeText() { copies += 1; }}});
  const ready = f.messages.find(item => item.message.type === 'campus:ready');
  assert.ok(ready);
  assert.equal(ready.message.workId, 'she-love-me');
  assert.equal(ready.message.attemptId, 'guide-test');
  assert.equal(ready.message.level, 'page_opened');
  assert.equal(ready.origin, 'https://campus.test');
  f.hostMessage({type: 'campus:activity', paused: true}, 'https://foreign.test');
  assert.equal(f.document.getElementById('project').inert, false);
  f.hostMessage({type: 'campus:activity', paused: true});
  assert.equal(f.document.getElementById('project').inert, true);
  assert.equal(f.document.getElementById('activity-status').hidden, false);
  await f.click('#copy-instruction');
  await f.click('#return-to-campus');
  assert.equal(copies, 0);
  assert.equal(f.messages.some(item => item.message.type === 'campus:exit'), false);
  f.hostMessage({type: 'campus:activity', paused: false});
  assert.equal(f.document.getElementById('project').inert, false);
  assert.equal(f.document.getElementById('activity-status').hidden, true);
  await f.click('#copy-instruction');
  assert.equal(copies, 1);
  const event = await f.click('#return-to-campus');
  assert.equal(event.defaultPrevented, true);
  const exits = f.messages.filter(item => item.message.type === 'campus:exit');
  assert.equal(exits.length, 1);
  assert.equal(exits[0].message.workId, 'she-love-me');
  assert.equal(exits[0].message.attemptId, 'guide-test');
  f.hostMessage({type: 'campus:dispose'});
  assert.equal(f.document.getElementById('project').inert, true);
  assert.match(f.document.getElementById('activity-status').textContent, /已结束/);
  await f.click('#return-to-campus');
  assert.equal(f.messages.filter(item => item.message.type === 'campus:exit').length, 1);
});

test('standalone return keeps normal campus navigation', async t => {
  const f = pageFixture(t);
  let wasPrevented;
  f.document.getElementById('return-to-campus').addEventListener('click', event => {
    wasPrevented = event.defaultPrevented;
    event.preventDefault(); // JSDOM cannot perform navigation; observe the page handler first.
  });
  await f.click('#return-to-campus');
  assert.equal(wasPrevented, false);
});

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
