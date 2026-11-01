import test from 'node:test';
import assert from 'node:assert/strict';
import { createCueStore, filterCues } from '../src/operator-cues.js';
import { SCRIPT } from '../src/operator-cue-data.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('host speech, Codex replies and stage directions remain distinct, including the three-second pause', () => {
  assert.deepEqual(Object.fromEntries(['host', 'codex', 'announcement', 'direction'].map(role => [role, filterCues(SCRIPT.entries, { role }).length])), { host: 25, codex: 19, announcement: 1, direction: 17 });
  assert.equal(SCRIPT.entries.find(entry => entry.text === '（思考3秒）').role, 'direction');
  assert.equal(SCRIPT.entries.find(entry => entry.text === '可你我本就年少').role, 'codex');
  assert.equal(SCRIPT.entries.find(entry => entry.text === '欢迎大家探索东校区online').role, 'announcement');
  assert.equal(SCRIPT.entries.find(entry => entry.text.startsWith('手把手带零基础')).role, 'direction');
  assert.equal(new Set(SCRIPT.entries.map(entry => entry.id)).size, SCRIPT.entries.length);
});

test('edits, empty drafts and resets survive reload; separate tabs preserve edits to different lines', () => {
  const storage = memoryStorage(), a = createCueStore(storage), b = createCueStore(storage);
  assert.equal(a.set('line-09', '修改后的回复\n第二行'), true);
  b.set('line-13', '');
  const reloaded = createCueStore(storage);
  assert.equal(reloaded.entries().find(entry => entry.id === 'line-09').text, '修改后的回复\n第二行');
  assert.equal(reloaded.entries().find(entry => entry.id === 'line-13').text, '');
  reloaded.set('line-09', SCRIPT.entries[8].text);
  assert.equal(createCueStore(storage).entries()[8].edited, false);
});

test('filtered results use edited text and keep the original show order', () => {
  const store = createCueStore(memoryStorage()); store.set('line-09', '彩排版本');
  assert.deepEqual(filterCues(store.entries(), { role: 'codex', chapter: '开场与演示', query: '彩排' }).map(entry => entry.id), ['line-09']);
  assert.equal(filterCues(store.entries(), { role: 'host', query: '彩排' }).length, 0);
  const ids = filterCues(store.entries(), { role: 'codex' }).map(entry => Number(entry.id.slice(5)));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

test('export/import transfers edits without accepting invalid data or losing existing lines', () => {
  const a = createCueStore(memoryStorage()), b = createCueStore(memoryStorage());
  a.set('line-09', '用于另一个后台'); b.set('line-03', '主持人彩排');
  assert.equal(b.import(a.export()), true);
  assert.equal(b.entries()[8].text, '用于另一个后台');
  assert.equal(b.entries()[2].text, '主持人彩排');
  for (const edits of [{ unknown: 'bad' }, { 'line-09': null }, { 'line-09': 'x'.repeat(16001) }]) assert.throws(() => b.import({ version: SCRIPT.version, edits }));
  assert.throws(() => b.import({ version: 1, edits: {} }));
  assert.equal(b.entries()[8].text, '用于另一个后台');
});

test('storage failures keep the visible edit and expose a warning instead of claiming it was saved', () => {
  const store = createCueStore({ getItem() { return '{invalid'; }, setItem() { throw new Error('quota'); } });
  assert.match(store.warning, /无法读取/);
  assert.equal(store.set('line-09', '尚未保存'), false);
  assert.equal(store.entries()[8].text, '尚未保存');
  assert.match(store.warning, /暂未保存/);
  assert.equal(store.export().edits['line-09'], '尚未保存');
});


test('new script never applies or overwrites old rehearsal edits after cue renumbering', () => {
  const storage = memoryStorage(), previous = JSON.stringify({ version: 1, edits: { 'line-09': '旧版的舞台动作' } });
  storage.setItem('hust-activity-script-edits-v1', previous);
  const store = createCueStore(storage);
  assert.equal(store.entries()[8].text, SCRIPT.entries[8].text);
  assert.equal(store.entries()[8].role, 'codex');
  store.set('line-09', '新版的本地排练回复');
  assert.equal(storage.getItem('hust-activity-script-edits-v1'), previous);
  assert.equal(createCueStore(storage).entries()[8].text, '新版的本地排练回复');
  assert.equal(store.export().version, 2);
  assert.throws(() => store.import(JSON.parse(previous)), /其他版本/);
});

test('November script includes C118 gathering and restoration cues and drops superseded dialogue', () => {
  assert.equal(SCRIPT.sourceSha256, '14e8d3bc2049439de6055b63f10ef440173da51358d0a5fa9c515cc0d0d02b12');
  assert.equal(SCRIPT.entries.length, 62);
  assert.equal(SCRIPT.entries.find(e => e.text === '（室内海啸，过了一会儿复原）').role, 'direction');
  assert.equal(SCRIPT.entries.find(e => e.text.startsWith('请同学们前往光电大楼C118')).role, 'host');
  assert.equal(SCRIPT.entries.find(e => e.text.startsWith('这是本次互动展示的最终场所')).role, 'codex');
  assert.equal(SCRIPT.entries.some(e => e.text.startsWith('你们置身活动之中')), false);
  assert.equal(SCRIPT.entries.some(e => e.text.startsWith('你不工作，有的是AI')), false);
});
