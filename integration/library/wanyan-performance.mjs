// Strict activity-copy transforms. The original gift's HTML/Unity build is untouched.
export function applyWanyanPerformance(source){
  const marker='campus-wanyan-performance-v1';
  if(source.includes(marker))return source;
  const quality=/<script id="bookrealm-render-quality">[\s\S]*?<\/script>/;
  if(!quality.test(source))throw new Error('Wanyan render quality script changed');
  let result=source.replace(quality,`<script id="${marker}" src="/works/wanyan/wanyan-performance.js"></script>`);
  const suspension='window.bookrealmControlsSuspended = event.data.suspended;\n  document.documentElement.dataset.controlsSuspended = String(event.data.suspended);';
  if(!result.includes(suspension))throw new Error('Wanyan library suspension bridge changed');
  result=result.replace(suspension,'window.campusWanyanSetLibrarySuspended(event.data.suspended);');
  const registration='window.campusWorkAdapter?.register({setPaused(value){window.bookrealmControlsSuspended=value;document.documentElement.dataset.controlsSuspended=String(value);},dispose(){window.bookrealmControlsSuspended=true;unityInstance.Quit?.();}});';
  if(!result.includes(registration))throw new Error('Wanyan activity runtime registration changed');
  result=result.replace(registration,'window.campusWorkAdapter?.register(window.campusWanyanPerformance);');
  return result;
}
