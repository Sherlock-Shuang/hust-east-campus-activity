import {planCanteenBoundary,inCanteenOpenForecourt} from './yunyuan-canteen.js';
import {footprintIntersectsRing} from './yunyuan-parking.js';
import {streetFootprint} from './street-clearance.js';
import {createCrossingDetails} from './street-furniture.js';
import {sampleVehicleContact} from './vehicle-contact.js';
import {createActorLibrary} from './commute-actors.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {createTreeLayer} from './vegetation.js';
import {createStreetDetails} from './street-details.js';
import {createSurfaceMaterials,applyWorldUV} from './surface-materials.js';
import {createEastNineParkingDetails} from './east-nine-parking-details.js';
import {createScooterTransport} from './scooter-transport.js';

/** Photo-informed geometric reconstruction. Source locations belong to route;
 * vehicle styling, parking arrangement, signal poles and ramp grades are estimates.
 * Every vehicle faces local -Z. Metres are preserved throughout the scene.
 */
export function createCommuteScene(THREE,scene,route,simulation,{model}={}){
  const group=new THREE.Group();group.name='韵苑—东九早八通勤';scene.add(group);
  const staticGroup=new THREE.Group();staticGroup.name='沿途道路设施与林荫';scene.add(staticGroup);
  group.userData={source:'OSM source route and fixture locations; public campus photographs guide styling',estimated:['vehicle design','signal pole offset and appearance','parking arrangement','bridge approach grade','traffic demand and timing'],units:'metres'};
  const geometries=new Set(),materials=new Set(),signalLamps=[];
  const mat=(color,roughness=.7,metalness=0)=>{const m=new THREE.MeshStandardMaterial({color,roughness,metalness});materials.add(m);return m;};
  const box=(x,y,z)=>new THREE.BoxGeometry(x,y,z);
  const rounded=(x,y,z,r=.055)=>new RoundedBoxGeometry(x,y,z,2,Math.min(r,x/3,y/3,z/3));
  const actors=createActorLibrary(THREE,{registerGeometry:g=>geometries.add(g),registerMaterial:m=>materials.add(m)});
  const {scooter,walker,parked,lowScooter,lowWalker,lowParked}=actors;
  // Photographed canteen parking is an explicitly inferred layout, kept
  // separate from mapped parking POIs in route data and combined only to draw.
  const sourceParking=[...(route.parkingPlaces||[]),...(route.photoInferredParking||[])];
  const food=model?.buildings.find(r=>r.id==='way/103814566'),foodPlan=food?planCanteenBoundary(food):null,boundary=foodPlan?.boundary;
  // Keep mapped POIs intact; suppress only display instances which now occupy
  // the photo-refined building. A mapped parking centroid is not every bike.
  const reserved=(model?.photoForecourtReservations||[]).map(p=>streetFootprint(p.x,p.z,p.width+.3,p.depth+.3,p.yaw||0));
  const parking=sourceParking.filter(p=>{const footprint=streetFootprint(p.x,p.z,1.05,2.24,p.yaw||0);return(!boundary||!footprintIntersectsRing(footprint,boundary))&&!reserved.some(r=>footprintIntersectsRing(footprint,r));});
  const scooterTransport=createScooterTransport({parking,simulation,onChange:()=>update()});
  group.userData.parkingRefinedBoundaryAvoidance=sourceParking.length-parking.length;
  const dummy=new THREE.Object3D();
  const brakeMaterial=actors.palette.tail.clone();brakeMaterial.emissive.set('#ee321c');brakeMaterial.emissiveIntensity=1.1;materials.add(brakeMaterial);
  function batches(parts,capacity,label){const expanded=label.startsWith('electric-scooter')?parts.flatMap(part=>part.name==='tail'?[{...part,condition:'braking',material:brakeMaterial},{...part,condition:'released'}]:[part]):parts;return expanded.map(part=>{const mesh=new THREE.InstancedMesh(part.geometry,part.material,capacity);mesh.count=0;mesh.name=`${label}-${part.name}`;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.renderOrder=205;mesh.userData={component:label,part:part.name,joint:part.joint||'fixed',family:part.family??null,geometryEvidence:'photo-informed procedural model',agentIds:[]};group.add(mesh);return{...part,mesh};});}
  const vehicles=batches(scooter,1200,'electric-scooter'),walkers=batches(walker,1200,'pedestrian'),parkedBatches=batches(parked,Math.max(1,parking.length),'parked-scooter');
  const distantVehicles=batches(lowScooter,1200,'electric-scooter-distant'),distantWalkers=batches(lowWalker,1200,'pedestrian-distant'),distantParked=batches(lowParked,Math.max(1,parking.length),'parked-scooter-distant');
  for(const part of[...distantVehicles,...distantWalkers,...distantParked])part.mesh.castShadow=false;
  // Simulation advances at 20 Hz while cameras can render at 60–120 Hz. Keep
  // the last rig per actor and do not rebuild/upload identical instance data.
  // Weak keys release completed/borrowed actors naturally; no history grows.
  let poseCache=new WeakMap();
  const poseFields=['x','y','z','yaw','progress','speed','steeringAngle','footDown','lean','id','colorIndex','braking','pathScale','direction'];
  const colorPalette=Object.fromEntries(Object.entries(actors.colors).map(([key,values])=>[key,values.map(value=>new THREE.Color(value))]));
  const contactPitch=new THREE.Matrix4(),contactLean=new THREE.Matrix4();
  function actorRecord(agent,kind,staticBatch){
    let record=poseCache.get(agent),changed=!record||record.kind!==kind||record.staticBatch!==staticBatch;
    if(!record){record={agent,kind,staticBatch,values:[],version:0,world:new THREE.Matrix4(),joints:new Map()};poseCache.set(agent,record);}
    for(let i=0;i<poseFields.length;i++)if(!Object.is(record.values[i],agent[poseFields[i]])){record.values[i]=agent[poseFields[i]];changed=true;}
    if(changed){
      record.kind=kind;record.staticBatch=staticBatch;record.version++;
      const pose=record.pose=actors.samplePose(agent,kind);record.appearance=pose.appearance;
      const contact=kind==='scooter'&&!staticBatch&&Number.isFinite(agent.progress)?sampleVehicleContact(route,agent):{y:(agent.y??.16)-(kind==='scooter'?.021:0),pitch:0};
      dummy.position.set(agent.x,contact.y,agent.z);dummy.rotation.set(0,agent.yaw||0,0);dummy.scale.setScalar(1);dummy.updateMatrix();record.world.copy(dummy.matrix);
      if(kind==='scooter')record.world.multiply(contactPitch.makeRotationX(contact.pitch)).multiply(contactLean.makeRotationZ(pose.lean));
    }
    return record;
  }
  function jointMatrix(part,record){
    if(!part.matrixKey)part.matrixKey=[part.joint||'fixed',part.anchor||'',...(part.segment||[])].join(':');
    let joint=record.joints.get(part.matrixKey);
    if(!joint){joint={matrix:new THREE.Matrix4(),version:-1};record.joints.set(part.matrixKey,joint);}
    if(joint.version!==record.version){actors.partMatrix(part,record.agent,record.pose,joint.matrix);joint.version=record.version;}
    return joint.matrix;
  }
  function writeBatch(batch,items,staticBatch=false){
    // Borrowed traffic scooters can be left parked anywhere; grow only when a
    // returned vehicle actually exceeds the original instance capacity.
    for(const part of batch)if(items.length>part.mesh.instanceMatrix.count){
      const previous=part.mesh,next=new THREE.InstancedMesh(previous.geometry,previous.material,2**Math.ceil(Math.log2(items.length)));
      Object.assign(next,{name:previous.name,castShadow:previous.castShadow,receiveShadow:previous.receiveShadow,frustumCulled:false,renderOrder:previous.renderOrder,userData:previous.userData});
      next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.remove(previous);previous.dispose();group.add(next);part.mesh=next;part.previousItems=null;
    }
    const kind=batch===walkers||batch===distantWalkers?'walk':'scooter';
    const posed=items.map(agent=>actorRecord(agent,kind,staticBatch));
    for(const part of batch){
      const selected=posed.filter(item=>actors.partApplies(part,item.appearance)&&(!part.condition||(part.condition==='braking')===!!item.agent.braking));
      if(part.previousItems?.length===selected.length&&selected.every((item,i)=>part.previousItems[i]===item&&part.previousVersions[i]===item.version))continue;
      part.mesh.count=selected.length;part.mesh.userData.agentIds=selected.map(item=>item.agent.id??null);
      selected.forEach((record,i)=>{
        const {appearance}=record;
        dummy.matrix.copy(record.world).multiply(jointMatrix(part,record));part.mesh.setMatrixAt(i,dummy.matrix);
        if(part.colorKey){const colors=colorPalette[part.colorKey],index=part.colorKey==='skin'?appearance.skinIndex:part.colorKey==='paint'?appearance.colorIndex:appearance.colorIndex+(part.colorKey==='coat'?3:part.colorKey==='pants'?1:part.colorKey==='bag'?2:0);part.mesh.setColorAt(i,colors[index%colors.length]);}
      });
      part.previousItems=selected;part.previousVersions=selected.map(item=>item.version);
      // Capacities reserve room for peak traffic, but a nearby view uses only
      // a short prefix. Upload that prefix, not 1200 matrices for every part.
      if(selected.length){
        part.mesh.instanceMatrix.clearUpdateRanges();part.mesh.instanceMatrix.addUpdateRange(0,selected.length*16);part.mesh.instanceMatrix.needsUpdate=true;
        if(part.mesh.instanceColor){part.mesh.instanceColor.clearUpdateRanges();part.mesh.instanceColor.addUpdateRange(0,selected.length*3);part.mesh.instanceColor.needsUpdate=true;}
      }
      if(staticBatch)part.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    }
  }
  writeBatch(parkedBatches,scooterTransport.parkedAgents,true);
  function mesh(g,m,parent=staticGroup){geometries.add(g);const o=new THREE.Mesh(g,m);o.castShadow=true;o.receiveShadow=true;o.renderOrder=205;parent.add(o);return o;}
  const surfaces=createSurfaceMaterials(THREE);
  const eastNineParking=createEastNineParkingDetails(THREE,{...route,parkingPlaces:parking},{model,heightAt:model?.eastNineGround?.heightAt,surfaceHeightAt:model?.eastNineGround?.surfaceHeightAt});
  staticGroup.add(eastNineParking.group);if(model)model.parkingInfrastructure=eastNineParking.infrastructure;
  const asphalt=surfaces.asphalt,concrete=surfaces.concrete,white=surfaces.paint,poleMaterial=mat('#aeb6b4',.46,.55),housing=mat('#252d2c',.71),routeMaterial=mat('#d3b477',.8);
  const trees=(route.roadsideTrees||[]).filter(p=>!inCanteenOpenForecourt(foodPlan,p));
  staticGroup.userData.photoForecourtTreeClearance=(route.roadsideTrees?.length||0)-trees.length;
  const vegetation=createTreeLayer(THREE,trees,{name:'photo-inferred-roadside-trees',detail:'street',whitewash:true,barkMaterial:surfaces.bark});staticGroup.add(vegetation.group);
  const streetDetails=createStreetDetails(THREE,route,surfaces,{treesForPits:trees});staticGroup.add(streetDetails.group);
  for(const ramp of route.ramps||[]){const vertices=[],indices=[];
    for(let i=0;i<ramp.points.length;i++){const p=ramp.points[i],a=ramp.points[Math.max(0,i-1)],b=ramp.points[Math.min(ramp.points.length-1,i+1)],l=Math.hypot(b.x-a.x,b.z-a.z)||1,nx=-(b.z-a.z)/l*ramp.width/2,nz=(b.x-a.x)/l*ramp.width/2;vertices.push(p.x+nx,p.y-.02,p.z+nz,p.x-nx,p.y-.02,p.z-nz,p.x+nx,.1,p.z+nz,p.x-nx,.1,p.z-nz);if(i){const q=(i-1)*4,o=i*4;indices.push(q,o,q+1,q+1,o,o+1,q,q+2,o,q+2,o+2,o,q+1,o+1,q+3,q+3,o+1,o+3);}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();const road=mesh(applyWorldUV(g),asphalt);road.castShadow=false;road.userData={component:'estimated-bridge-approach',sourceId:ramp.sourceId,evidence:ramp.evidence};
  }
  // The route highlight consists of small ground-level beads, never a floating
  // strip cutting through buildings. It sits on the same vertical profile.
  const routePositions=[];for(let s=0;s<route.length;s+=8){const p=simulation.getPoseAt(s,0,'scooter');routePositions.push({...p,y:p.y+.035});}
  const beadGeometry=new THREE.CylinderGeometry(.12,.12,.035,6);geometries.add(beadGeometry);const beads=new THREE.InstancedMesh(beadGeometry,routeMaterial,routePositions.length);beads.renderOrder=205;beads.userData.component='route-markers';routePositions.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,0,0);dummy.updateMatrix();beads.setMatrixAt(i,dummy.matrix);});group.add(beads);
  // Crossing nodes are taken from the map. Unknown markings remain unpainted.
  const crossingDetails=createCrossingDetails(THREE,route,surfaces);staticGroup.add(crossingDetails.group);
  for(const source of route.trafficSignals||[]){
    const junctionGroup=new THREE.Group();junctionGroup.name=source.signalEvidence==='user-confirmed'?'用户确认的湖畔信号路口':'源地图信号控制路口';
    junctionGroup.userData={component:'traffic-signal',sourceId:source.id,locationEvidence:source.coordinateEvidence||'source-junction',signalEvidence:source.signalEvidence||'source-map',poleEvidence:'approach-specific inferred poles; not surveyed',timingEvidence:'scenario'};
    staticGroup.add(junctionGroup);
    for(const direction of(route.bidirectional?[1,-1]:[1])){
      const line=direction===1?(source.stopLine||source):source.reverseStopLine;
      if(!line)continue;
      const width=line.width||source.width,holder=new THREE.Group();holder.position.set(line.x,line.y,line.z);holder.rotation.y=line.yaw;holder.name=direction===1?'去向信号':'回向信号';junctionGroup.add(holder);
      const side=width/2+.5,laneCenter=Math.max(.65,width*.25);
      const base=mesh(new THREE.CylinderGeometry(.22,.26,.24,8),concrete,holder);base.position.set(side,.1,0);
      const pole=mesh(new THREE.CylinderGeometry(.065,.085,4.8,10),poleMaterial,holder);pole.position.set(side,2.4,0);
      const arm=mesh(box(side-laneCenter,.09,.09),poleMaterial,holder);arm.position.set((side+laneCenter)/2,4.65,0);
      const casing=mesh(rounded(.37,1.03,.22,.035),housing,holder);casing.position.set(laneCenter,4.1,.01);
      const lamps={};for(const[name,y,c]of[['red',4.4,'#ff3b28'],['amber',4.1,'#ffc637'],['green',3.8,'#50ed93']]){
        const m=mat(c,.35);m.emissive=new THREE.Color(c);m.emissiveIntensity=.02;
        const lamp=mesh(new THREE.CircleGeometry(.115,16),m,holder);lamp.position.set(laneCenter,y,.128);lamps[name]=m;
        const hood=mesh(new THREE.CylinderGeometry(.135,.135,.17,12,1,true,0,Math.PI),housing,holder);hood.rotation.x=Math.PI/2;hood.rotation.z=Math.PI/2;hood.position.set(laneCenter,y+.025,.17);
      }
      const backplate=mesh(rounded(.48,1.16,.035,.045),poleMaterial,holder);backplate.position.set(laneCenter,4.1,-.12);
      const cabinet=mesh(rounded(.28,.43,.22,.015),poleMaterial,holder);cabinet.position.set(side+.03,.54,.15);
      for(const y of[1.1,3.8]){const collar=mesh(new THREE.TorusGeometry(.086,.014,5,12),housing,holder);collar.rotation.x=Math.PI/2;collar.position.set(side,y,0);}
      // Each stop line spans only the approaching half of the road; the return
      // lane stays open, and the position clears the crossing road's full width.
      const halfWidth=route.bidirectional?width/2:width,stop=mesh(box(Math.max(.7,halfWidth-.35),.003,.25),white,holder);
      stop.position.set(route.bidirectional?width/4:0,-.017,0);
      stop.userData={component:'estimated-stop-line',sourceId:source.id,progress:line.progress??source.progress,direction,evidence:line.evidence||'estimated'};
      signalLamps.push({id:source.id,direction,lamps});
    }
  }
  let disposed=false,lastCamera=null,detailDistance=34;const frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),sphere=new THREE.Sphere(new THREE.Vector3(),2),cameraPosition=new THREE.Vector3();
  function update(camera){if(disposed)return;if(camera)lastCamera=camera;vegetation.update(lastCamera);
    if(lastCamera){lastCamera.updateMatrixWorld();projection.multiplyMatrices(lastCamera.projectionMatrix,lastCamera.matrixWorldInverse);frustum.setFromProjectionMatrix(projection);lastCamera.getWorldPosition(cameraPosition);}
    function partition(items){const near=[],far=[];for(const item of items){if(!lastCamera){near.push(item);continue;}sphere.center.set(item.x,(item.y||.16)+.9,item.z);if(!frustum.intersectsSphere(sphere))continue;(sphere.center.distanceToSquared(cameraPosition)<detailDistance*detailDistance?near:far).push(item);}return[near,far];}
    const agents=simulation.agents.filter(a=>a.active!==false&&a.phase!=='arrived'),[nearScooters,farScooters]=partition(agents.filter(a=>(a.kind||a.type)==='scooter')),[nearPeople,farPeople]=partition(agents.filter(a=>(a.kind||a.type)==='walk')),[nearParking,farParking]=partition(scooterTransport.parkedAgents);
    writeBatch(vehicles,nearScooters.slice(0,1200));writeBatch(distantVehicles,farScooters.slice(0,1200));writeBatch(walkers,nearPeople.slice(0,1200));writeBatch(distantWalkers,farPeople.slice(0,1200));writeBatch(parkedBatches,nearParking,true);writeBatch(distantParked,farParking,true);
    for(const entry of signalLamps){const state=simulation.signals.find(s=>s.id===entry.id)?.state||'off';for(const[name,m]of Object.entries(entry.lamps)){m.emissiveIntensity=name===state?2:.015;m.color.set(name===state?name==='red'?'#ff3b28':name==='green'?'#50ed93':'#ffc637':'#263b35');}}}
  function setDetailDistanceScale(scale=1){detailDistance=34*Math.max(.35,Math.min(1.5,Number.isFinite(scale)?scale:1));}
  function setVisible(visible){group.visible=!!visible;}
  function dispose(){if(disposed)return;disposed=true;poseCache=new WeakMap();for(const part of[...vehicles,...walkers,...parkedBatches,...distantVehicles,...distantWalkers,...distantParked]){part.previousItems=null;part.previousVersions=null;}scooterTransport.dispose();group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});vegetation.dispose();streetDetails.dispose();crossingDetails.dispose();eastNineParking.dispose();if(model?.parkingInfrastructure===eastNineParking.infrastructure)delete model.parkingInfrastructure;surfaces.dispose();scene.remove(group);scene.remove(staticGroup);for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.clear();staticGroup.clear();}
  update();return{group,staticGroup,scooterTransport,update,setDetailDistanceScale,updateStatic:camera=>vegetation.update(camera),setVisible,dispose,counts:{parked:parking.length,photoInferredParked:parking.filter(p=>p.buildingSourceId==='way/103814566').length,trees:trees.length,streetDetails:streetDetails.counts,signals:(route.trafficSignals||[]).length,signalHeads:signalLamps.length,crossings:(route.crossings||[]).filter(c=>c.tags?.['crossing:markings']==='yes'||c.tags?.crossing==='marked').length},vehicleGeometry:scooter};
}
