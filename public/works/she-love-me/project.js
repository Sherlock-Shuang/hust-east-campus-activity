import {parseChat,analyzeChat,sampleReport,duration,observations,markdownReport,MAX_BYTES} from './analyzer.js';
import {demos} from './demo.js';
const $ = id=>document.getElementById(id);
const el = (tag,text,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;return n;};
let mode='demo',demoIndex=0,fileText='',parsed=null,report=null,sample=null,analysis=null,controller=null,version=0,paused=false,disposed=false,parseTimer;
const tabId=crypto.randomUUID();
let normalized=null,importController=null,importVersion=0,imageTiles=[],imageBusy=false,imageUrls=[];
function status(id,message,error=false){$(id).textContent=message;$(id).classList.toggle('error',error);}
function cancel(message='已取消。') { version++;controller?.abort();controller=null;$('cancel-ai').hidden=true;$('ai-analyze').textContent='生成解读';$('ai-analyze').disabled=!sample||!$('consent').checked||paused;$('join').disabled=false;if(message)status('ai-status',message); }
function resetReport(){cancel('');$('export-preview').hidden=true;$('export-text').value='';status('export-status','');report=sample=analysis=null;$('report').hidden=true;$('ai-result').replaceChildren();$('ai-result').hidden=true;$('sample-preview').textContent='';$('consent').checked=false;$('ai-analyze').disabled=true;$('join-box').hidden=true;status('ai-status','');}
function sourceText(){if(normalized&&mode!=='demo')return JSON.stringify({messages:normalized.messages});return mode==='demo'?demos[demoIndex].text:mode==='file'?fileText:$('chat-text').value;}
function parseSource(silent=true){
  try { if(mode==='image'&&!normalized)throw new Error('先识别聊天截图。');parsed=parseChat(sourceText());const previous=$('self-select').value;$('self-select').replaceChildren(...parsed.authors.map(name=>{const opt=el('option',name);opt.value=name;return opt;}));$('self-select').value=parsed.authors.includes(previous)?previous:mode==='demo'?demos[demoIndex].self:parsed.authors.includes('我')?'我':parsed.authors[0];$('self-select').disabled=false;$('range-select').disabled=!parsed.completeTime;if(!parsed.completeTime)$('range-select').value='0';$('range-note').textContent=parsed.completeTime?'':'时间不完整，仅统计文字。';status('input-status','');return true;
  } catch(e){parsed=null;$('self-select').replaceChildren(el('option','选择发送者'));$('self-select').disabled=true;$('range-select').disabled=true;$('range-note').textContent='';if(!silent)status('input-status',normalized||mode==='demo'?e.message:'可用 AI 整理这段内容。',true);return false;}
}
function preview(){const p=parseChat(demos[demoIndex].text);$('chat-preview').replaceChildren(...p.messages.slice(0,4).map(m=>{const box=el('div',null,'bubble'+(m.sender===demos[demoIndex].self?' mine':''));box.append(el('small',m.sender),el('p',m.content));return box;}));document.querySelectorAll('[data-demo]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.demo)===demoIndex);b.setAttribute('aria-pressed',Number(b.dataset.demo)===demoIndex?'true':'false');});}
function setMode(next){invalidateImport();mode=next;clearTimeout(parseTimer);resetReport();status('input-status','');document.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===mode;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1;$('panel-'+b.dataset.tab).hidden=!on;});parseSource();updateImportUI();}
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
document.querySelectorAll('[data-tab]').forEach(b=>{b.addEventListener('click',()=>setMode(b.dataset.tab));b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-tab]')];let i=tabs.indexOf(b);i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;setMode(tabs[i].dataset.tab);tabs[i].focus();});});
document.querySelectorAll('[data-demo]').forEach(b=>b.addEventListener('click',()=>{demoIndex=Number(b.dataset.demo);resetReport();preview();parseSource();}));
$('chat-text').addEventListener('input',()=>{invalidateImport();resetReport();parsed=null;clearTimeout(parseTimer);parseTimer=setTimeout(()=>{parseSource();updateImportUI();},350);updateImportUI();});
$('chat-file').addEventListener('change',async()=>{invalidateImport();resetReport();fileText='';const file=$('chat-file').files[0];$('file-name').textContent=file?file.name:'';parseSource();updateImportUI();if(!file)return;const fileVersion=version;try{if(file.size>MAX_BYTES)throw new Error('文件超过 2 MB，请先截取一段双人聊天。');const content=await file.text();if(fileVersion!==version||disposed)return;fileText=content;parseSource();updateImportUI();}catch(e){status('input-status',e.message,true);}});
$('self-select').addEventListener('change',resetReport);$('range-select').addEventListener('change',resetReport);
function runAnalysis(){if(paused||disposed)return;clearTimeout(parseTimer);resetReport();try{if(!parseSource(false))return;report=analyzeChat(parsed,$('self-select').value,Number($('range-select').value));renderReport();if(innerWidth<=760)$('report-title').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});}catch(e){status('input-status',e.message,true);}}
$('analyze').addEventListener('click',()=>{if(mode==='demo'||normalized)runAnalysis();else requestImport();});
$('local-analyze').addEventListener('click',runAnalysis);
$('clear').addEventListener('click',()=>{invalidateImport();clearImages();$('import-nickname').value='';resetReport();clearTimeout(parseTimer);fileText='';parsed=null;$('chat-text').value='';$('chat-file').value='';$('file-name').textContent='';$('nickname').value='';setMode('paste');status('input-status','已清空。');});
$('consent').addEventListener('change',()=>{if(!$('consent').checked&&controller)cancel('已停止 AI 请求；已发送的样本无法撤回。');$('ai-analyze').disabled=!$('consent').checked||!sample||!!controller||paused;});
$('ai-analyze').addEventListener('click',()=>requestAI());$('join').addEventListener('click',()=>requestAI(true));$('nickname').addEventListener('keydown',e=>{if(e.key==='Enter')requestAI(true);});$('cancel-ai').addEventListener('click',()=>cancel());
$('export').addEventListener('click',()=>{if(!report)return;const markdown=markdownReport(report,analysis);$('export-text').value=markdown;$('export-preview').hidden=false;status('export-status','');const blob=new Blob([markdown],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='她不一样-聊天观察报告.md';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('close-export').addEventListener('click',()=>{$('export-preview').hidden=true;});
$('copy-report').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('export-text').value);status('export-status','报告已复制。');}catch{$('export-text').focus();$('export-text').select();status('export-status','已选中报告，请使用系统的复制操作。');}});
$('return-to-campus').addEventListener('click',e=>{if(window.parent!==window&&window.campusActivity){e.preventDefault();window.campusActivity.exit();}});
function lifecycle(state){paused=!!state.paused;disposed=!!state.disposed;$('project').inert=paused||disposed;$('activity-status').hidden=!paused&&!disposed;$('activity-status').textContent=disposed?'体验已结束。':'体验已暂停。';if(paused||disposed){cancelImport();cancel('');clearTimeout(parseTimer);}if(disposed){invalidateImport();clearImages();$('import-nickname').value='';resetReport();parsed=null;fileText='';$('chat-text').value='';$('chat-file').value='';$('nickname').value='';}if(!paused&&!disposed){$('ai-analyze').disabled=!sample||!$('consent').checked;updateImportUI();}}
preview();parseSource();updateImportUI();if(window.campusActivity)window.campusActivity.subscribe(lifecycle);else window.addEventListener('load',()=>window.campusActivity?.subscribe(lifecycle),{once:true});
window.addEventListener('pagehide',()=>{invalidateImport();clearImages();$('import-nickname').value='';resetReport();clearTimeout(parseTimer);fileText='';parsed=null;$('chat-text').value='';$('chat-file').value='';$('nickname').value='';});

function cancelImport(){importVersion++;importController?.abort();importController=null;imageBusy=false;$('cancel-import').hidden=true;updateImportUI();}
function invalidateImport(){cancelImport();normalized=null;$('import-review').hidden=true;$('review-rows').replaceChildren();$('import-consent').checked=false;$('import-join-box').hidden=true;}
function clearImages(){imageUrls.forEach(url=>URL.revokeObjectURL(url));imageUrls=[];imageTiles=[];$('image-preview').replaceChildren();$('chat-images').value='';}
function updateImportUI(){
  const needs=mode!=='demo'&&!normalized,busy=!!importController||imageBusy;
  $('import-options').hidden=!needs;$('chat-controls').hidden=needs&&!parsed;
  $('analyze').textContent=busy?(imageBusy?'处理图片…':'整理中…'):normalized?'确认并分析':needs?(mode==='image'?'识别图片':'AI 整理'):'分析';
  $('analyze').disabled=busy||paused||disposed;
  $('local-analyze').hidden=!needs||!parsed||mode==='image';$('local-analyze').disabled=busy;
  $('input-privacy').textContent=needs?'本站不保存原文或图片。':'本地统计，不保存聊天。';
}
function renderImport(){
  $('import-review').hidden=false;
  $('import-summary').textContent=`${normalized.messages.length} 条 · 可修改发送者、正文和时间`;
  const uncertain=normalized.messages.filter(m=>m.uncertain||m.sender==='待确认').length;
  $('import-warnings').textContent=[...normalized.warnings,...(uncertain?[`${uncertain} 条待核对。`]:[])].join(' ');
  $('review-rows').replaceChildren(...normalized.messages.map((m,i)=>{
    const row=el('div',null,'review-row'+(m.uncertain||m.sender==='待确认'?' uncertain':''));
    const sender=el('input');sender.value=m.sender;sender.maxLength=60;sender.setAttribute('aria-label',`第 ${i+1} 条发送者`);
    const content=el('textarea');content.value=m.content;content.rows=2;content.maxLength=6000;content.setAttribute('aria-label',`第 ${i+1} 条消息`);
    const details=el('details',null,'message-time'),summary=el('summary',m.timestamp?'时间':'无完整时间');const time=el('input');time.type='datetime-local';time.step='1';time.value=m.timestamp?.slice(0,19)||'';time.setAttribute('aria-label',`第 ${i+1} 条时间`);details.append(summary,time);
    const remove=el('button','删除','text-button');remove.type='button';remove.setAttribute('aria-label',`删除第 ${i+1} 条`);
    const changed=()=>{resetReport();parseSource();updateImportUI();};
    sender.addEventListener('input',()=>{m.sender=sender.value;changed();});content.addEventListener('input',()=>{m.content=content.value;changed();});
    time.addEventListener('input',()=>{m.timestamp=time.value?time.value+(time.value.length===16?':00':'')+'+08:00':null;summary.textContent=m.timestamp?'时间':'无完整时间';changed();});
    remove.addEventListener('click',()=>{normalized.messages.splice(i,1);renderImport();changed();});
    row.append(sender,content,details,remove);return row;
  }));
  parseSource();updateImportUI();
}
async function requestImport(){
  if(paused||disposed||importController||imageBusy)return;
  if(!$('import-consent').checked){status('input-status','请先勾选 AI 整理的发送说明。',true);$('import-consent').focus();return;}
  const text=mode==='image'?'':sourceText().trim(),images=mode==='image'?[...imageTiles]:[];
  if(!text&&!images.length){status('input-status','请先粘贴消息或选择截图。',true);return;}
  if(text.length>20000){status('input-status','每次可整理 20,000 字，请分段粘贴。',true);return;}
  clearTimeout(parseTimer);resetReport();const revision=++importVersion;importController=new AbortController();const signal=importController.signal;updateImportUI();$('cancel-import').hidden=false;status('input-status','');
  try{
    if(!$('import-join-box').hidden){const nickname=$('import-nickname').value.trim();if(!nickname)throw new Error('填写昵称后继续。');await jsonFetch('/api/audience/join',{method:'POST',body:JSON.stringify({nickname,tabId}),signal});}
    const data=await jsonFetch('/api/works/she-love-me/import',{method:'POST',body:JSON.stringify({consent:true,text,images}),signal});
    if(revision!==importVersion||paused||disposed)return;
    if(!Array.isArray(data.imported?.messages))throw new Error('识别结果不完整，请重试。');
    if(!data.imported.messages.length)throw new Error(data.imported.warnings?.join(' ')||'没有识别到聊天消息，请换一张清晰截图。');
    normalized=data.imported;$('import-join-box').hidden=true;$('import-consent').checked=false;renderImport();status('input-status','');
    if(innerWidth<=760)$('import-review').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){if(revision!==importVersion||signal.aborted)return;if(e.status===401){$('import-join-box').hidden=false;status('input-status','填写昵称后继续。');$('import-nickname').focus();}else status('input-status',e.message,true);}
  finally{if(revision===importVersion){importController=null;$('cancel-import').hidden=true;updateImportUI();}}
}
$('cancel-import').addEventListener('click',()=>{cancelImport();status('input-status','已取消。');});
$('import-consent').addEventListener('change',()=>{if(!$('import-consent').checked&&importController){cancelImport();status('input-status','已取消；已发送的内容无法撤回。');}});
$('import-nickname').addEventListener('keydown',e=>{if(e.key==='Enter')requestImport();});
$('add-message').addEventListener('click',()=>{if(!normalized||normalized.messages.length>=120)return;normalized.messages.push({sender:'我',content:'',timestamp:null,uncertain:false});resetReport();renderImport();});
// Re-encode locally: strip metadata, split long screenshots instead of shrinking their text.
async function prepareImage(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if(file.size>20*1024*1024)throw new Error('单张图片需小于 20 MB。');
  const url=URL.createObjectURL(file),img=new Image();
  try{
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('图片无法读取，请换一张截图。'));img.src=url;});
    if(img.naturalWidth*img.naturalHeight>40000000)throw new Error('图片过长，请截成几段上传。');
    const width=Math.min(1440,img.naturalWidth),scale=width/img.naturalWidth,height=Math.round(img.naturalHeight*scale),tiles=[];
    if(Math.ceil(height/2200)>8)throw new Error('截图过长，请分段上传。');
    for(let top=0;top<height;top+=2200){
      const tileHeight=Math.min(2300,height-top),canvas=document.createElement('canvas');canvas.width=width;canvas.height=tileHeight;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,tileHeight);ctx.drawImage(img,0,top/scale,img.naturalWidth,tileHeight/scale,0,0,width,tileHeight);
      let quality=.9,data=canvas.toDataURL('image/jpeg',quality);
      while(data.length>340000&&quality>.4){quality-=.1;data=canvas.toDataURL('image/jpeg',quality);}
      if(data.length>1000000)throw new Error('图片过大，请裁剪聊天区域后重试。');
      tiles.push(data);canvas.width=canvas.height=1;
    }
    return tiles;
  }finally{URL.revokeObjectURL(url);}
}
$('chat-images').addEventListener('change',async()=>{
  const files=[...$('chat-images').files];invalidateImport();resetReport();clearImages();parsed=null;parseSource();
  if(!files.length){updateImportUI();return;}
  if(files.length>4){status('input-status','一次最多选择 4 张截图。',true);updateImportUI();return;}
  const revision=++importVersion;imageBusy=true;updateImportUI();status('input-status','');
  try{
    const tiles=[];
    for(const file of files){tiles.push(...await prepareImage(file));if(revision!==importVersion||paused||disposed)return;}
    if(tiles.length>8||tiles.reduce((n,s)=>n+s.length,0)>2800000)throw new Error('截图较多或较长，请分批识别。');
    imageTiles=tiles;
    $('image-preview').replaceChildren(...files.map((file,i)=>{const url=URL.createObjectURL(file);imageUrls.push(url);const figure=el('figure'),img=el('img');img.src=url;img.alt=`截图 ${i+1}`;figure.append(img,el('figcaption',`${i+1}. ${file.name}`));return figure;}));
  }catch(e){if(revision===importVersion)status('input-status',e.message,true);}
  finally{if(revision===importVersion){imageBusy=false;updateImportUI();}}
});
