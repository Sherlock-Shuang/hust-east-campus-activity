// Opt-in diagnostics for reproducible route checks. No network telemetry,
// personal records, credentials or normal-player overlay.
export function mountRuntimeDiagnostics({document,window,canvas,renderer,getReport,scene}={}) {
  if(new URLSearchParams(window.location.search).get('diagnostics')!=='1')return {dispose(){}};
  const panel=document.createElement('aside');panel.className='runtime-diagnostics';panel.setAttribute('aria-label','性能验收');
  const download=document.createElement('button');download.type='button';download.textContent='导出性能报告';panel.append(download);
  const listeners=[],timers=new Set(),listen=(el,type,fn)=>{el.addEventListener(type,fn);listeners.push(()=>el.removeEventListener(type,fn));};
  listen(download,'click',()=>{
    const report={capturedAt:new Date().toISOString(),path:window.location.pathname,userAgent:window.navigator.userAgent,
      viewport:{width:canvas.clientWidth,height:canvas.clientHeight},hardware:{concurrency:window.navigator.hardwareConcurrency,memoryGiB:window.navigator.deviceMemory,nativeDpr:window.devicePixelRatio},
      ...(scene?{geometryAllocation:estimateGeometryAllocation(scene)}:{}),...getReport()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='campus-performance.json';link.click();
    const timer=setTimeout(()=>{URL.revokeObjectURL(url);timers.delete(timer);},1000);timers.add(timer);
  });
  if(['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)){
    const recover=document.createElement('button');recover.type='button';recover.textContent='测试画面恢复';panel.append(recover);
    listen(recover,'click',()=>{
      const extension=renderer.getContext().getExtension('WEBGL_lose_context');if(!extension){recover.textContent='此设备不支持恢复测试';return;}
      recover.disabled=true;extension.loseContext();
      const timer=setTimeout(()=>{extension.restoreContext();recover.disabled=false;timers.delete(timer);},900);timers.add(timer);
    });
  }
  document.body.append(panel);
  return {dispose(){listeners.forEach(fn=>fn());timers.forEach(clearTimeout);panel.remove();}};
}

// Export-time scan only. Counts unique backing buffers, including instance
// capacity; this is a CPU allocation estimate, not measured GPU residency.
export function estimateGeometryAllocation(scene){
  const buffers=new Set(),geometries=new Set();let bytes=0;
  const add=attribute=>{const buffer=attribute?.array?.buffer||attribute?.data?.array?.buffer;if(buffer&&!buffers.has(buffer)){buffers.add(buffer);bytes+=buffer.byteLength;}};
  scene.traverse(object=>{const g=object.geometry;if(g&&!geometries.has(g)){geometries.add(g);Object.values(g.attributes||{}).forEach(add);add(g.index);Object.values(g.morphAttributes||{}).forEach(list=>list.forEach(add));}add(object.instanceMatrix);add(object.instanceColor);});
  return {uniqueBuffers:buffers.size,uniqueGeometries:geometries.size,bytes,note:'Unique attached ArrayBuffer capacity, including hidden meshes. CPU estimate; excludes textures, render targets, shader programs and detached pools.'};
}
