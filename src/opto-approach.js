import polygonClipping from 'polygon-clipping';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {getRoadProfile} from './building-profiles.js';
import {streetFootprint} from './street-clearance.js';
import {applyWorldUV} from './surface-materials.js';

export const OPTO_APPROACH_BRIDGES=Object.freeze(['way/1023544702','way/104351014','way/1483567255','way/1483567257','way/1483567260','way/98831415']);
const FLOOR=.14;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const linePolygon=(a,b,width)=>streetFootprint((a.x+b.x)/2,(a.z+b.z)/2,distance(a,b),width,-Math.atan2(b.z-a.z,b.x-a.x));
const segments=record=>record.feature.geometry.type==='LineString'?[record.feature.geometry.coordinates]:record.feature.geometry.type==='MultiLineString'?record.feature.geometry.coordinates:[];
const clipRing=ring=>ring.map(p=>[p.x,p.z]);
function nearest(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));return{x:a.x+t*dx,z:a.z+t*dz,distance:Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz)};}

/** Keep the existing campus datum and original source paths. `layer=1` records
 * crossing order; it does not measure a five-and-a-half-metre road elevation.
 * This reconstruction uses level bank connections until a DEM is available. */
export function planOptoApproach(model,{frame,geoToLocal,optoBuilding}={}){
  const plan={accepted:false,bridges:[],connectors:[],barriers:[],walkSurfaces:[],forestExclusions:[],replacedRoadIds:[],diagnostics:[],evidence:{
    source:'Unmodified public OSM road centerlines and the current photo-informed optoelectronics entry plan',
    photograph:'https://hbkx.org.cn/attached/image/20240716/1721113702065049616.png',
    localPhotographs:['2720ef701be4299993bba9f043709044.jpg','38da0ca94ef701bc2f2d30d5669aa6b9.jpg','9a2a2edd9e9b1580d26b77156a89d5eb.jpg'],
    railingAppearance:'2026-10-30 user photographs: grey metal cap rail and closely spaced vertical balusters; source bridge boundaries and access openings retained',
    observed:'Completed aerial shows surface arrival lanes meeting the surrounding roads and a bridge across the watercourse; no five-metre road steps at the banks.',
    uncertainty:'Bridge vertical profile, widths, slab/rail dimensions and the college/east doorway connectors are display estimates, not a bridge survey. The two access routes are user-confirmed; exact door coordinates remain estimated in opto-building.',
  }};
  if(!model?.roads||!frame||typeof geoToLocal!=='function')return plan;
  const local=c=>geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);
  const roads=model.roads.map(record=>({id:record.id,profile:getRoadProfile(record.feature),lines:segments(record).map(line=>line.map(local)),record}));
  for(const id of OPTO_APPROACH_BRIDGES){
    const road=roads.find(r=>r.id===id);if(!road?.profile.bridge)continue;
    const width=road.profile.width,patches=[],bridge={id,lines:road.lines,width,motor:road.profile.motor,oldElevation:road.profile.elevation,rails:[],polygons:[],sourceUrl:road.profile.sourceUrl};
    for(const [lineIndex,points]of road.lines.entries()){
      for(let i=1;i<points.length;i++)if(distance(points[i-1],points[i])>.01)patches.push([clipRing(linePolygon(points[i-1],points[i],width))]);
      // Shared endpoints with other mapped roads/footways are real accesses.
      // Leave rail openings there, including the C-side footway at an internal
      // vertex of the arrival bridge, not only at the bridge's two endpoints.
      const joints=[];
      for(const p of points)for(const other of roads){if(other.id===id)continue;for(const line of other.lines)if(line.some(q=>distance(p,q)<.12))joints.push({point:p,width:other.profile.width});}
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i],length=distance(a,b);if(length<.01)continue;
        const dx=(b.x-a.x)/length,dz=(b.z-a.z)/length,count=Math.ceil(length/1.8),pitch=length/count;
        for(const side of[-1,1])for(let k=0;k<count;k++){
          const t=(k+.5)/count,x=a.x+dx*length*t-dz*width*.49*side,z=a.z+dz*length*t+dx*width*.49*side;
          if(joints.some(j=>Math.hypot(x-j.point.x,z-j.point.z)<j.width/2+1.25))continue;
          const rail={id:`${id}:rail:${lineIndex}:${i}:${side}:${k}`,x,z,length:pitch+.015,yaw:-Math.atan2(dz,dx),height:1.08,width:.085};bridge.rails.push(rail);
          plan.barriers.push({id:rail.id,sourceId:id,polygon:streetFootprint(x,z,rail.length,rail.width,rail.yaw),minHeight:FLOOR,height:FLOOR+rail.height,label:'光电周边低桥栏杆',estimated:true});
        }
      }
    }
    bridge.polygons=patches.length?polygonClipping.union(...patches):[];
    for(const [i,p]of bridge.polygons.entries())plan.walkSurfaces.push({id:`${id}:level-deck:${i}`,sourceId:id,polygon:p[0].map(([x,z])=>({x,z})),holes:p.slice(1).map(r=>r.map(([x,z])=>({x,z}))),surfaceY:FLOOR,bridge:true,deckDepth:.18,kind:'level-bank-bridge',estimated:true});
    plan.bridges.push(bridge);plan.replacedRoadIds.push(id);plan.forestExclusions.push(...bridge.polygons);
    plan.diagnostics.push({id,oldElevation:road.profile.elevation,newDisplayElevation:0,sourceLines:road.lines.length,reason:'Source layer is a crossing order, while both connected bank roads use the shared ground datum'});
  }
  // Parallel motor and footway ways may occupy the same physical bridge.
  // Their estimated widths overlap: do not put the motor-way's inner guard
  // across the mapped sidewalk or duplicate a guard inside the adjacent deck.
  const removedRails=new Set();
  for(const bridge of plan.bridges)bridge.rails=bridge.rails.filter(rail=>{
    const footprint=streetFootprint(rail.x,rail.z,rail.length,rail.width,rail.yaw);
    const internal=plan.bridges.some(other=>other.id!==bridge.id&&other.lines.some(line=>line.some((b,i)=>i&&footprint.some(p=>nearest(p,line[i-1],b).distance<other.width/2+.3))));
    if(internal)removedRails.add(rail.id);return !internal;
  });
  plan.barriers=plan.barriers.filter(b=>!removedRails.has(b.id));
  const connector=(id,a,b,width,sourceId,reason)=>{
    if(distance(a,b)<.01)return;
    const polygon=linePolygon(a,b,width),c={id,a,b,width,length:distance(a,b),sourceId,polygon,reason,estimated:true};plan.connectors.push(c);
    plan.walkSurfaces.push({id,sourceId,polygon,surfaceY:FLOOR,kind:'entry-connector',estimated:true});plan.forestExclusions.push([clipRing(polygon)]);
  };
  // Only bridge a bounded gap between two fragments of the same source way.
  // The source geometries stay untouched; the 3.4 m strip is identified as a
  // capture-seam display repair, not a newly surveyed path.
  const seam=roads.find(r=>r.id==='way/1483567253');
  if(seam?.lines.length>1){let best;for(let i=0;i<seam.lines.length;i++)for(let j=i+1;j<seam.lines.length;j++)for(const a of [seam.lines[i][0],seam.lines[i].at(-1)])for(const b of [seam.lines[j][0],seam.lines[j].at(-1)]){const d=distance(a,b);if(d>.05&&d<5&&(!best||d<best.d))best={a,b,d};}if(best)connector('opto-footway-capture-seam',best.a,best.b,seam.profile.width,seam.id,'Short same-way capture seam; endpoints and path direction retained');}
  const ground=optoBuilding?.plan?.groundFloor;
  const areaOf=polygons=>polygons.reduce((sum,p)=>sum+p.reduce((s,r,i)=>s+(i?-1:1)*Math.abs(r.reduce((a,q,k)=>{const n=r[(k+1)%r.length];return a+q[0]*n[1]-n[0]*q[1];},0)/2),0),0);
  // Separate source paths on each SIDE of the real building. Reusing the west
  // footway for the east entrance would draw an impossible path through rooms.
  for(const [key,id,roadId]of [['college','opto-c-entry-approach','way/1483567204'],['east','opto-c-east-approach','way/1483567206'],['rear','opto-rear-entry-approach','way/1483567205']]){
    const door=key==='rear'?optoBuilding?.plan?.rear:ground?.[key],footway=roads.find(r=>r.id===roadId);if(!door||!footway)continue;
    const end={x:door.x+door.nx*1.5,z:door.z+door.nz*1.5};let best;
    for(const line of footway.lines)for(let i=1;i<line.length;i++){const q=nearest(end,line[i-1],line[i]);if(!best||q.distance<best.distance)best=q;}
    if(best&&best.distance<(key==='rear'?18:12)){
      const path=[clipRing(linePolygon(best,end,3))],source=optoBuilding.plan.sourceFootprint;
      const overlap=source?.length?areaOf(polygonClipping.intersection(source,path)):0;
      if(overlap>.08){plan.diagnostics.push({id,reason:'Rejected: doorway approach crosses the source building footprint',overlap});continue;}
      connector(id,best,end,3,footway.id,`User-confirmed ${key} access topology; exact door coordinates and this bounded paving connector remain estimated`);
    }
  }
  for(const s of optoBuilding?.infrastructure?.walkSurfaces||[])if(s.polygon?.length)plan.forestExclusions.push([clipRing(s.polygon),...(s.holes||[]).map(clipRing)]);
  plan.accepted=!!plan.bridges.length;
  return plan;
}

/** Bounded, static detail layer. Draw geometry and walk/rail colliders share one
 * plan; no original road, water, terrain or building feature is rewritten. */
export function createOptoApproach(THREE,model,options={}){
  const plan=planOptoApproach(model,options),group=new THREE.Group();group.name='光电接岸桥与入口步行接驳';group.userData={component:'opto-approach',...plan.evidence};
  const geometries=new Set(),materials=new Set(),batches=new Map(),dummy=new THREE.Object3D();let disposed=false;
  const makeMat=(color,roughness=.9,metalness=0)=>{const m=new THREE.MeshStandardMaterial({color,roughness,metalness});materials.add(m);return m;};
  const asphalt=options.surfaces?.asphalt||makeMat('#737a73'),paving=options.surfaces?.paving||makeMat('#b9b5a5'),edge=makeMat('#989e94'),rail=makeMat('#8c989d',.47,.42);
  const boxGeo=new THREE.BoxGeometry(1,1,1);geometries.add(boxGeo);
  function box(name,m,x,y,z,w,h,d,yaw=0){const key=name+'/'+m.uuid;if(!batches.has(key))batches.set(key,{name,material:m,items:[]});dummy.position.set(x,y,z);dummy.rotation.set(0,yaw,0);dummy.scale.set(w,h,d);dummy.updateMatrix();batches.get(key).items.push(dummy.matrix.clone());}
  const slabs=new Map();
  function slab(polygons,material,top,depth,name){
    if(!slabs.has(material))slabs.set(material,{items:[],name});
    for(const poly of polygons){const shape=new THREE.Shape(poly[0].map(([x,z])=>new THREE.Vector2(x,-z)));shape.holes=poly.slice(1).map(r=>new THREE.Path(r.map(([x,z])=>new THREE.Vector2(x,-z))));const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:1});g.rotateX(-Math.PI/2);g.translate(0,top-depth,0);applyWorldUV(g);slabs.get(material).items.push(g);}
  }
  for(const bridge of plan.bridges){
    slab(bridge.polygons,bridge.motor?asphalt:paving,FLOOR+(bridge.motor?.002:0),.18,'opto-level-bank-deck');
    for(const r of bridge.rails){
      box('opto-low-bridge-edge',edge,r.x,FLOOR+.065,r.z,r.length,.13,.14,r.yaw);
      // The close photographs show a broad grey cap, a lower frame and dense
      // upright infill. Keep all geometry inside the existing rail envelope;
      // changing its appearance must not narrow a doorway or bridge junction.
      for(const [h,thickness,depth] of [[.23,.045,.06],[.92,.045,.06],[1.045,.07,.085]])box('opto-low-bridge-horizontal-rails',rail,r.x,FLOOR+h,r.z,r.length,thickness,depth,r.yaw);
      for(const side of[-1,1])box('opto-low-bridge-rail-posts',rail,r.x+Math.cos(r.yaw)*r.length*.45*side,FLOOR+.56,r.z-Math.sin(r.yaw)*r.length*.45*side,.075,1.04,.075,r.yaw);
      const infillCount=Math.max(2,Math.floor(r.length/.19));
      for(let i=1;i<infillCount;i++){const along=(i/infillCount-.5)*r.length*.9;box('opto-low-bridge-rail-posts',rail,r.x+Math.cos(r.yaw)*along,FLOOR+.575,r.z-Math.sin(r.yaw)*along,.022,.69,.028,r.yaw);}
    }
  }
  for(const c of plan.connectors)slab([[clipRing(c.polygon)]],paving,FLOOR+.002,.1,'opto-entry-connector-paving');
  for(const [material,{items,name}]of slabs){const g=mergeGeometries(items,false);items.forEach(x=>x.dispose());geometries.add(g);const mesh=new THREE.Mesh(g,material);mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=false;mesh.userData={component:name,estimated:true};group.add(mesh);}
  for(const {name,material,items}of batches.values()){const mesh=new THREE.InstancedMesh(boxGeo,material,items.length);items.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.name=name;mesh.castShadow=false;mesh.receiveShadow=true;mesh.userData={component:name,estimated:true,instanceCount:items.length};group.add(mesh);}
  const fine=group.getObjectByName('opto-low-bridge-rail-posts'),points=plan.bridges.flatMap(b=>b.lines.flat());
  function update(camera,{detailDistanceScale=1}={}){if(!fine)return;const p=camera?.position||camera;fine.visible=!p||points.some(q=>(p.x-q.x)**2+(p.z-q.z)**2<(230*detailDistanceScale)**2);}
  function dispose(){if(disposed)return;disposed=true;group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.removeFromParent();group.clear();}
  return{group,plan,infrastructure:{replacedRoadIds:plan.replacedRoadIds,barriers:plan.barriers,walkSurfaces:plan.walkSurfaces},forestExclusions:plan.forestExclusions,update,dispose};
}
