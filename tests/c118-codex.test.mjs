import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeC118Screen,reconcileC118Screen} from '../src/c118-screen-state.js';
import {createLocalCodexConversation} from '../src/c118-codex-conversation.js';
import {SKY_QR_PLACEMENT} from '../src/sky-qr-placement.js';

test('Codex host content follows the same explicit revision guard and survives video switches and old-client saves',()=>{
 const screen={mediaId:'codex',revision:1,codexText:'欢迎来到 AI 俱乐部\n我们来构建点什么？'};
 assert.deepEqual(normalizeC118Screen(screen),screen);
 assert.deepEqual(reconcileC118Screen({c118Screen:screen},{c118Screen:screen}),screen);
 assert.throws(()=>reconcileC118Screen({c118Screen:screen},{c118Screen:{...screen,codexText:'偷偷替换'}}));
 const video=reconcileC118Screen({c118Screen:screen},{c118Screen:{mediaId:'club-promo',revision:2}});assert.equal(video.codexText,screen.codexText);
 assert.deepEqual(reconcileC118Screen({c118Screen:video},{}),video);
 assert.throws(()=>normalizeC118Screen({...screen,codexText:'x'.repeat(4001)}));
 assert.throws(()=>normalizeC118Screen({...screen,codexText:{html:'<script>'}}));
});
test('each viewer keeps independent replies; repeated snapshots do not duplicate host text and a clear resets the page',()=>{
 const a=createLocalCodexConversation(),b=createLocalCodexConversation(),host={mediaId:'codex',revision:1,codexText:'一起写代码'};
 assert.ok(a.accept(host));assert.ok(b.accept(host));assert.equal(a.accept(host),false);
 assert.ok(a.reply('我的第一条回复'));assert.equal(a.messages.length,2);assert.equal(b.messages.length,1);assert.equal(host.codexText,'一起写代码');
 a.accept({...host,revision:2,codexText:'继续吧'});assert.equal(a.messages.at(-1).text,'继续吧');assert.equal(a.messages[1].text,'我的第一条回复');
 assert.equal(a.reply('  '),false);a.reply('x'.repeat(3000));assert.equal(a.messages.at(-1).text.length,2000);
 for(let i=0;i<100;i++)a.reply(String(i));assert.equal(a.messages.length,40);
 a.accept({...host,revision:3,codexText:''});assert.equal(a.messages.length,0);
});
test('personal QR keeps its original sky placement independently of the group card',()=>{
 assert.deepEqual(SKY_QR_PLACEMENT,{x:428.44619,y:2400,z:58.80678,size:1200});
});

test('viewer chat is ephemeral and clearing does not replay an unchanged host snapshot',()=>{
 const viewer=createLocalCodexConversation(),host={mediaId:'codex',revision:1,codexText:'主持人'};
 viewer.accept(host);viewer.reply('私有回复');viewer.clear();assert.equal(viewer.messages.length,0);
 assert.equal(viewer.accept(host),false);assert.equal(viewer.messages.length,0);
 viewer.accept({...host,revision:2,codexText:'下一句'});assert.deepEqual(viewer.messages,[{role:'codex',text:'下一句'}]);
 assert.equal(createLocalCodexConversation().messages.length,0,'a new page cannot restore another page reply');
});
