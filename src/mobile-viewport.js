/** Keep form/iframe overlays inside the visible viewport when a phone keyboard
 * opens. This does not resize the campus renderer or change the user's zoom. */
export function mountMobileViewport({window=globalThis.window,root=globalThis.document?.documentElement}={}){
  if(!window||!root?.style)return()=>{};
  const viewport=window.visualViewport;
  let raf=null,disposed=false;
  function paint(){
    raf=null;if(disposed)return;
    const zoomed=viewport&&Math.abs((viewport.scale||1)-1)>.05;
    const height=!zoomed&&Number.isFinite(viewport?.height)?viewport.height:window.innerHeight;
    const top=!zoomed&&Number.isFinite(viewport?.offsetTop)?viewport.offsetTop:0;
    if(Number.isFinite(height)&&height>0)root.style.setProperty('--campus-visible-height',`${Math.round(height)}px`);
    root.style.setProperty('--campus-visible-top',`${Math.max(0,Math.round(top))}px`);
  }
  function update(){if(raf===null)raf=window.requestAnimationFrame(paint);}
  paint();
  const listeners=[[window,'resize'],[window,'orientationchange'],[viewport,'resize'],[viewport,'scroll']];
  for(const [target,event]of listeners)target?.addEventListener(event,update);
  return()=>{
    disposed=true;if(raf!==null)window.cancelAnimationFrame(raf);
    for(const [target,event]of listeners)target?.removeEventListener(event,update);
    root.style.removeProperty('--campus-visible-height');root.style.removeProperty('--campus-visible-top');
  };
}
