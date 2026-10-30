/** Activity-only asset ownership. A lazy character is never required to walk. */
export function disposeGltf(asset){
  if(!asset?.scene)return;
  const geometries=new Set(),materials=new Set(),textures=new Set(),images=new Set();
  asset.scene.traverse(object=>{
    if(object.geometry)geometries.add(object.geometry);
    for(const material of [].concat(object.material||[])){
      materials.add(material);
      for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    }
  });
  asset.scene.removeFromParent?.();
  for(const geometry of geometries)geometry.dispose?.();
  for(const material of materials)material.dispose?.();
  for(const texture of textures){if(texture.source?.data)images.add(texture.source.data);texture.dispose?.();}
  for(const image of images)image.close?.();
}
export async function fetchGltf(url,loader,{signal,fetchImpl=fetch,onProgress=()=>{}}={}){
  const response=await fetchImpl(url,{signal});
  if(!response.ok)throw new Error(`模型资源请求失败（${response.status}）`);
  const bytes=await response.arrayBuffer();onProgress({loaded:bytes.byteLength,total:bytes.byteLength});
  if(signal?.aborted)throw new DOMException('Asset cancelled','AbortError');
  const asset=await loader.parseAsync(bytes,new URL('.',new URL(url,globalThis.location?.href||'https://campus.invalid/')).href);
  if(signal?.aborted){disposeGltf(asset);throw new DOMException('Asset cancelled','AbortError');}
  return asset;
}
export function createLazyAsset({load,apply,onState=()=>{},disposeAsset=disposeGltf}){
  let promise=null,asset=null,disposed=false;const controller=new AbortController();
  return {
    get ready(){return !!asset;},get disposed(){return disposed;},get pending(){return !!promise&&!asset;},
    ensure(){
      if(disposed)return Promise.resolve(false);
      if(asset)return Promise.resolve(true);
      if(promise)return promise;
      onState('loading');
      promise=Promise.resolve().then(()=>load(controller.signal)).then(value=>{
        if(disposed){disposeAsset(value);return false;}
        try{apply(value);asset=value;onState('ready');return true;}
        catch(error){disposeAsset(value);throw error;}
      }).catch(error=>{if(!disposed)onState('failed',error);return false;}).finally(()=>{promise=null;});
      return promise;
    },
    dispose(){if(disposed)return;disposed=true;controller.abort();if(asset){disposeAsset(asset);asset=null;}onState('disposed');},
  };
}
