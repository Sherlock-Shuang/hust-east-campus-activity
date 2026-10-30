import {parseChat,analyzeChat,sampleReport,duration,observations,markdownReport,MAX_BYTES} from './analyzer.js';
import {demos} from './demo.js';
const $ = id=>document.getElementById(id);
const el = (tag,text,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;return n;};
let mode='demo',demoIndex=0,fileText='',parsed=null,report=null,sample=null,analysis=null,controller=null,version=0,paused=false,disposed=false,parseTimer;
const tabId=crypto.randomUUID();
function status(id,message,error=false){$(id).textContent=message;$(id).classList.toggle('error',error);}
function cancel(message='已取消 AI 解读，统计结果仍保留。') { version++;controller?.abort();controller=null;$('cancel-ai').hidden=true;$('ai-analyze').textContent='生成 AI 解读 ✳';$('ai-analyze').disabled=!sample||!$('consent').checked||paused;$('join').disabled=false;if(message)status('ai-status',message); }
function resetReport(){cancel('');report=sample=analysis=null;$('report').hidden=true;$('empty-report').hidden=false;$('ai-result').replaceChildren();$('ai-result').hidden=true;$('sample-preview').textContent='';$('consent').checked=false;$('ai-analyze').disabled=true;$('join-box').hidden=true;status('ai-status','');}
function sourceText(){return mode==='demo'?demos[demoIndex].text:mode==='file'?fileText:$('chat-text').value;}
function parseSource(silent=true){
  try { parsed=parseChat(sourceText());const previous=$('self-select').value;$('self-select').replaceChildren(...parsed.authors.map(name=>{const opt=el('option',name);opt.value=name;return opt;}));$('self-select').value=parsed.authors.includes(previous)?previous:mode==='demo'?demos[demoIndex].self:parsed.authors.includes('我')?'我':parsed.authors[0];$('self-select').disabled=false;$('range-select').disabled=!parsed.completeTime;if(!parsed.completeTime)$('range-select').value='0';$('range-note').textContent=parsed.completeTime?'时间范围以记录中的最后一天为基准。':'时间不完整：只计算数量与文字指标。';status('input-status','');return true;
  } catch(e){parsed=null;$('self-select').replaceChildren(el('option','等待识别发送者'));$('self-select').disabled=true;$('range-select').disabled=true;if(!silent)status('input-status',e.message,true);return false;}
}
function preview(){const p=parseChat(demos[demoIndex].text);$('chat-preview').replaceChildren(...p.messages.slice(0,4).map(m=>{const box=el('div',null,'bubble'+(m.sender===demos[demoIndex].self?' mine':''));box.append(el('small',m.sender),el('p',m.content));return box;}),el('div',`还有 ${p.messages.length-4} 条对话，等你发现 ···`,'preview-more'));document.querySelectorAll('[data-demo]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.demo)===demoIndex);b.setAttribute('aria-pressed',Number(b.dataset.demo)===demoIndex?'true':'false');});}
function setMode(next){mode=next;clearTimeout(parseTimer);resetReport();status('input-status','');document.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===mode;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1;$('panel-'+b.dataset.tab).hidden=!on;});parseSource();}
function renderReport(){
  const r=report;
  $('empty-report').hidden=true;$('report').hidden=false;
  $('report-source').textContent=mode==='demo'?'FICTIONAL DEMO / 虚构示例':'YOUR CONVERSATION / 你的对话';
  $('report-heading').textContent='每一次回应，都有迹可循';
  const date=n=>new Date(n+8*3600000).toISOString().slice(0,10).replaceAll('-','.');
  $('report-meta').textContent=`${r.timed?date(r.start)+' — '+date(r.end):'无完整时间记录'} · ${r.total} 条文字消息${r.skipped?` · 跳过 ${r.skipped} 条不支持的记录`:''}`;
  $('metrics').replaceChildren(...[['文字消息',r.total,'条'],['对话片段',r.sessions??'—',r.timed?'段':'时间不足'],['双方参与',`${r.me.share}:${r.them.share}`,'%']].map(([label,n,unit])=>{const box=el('div',null,'metric'),value=el('strong',String(n));value.append(el('span',unit));box.append(el('small',label),value);return box;}));
  $('pair-names').textContent='我 / 对方';$('share-bar').replaceChildren(...[r.me,r.them].map(p=>{const n=el('span');n.style.width=`${p.share}%`;return n;}));$('share-bar').setAttribute('aria-label',`我 ${r.me.share}%，对方 ${r.them.share}%`);$('me-share').textContent=`我 · ${r.me.count} 条 (${r.me.share}%)`;$('them-share').textContent=`对方 · ${r.them.count} 条 (${r.them.share}%)`;
  const rows=[[`${r.me.averageLength} 字`,'平均消息长度',`${r.them.averageLength} 字`],[r.timed?`${r.me.starts} 次`:'—','主动开启片段',r.timed?`${r.them.starts} 次`:'—'],[duration(r.me.replySeconds),'平均回复用时',duration(r.them.replySeconds),`${r.me.replySamples} 个有效间隔`,`${r.them.replySamples} 个有效间隔`],[`${r.me.short} 条`,'简短回复',`${r.them.short} 条`],[`${r.me.maxRun} 条`,'最长连续发送',`${r.them.maxRun} 条`]];
  $('comparison-rows').replaceChildren(...rows.map(([a,label,b,noteA,noteB])=>{const row=el('div',null,'compare-row'),left=el('span',a),right=el('span',b);if(noteA)left.append(el('small',noteA));if(noteB)right.append(el('small',noteB));row.append(left,el('span',label,'row-label'),right);return row;}));
  $('trend').hidden=!r.timed;
  const days=r.daily.slice(-14),max=Math.max(1,...days.flatMap(d=>[d.me,d.them]));
  $('daily-chart').replaceChildren(...days.map(d=>{const col=el('div',null,'day'),bars=el('div',null,'day-bars');col.title=`${d.date}：我 ${d.me} 条，对方 ${d.them} 条`;col.setAttribute('aria-label',col.title);for(const count of [d.me,d.them]){const bar=el('i');bar.style.height=`${count/max*100}%`;bars.append(bar);}col.append(bars,el('small',d.date.slice(5)));return col;}));
  $('chart-note').textContent=`玫瑰色：我 · 青色：对方${r.daily.length>14?' · 仅显示最近 14 个有消息的日期':''}`;
  $('observations').replaceChildren(...observations(r).map(x=>el('li',x)));
  sample=sampleReport(r);$('sample-summary').textContent=`查看将发送的 ${sample.messages.length} / ${r.total} 条样本和统计`;
  $('sample-preview').textContent=`${r.total>48?'从时间顺序中均匀取 6 段连续对话，每段 8 条。':'这段对话不超过 48 条，将发送全部文字消息。'}\n${sample.trimmed} 条长消息被截短；${sample.redacted} 条消息隐藏了常见手机号或邮箱。\n\n统计数据：\n${JSON.stringify({total:sample.total,timed:sample.timed,sessions:sample.sessions,me:sample.me,them:sample.them},null,2)}\n\n消息样本：\n${sample.messages.map(m=>`#${m.id} ${m.sender==='me'?'我':'对方'}：${m.content}`).join('\n')}`;
  status('input-status',`已在浏览器完成 ${r.total} 条消息的统计，没有上传聊天。`);
}
function showAnalysis(result){analysis=result;$('ai-result').hidden=false;const nodes=[el('h5','对话之外，还有这些可能'),el('p',result.summary)];for(const item of result.observations){nodes.push(el('h5',item.title),el('p',item.detail),el('span',`依据抽样消息 #${item.evidence.join('、#')}，可在上方样本中核对。`,'evidence'));}const list=el('ul');list.append(...result.suggestions.map(s=>el('li',s)));nodes.push(el('h5','可以试试这样沟通'),list,el('p',result.limitations,'limit'));$('ai-result').replaceChildren(...nodes);}
async function jsonFetch(url,options={}){const res=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});let data;try{data=await res.json();}catch{throw new Error('服务暂时无法响应，请稍后再试。');}if(!res.ok){const e=new Error(data.error?.message||data.error||'请求未完成，请稍后重试。');e.status=res.status;throw e;}return data;}
async function requestAI(join=false){
  if(!sample||!$('consent').checked||paused||disposed||controller)return;
  const snapshot=sample,requestVersion=++version;controller=new AbortController();const signal=controller.signal;$('ai-analyze').disabled=true;$('join').disabled=true;$('cancel-ai').hidden=false;$('ai-analyze').textContent='正在理解这段对话…';status('ai-status','正在连接校园模型服务，通常需要十几秒…');
  try {
    if(join){const nickname=$('nickname').value.trim();if(!nickname)throw new Error('先填写一个校园昵称。');await jsonFetch('/api/audience/join',{method:'POST',body:JSON.stringify({nickname,tabId}),signal});}
    const data=await jsonFetch('/api/works/she-love-me/analyze',{method:'POST',body:JSON.stringify({consent:true,...snapshot}),signal});
    if(requestVersion!==version||paused||disposed)return;
    showAnalysis(data.analysis);$('join-box').hidden=true;status('ai-status',`解读完成 · 使用 ${snapshot.messages.length} 条样本。建议结合上下文理解，不把推测当结论。`);
  } catch(e){if(requestVersion!==version||signal.aborted)return;if(e.status===401){$('join-box').hidden=false;status('ai-status','填一个昵称即可使用 AI 解读，本地统计不受影响。');$('nickname').focus();}else status('ai-status',e.message,true);
  } finally {if(requestVersion===version){controller=null;$('cancel-ai').hidden=true;$('ai-analyze').textContent='生成 AI 解读 ✳';$('ai-analyze').disabled=!$('consent').checked||paused;$('join').disabled=false;}}
}
document.querySelectorAll('[data-tab]').forEach(b=>{b.addEventListener('click',()=>setMode(b.dataset.tab));b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-tab]')];let i=tabs.indexOf(b);i=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;setMode(tabs[i].dataset.tab);tabs[i].focus();});});
document.querySelectorAll('[data-demo]').forEach(b=>b.addEventListener('click',()=>{demoIndex=Number(b.dataset.demo);resetReport();preview();parseSource();}));
$('chat-text').addEventListener('input',()=>{resetReport();parsed=null;clearTimeout(parseTimer);parseTimer=setTimeout(()=>parseSource(),350);});
$('chat-file').addEventListener('change',async()=>{resetReport();fileText='';const file=$('chat-file').files[0];$('file-name').textContent=file?file.name:'文件仅在当前浏览器中读取。';if(!file)return;const fileVersion=version;try{if(file.size>MAX_BYTES)throw new Error('文件超过 2 MB，请先截取一段双人聊天。');const content=await file.text();if(fileVersion!==version||disposed)return;fileText=content;parseSource(false);}catch(e){status('input-status',e.message,true);}});
$('self-select').addEventListener('change',resetReport);$('range-select').addEventListener('change',resetReport);
$('analyze').addEventListener('click',()=>{if(paused||disposed)return;clearTimeout(parseTimer);resetReport();try{if(!parseSource(false))return;report=analyzeChat(parsed,$('self-select').value,Number($('range-select').value));renderReport();if(innerWidth<=760)$('report-title').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});}catch(e){status('input-status',e.message,true);}});
$('quick-demo').addEventListener('click',()=>{if(paused||disposed)return;setMode('demo');$('analyze').click();});
$('clear').addEventListener('click',()=>{resetReport();clearTimeout(parseTimer);fileText='';parsed=null;$('chat-text').value='';$('chat-file').value='';$('file-name').textContent='文件仅在当前浏览器中读取。';$('nickname').value='';setMode('paste');status('input-status','已清空当前记录与报告。');});
$('consent').addEventListener('change',()=>{if(!$('consent').checked&&controller)cancel('已停止 AI 请求；已发送的样本无法撤回。');$('ai-analyze').disabled=!$('consent').checked||!sample||!!controller||paused;});
$('ai-analyze').addEventListener('click',()=>requestAI());$('join').addEventListener('click',()=>requestAI(true));$('nickname').addEventListener('keydown',e=>{if(e.key==='Enter')requestAI(true);});$('cancel-ai').addEventListener('click',()=>cancel());
$('export').addEventListener('click',()=>{if(!report)return;const blob=new Blob([markdownReport(report,analysis)],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='她不一样-聊天观察报告.md';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('return-to-campus').addEventListener('click',e=>{if(window.parent!==window&&window.campusActivity){e.preventDefault();window.campusActivity.exit();}});
function lifecycle(state){paused=!!state.paused;disposed=!!state.disposed;$('project').inert=paused||disposed;$('activity-status').hidden=!paused&&!disposed;$('activity-status').textContent=disposed?'本次体验已结束，请返回校园。':'主持人暂停了体验，恢复后可以继续。';if(paused||disposed){cancel('体验暂停，已取消正在进行的 AI 请求。');clearTimeout(parseTimer);}if(disposed){resetReport();parsed=null;fileText='';$('chat-text').value='';$('chat-file').value='';$('nickname').value='';}if(!paused&&!disposed)$('ai-analyze').disabled=!sample||!$('consent').checked;}
preview();parseSource();if(window.campusActivity)window.campusActivity.subscribe(lifecycle);else window.addEventListener('load',()=>window.campusActivity?.subscribe(lifecycle),{once:true});
window.addEventListener('pagehide',()=>{cancel('');fileText='';parsed=report=sample=analysis=null;$('chat-text').value='';$('sample-preview').textContent='';$('ai-result').replaceChildren();});
