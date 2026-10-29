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

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}

test('completion migration accepts only a literal completed flag and never changes legacy story saves', () => {
  const {readStoredStoryCompletion, rememberStoryCompletion} = modules()('components/sheLoveCompletion');
  for (const key of ['ta-say:persisted', 'ta-say:original-story:persisted']) {
    for (const value of [null, 'broken json', 'true', '[]', '{}', '{"version":2,"hasFinishedGame":false}', '{"version":2,"hasFinishedGame":"true"}', '{"version":2,"hasFinishedGame":1}', '{"opened":true,"returned":true,"stage":"wake_up"}', '{"hasFinishedGame":true}', '{"version":1,"hasFinishedGame":true}', '{"version":3,"hasFinishedGame":true}', '{"version":"2","hasFinishedGame":true}']) {
      assert.equal(readStoredStoryCompletion(storage({[key]: value})), false, `${key}: ${value}`);
    }
    assert.equal(readStoredStoryCompletion(storage({[key]: '{"version":2,"hasFinishedGame":true}'})), true);
  }
  const legacy = JSON.stringify({version: 2, hasFinishedGame: true, autoSaveSnapshot: {stage: 'old-story'}, metaMemory: ['old-story']});
  const saved = storage({'ta-say:persisted': legacy});
  assert.equal(readStoredStoryCompletion(saved), true);
  rememberStoryCompletion(true, saved);
  assert.equal(saved.getItem('ta-say:persisted'), legacy);
  assert.equal(saved.getItem('ta-say:original-story:persisted'), null);
  saved.values.delete('ta-say:persisted');
  assert.equal(readStoredStoryCompletion(saved), true, 'completion survives after the legacy save is gone');
  rememberStoryCompletion(false, saved);
  assert.equal(readStoredStoryCompletion(saved), true, 'replay cannot clear a completed marker');
});

test('missing or blocked storage cannot unlock a new player or break a completed session', () => {
  const blocked = {getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }};
  for (const value of [null, blocked]) {
    const {readStoredStoryCompletion, rememberStoryCompletion} = modules()('components/sheLoveCompletion');
    assert.equal(readStoredStoryCompletion(value), false);
    assert.doesNotThrow(() => rememberStoryCompletion(true, value));
    assert.equal(readStoredStoryCompletion(value), true, 'completion survives within the current page');
    assert.equal(modules()('components/sheLoveCompletion').readStoredStoryCompletion(value), false, 'a new page cannot persist completion when storage is blocked');
  }
  const {readStoredStoryCompletion, rememberStoryCompletion} = modules()('components/sheLoveCompletion');
  const saved = storage();
  rememberStoryCompletion(false, saved);
  assert.equal(saved.values.size, 0);
  assert.equal(readStoredStoryCompletion(storage({'ta-say:she-love-me:completed': '"true"'})), false);
  assert.equal(readStoredStoryCompletion(storage({'ta-say:she-love-me:completed': 'bad', 'ta-say:persisted': '{"version":2,"hasFinishedGame":true}'})), true);
});

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
  if (legacy !== undefined) win.localStorage.setItem('ta-say:persisted', legacy);
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

test('new player has no project entry; real completion reveals it immediately and replay retains it', async t => {
  const f = await fixture(t);
  assert.equal(f.buttons('她不一样 · 恋情分析室').length, 0);
  await f.finish();
  assert.equal(f.document.querySelector('.game-ending').textContent.includes('她不一样 · 恋情分析室'), true);
  assert.equal(f.win.localStorage.getItem('ta-say:she-love-me:completed'), 'true');
  await f.click(f.buttons('重新开始这段故事')[0]);
  assert.equal(f.document.querySelector('.game-ending'), null);
  assert.ok(f.document.querySelector('#wx-chat-actions').textContent.includes('她不一样 · 恋情分析室'));
});

test('a returning legacy winner sees the entry without restoring old story progress', async t => {
  const f = await fixture(t, {legacy: '{"version":2,"hasFinishedGame":true,"autoSaveSnapshot":{"stage":"wake_up"}}'});
  assert.equal(f.state.session.stage, 'warmup');
  assert.equal(f.state.session.hasFinishedGame, false);
  assert.equal(f.document.querySelector('.game-ending'), null);
  assert.ok(f.buttons('她不一样 · 恋情分析室').length);
});

test('blocked-storage replay clears the store flag but completion survives ChatPage remounts', async t => {
  const f = await fixture(t, {blockedStorage: true});
  assert.equal(f.buttons('她不一样 · 恋情分析室').length, 0);
  await f.finish();
  await f.click(f.buttons('重新开始这段故事')[0]);
  assert.equal(f.state.session.hasFinishedGame, false, 'replay rebuilt the session from unavailable storage defaults');
  await f.remount();
  assert.equal(f.state.session.hasFinishedGame, false, 'project availability does not rewrite story state');
  assert.equal(f.document.querySelector('.game-ending'), null);
  await f.click(f.buttons('她不一样 · 恋情分析室')[0]);
  assert.ok(f.document.querySelector('dialog[open]'));
});

test('project preserves chat position and menu, restores focus on Escape, and supplies safe external links', async t => {
  const f = await fixture(t, {finished: true, phone: true});
  await f.click(f.document.querySelector('[aria-label="聊天信息与操作"]'));
  const entry = f.document.querySelector('#wx-chat-actions button:nth-of-type(2)');
  assert.equal(entry.textContent, '她不一样 · 恋情分析室');
  const stream = f.document.querySelector('.desktop-chat-stream');
  assert.ok(stream);
  stream.scrollTop = 123;
  await f.click(entry);
  const dialog = f.document.querySelector('dialog');
  assert.ok(dialog.open);
  assert.equal(f.document.activeElement.getAttribute('aria-label'), '返回聊天');
  for (const link of dialog.querySelectorAll('a')) {
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
    assert.ok(link.href.startsWith('https://github.com/863401402/she-love-me'));
  }
  assert.equal(dialog.querySelector('input[type=file]'), null);
  await React.act(async () => dialog.dispatchEvent(new f.win.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true})));
  assert.equal(f.document.querySelector('dialog'), null);
  assert.equal(f.document.activeElement, entry);
  assert.equal(f.document.querySelector('[aria-label="聊天信息与操作"]').getAttribute('aria-expanded'), 'true');
  assert.equal(stream.scrollTop, 123);
});

test('copy succeeds when permitted and falls back to selected instructions when iframe clipboard is denied', async t => {
  const f = await fixture(t, {finished: true});
  let copied;
  Object.defineProperty(f.win.navigator, 'clipboard', {configurable: true, value: {async writeText(value) { copied = value; }}});
  await f.click(f.buttons('她不一样 · 恋情分析室')[0]);
  await f.click(f.buttons('复制给 AI 的指令')[0]);
  assert.equal(copied, f.load('components/SheLoveProject').sheLoveAiInstruction);
  assert.match(f.document.querySelector('dialog [role=status]').textContent, /已复制/);
  Object.defineProperty(f.win.navigator, 'clipboard', {value: {async writeText() { throw new Error('Permission denied'); }}});
  await f.click(f.buttons('复制给 AI 的指令')[0]);
  const field = f.document.querySelector('dialog textarea');
  assert.equal(f.document.activeElement, field);
  assert.equal(field.selectionStart, 0);
  assert.equal(field.selectionEnd, field.value.length);
  assert.match(f.document.querySelector('dialog [role=status]').textContent, /请长按或使用复制快捷键/);
  assert.match(field.value, /不要自动读取微信、QQ/);
});
