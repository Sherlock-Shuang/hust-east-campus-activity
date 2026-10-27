import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// A fixed pool of instances; the simulation owns every road user's pose and speed.
export function createCrowdRenderer(scene,capacity=600){
  const group=new THREE.Group();scene.add(group);
  const dummy=new THREE.Object3D(),parent=new THREE.Matrix4(),local=new THREE.Matrix4(),white=new THREE.Color();
  const parts={};const neutral=(color,roughness=.8,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const cloth=neutral('#ffffff'),skin=neutral('#ba9475'),dark=neutral('#202b2a'),metal=neutral('#738078',.4,.65),paint=neutral('#ffffff',.35,.15);
  function make(name,geo,mat,factor=1){const mesh=new THREE.InstancedMesh(geo,mat,capacity*factor);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.castShadow=true;mesh.frustumCulled=false;group.add(mesh);parts[name]={mesh,factor};return mesh;}
  make('body',new THREE.CapsuleGeometry(.19,.4,3,7),cloth);
  make('head',new THREE.SphereGeometry(.135,9,7),skin);
  make('hair',new THREE.SphereGeometry(.142,9,5,0,Math.PI*2,0,Math.PI*.65),dark);
  make('helmet',new THREE.SphereGeometry(.163,10,6,0,Math.PI*2,0,Math.PI*.58),paint);
  make('pack',new RoundedBoxGeometry(.3,.37,.16,1,.045),neutral('#343e38'));
  make('arms',new THREE.CylinderGeometry(.061,.052,.58,6),cloth,2);
  make('thighs',new THREE.CylinderGeometry(.075,.065,.39,6),neutral('#3d484b'),2);
  make('shins',new THREE.CylinderGeometry(.06,.048,.39,6),neutral('#354246'),2);
  make('shoes',new RoundedBoxGeometry(.13,.1,.25,1,.03),neutral('#e2dfd1'),2);
  make('tires',new THREE.TorusGeometry(.255,.065,6,16),dark,2);
  make('hubs',new THREE.CylinderGeometry(.17,.17,.09,10),metal,2);
  make('battery',new RoundedBoxGeometry(.43,.41,.58,2,.065),paint);
  make('seat',new RoundedBoxGeometry(.45,.095,.69,2,.04),dark);
  make('deck',new RoundedBoxGeometry(.43,.1,.95,1,.035),neutral('#434e48'));
  make('cowl',new RoundedBoxGeometry(.36,.69,.16,2,.055),paint);
  make('headlight',new THREE.SphereGeometry(.105,9,6),neutral('#e8ebd4',.22));
  make('handlebar',new THREE.CylinderGeometry(.025,.025,.75,7),metal);
  make('mirrors',new THREE.SphereGeometry(.055,7,5),metal,2);
  make('stalks',new THREE.CylinderGeometry(.012,.012,.24,5),metal,2);
  const colors=[0x8d3940,0x536f7b,0xddd9c9,0x78938c,0x48504b,0xa99972,0x687e97];
  function p(name,i,x,y,z,rx=0,ry=0,rz=0,scale=1,color){const m=parts[name].mesh;dummy.position.set(x,y,z);dummy.rotation.set(rx,ry,rz);dummy.scale.setScalar(scale);dummy.updateMatrix();local.multiplyMatrices(parent,dummy.matrix);m.setMatrixAt(i,local);if(color!==undefined)m.setColorAt(i,white.set(color));}
  function update(npcs){const n=Math.min(npcs.length,capacity);for(let i=0;i<n;i++){
    const a=npcs[i],scooter=a.kind==='scooter'||a.kind==='bike',visible=a.phase!=='arrived'&&a.active!==false;
    dummy.position.set(a.x,0,a.z);dummy.rotation.set(0,a.yaw,0);dummy.scale.setScalar(visible?1:0);dummy.updateMatrix();parent.copy(dummy.matrix);
    const stride=Math.sin(a.stride||0),s=scooter?1:0,c=colors[(a.id??i)%colors.length],y=scooter?1.13:1.14;
    p('body',i,0,y,scooter?.06:0,scooter?.12:0,0,0,1,a.color??0x829885);
    p('head',i,0,scooter?1.64:1.65,scooter?-.025:0);
    p('hair',i,0,scooter?1.67:1.68,scooter?-.025:0);
    p('helmet',i,0,1.68,-.025,0,0,0,scooter&&(a.id??i)%4!==0?1:0,c);
    p('pack',i,0,y,.27,scooter?.12:0);
    for(let side=0;side<2;side++){const sign=side?1:-1,k=i*2+side;
      p('arms',k,sign*.25,1.07,scooter?-.21:0,scooter?-1.0:sign*stride*.45,0,0,1,a.color??0x829885);
      p('thighs',k,sign*.14,scooter?.69:.62,scooter?-.13:0,scooter?1.12:sign*stride*.56);
      p('shins',k,sign*.14,scooter?.38:.25,scooter?-.32:sign*stride*.17,scooter?.06:-sign*stride*.35);
      p('shoes',k,sign*.14,.1,scooter?-.42:sign*stride*.26-.07);
      const z=side?.57:-.57;
      p('tires',k,0,.31,z,0,Math.PI/2,0,s);
      p('hubs',k,0,.31,z,0,0,Math.PI/2,s);
      p('mirrors',k,sign*.32,1.48,-.53,0,0,0,s);
      p('stalks',k,sign*.3,1.34,-.52,-.15,0,sign*.18,s);
    }
    p('battery',i,0,.54,.22,0,0,0,s,c);p('seat',i,0,.79,.23,0,0,0,s);
    p('deck',i,0,.26,-.08,0,0,0,s);p('cowl',i,0,.75,-.49,-.16,0,0,s,c);
    p('headlight',i,0,1.08,-.60,0,0,0,s);p('handlebar',i,0,1.16,-.47,0,0,Math.PI/2,s);
  }
  Object.values(parts).forEach(({mesh,factor})=>{mesh.count=n*factor;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;});
  }
  return {group,update};
}
