import test from 'node:test';
import assert from 'node:assert/strict';
import { createCueStore, filterCues } from '../src/operator-cues.js';
import { SCRIPT } from '../src/operator-cue-data.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('host speech, Codex replies and stage directions remain distinct, including the three-second pause', () => {
  assert.deepEqual(Object.fromEntries(['host', 'codex', 'announcement', 'direction'].map(role => [role, filterCues(SCRIPT.entries, { role }).length])), { host: 19, codex: 20, announcement: 1, direction: 13 });
  assert.equal(SCRIPT.entries.find(entry => entry.text === '（思考3秒）').role, 'direction');
  assert.equal(SCRIPT.entries.find(entry => entry.text === '可你我本就年少').role, 'codex');
  assert.equal(SCRIPT.entries.find(entry => entry.text === '欢迎大家探索东校区online').role, 'announcement');
  assert.equal(SCRIPT.entries.find(entry => entry.text.startsWith('手把手带零基础')).role, 'direction');
  assert.equal(new Set(SCRIPT.entries.map(entry => entry.id)).size, SCRIPT.entries.length);
});

test('edits, empty drafts and resets survive reload; separate tabs preserve edits to different lines', () => {
  const storage = memoryStorage(), a = createCueStore(storage), b = createCueStore(storage);
  assert.equal(a.set('line-07', '修改后的回复\n第二行'), true);
  b.set('line-10', '');
  const reloaded = createCueStore(storage);
  assert.equal(reloaded.entries().find(entry => entry.id === 'line-07').text, '修改后的回复\n第二行');
  assert.equal(reloaded.entries().find(entry => entry.id === 'line-10').text, '');
  reloaded.set('line-07', SCRIPT.entries[6].text);
  assert.equal(createCueStore(storage).entries()[6].edited, false);
});

test('filtered results use edited text and keep the original show order', () => {
  const store = createCueStore(memoryStorage()); store.set('line-07', '彩排版本');
  assert.deepEqual(filterCues(store.entries(), { role: 'codex', chapter: '开场与演示', query: '彩排' }).map(entry => entry.id), ['line-07']);
  assert.equal(filterCues(store.entries(), { role: 'host', query: '彩排' }).length, 0);
  const ids = filterCues(store.entries(), { role: 'codex' }).map(entry => Number(entry.id.slice(5)));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

test('export/import transfers edits without accepting invalid data or losing existing lines', () => {
  const a = createCueStore(memoryStorage()), b = createCueStore(memoryStorage());
  a.set('line-07', '用于另一个后台'); b.set('line-01', '主持人彩排');
  assert.equal(b.import(a.export()), true);
  assert.equal(b.entries()[6].text, '用于另一个后台');
  assert.equal(b.entries()[0].text, '主持人彩排');
  for (const edits of [{ unknown: 'bad' }, { 'line-07': null }, { 'line-07': 'x'.repeat(16001) }]) assert.throws(() => b.import({ version: 1, edits }));
  assert.throws(() => b.import({ version: 2, edits: {} }));
  assert.equal(b.entries()[6].text, '用于另一个后台');
});

test('storage failures keep the visible edit and expose a warning instead of claiming it was saved', () => {
  const store = createCueStore({ getItem() { return '{invalid'; }, setItem() { throw new Error('quota'); } });
  assert.match(store.warning, /无法读取/);
  assert.equal(store.set('line-07', '尚未保存'), false);
  assert.equal(store.entries()[6].text, '尚未保存');
  assert.match(store.warning, /暂未保存/);
  assert.equal(store.export().edits['line-07'], '尚未保存');
});
