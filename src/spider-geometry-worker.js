import {Vector3,Quaternion,Matrix4,Color} from 'three';
import {createSpiderGeometryAsset} from './spider-geometry-asset.js';

// Only Three's small math classes enter this worker bundle, never its renderer.
const math={Vector3,Quaternion,Matrix4,Color};
self.onmessage=event=>{
  if(event.data?.type!=='generate')return;
  try {
    const asset=createSpiderGeometryAsset(math);
    self.postMessage({type:'ready',buffer:asset.buffer},[asset.buffer]);
  }catch(error){self.postMessage({type:'error',message:String(error?.message||error)});}
};
