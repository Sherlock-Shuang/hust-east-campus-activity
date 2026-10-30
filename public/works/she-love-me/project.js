import {parseChat,analyzeChat,sampleReport,duration,observations,markdownReport,MAX_BYTES} from './analyzer.js';
import {demos} from './demo.js';
const $ = id=>document.getElementById(id);
const el = (tag,text,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;return n;};
let mode='demo',demoIndex=0,fileText='',parsed=null,report=null,sample=null,analysis=null,controller=null,version=0,paused=false,disposed=false,parseTimer;
const tabId=crypto.randomUUID();
function status(id,message,error=false){$(id).textContent=message;$(id).classList.toggle('error',error);}
function cancel(message='已取消。') { version++;controller?.abort();controller=null;$('cancel-ai').hidden=true;$('ai-analyze').textContent='生成解读';$('ai-analyze').disabled=!sample||!$('consent').checked||paused;$('join').disabled=false;if(message)status('ai-status',message); }
function resetReport(){cancel('');$('export-preview').hidden=true;$('export-text').value='';status('export-status','');report=sample=analysis=null;$('report').hidden=true;$('ai-result').replaceChildren();$('ai-result').hidden=true;$('sample-preview').textContent='';$('consent').checked=false;$('ai-analyze').disabled=true;$('join-box').hidden=true;status('ai-status','');}
function sourceText(){return mode==='demo'?demos[demoIndex].text:mode==='file'?fileText:$('chat-text').value;}
function parseSource(silent=true){
  try { parsed=parseChat(sourceText());const previous=$('self-select').value;$('self-select').replaceChildren(...parsed.authors.map(name=>{const opt=el('option',name);opt.value=name;return opt;}));$('self-select').value=parsed.authors.includes(previous)?previous:mode==='demo'?demos[demoIndex].self:parsed.authors.includes('我')?'我':parsed.authors[0];$('self-select').disabled=false;$('range-select').disabled=!parsed.completeTime;if(!parsed.completeTime)$('range-select').value='0';$('range-note').textContent=parsed.completeTime?'':'时间不完整，仅统计文字。';status('input-status','');return true;
  } catch(e){parsed=null;$('self-select').replaceChildren(el('option','选择发送者'));$('self-select').disabled=true;$('range-select').disabled=true;if(!silent)status('input-status',e.message,true);return false;}
}
function preview(){const p=parseChat(demos[demoIndex].text);$('chat-preview').replaceChildren(...p.messages.slice(0,4).map(m=>{const box=el('div',null,'bubble'+(m.sender===demos[demoIndex].self?' mine':''));box.append(el('small',m.sender),el('p',m.content));return box;}));document.querySelectorAll('[data-demo]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.demo)===demoIndex);b.setAttribute('aria-pressed',Number(b.dataset.demo)===demoIndex?'true':'false');});}
function setMode(next){mode=next;clearTimeout(parseTimer);resetReport();status('input-status','');document.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===mode;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1;$('panel-'+b.dataset.tab).hidden=!on;});parseSource();}
function renderReport(){
  const r=report;
  $('report').hidden=false;
  const date=n=>new Date(n+8*3600000).toISOString().slice(0,10).replaceAll('-','.');
  $('report-meta').textContent=`${r.timed?date(r.start)+' — '+date(r.end):'无完整时间记录'} · ${r.total} 条文字消息${r.skipped?` · 跳过 ${r.skipped} 条不支持的记录`:''}`;
  const rows=[[`${r.me.count} 条`,'消息数',`${r.them.count} 条`],[`${r.me.averageLength} 字`,'平均字数',`${r.them.averageLength} 字`],[r.timed?`${r.me.starts} 次`:'—','开启对话',r.timed?`${r.them.starts} 次`:'—'],[duration(r.me.replySeconds),'平均回复',duration(r.them.replySeconds),`${r.me.replySamples} 个有效间隔`,`${r.them.replySamples} 个有效间隔`],[`${r.me.short} 条`,'简短回复',`${r.them.short} 条`],[`${r.me.maxRun} 条`,'最长连续发送',`${r.them.maxRun} 条`]];
  $('comparison-rows').replaceChildren(...rows.map(([a,label,b,noteA,noteB])=>{const row=el('div',null,'compare-row'),left=el('span',a),right=el('span',b);if(noteA)left.title=noteA;if(noteB)right.title=noteB;const heading=el('span',label,'row-label');row.setAttribute('role','row');heading.setAttribute('role','rowheader');left.setAttribute('role','cell');right.setAttribute('role','cell');row.append(heading,left,right);return row;}));
  $('observations').replaceChildren(...observations(r).map(x=>el('li',x)));
  sample=sampleReport(r);$('sample-summary').textContent=`预览发送内容 · ${sample.messages.length} 条`;
  $('sample-preview').textContent=`${r.total>48?'从时间顺序中均匀取 6 段连续对话，每段 8 条。':'这段对话不超过 48 条，将发送全部文字消息。'}\n${sample.trimmed} 条长消息被截短；${sample.redacted} 条消息隐藏了常见手机号或邮箱。\n\n统计数据：\n${JSON.stringify({total:sample.total,timed:sample.timed,sessions:sample.sessions,me:sample.me,them:sample.them},null,2)}\n\n消息样本：\n${sample.messages.map(m=>`#${m.id} ${m.sender==='me'?'我':'对方'}：${m.content}`).join('\n')}`;
  status('input-status','');
}
function showAnalysis(result){analysis=result;$('ai-result').hidden=false;const nodes=[el('p',result.summary)];for(const item of result.observations){nodes.push(el('h4',item.title),el('p',item.detail),el('span',`样本 #${item.evidence.join('、#')}`,'evidence'));}const list=el('ul');list.append(...result.suggestions.map(s=>el('li',s)));nodes.push(el('h4','沟通建议'),list,el('p',result.limitations,'limit'));$('ai-result').replaceChildren(...nodes);}
async function jsonFetch(url,options={}){const res=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});let data;try{data=await res.json();}catch{throw new Error('服务暂时无法响应，请稍后再试。');}if(!res.ok){const e=new Error(data.error?.message||data.error||'请求未完成，请稍后重试。');e.status=res.status;throw e;}return data;}
async function requestAI(join=false){
  if(!sample||!$('consent').checked||paused||disposed||controller)return;
  const snapshot=sample,requestVersion=++version;controller=new AbortController();const signal=controller.signal;$('ai-analyze').disabled=true;$('join').disabled=true;$('cancel-ai').hidden=false;$('ai-analyze').textContent='生成中…';status('ai-status','');
  try {
    if(join){const nickname=$('nickname').value.trim();if(!nickname)throw new Error('先填写一个校园昵称。');await jsonFetch('/api/audience/join',{method:'POST',body:JSON.stringify({nickname,tabId}),signal});}
    const data=await jsonFetch('/api/works/she-love-me/analyze',{method:'POST',body:JSON.stringify({consent:true,...snapshot}),signal});
    if(requestVersion!==version||paused||disposed)return;
    showAnalysis(data.analysis);$('join-box').hidden=true;status('ai-status','');
  } catch(e){if(requestVersion!==version||signal.aborted)return;if(e.status===401){$('join-box').hidden=false;status('ai-status','填写昵称后继续。');$('nickname').focus();}else status('ai-status',e.message,true);
  } finally {if(requestVersion===version){controller=null;$('cancel-ai').hidden=true;$('ai-analyze').textContent='生成解读';$('ai-analyze').disabled=!$('consent').checked||paused;$('join').disabled=false;}}
}
document.querySelectorAll('[data-tab]').forEach(b=>{b.addEventListener('click',()=>setMode(b.dataset.tab));b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-tab]')];let i=tabs.indexOf(b);i=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;setMode(tabs[i].dataset.tab);tabs[i].focus();});});
document.querySelectorAll('[data-demo]').forEach(b=>b.addEventListener('click',()=>{demoIndex=Number(b.dataset.demo);resetReport();preview();parseSource();}));
$('chat-text').addEventListener('input',()=>{resetReport();parsed=null;clearTimeout(parseTimer);parseTimer=setTimeout(()=>parseSource(),350);});
$('chat-file').addEventListener('change',async()=>{resetReport();fileText='';const file=$('chat-file').files[0];$('file-name').textContent=file?file.name:'';if(!file)return;const fileVersion=version;try{if(file.size>MAX_BYTES)throw new Error('文件超过 2 MB，请先截取一段双人聊天。');const content=await file.text();if(fileVersion!==version||disposed)return;fileText=content;parseSource(false);}catch(e){status('input-status',e.message,true);}});
$('self-select').addEventListener('change',resetReport);$('range-select').addEventListener('change',resetReport);
$('analyze').addEventListener('click',()=>{if(paused||disposed)return;clearTimeout(parseTimer);resetReport();try{if(!parseSource(false))return;report=analyzeChat(parsed,$('self-select').value,Number($('range-select').value));renderReport();if(innerWidth<=760)$('report-title').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});}catch(e){status('input-status',e.message,true);}});
$('clear').addEventListener('click',()=>{resetReport();clearTimeout(parseTimer);fileText='';parsed=null;$('chat-text').value='';$('chat-file').value='';$('file-name').textContent='';$('nickname').value='';setMode('paste');status('input-status','已清空。');});
$('consent').addEventListener('change',()=>{if(!$('consent').checked&&controller)cancel('已停止 AI 请求；已发送的样本无法撤回。');$('ai-analyze').disabled=!$('consent').checked||!sample||!!controller||paused;});
$('ai-analyze').addEventListener('click',()=>requestAI());$('join').addEventListener('click',()=>requestAI(true));$('nickname').addEventListener('keydown',e=>{if(e.key==='Enter')requestAI(true);});$('cancel-ai').addEventListener('click',()=>cancel());
$('export').addEventListener('click',()=>{if(!report)return;const markdown=markdownReport(report,analysis);$('export-text').value=markdown;$('export-preview').hidden=false;status('export-status','');const blob=new Blob([markdown],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='她不一样-聊天观察报告.md';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('close-export').addEventListener('click',()=>{$('export-preview').hidden=true;});
$('copy-report').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('export-text').value);status('export-status','报告已复制。');}catch{$('export-text').focus();$('export-text').select();status('export-status','已选中报告，请使用系统的复制操作。');}});
$('return-to-campus').addEventListener('click',e=>{if(window.parent!==window&&window.campusActivity){e.preventDefault();window.campusActivity.exit();}});
function lifecycle(state){paused=!!state.paused;disposed=!!state.disposed;$('project').inert=paused||disposed;$('activity-status').hidden=!paused&&!disposed;$('activity-status').textContent=disposed?'体验已结束。':'体验已暂停。';if(paused||disposed){cancel('');clearTimeout(parseTimer);}if(disposed){resetReport();parsed=null;fileText='';$('chat-text').value='';$('chat-file').value='';$('nickname').value='';}if(!paused&&!disposed)$('ai-analyze').disabled=!sample||!$('consent').checked;}
preview();parseSource();if(window.campusActivity)window.campusActivity.subscribe(lifecycle);else window.addEventListener('load',()=>window.campusActivity?.subscribe(lifecycle),{once:true});
window.addEventListener('pagehide',()=>{resetReport();clearTimeout(parseTimer);fileText='';parsed=null;$('chat-text').value='';$('chat-file').value='';$('nickname').value='';});
