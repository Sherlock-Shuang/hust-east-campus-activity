import {planNpcTransportRoutes,sampleNpcTransportRoute} from './npc-transport-routes.js';
import {createNpcTransportModels} from './npc-transport-models.js';

/** Decorative NPC fleet. Existing road commuters remain in their signal-aware
 * simulation; these aircraft/lake boats have independent certified loops and
 * never become player obstacles, pickups or activity participants. */
export function createNpcTransport({THREE,scene,model,route}={}){
  const group=new THREE.Group();group.name='ambient-npc-transport';group.userData.dynamic=true;
  group.matrixAutoUpdate=true;group.matrixWorldAutoUpdate=true;scene.add(group);
  const library=createNpcTransportModels(THREE),plans=planNpcTransportRoutes({model,route});
  const entries=[];
  for(const plan of plans){const visual=library.create(plan.mode);if(!visual)continue;visual.root.name=plan.id;group.add(visual.root);entries.push({plan,...visual,pose:{},drawCalls:0,triangles:0});}
  for(const item of entries)item.root.traverse(o=>{if(!o.isMesh)return;item.drawCalls++;item.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});
  let elapsedSeconds=0,detailDistanceScale=1,enabled=true,disposed=false,visibleCount=0;
  const counts={};for(const {plan}of entries)counts[plan.mode]=(counts[plan.mode]||0)+1;
  function place(item){const p=item.pose;item.root.position.set(p.x,p.y,p.z);item.root.rotation.set(p.pitch??0,p.yaw,p.roll??0,'YXZ');for(const rotor of item.rotors)rotor.mesh.rotation[rotor.axis]=(elapsedSeconds*rotor.rate)%(Math.PI*2);}
  for(const item of entries){sampleNpcTransportRoute(item.plan,0,item.pose);place(item);item.root.visible=false;}
  return{
    group,
    tick(dt,camera){
      if(disposed||!enabled)return false;
      const advancing=Number.isFinite(dt)&&dt>0;
      if(advancing)elapsedSeconds+=Math.min(dt,.1);
      const eye=camera?.position,limit=320*detailDistanceScale,limitSq=limit*limit;visibleCount=0;
      let changed=false;
      for(const item of entries){
        sampleNpcTransportRoute(item.plan,elapsedSeconds,item.pose);
        const p=item.pose,dx=eye?p.x-eye.x:0,dy=eye?p.y-eye.y:0,dz=eye?p.z-eye.z:0;
        const visible=!eye||dx*dx+dy*dy+dz*dz<limitSq;changed||=visible!==item.root.visible;item.root.visible=visible;
        if(!item.root.visible)continue;visibleCount++;place(item);
      }
      return changed||(advancing&&visibleCount>0);
    },
    setVisible(value){enabled=!!value;group.visible=enabled&&!disposed;if(!enabled)visibleCount=0;},
    setDetailDistanceScale(value){if(Number.isFinite(value))detailDistanceScale=Math.max(.35,Math.min(1.5,value));},
    getDiagnostics(){return{elapsedSeconds,counts:{...counts},total:entries.length,visibleCount,drawCalls:entries.reduce((n,i)=>n+(i.root.visible&&enabled?i.drawCalls:0),0),triangles:entries.reduce((n,i)=>n+(i.root.visible&&enabled?i.triangles:0),0),maxDrawCalls:entries.reduce((n,i)=>n+i.drawCalls,0),maxTriangles:entries.reduce((n,i)=>n+i.triangles,0),disposed,poses:entries.map(i=>({id:i.plan.id,mode:i.plan.mode,...i.pose,visible:i.root.visible&&enabled&&!disposed}))};},
    dispose(){if(disposed)return;disposed=true;enabled=false;visibleCount=0;group.removeFromParent();group.clear();library.dispose();},
  };
}
