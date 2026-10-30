// Diagnostic-only WebGL2 timers. Read availability first; never wait for GPU.
// Values measure all submitted passes between begin/end, not just render() CPU.
export function createGpuFrameTimer(renderer,{enabled=false}={}){
  let gl,ext,current=null,pending=[],samples=[],dropped=0;
  function initialize(){gl=renderer.getContext();ext=enabled?gl.getExtension('EXT_disjoint_timer_query_webgl2'):null;}
  initialize();
  function clear(){if(current){try{gl.endQuery(ext.TIME_ELAPSED_EXT);}catch{}gl.deleteQuery(current);current=null;}pending.forEach(q=>gl.deleteQuery(q));pending=[];}
  return {
    begin(){
      if(!ext||gl.isContextLost())return;
      if(gl.getParameter(ext.GPU_DISJOINT_EXT)){clear();samples=[];dropped++;return;}
      while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){
        const q=pending.shift(),ms=gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6;gl.deleteQuery(q);
        if(Number.isFinite(ms)&&ms>=0){samples.push(ms);if(samples.length>600)samples.shift();}
      }
      if(current||pending.length>=4)return;
      current=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,current);
    },
    end(){if(current&&!gl.isContextLost()){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(current);current=null;}},
    restore(){current=null;pending=[];samples=[];initialize();},
    snapshot(){const sorted=[...samples].sort((a,b)=>a-b),p=q=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*q)-1)]:null;return {supported:!!ext,sampleCount:samples.length,p50Ms:p(.5),p95Ms:p(.95),disjointResets:dropped,note:'Non-blocking GPU queries across reflection and main draw; unavailable values stay null.'};},
    dispose(){clear();samples=[];},
  };
}
