import {installBrowserCompatibility} from './browser-compat.js';
import {getCampusStartupData} from './campus-startup-data.js';
import './survey.css';
import './transport-ui.css';
import './mobile-controls.css';
installBrowserCompatibility();
// Fetch maps while the larger scene module downloads. The scene consumes this
// same promise; attach a handler now so an early failure is never unhandled.
getCampusStartupData().catch(()=>{});
import('./survey.js').catch(error=>{
  window.dispatchEvent(new CustomEvent('campus:startup-error',{detail:/WebGL|context|GPU/i.test(error?.message||'')?'当前浏览器未能启动三维画面。可先以流畅画质重试；若仍失败，请在更新后的 Chrome 或 Safari 中打开。':'校园启动未完成，请检查网络后重试，或复制链接到手机系统浏览器中打开。'}));
  console.error('Campus startup failed:',error);
});
