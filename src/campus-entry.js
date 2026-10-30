import {installBrowserCompatibility} from './browser-compat.js';
import './campus-entry.css';
import './survey.css';
import './transport-ui.css';
import './mobile-controls.css';
installBrowserCompatibility();
let completed=false;
const panel=document.getElementById('campus-startup-help'),message=panel.querySelector('p'),retry=panel.querySelector('button');
retry.addEventListener('click',()=>{
  try{localStorage.setItem('campus-quality-mode-v1','smooth');}catch{}
  location.reload();
});
function show(text){message.textContent=text;panel.hidden=false;}
// A failed module download, unsupported renderer or initialization exception
// must leave a useful screen rather than the permanent loading mask.
const timer=setTimeout(()=>{
  if(!completed)show('校园加载时间较长。你可以继续等待，或以流畅画质重试；也可以复制链接，在手机系统浏览器中打开。');
},30000);
const ready=()=>{completed=true;clearTimeout(timer);panel.hidden=true;};
window.addEventListener('campus:ready',ready,{once:true});
window.addEventListener('campus:startup-error',event=>{clearTimeout(timer);show(event.detail||'校园数据尚未准备完成，请检查网络后重试。');});
import('./survey.js').catch(error=>{
  clearTimeout(timer);
  show(/WebGL|context|GPU/i.test(error?.message||'')?'当前浏览器未能启动三维画面。可先以流畅画质重试；若仍失败，请在更新后的 Chrome 或 Safari 中打开。':'校园启动未完成，请检查网络后重试，或复制链接到手机系统浏览器中打开。');
  console.error('Campus startup failed:',error);
});
