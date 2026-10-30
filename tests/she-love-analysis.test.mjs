import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChat,analyzeChat,sampleReport,timestamp,markdownReport} from '../public/works/she-love-me/analyzer.js';
import {demos} from '../public/works/she-love-me/demo.js';
const rows=(times=[0,30,60,20000])=>times.map((t,i)=>({sender:i%2?'them':'me',content:i===0?'你好😀':'收到啦',timestamp:1760000000+t}));
test('normalizes exported formats, time units, names and stable chronology',()=>{
 const p=parseChat(JSON.stringify({messages:rows().reverse()}));assert.deepEqual(p.authors,['对方','我']);assert.equal(p.messages[0].sender,'我');assert.equal(p.messages[0].time,1760000000000);
 for(const value of [1760000000,1760000000000,1760000000000000,1760000000000000000])assert.equal(timestamp(value),1760000000000);
 assert.equal(timestamp('2026-10-12 18:00'),Date.parse('2026-10-12T18:00:00+08:00'));assert.equal(timestamp('invalid'),null);
 const alias=parseChat(JSON.stringify({messages:rows().map((r,i)=>({isSend:i%2,content:r.content,createTime:r.timestamp}))}));assert.equal(alias.authors.length,2);
});
test('counts starts, actual reply samples and trailing runs without inventing missing timing',()=>{
 const r=analyzeChat(parseChat(JSON.stringify(rows())),'我');
 assert.equal(r.total,4);assert.equal(r.sessions,2);assert.equal(r.me.starts,1);assert.equal(r.them.starts,1);assert.equal(r.me.replySeconds,30);assert.equal(r.them.replySamples,2);
 const plain=analyzeChat(parseChat('甲: 😀😀\n乙: 好的\n甲: 今天开心\n甲: 下次见\n甲: 晚安'),'甲');
 assert.equal(plain.me.maxRun,3);assert.equal(plain.me.short,2);assert.equal(plain.me.greetings,1);assert.equal(plain.sessions,null);assert.equal(plain.me.replySeconds,null);
 const mixed=rows();delete mixed[0].timestamp;const m=analyzeChat(parseChat(JSON.stringify(mixed)));assert.equal(m.timed,false);assert.equal(m.daily.length,0);
 const bounds=analyzeChat(parseChat(JSON.stringify(rows([0,5,86406,86436]))));assert.equal(bounds.me.replySamples,0);assert.equal(bounds.them.replySamples,1);
});
test('validates input and ranges, excludes unsupported media, does not execute content',()=>{
 assert.throws(()=>parseChat('abc'),/无法识别/);assert.throws(()=>parseChat('甲: a\n乙: b\n丙: c\n甲: d'),/3 位/);assert.throws(()=>parseChat('x'.repeat(2097153)),/2 MB/);
 const data=rows();data.push({sender:'them',content:'[语音]',type:'voice'});const p=parseChat(JSON.stringify(data));assert.equal(p.skipped,1);
 const r=analyzeChat(parseChat(demos[0].text),'小林',7);assert.equal(r.total,24);assert.equal(r.me.count+r.them.count,r.total);assert.ok(markdownReport(r).includes('原始聊天未写入'));
 const xss=rows();xss[0].content='<img src=x onerror=alert(1)>';assert.equal(parseChat(JSON.stringify(xss)).messages[0].content,xss[0].content);
});
test('sampling keeps ordered adjacent windows, hides common contacts and bounds unicode length',()=>{
 const long=Array.from({length:100},(_,i)=>({sender:i%2?'me':'them',content:i===0?'电话13812345678 a@example.com':i===99?'😀'.repeat(400):'测试消息',timestamp:1760000000+i*60}));
 const sample=sampleReport(analyzeChat(parseChat(JSON.stringify(long))));assert.equal(sample.messages.length,48);assert.deepEqual(sample.messages.slice(0,8).map(m=>m.id),[1,2,3,4,5,6,7,8]);assert.equal(sample.messages.at(-1).id,100);assert.equal([...sample.messages.at(-1).content].length,321);assert.equal(sample.trimmed,1);assert.equal(sample.redacted,1);assert.ok(!JSON.stringify(sample).includes('13812345678'));assert.ok(!JSON.stringify(sample).includes('a@example.com'));
});
