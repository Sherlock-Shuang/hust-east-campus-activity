/** Select only complete matching Unity builds, before downloading the engine.
 * ASTC is never inferred from device names. Unsupported devices keep desktop.
 */
export function supportsAstc(createCanvas=()=>document.createElement('canvas')){
 let canvas,gl;
 try{canvas=createCanvas();gl=canvas.getContext('webgl2',{alpha:false,antialias:false,powerPreference:'low-power'});return !!gl?.getExtension('WEBGL_compressed_texture_astc');}
 catch{return false;}
 finally{gl?.getExtension('WEBGL_lose_context')?.loseContext();canvas?.remove?.();}
}
export function selectWanyanQuality({manifest,mobile,astc,requested}){
 // This candidate is larger on the network; opt in until physical-device
 // quality/FPS/thermal comparisons justify changing the mobile default.
 const wantMobile=requested==='mobile';
 if(wantMobile&&astc&&manifest.mobile?.textureSubtarget==='ASTC')return {variant:manifest.mobile,reason:'mobile-astc'};
 return {variant:manifest.desktop,reason:wantMobile?'desktop-compatible-fallback':'desktop'};
}
export async function prepareWanyanQuality({config,loaderUrl,fetchImpl=fetch,detectAstc=supportsAstc,signal}={}){
 const response=await fetchImpl('/works/wanyan/performance-builds.json',{cache:'no-cache',signal});
 if(!response.ok)throw new Error('晚言版本配置载入失败');
 const manifest=await response.json();
 const requested=new URLSearchParams(location.search).get('quality');
 const mobile=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;
 const {variant,reason}=selectWanyanQuality({manifest,mobile,astc:requested==='mobile'&&detectAstc(),requested});
 if(!variant||!['loaderUrl','dataUrl','frameworkUrl','codeUrl'].every(key=>typeof variant[key]==='string'&&variant[key].startsWith('/works/wanyan/assets/')))throw new Error('晚言版本资源不完整');
 Object.assign(config,{dataUrl:variant.dataUrl,frameworkUrl:variant.frameworkUrl,codeUrl:variant.codeUrl});
 document.documentElement.dataset.wanyanQuality=reason;
 return {loaderUrl:variant.loaderUrl,variant:reason};
}
export function applyWanyanQuality(source){
 if(source.includes('campus-wanyan-quality-v2'))return source;
 const end='document.body.appendChild(script);';
 if(source.split(end).length!==2)throw new Error('Unity runtime changed: loader append');
 return source.replace(end,`// campus-wanyan-quality-v2: never preload a second Unity build.
      const qualityController=new AbortController();
      let qualityDisposed=false;
      window.campusWorkAdapter?.onDispose(()=>{qualityDisposed=true;qualityController.abort();script.remove();});
      import('/works/wanyan/wanyan-quality.mjs').then(module=>module.prepareWanyanQuality({config,loaderUrl,signal:qualityController.signal})).then(result=>{
        if(qualityDisposed)return;
        loaderUrl=result.loaderUrl;script.src=loaderUrl;document.body.appendChild(script);
      }).catch(error=>{if(qualityDisposed)return;window.campusWorkAdapter?.fail('晚言版本资源未能载入');unityShowBanner('游戏版本未能载入，请返回后重试。','error');});`);
}
