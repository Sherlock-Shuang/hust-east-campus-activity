import {waterFootprint} from './water-details.js';
import {getRoadProfile} from './building-profiles.js';
import {createActorLibrary} from './commute-actors.js';

const PHOTO='/references/local-campus/east-nine-curtainwall.webp';
const BASE_HEIGHT=1.5963899739354073,BASE_FOOT=.02399999886751175;
const distance=(p,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);};
function sourcePoints(record){
  const lines=[];record?.group?.updateWorldMatrix(true,true);record?.group?.traverse(o=>{if(!o.isLine||o.isLineSegments)return;const a=o.geometry.attributes.position,m=o.matrixWorld.elements,points=[];
    for(let i=0;i<a.count;i++)points.push({x:m[0]*a.getX(i)+m[4]*a.getY(i)+m[8]*a.getZ(i)+m[12],z:m[2]*a.getX(i)+m[6]*a.getY(i)+m[10]*a.getZ(i)+m[14]});lines.push(points);
  });return lines;
}
function poiPoint(record){const a=record?.mesh?.geometry?.attributes.position;if(!a?.count)return null;const p={x:a.getX(0),z:a.getZ(0)};return p;}

/** A small, explicitly illustrative forecourt population. The A-north walkers
 * stay on the source footway before its entrance platform. The B/C people use
 * short, checked clear strips outside the mapped facade, as seen in the photo;
 * these strips are not new routes, surveyed door locations or demand data.
 */
export function planEastNinePeople(model){
  const people=[],records=model.records??[],building=waterFootprint(records.find(r=>r.id==='way/1023544717')??{});
  if(!building)return{people};
  const obstacles=records.filter(r=>['building','water','green'].includes(r.category)).map(waterFootprint).filter(Boolean);
  const roads=(model.roads??[]).flatMap(r=>sourcePoints(r).flatMap(line=>line.slice(1).map((b,i)=>({a:line[i],b,id:r.id,width:getRoadProfile(r.feature).width}))));
  const safe=(p,sourceId)=>!obstacles.some(f=>f.contains(p.x,p.z)||f.distance(p.x,p.z)<.63)&&!roads.some(r=>r.id!==sourceId&&distance(p,r.a,r.b)<r.width/2+.75);
  function add(a,b,{sourceId,locationEvidence,standing=false,side=0}={}){
    const length=Math.hypot(b.x-a.x,b.z-a.z);if(length<1)return;
    const tx=(b.x-a.x)/length,tz=(b.z-a.z)/length,nx=-tz,nz=tx,offset=side*.52;
    const start={x:a.x+nx*offset,z:a.z+nz*offset},end={x:b.x+nx*offset,z:b.z+nz*offset};
    for(let i=0;i<=24;i++){const t=i/24;if(!safe({x:start.x+(end.x-start.x)*t,z:start.z+(end.z-start.z)*t},sourceId))return;}
    const i=people.length,height=[1.70,1.78,1.66,1.74,1.80,1.68,1.72,1.76][i%8];
    people.push({id:98001+i*7,colorIndex:[2,0,4,7,1,6,3,5][i%8],height,scale:height/BASE_HEIGHT,start,end,length,side,sourceId,locationEvidence,
      standing,standingFraction:.38+i*.047,phase:i*3.37,speed:.95+(i%3)*.11,pause:1.8+(i%2)*.5,
      surfaceY:.14,photo:PHOTO,layoutEvidence:'photo-informed illustrative forecourt people; positions and adult heights estimated; not observed early-morning density or traffic agents'});
  }
  const north=records.find(r=>r.id==='way/655063746'),line=sourcePoints(north)[0];
  if(line?.length>=2){const a=line[0],b=line.at(-1),l=Math.hypot(b.x-a.x,b.z-a.z),tx=(b.x-a.x)/l,tz=(b.z-a.z)/l;
    // The final 5 m belong to the independently modelled entrance platform.
    if(l>11){const start={x:a.x+tx*4,z:a.z+tz*4},end={x:b.x-tx*5,z:b.z-tz*5};for(const side of[-1,1])add(start,end,{sourceId:north.id,side,locationEvidence:'source A-north footway, excluding its entrance/platform end'});}
  }
  for(const sourceId of['node/11395860770','node/1186784735']){
    const centre=poiPoint(records.find(r=>r.id===sourceId));if(!centre)continue;
    let closest=null;
    for(const rings of building.polygons)for(const ring of rings)for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz),t=Math.max(0,Math.min(1,((centre.x-a.x)*dx+(centre.z-a.z)*dz)/(l*l||1))),p={x:a.x+t*dx,z:a.z+t*dz},d=Math.hypot(centre.x-p.x,centre.z-p.z);
      if(l>7&&(!closest||d<closest.distance))closest={p,distance:d,tx:dx/l,tz:dz/l};
    }
    if(!closest||closest.distance<9)continue;
    const {p,tx,tz}=closest,nx=(centre.x-p.x)/closest.distance,nz=(centre.z-p.z)/closest.distance;
    const start={x:p.x+nx*4.6-tx*3.6,z:p.z+nz*4.6-tz*3.6},end={x:p.x+nx*4.6+tx*3.6,z:p.z+nz*4.6+tz*3.6};
    add(start,end,{sourceId,side:-1,locationEvidence:'photo-estimated clear forecourt strip outside mapped curved facade, beside mapped parking POI'});
    add({x:start.x+nx*1.8,z:start.z+nz*1.8},{x:end.x+nx*1.8,z:end.z+nz*1.8},{sourceId,side:1,standing:true,locationEvidence:'photo-estimated standing person on the open forecourt, outside facade and parking pockets'});
  }
  return{people};
}

export function sampleEastNinePerson(person,time=0){
  const {start,end,length,scale,surfaceY}=person,heading=Math.atan2(-(end.x-start.x),-(end.z-start.z));
  if(person.standing){const t=person.standingFraction;return{id:person.id,colorIndex:person.colorIndex,x:start.x+(end.x-start.x)*t,z:start.z+(end.z-start.z)*t,y:surfaceY-BASE_FOOT*scale,yaw:heading+(person.id%2?.35:-.55),speed:0,progress:0,scale,standing:true};}
  // Cosine distance gives zero speed at either end. People then pause and turn
  // in place; there is no instantaneous teleport or snap at a looping waypoint.
  const travel=Math.PI*length/(2*person.speed),cycle=2*(travel+person.pause),elapsed=Math.max(0,time+person.phase),phase=elapsed%cycle;
  const returning=phase>=travel+person.pause,local=returning?phase-travel-person.pause:phase,t=Math.min(1,local/travel),portion=(1-Math.cos(Math.PI*t))*.5;
  const f=returning?1-portion:portion,speed=local<travel?person.speed*Math.sin(Math.PI*t):0;
  const turn=local>travel?Math.min(1,(local-travel)/person.pause):0,smoothTurn=turn*turn*(3-2*turn),yaw=heading+(returning?Math.PI:0)+Math.PI*smoothTurn;
  return{id:person.id,colorIndex:person.colorIndex,x:start.x+(end.x-start.x)*f,z:start.z+(end.z-start.z)*f,y:surfaceY-BASE_FOOT*scale,yaw,speed,progress:Math.floor(elapsed/cycle)*2*length+(returning?length+portion*length:portion*length),scale};
}

export function createEastNinePeople(THREE,model,{heightAt}={}){
  const plan=planEastNinePeople(model),group=new THREE.Group();group.name='东九前场人物 · 照片比例参照';
  group.userData={component:'east-nine-forecourt-people',photo:PHOTO,personCount:plan.people.length,sourceIds:[...new Set(plan.people.map(p=>p.sourceId))],heightRangeMetres:[1.65,1.8],populationEvidence:'small illustrative population, not measured early-morning demand',positions:'source A footway or checked photo-estimated open B/C forecourt strips'};
  const geometries=new Set(),materials=new Set(),library=createActorLibrary(THREE,{registerGeometry:g=>geometries.add(g),registerMaterial:m=>materials.add(m)});
  const parts=library.walker.map(part=>{const mesh=new THREE.InstancedMesh(part.geometry,part.material,Math.max(1,plan.people.length));mesh.name=`forecourt-person-${part.name}`;mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.renderOrder=205;group.add(mesh);return{...part,mesh};});
  const object=new THREE.Object3D(),matrix=new THREE.Matrix4(),localMatrix=new THREE.Matrix4(),color=new THREE.Color(),cameraPosition=new THREE.Vector3();let time=0,disposed=false,distanceCulled=false;
  function update(dt=0,camera){
    if(disposed||!group.visible&&!distanceCulled)return false;
    for(let parent=group.parent;parent;parent=parent.parent)if(!parent.visible)return false;
    if(camera){camera.getWorldPosition(cameraPosition);const near=plan.people.some(p=>Math.min((p.start.x-cameraPosition.x)**2+(p.start.z-cameraPosition.z)**2,(p.end.x-cameraPosition.x)**2+(p.end.z-cameraPosition.z)**2)+(cameraPosition.y-.9)**2<180**2);
      if(!near){group.visible=false;distanceCulled=true;return false;}
      if(distanceCulled){group.visible=true;distanceCulled=false;}
    }
    time+=Math.max(0,Math.min(Number.isFinite(dt)?dt:0,.15));
    const people=plan.people.map(person=>{const agent=sampleEastNinePerson(person,time),pose=library.samplePose(agent,'walk');
      if(heightAt)agent.y+=heightAt(agent.x,agent.z)-person.surfaceY;
      if(agent.standing){const side=agent.id%2?'L':'R',sign=side==='L'?-1:1;pose.points[`elbow${side}`]=[sign*.24,1.10,-.07];pose.points[`hand${side}`]=[sign*.13,1.23,-.035];pose.points[`ankle${side}`][2]+=.065;pose.points[`knee${side}`][2]+=.025;}
      object.position.set(agent.x,agent.y,agent.z);object.rotation.set(0,agent.yaw,0);object.scale.setScalar(agent.scale);object.updateMatrix();return{agent,pose,world:object.matrix.clone(),appearance:library.appearance(agent)};});
    for(const part of parts){const selected=people.filter(p=>library.partApplies(part,p.appearance));part.mesh.count=selected.length;part.mesh.userData={component:'east-nine-forecourt-person',personIds:selected.map(p=>p.agent.id)};
      selected.forEach(({agent,pose,world,appearance},i)=>{matrix.copy(world).multiply(library.partMatrix(part,agent,pose,localMatrix));part.mesh.setMatrixAt(i,matrix);
        if(part.colorKey){const colors=library.colors[part.colorKey],index=part.colorKey==='skin'?appearance.skinIndex:appearance.colorIndex+(part.colorKey==='coat'?3:part.colorKey==='pants'?1:part.colorKey==='bag'?2:0);color.set(colors[index%colors.length]);part.mesh.setColorAt(i,color);}
      });part.mesh.instanceMatrix.needsUpdate=true;if(part.mesh.instanceColor)part.mesh.instanceColor.needsUpdate=true;part.mesh.computeBoundingSphere();
    }
    return true;
  }
  update();return{group,plan,update,dispose(){if(disposed)return;disposed=true;for(const {mesh}of parts)mesh.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.removeFromParent();group.clear();}};
}
