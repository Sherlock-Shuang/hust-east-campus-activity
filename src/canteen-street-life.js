import {createTreeLayer} from './vegetation.js';
import {createPlayerWorld} from './player-experience.js';
import {getRoadProfile} from './building-profiles.js';
import {streetFootprint} from './street-clearance.js';
import {footprintIntersectsRing} from './yunyuan-parking.js';
import {planYunyuanSouthPrecinct} from './yunyuan-south-precinct.js';

export const CANTEEN_STREET_SOURCES=Object.freeze({building:'way/103757021',road:'way/98831423',walk:'way/1483567174',stairs:['way/110398904','way/110398907']});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const random=n=>{const x=Math.sin(n*127.1+81.19)*43758.5453;return x-Math.floor(x);};
function inside(p,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)hit=!hit;}return hit;}
function segmentDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);}
const edgeDistance=(p,ring)=>Math.min(...ring.map((a,i)=>segmentDistance(p,a,ring[(i+1)%ring.length])));
function atZ(line,z){for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i];if(z<Math.min(a.z,b.z)||z>Math.max(a.z,b.z))continue;const t=(z-a.z)/(b.z-a.z);return{x:a.x+(b.x-a.x)*t,z,yaw:-Math.atan2(b.x-a.x,b.z-a.z),tx:(b.x-a.x)/distance(a,b),tz:(b.z-a.z)/distance(a,b)};}return null;}
function disk(x,z,r,n=12){return Array.from({length:n},(_,i)=>({x:x+Math.cos(i/n*Math.PI*2)*r,z:z+Math.sin(i/n*Math.PI*2)*r}));}

/** The photograph guides form and density, not surveyed positions. Every new
 * trunk and complete scooter footprint is checked against the final campus.
 * The mapped 2.4 m footway stays completely empty, including all eight walkers. */
export function planCanteenStreetLife(model,{frame,geoToLocal,southPlan,existingTrees=[],existingParking=[],reserved=[],groundAt}={}){
  const plan={id:'canteen-street',accepted:false,sources:CANTEEN_STREET_SOURCES,trees:[],parking:[],lamps:[],barriers:[],dapplePatches:[],viewpoints:{},evidence:{photo:'4e2948926e9e705d9346beda566ad0ed.jpg',basis:'user photograph: broad overlapping plane-tree crowns, forked mottled trunks, white bases and loose angled scooter clusters',dimensions:'photo-informed estimates; source geometries unchanged'}};
  if(!frame||typeof geoToLocal!=='function'||!model?.records)return plan;
  const south=southPlan??planYunyuanSouthPrecinct(model,{frame,geoToLocal});if(!south.accepted)return plan;
  const project=c=>{const p=geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);return{x:p.x,z:p.z};};
  const roads=model.records.filter(r=>r.feature?.geometry?.type==='LineString'&&r.feature.properties?.tags?.highway).map(r=>({id:r.id,points:r.feature.geometry.coordinates.map(project),...getRoadProfile(r.feature)}));
  const main=roads.find(r=>r.id===CANTEEN_STREET_SOURCES.road),walk=roads.find(r=>r.id===CANTEEN_STREET_SOURCES.walk);if(!main||!walk)return plan;
  const world=createPlayerWorld(model),blocks=[...world.buildings.filter(b=>b.id!==south.sourceId),...south.buildings,...world.barriers,...world.water,...south.barriers,...(reserved||[])].filter(b=>!String(b.id).startsWith('canteen-street-')).map(b=>({rings:b.rings??(b.polygon?[b.polygon]:[]),height:b.height,minHeight:b.minHeight??0,water:world.water.includes(b)})).filter(b=>b.rings[0]?.length>=3&&(b.water||b.height===undefined||b.height>.14&&b.minHeight<2.4));
  // Approaches and stairs remain clear at every elevation, including their
  // ground-level mouths, rather than merely testing nearby wall columns.
  const reservedSurfaces=south.walkSurfaces.filter(s=>/stair|approach/.test(s.kind));
  const trunkClear=(p,r=.55)=>{
    if(blocks.some(b=>(inside(p,b.rings[0])&&!b.rings.slice(1).some(h=>inside(p,h)))||b.rings.some(ring=>edgeDistance(p,ring)<r+.15)))return false;
    if(reservedSurfaces.some(s=>inside(p,s.polygon)||edgeDistance(p,s.polygon)<r+.65))return false;
    if(roads.some(road=>!road.bridge&&!road.tunnel&&road.points.slice(1).some((b,i)=>segmentDistance(p,road.points[i],b)<road.width/2+r+.16)))return false;
    if(existingTrees.some(t=>distance(t,p)<(t.trunkRadius??.45)+r+1.2))return false;
    if(existingParking.some(t=>distance(t,p)<1.65+r))return false;
    if(groundAt){const g=groundAt(p.x,p.z,r,.14);if(!g.allowed||Math.abs(g.height-.14)>.12)return false;}
    return true;
  };
  const occupied=existingParking.map(p=>streetFootprint(p.x,p.z,1.18,2.36,p.yaw??0));
  const offsets=[-6.75,6.85,-8.15,8.3,-9.3,10.0];
  const planting=[151,160,181,190,199,208,217,229,246,258,279,302,326,340];
  for(const [i,z]of planting.entries())for(const side of[-1,1]){
    if(z>270&&side<0&&i%2===1)continue;
    for(const dz of[0,2.2,-2.3,4.1]){
      const onRoad=atZ(main.points,z+dz);if(!onRoad)continue;
      let placed=false;
      for(const off of offsets.filter(o=>Math.sign(o)===side)){
        const p={x:onRoad.x+off,z:onRoad.z};
        if(!trunkClear(p,.53)||plan.trees.some(t=>distance(t,p)<6.4))continue;
        const seed=random(i*29+side+200),t={...p,y:.14,id:`canteen-street-tree-${plan.trees.length}`,featureId:CANTEEN_STREET_SOURCES.road,sourceRoadId:CANTEEN_STREET_SOURCES.road,height:12.8+seed*3.7,radius:8.7+random(i+102+side)*1.5,trunkRadius:.53,form:'spreading',seed,estimated:true};
        plan.trees.push(t);plan.barriers.push({id:t.id,sourceId:CANTEEN_STREET_SOURCES.road,polygon:disk(t.x,t.z,.53),minHeight:.14,height:3.6,label:'食堂沿街树干',estimated:true});placed=true;break;
      }
      if(placed)break;
    }
  }
  // Loose pockets leave wide breaks by both stair mouths, loop turnarounds,
  // junctions, and trees. They do not fill the entire frontage with a grid.
  const pockets=[[151,164],[177,196],[201,222],[228,233],[245,256]];
  for(const [cluster,[lo,hi]]of pockets.entries())for(const side of[-1,1]){
    let slot=0,accepted=0;for(let z=lo+.5;z<hi-.8&&accepted<4;z+=1.48+random(cluster*23+slot*9)*.7,slot++){
      const road=atZ(main.points,z);if(!road)continue;
      const key=cluster*93+slot*17+(side+1)*43,yaw=side*Math.PI*.43+(random(key+6)-.5)*.55+(random(key+7)<.17?Math.PI:0);
      const candidates=(side<0?[-6.65,-6.95,-7.25,-13.9,-15.4]:[6.2,8.1,10.4]).map(off=>({x:road.x+off+(random(key+1)-.5)*.5,z:z+(random(key+3)-.5)*.55}));
      for(const p of candidates){
        const poly=streetFootprint(p.x,p.z,1.15,2.36,yaw),samples=[p,...poly,...poly.map((a,i)=>({x:(a.x+poly[(i+1)%4].x)/2,z:(a.z+poly[(i+1)%4].z)/2}))];
        if(blocks.some(b=>footprintIntersectsRing(poly,b.rings[0]))||reservedSurfaces.some(s=>footprintIntersectsRing(poly,s.polygon)))continue;
        if(samples.some(q=>roads.some(r=>!r.bridge&&!r.tunnel&&r.points.slice(1).some((b,i)=>segmentDistance(q,r.points[i],b)<r.width/2+.19))))continue;
        if([...existingTrees,...plan.trees].some(t=>inside(t,poly)||edgeDistance(t,poly)<(t.trunkRadius??.45)+.3))continue;
        if(occupied.some(r=>footprintIntersectsRing(poly,r)))continue;
        if(groundAt&&samples.some(q=>{const g=groundAt(q.x,q.z,.05,.14);return!g.allowed||Math.abs(g.height-.14)>.1;}))continue;
        const id=96000+plan.parking.length,boardingPose={x:p.x+Math.cos(yaw)*.98,z:p.z-Math.sin(yaw)*.98,y:.14,yaw,mode:'walk',view:'first'};
        plan.parking.push({...p,y:.161,yaw,id,colorIndex:Math.floor(random(key+19)*8),activityId:id,activityRegion:'canteen-street',clusterId:`canteen-${cluster}-${side}`,buildingSourceId:south.sourceId,sourceRoadId:main.id,estimated:true,steeringAngle:(random(key+8)-.5)*.45,lean:(random(key+9)-.5)*.04,footprintWidth:1.05,footprintLength:2.24,boardingPose,locationEvidence:'photograph-informed inferred kerb/forecourt parking; not mapped inventory'});
        occupied.push(poly);accepted++;break;
      }
    }
  }
  for(const targetZ of[166,213,248,303]){
    let placed=false;
    for(const dz of[0,3,-3,5.5]){
    const z=targetZ+dz,road=atZ(main.points,z);if(!road)continue;
    for(const off of[6.2,8.4,-6.8,-9.5,-14.8]){
      const p={x:road.x+off,z};if(!trunkClear(p,.22)||plan.trees.some(t=>distance(t,p)<1.8)||occupied.some(poly=>inside(p,poly)||edgeDistance(p,poly)<.55))continue;
      const lamp={...p,id:`canteen-street-lamp-${plan.lamps.length}`,y:.14,height:5.1,poolX:road.x+Math.sign(off)*1.8,poolZ:z};plan.lamps.push(lamp);plan.barriers.push({id:lamp.id,polygon:disk(p.x,p.z,.16),minHeight:.14,height:5.24,label:'食堂沿街灯杆',estimated:true});placed=true;break;
    }if(placed)break;
    }
  }
  // Ground masks sit on the actual source road/pavement tops. They are not a
  // raised transparent rectangle spanning stairs, buildings or the grass.
  const groundRoads=roads.filter(r=>[main.id,walk.id,'way/1483567170','way/1483567180','way/1483567175','way/1483567176'].includes(r.id));
  for(const road of groundRoads)for(let z=Math.max(148,Math.ceil(Math.min(...road.points.map(p=>p.z))));z<Math.min(345,Math.max(...road.points.map(p=>p.z)))-2;z+=2){
    const a=atZ(road.points,z),b=atZ(road.points,z+2);if(!a||!b)continue;
    const d=distance(a,b),nx=-(b.z-a.z)/d*(road.width/2-.018),nz=(b.x-a.x)/d*(road.width/2-.018);
    plan.dapplePatches.push({polygon:[{x:a.x+nx,z:a.z+nz},{x:a.x-nx,z:a.z-nz},{x:b.x-nx,z:b.z-nz},{x:b.x+nx,z:b.z+nz}],y:.14+(road.motor?.002:0)+.007,sourceId:road.id});
  }
  // The open lower forecourt is the unbuilt eastern part of the original
  // canteen outline. Its render datum is the GIS base (+.015), below the road
  // kerbs; reject stair treads, walls and columns before laying small tiles.
  const boundary=south.boundary;
  for(let x=Math.floor(Math.min(...boundary.map(p=>p.x)));x<Math.max(...boundary.map(p=>p.x));x+=1.5)for(let z=158;z<248;z+=1.5){
    const poly=streetFootprint(x+.75,z+.75,1.5,1.5);
    if(!poly.every(p=>inside(p,boundary)))continue;
    if(blocks.some(b=>footprintIntersectsRing(poly,b.rings[0]))||reservedSurfaces.some(s=>footprintIntersectsRing(poly,s.polygon)))continue;
    plan.dapplePatches.push({polygon:poly,y:.022,sourceId:south.sourceId,surfaceType:'open-lower-forecourt'});
  }
  const gallery=south.galleries.find(g=>g.length>40),galleryPoint=gallery?atZ([gallery.a,gallery.b],228):null;
  const view=atZ(main.points,263),nearView=atZ(main.points,246),north=atZ(main.points,184);
  plan.viewpoints={canteenStreet:{x:view.x+.6,z:263,y:.14,yaw:.14,mode:'walk',view:'first'},canteenStreetNear:{x:nearView.x+.8,z:246,y:.14,yaw:.14,mode:'walk',view:'first'},canteenStreetSouth:{x:north.x-.6,z:184,y:.14,yaw:Math.PI+.12,mode:'walk',view:'first'},canteenStreetGallery:{x:(galleryPoint?.x??483)+.55,z:228,y:south.galleryY,yaw:-.42,mode:'walk',view:'first'}};
  plan.accepted=plan.trees.length>0;plan.counts={trees:plan.trees.length,parking:plan.parking.length,lamps:plan.lamps.length};return plan;
}

const noiseGLSL=`
float csHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float csNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(csHash(i),csHash(i+vec2(1.,0.)),f.x),mix(csHash(i+vec2(0.,1.)),csHash(i+vec2(1.)),f.x),f.y);}
`;
function barkMaterial(THREE){
  const m=new THREE.MeshStandardMaterial({color:'#a19c83',roughness:1});
  m.onBeforeCompile=s=>{s.vertexShader='varying vec3 csBark;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ncsBark=position;');s.fragmentShader='varying vec3 csBark;\n'+noiseGLSL+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
float bark=csNoise(csBark.xz*13.+vec2(csBark.y*3.1,csBark.y*.8));
float barkPatch=smoothstep(.40,.53,bark);diffuseColor.rgb*=mix(vec3(.38,.39,.32),vec3(1.04,1.01,.85),barkPatch);`);};m.customProgramCacheKey=()=> 'canteen-plane-bark-v1';return m;
}

// Enlarged mature crowns need smaller individual leaf silhouettes than the
// generic campus spray. Rasterize only leaf bounds, sharing one mipmapped mask
// across every near/far material rather than adding per-leaf meshes or draws.
function fineCanopyTexture(THREE){
  const size=256,data=new Uint8Array(size*size*4);
  for(let i=0;i<640;i++){
    const a=random(i*17+4)*Math.PI*2,r=Math.sqrt(random(i*17+5))*.445,cx=.5+Math.cos(a)*r,cy=.5+Math.sin(a)*r;
    const rx=.015+random(i*17+6)*.011,ry=.009+random(i*17+7)*.009,angle=random(i*17+8)*Math.PI,c=Math.cos(angle),s=Math.sin(angle),span=Math.max(rx,ry)*1.1;
    for(let y=Math.max(0,Math.floor((cy-span)*size));y<Math.min(size,Math.ceil((cy+span)*size));y++)for(let x=Math.max(0,Math.floor((cx-span)*size));x<Math.min(size,Math.ceil((cx+span)*size));x++){
      const dx=(x+.5)/size-cx,dy=(y+.5)/size-cy,u=(dx*c+dy*s)/rx,v=(-dx*s+dy*c)/ry,d=u*u+v*v;
      if(d>=1)continue;const index=(y*size+x)*4,shade=Math.round(255*(.78+random(i*17+9)*.22)*(.92+.08*Math.sqrt(1-d)));
      data[index]=data[index+1]=data[index+2]=shade;data[index+3]=Math.max(data[index+3],Math.round(Math.min(1,(1-d)*12)*255));
    }
  }
  for(let y=124;y<132;y++)for(let x=124;x<132;x++)data.set([255,255,255,255],(y*size+x)*4);
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;return texture;
}

export function createCanteenStreetLife(THREE,model,options={}){
  const plan=planCanteenStreetLife(model,options),group=new THREE.Group();group.name='canteen-street-life';group.userData={component:'canteen-street-life',...plan.evidence};
  const infrastructure={barriers:plan.barriers,viewpoints:plan.viewpoints},geometries=new Set(),materials=new Set(),textures=new Set();let disposed=false,mode='day';
  const bark=barkMaterial(THREE);materials.add(bark);
  const treeLayer=createTreeLayer(THREE,plan.trees,{name:'canteen-street-canopy',detail:'street',whitewash:true,barkMaterial:bark});group.add(treeLayer.group);
  // The precomputed ground mask works in smooth quality too; thousands of
  // tiny alpha-cutout leaves never enter the dynamic shadow pass.
  const leafMask=fineCanopyTexture(THREE);textures.add(leafMask);
  treeLayer.group.traverse(o=>{if(o.isMesh){o.castShadow=false;if(o.material.map){o.material.map=leafMask;o.material.needsUpdate=true;}}});
  const positions=[],weights=[];
  for(const patch of plan.dapplePatches)for(const i of[0,2,1,0,3,2]){
    const p=patch.polygon[i];positions.push(p.x,patch.y,p.z);
    weights.push(Math.min(1,plan.trees.reduce((v,t)=>v+Math.max(0,1-distance(p,t)/(t.radius*1.55)),0)));
  }
  const groundGeo=new THREE.BufferGeometry();groundGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));groundGeo.setAttribute('canopyWeight',new THREE.Float32BufferAttribute(weights,1));groundGeo.computeVertexNormals();geometries.add(groundGeo);
  const strength={value:.46},warmth={value:0},nightStrength={value:0};
  function groundMaterial(pool){
    const m=new THREE.MeshBasicMaterial({color:pool?'#ffce83':'#243528',transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    m.onBeforeCompile=s=>{
      s.uniforms.csStrength=pool?nightStrength:strength;s.uniforms.csWarmth=warmth;
      s.vertexShader='attribute float canopyWeight; varying vec2 csWorld; varying float csWeight;\n'+s.vertexShader;
      s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ncsWorld=position.xz;csWeight=canopyWeight;');
      s.fragmentShader='varying vec2 csWorld; varying float csWeight; uniform float csStrength; uniform float csWarmth;\n'+noiseGLSL+s.fragmentShader;
      const pools=plan.lamps.map(p=>`glow=max(glow,pow(max(0.,1.-distance(csWorld,vec2(${p.poolX.toFixed(4)},${p.poolZ.toFixed(4)}))/6.2),1.65));`).join('\n');
      s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',pool?`#include <color_fragment>\nfloat glow=0.;${pools}\ndiffuseColor.a=glow*csStrength;`:`#include <color_fragment>
float broad=csNoise(csWorld*.36);float leaves=csNoise(csWorld*2.6+vec2(12.4,7.1));
float aa=max(fwidth(leaves)*1.35,.035);float shade=smoothstep(.38-aa,.56+aa,leaves+broad*.22);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.28,.17,.08),csWarmth);diffuseColor.a=csStrength*csWeight*(.22+.78*shade);`);
    };m.customProgramCacheKey=()=>pool?'canteen-ground-pool-v1':'canteen-world-dapple-v1';materials.add(m);return m;
  }
  const dapple=new THREE.Mesh(groundGeo,groundMaterial(false));dapple.name='canteen-world-fixed-dapple';dapple.renderOrder=203;dapple.userData={component:dapple.name,worksWithoutShadows:true,worldFixed:true};group.add(dapple);
  const pools=new THREE.Mesh(groundGeo,groundMaterial(true));pools.name='canteen-warm-ground-pools';pools.renderOrder=204;pools.visible=false;group.add(pools);
  const poleMaterial=new THREE.MeshStandardMaterial({color:'#465247',roughness:.7,metalness:.45}),bulbMaterial=new THREE.MeshStandardMaterial({color:'#f0dfb5',emissive:'#ffd18a',emissiveIntensity:.08,roughness:.4});materials.add(poleMaterial);materials.add(bulbMaterial);
  const cylinder=new THREE.CylinderGeometry(1,1,1,7),bulb=new THREE.SphereGeometry(1,8,6);geometries.add(cylinder);geometries.add(bulb);
  const dummy=new THREE.Object3D();
  for(const [name,g,m,size,y]of[['poles',cylinder,poleMaterial,[.08,5.1,.08],2.55],['caps',cylinder,poleMaterial,[.48,.14,.48],5.05],['bulbs',bulb,bulbMaterial,[.29,.19,.29],4.85]]){
    const mesh=new THREE.InstancedMesh(g,m,plan.lamps.length);mesh.name=`canteen-lamp-${name}`;for(const [i,p]of plan.lamps.entries()){dummy.position.set(p.x,p.y+y,p.z);dummy.scale.set(...size);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}mesh.computeBoundingSphere();group.add(mesh);
  }
  function setTimeOfDay(next){mode=['day','sunset','night'].includes(next)?next:'day';strength.value=mode==='day'?.46:mode==='sunset'?.19:0;warmth.value=mode==='sunset'?1:0;nightStrength.value=mode==='night'?.68:mode==='sunset'?.12:0;bulbMaterial.emissiveIntensity=mode==='night'?4.2:mode==='sunset'?.65:.08;dapple.visible=mode!=='night';pools.visible=mode!=='day';group.userData.timeOfDay=mode;}
  function update(camera,{detailDistanceScale=1}={}){if(disposed)return;treeLayer.update(camera,{detailDistanceScale});const p=camera?.position;const near=!p||Math.hypot(p.x-510,p.z-235)<300*detailDistanceScale;dapple.visible=near&&mode!=='night';pools.visible=near&&mode!=='day';}
  function dispose(){if(disposed)return;disposed=true;treeLayer.dispose();group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.removeFromParent();group.clear();}
  setTimeOfDay('day');return{group,plan,infrastructure,viewpoints:plan.viewpoints,update,setTimeOfDay,dispose,counts:plan.counts};
}
