const MODES=new Set(['auto','smooth','balanced','clear']);
const KEY='campus-quality-mode-v1';
export function getQualityStorage(){try{return globalThis.localStorage;}catch{return null;}}
export function readQualityPreference(storage=getQualityStorage()){
  try { const value=storage?.getItem(KEY);return MODES.has(value)?value:'auto'; } catch { return 'auto'; }
}
export function mountPerformanceUI({document,storage,onChange,mode='auto'}={}){
  const select=document.getElementById('performance-mode');
  if(!select)return {update(){},dispose(){}};
  select.value=mode;
  const change=()=>{const value=MODES.has(select.value)?select.value:'auto';try{storage?.setItem(KEY,value);}catch{}onChange(value);select.blur();};
  const stop=event=>event.stopPropagation();
  select.addEventListener('change',change);select.addEventListener('keydown',stop);
  return {
    update(budget){select.title=`当前：${budget.name}。自动根据运行负载调整；配置较低可选流畅优先。`;},
    dispose(){select.removeEventListener('change',change);select.removeEventListener('keydown',stop);},
  };
}
