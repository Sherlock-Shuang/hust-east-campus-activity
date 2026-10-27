import {streetFootprint,createRoadClearance} from './street-clearance.js';
import {footprintIntersectsRing} from './yunyuan-parking.js';
import {waterFootprint} from './water-details.js';

const PHOTO='/references/local-campus/east-nine-curtainwall.webp';
const hash=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};

/** The photo shows faded yellow parking strips and portable blue P signs.
 * These decorate mapped parking POIs; neither paint nor fixture offsets are
 * surveyed. Preserve the existing mixed bike positions and the central aisle. */
export function planEastNineParkingDetails(route,{model,heightAt=()=>.14,geometryBelowContact=0,surfaceHeightAt=(x,z)=>heightAt(x,z)-geometryBelowContact}={}){
  const parking=(route.parkingPlaces||[]).filter(p=>p.buildingSourceId==='way/1023544717'),clusters=new Map(),areas=new Map(),lines=[],signs=[],bollards=[];
  const roads=createRoadClearance(route),obstacles=(model?.records||[]).filter(r=>['building','water','green'].includes(r.category)).map(waterFootprint).filter(Boolean).flatMap(f=>f.polygons.map(p=>p[0]));
  const clear=(x,z,w,d,yaw)=>!roads(x,z,w,d,yaw)&&!obstacles.some(r=>footprintIntersectsRing(streetFootprint(x,z,w,d,yaw),r));
  for(const p of parking){if(!clusters.has(p.clusterId))clusters.set(p.clusterId,[]);clusters.get(p.clusterId).push(p);if(!areas.has(p.sourceId))areas.set(p.sourceId,[]);areas.get(p.sourceId).push(p);}
  for(const [id,items]of clusters){
    const ref=items[0],{x:tx,z:tz}=ref.frontageTangent,nx=-tz,nz=tx,origin=ref.sourceParkingCentre;
    const corners=items.flatMap(p=>streetFootprint(p.x,p.z,p.footprintWidth,p.footprintLength,p.yaw));
    const uv=corners.map(p=>({u:(p.x-origin.x)*tx+(p.z-origin.z)*tz,v:(p.x-origin.x)*nx+(p.z-origin.z)*nz}));
    const u0=Math.min(...uv.map(p=>p.u))-.08,u1=Math.max(...uv.map(p=>p.u))+.08,v0=Math.min(...uv.map(p=>p.v))-.08,v1=Math.max(...uv.map(p=>p.v))+.08;
    // Leave the 3.6m central cross-passage unpainted and unobstructed.
    if(u0<1.8&&u1>-1.8)continue;
    const point=(u,v)=>({x:origin.x+u*tx+v*nx,z:origin.z+u*tz+v*nz});
    const ring=[point(u0,v0),point(u1,v0),point(u1,v1),point(u0,v1)];
    for(let side=0;side<4;side++){
      const a=ring[side],b=ring[(side+1)%4],length=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
      const count=Math.ceil(length/.65),pitch=length/count;
      for(let j=0;j<count;j++){
        const key=lines.length+side*47+j*13,wear=hash(key),segment=pitch-(wear>.82?.09:.012),x=a.x+dx*(j+.5)*pitch,z=a.z+dz*(j+.5)*pitch,yaw=-Math.atan2(dz,dx);
        if(!clear(x,z,segment,.07,yaw))continue;
        lines.push({x,z,y:surfaceHeightAt(x,z)+.008,yaw,length:segment,width:.07,fade:.76+wear*.24,clusterId:id,sourceId:ref.sourceId});
      }
    }
  }
  const occupied=parking.map(p=>streetFootprint(p.x,p.z,p.footprintWidth+.7,p.footprintLength+.7,p.yaw));
  const fixtureClear=(x,z,w,d,yaw)=>clear(x,z,w,d,yaw)&&!occupied.some(r=>footprintIntersectsRing(streetFootprint(x,z,w+.65,d+.65,yaw),r));
  for(const [sourceId,items]of areas){
    const ref=items[0],origin=ref.sourceParkingCentre,{x:tx,z:tz}=ref.frontageTangent,nx=-tz,nz=tx;
    // At the end of a short parking strip, never in its central access aisle.
    const candidates=[[-10.8,2.5],[10.8,2.5],[-10.8,-2.5],[10.8,-2.5],[-10.8,4.3],[10.8,4.3]];
    const yaw=Math.atan2(nx,nz);
    for(const [u,v]of candidates){const x=origin.x+tx*u+nx*v,z=origin.z+tz*u+nz*v;if(!fixtureClear(x,z,.72,.65,yaw))continue;
      signs.push({x,z,y:surfaceHeightAt(x,z),yaw,sourceId,width:.56,height:1.08});occupied.push(streetFootprint(x,z,1.1,1.1,yaw));
      if(bollards.length<2){const bx=x+tx*1.15,bz=z+tz*1.15;if(fixtureClear(bx,bz,.36,.36,0)){bollards.push({x:bx,z:bz,y:surfaceHeightAt(bx,bz),sourceId,height:.58});occupied.push(streetFootprint(bx,bz,.8,.8));}}
      break;
    }
  }
  const barriers=[...parking.map(p=>({id:`parked-east-nine-${p.id}`,sourceId:p.sourceId,label:'停放的电动车',polygon:streetFootprint(p.x,p.z,p.footprintWidth,p.footprintLength,p.yaw),minHeight:heightAt(p.x,p.z),height:heightAt(p.x,p.z)+1.35})),
    ...signs.map(p=>({label:'停车提示牌',sourceId:p.sourceId,polygon:streetFootprint(p.x,p.z,.65,.6,p.yaw),minHeight:p.y,height:p.y+p.height})),
    ...bollards.map(p=>({label:'停车区警示短柱',sourceId:p.sourceId,polygon:streetFootprint(p.x,p.z,.3,.3),minHeight:p.y,height:p.y+p.height}))];
  return{lines,signs,bollards,barriers,photo:PHOTO,evidence:'photo-informed appearance; fixture positions and dimensions estimated around mapped parking POIs'};
}

export function createEastNineParkingDetails(THREE,route,options={}){
  const plan=planEastNineParkingDetails(route,options),group=new THREE.Group(),geometry=new THREE.BoxGeometry(1,1,1),object=new THREE.Object3D();
  group.name='东九停车区 · 黄线与落地提示牌';group.userData={component:'east-nine-parking-details',photo:PHOTO,evidence:plan.evidence};
  const materials=[],geometries=[geometry],textures=[];
  const mat=(color,roughness=.87)=>{const m=new THREE.MeshStandardMaterial({color,roughness});materials.push(m);return m;};
  const paint=mat('#c8bd83'),frame=mat('#c8ceca',.65),blue=mat('#336b8d'),rubber=mat('#353a37'),yellow=mat('#c6b94e');
  paint.polygonOffset=true;paint.polygonOffsetFactor=-1;
  const batches=new Map();
  function box(material,x,y,z,sx,sy,sz,yaw=0,name='parking-fixture',fade=1){if(!batches.has(material))batches.set(material,[]);batches.get(material).push({x,y,z,sx,sy,sz,yaw,name,fade});}
  for(const p of plan.lines)box(paint,p.x,p.y,p.z,p.length,.004,p.width,p.yaw,'parking-yellow-line',p.fade);
  let signMaterial=null;
  if(typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=384;canvas.height=512;const ctx=canvas.getContext('2d');
    if(ctx){ctx.fillStyle='#336b8d';ctx.fillRect(0,0,384,512);ctx.strokeStyle='#e2e7e2';ctx.lineWidth=9;ctx.strokeRect(13,13,358,486);ctx.fillStyle='#eff1e7';ctx.textAlign='center';ctx.font='bold 250px sans-serif';ctx.fillText('P',192,265);ctx.font='42px sans-serif';ctx.fillText('电动车停放',192,358);ctx.font='29px sans-serif';ctx.fillText('请勿占用通道',192,421);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);signMaterial=new THREE.MeshStandardMaterial({map:texture,roughness:.8});materials.push(signMaterial);}
  }
  for(const p of plan.signs){
    const point=(x,y,z)=>({x:p.x+Math.cos(p.yaw)*x+Math.sin(p.yaw)*z,y:p.y+y,z:p.z-Math.sin(p.yaw)*x+Math.cos(p.yaw)*z});
    const put=(m,x,y,z,sx,sy,sz)=>{const q=point(x,y,z);box(m,q.x,q.y,q.z,sx,sy,sz,p.yaw,'parking-P-sign');};
    put(rubber,0,.035,0,.68,.07,.55);put(blue,0,.66,0,.52,.70,.05);
    for(const side of[-1,1]){put(frame,side*.278,.57,0,.027,1.04,.035);put(frame,side*.278,.15,.18,.028,.27,.035);}
    for(const y of[.30,1.025])put(frame,0,y,.035,.58,.03,.035);
    if(signMaterial){const g=new THREE.PlaneGeometry(.51,.69);geometries.push(g);for(const side of[-1,1]){const mesh=new THREE.Mesh(g,signMaterial),q=point(0,.66,side*.028);mesh.position.set(q.x,q.y,q.z);mesh.rotation.y=p.yaw+(side<0?Math.PI:0);mesh.renderOrder=207;group.add(mesh);}}
    else{const q=point(-.08,.68,.029);box(frame,q.x,q.y,q.z,.08,.4,.005,p.yaw,'parking-letter-P');}
  }
  for(const p of plan.bollards){
    const cylinder=new THREE.CylinderGeometry(.10,.16,p.height,12);geometries.push(cylinder);const body=new THREE.Mesh(cylinder,yellow);body.position.set(p.x,p.y+p.height/2,p.z);body.castShadow=true;body.receiveShadow=true;body.renderOrder=205;group.add(body);
    box(rubber,p.x,p.y+.025,p.z,.34,.05,.34,0,'warning-post-foot');
    for(const y of[.17,.37]){const g=new THREE.CylinderGeometry(.16-y*.06/p.height+.003,.16-(y-.1)*.06/p.height+.003,.10,12);geometries.push(g);const band=new THREE.Mesh(g,rubber);band.position.set(p.x,p.y+y-.05,p.z);band.renderOrder=206;group.add(band);}
  }
  for(const [material,items]of batches){const mesh=new THREE.InstancedMesh(geometry,material,items.length);items.forEach((p,i)=>{object.position.set(p.x,p.y,p.z);object.rotation.set(0,p.yaw,0);object.scale.set(p.sx,p.sy,p.sz);object.updateMatrix();mesh.setMatrixAt(i,object.matrix);mesh.setColorAt(i,new THREE.Color('#ffffff').multiplyScalar(p.fade));});mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=material!==paint;mesh.receiveShadow=true;mesh.renderOrder=206;mesh.userData={...group.userData,component:material===paint?'parking-yellow-lines':'parking-sign-frames'};group.add(mesh);}
  let disposed=false;return{group,plan,infrastructure:{barriers:plan.barriers},dispose(){if(disposed)return;disposed=true;group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.removeFromParent();}};
}
