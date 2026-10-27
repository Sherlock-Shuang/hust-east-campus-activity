import polygonClipping from 'polygon-clipping';
import {getRoadProfile} from './building-profiles.js';
import {getReconstructionBuildings} from './campus-feature-selection.js';
import {createTreeLayer,createShrubLayer} from './vegetation.js';
import {applyWorldUV} from './surface-materials.js';

export const CAMPUS_VEGETATION_EVIDENCE = Object.freeze({
  coverage: 'Unmodified OSM woodland / tree_row / grass / meadow / scrub / garden / flowerbed geometries',
  photographs: [
    'local:截屏2026-10-06 20.18.20.png',
    'local:截屏2026-10-06 20.21.05.png',
    'local:截屏2026-10-06 20.22.07.png',
    'https://imagepphcloud.thepaper.cn/pph/image/249/995/888.jpg',
    'https://www.hust.edu.cn/__local/3/FF/51/51FF1DE2B5C1474E5782E3FF2E8_06E626A5_5F265.jpg',
  ],
  observed: 'Local street photographs show broad, dense mature crowns and whitewashed forked trunks; lake-side trees alternate narrower tiered forms with broad crowns. Open lawns and fine-leaved low shrubs remain separate layers. Individual species and spatial densities are inferred.',
  inferred: 'Individual tree positions, species, 6–17 m height, canopy diameters, understory distribution and lawn material are display estimates, not a tree survey.',
});

function seeded(id) {let s=2166136261;for(const c of id)s=Math.imul(s^c.charCodeAt(0),16777619);return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
const sqSegment=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l)):0;return(x-a[0]-dx*t)**2+(z-a[1]-dz*t)**2;};
export function pointInLandcover(x,z,polygons) {
  const inside=ring=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
  return polygons.some(poly=>inside(poly[0])&&!poly.slice(1).some(inside));
}
function bounds(polygons){const p=polygons.flat(2);return{minX:Math.min(...p.map(v=>v[0])),maxX:Math.max(...p.map(v=>v[0])),minZ:Math.min(...p.map(v=>v[1])),maxZ:Math.max(...p.map(v=>v[1]))};}
function intersects(a,b,pad=0){return a.minX-pad<=b.maxX&&a.maxX+pad>=b.minX&&a.minZ-pad<=b.maxZ&&a.maxZ+pad>=b.minZ;}
function sourcePolygons(r){return(r.shapes||[]).map(s=>[s.getPoints().map(p=>[p.x,-p.y]),...s.holes.map(h=>h.getPoints().map(p=>[p.x,-p.y]))]);}
function kindFor(r){const t=r.feature.properties?.tags||{};return t.natural==='tree_row'?'row':t.natural==='wood'||t.landuse==='forest'?'wood':t.natural==='scrub'?'scrub':t.landuse==='flowerbed'?'bed':t.leisure==='garden'?'garden':['grass','meadow'].includes(t.landuse)?'lawn':null;}
function polygonArea(polys){const area=r=>Math.abs(r.reduce((a,p,i)=>{const q=r[(i+1)%r.length];return a+p[0]*q[1]-q[0]*p[1];},0)/2);return polys.reduce((n,p)=>n+area(p[0])-p.slice(1).reduce((s,r)=>s+area(r),0),0);}
function capsule(a,b,r){const angle=Math.atan2(b[1]-a[1],b[0]-a[0]),ring=[];for(let k=0;k<=4;k++){const theta=angle-Math.PI/2+k*Math.PI/4;ring.push([b[0]+Math.cos(theta)*r,b[1]+Math.sin(theta)*r]);}for(let k=0;k<=4;k++){const theta=angle+Math.PI/2+k*Math.PI/4;ring.push([a[0]+Math.cos(theta)*r,a[1]+Math.sin(theta)*r]);}return[ring];}

/** Source-constrained planting plan. This does not change source geometry, road
 * width or ground elevations. It also excludes sports/parking, which the old
 * woodland-only sampler omitted. Park labels alone do not imply a planted lawn. */
export function planCampusLandcover(model,{frame,geoToLocal,maxTrees=7800,maxShrubs=1500,photoOpenLawns=[]}={}){
  if(!model?.records||!frame||typeof geoToLocal!=='function')throw new TypeError('Source model and projection required');
  const local=c=>{const p=geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);return[p.x??p.east,p.z??-p.north];};
  const obstacles=[],cells=new Map(),cellSize=35,coverages=[],trees=[],shrubs=[];
  function addObstacle(polygons,margin,category,id){if(!polygons.length)return;const box=bounds(polygons),o={polygons,margin,category,id,bounds:box};obstacles.push(o);for(let x=Math.floor((box.minX-margin)/cellSize);x<=Math.floor((box.maxX+margin)/cellSize);x++)for(let z=Math.floor((box.minZ-margin)/cellSize);z<=Math.floor((box.maxZ+margin)/cellSize);z++){const k=`${x}/${z}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(o);}}
  const buildingIds=new Set(getReconstructionBuildings(model).map(r=>r.id));
  for(const r of model.records){
    const t=r.feature.properties?.tags||{},category=buildingIds.has(r.id)?'building':r.category;
    if(['building','water','sports','road'].includes(category)||t.amenity==='parking')addObstacle(sourcePolygons(r),category==='building'?2.8:category==='sports'?1.1:.65,category,r.id);
    if(r.category==='road'&&!r.shapes?.length){const g=r.feature.geometry,lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[],w=getRoadProfile(r.feature).width;
      for(const line of lines){const pts=line.map(local);for(let i=1;i<pts.length;i++)addObstacle([capsule(pts[i-1],pts[i],w/2)],1.25,'road',r.id);}
    }
  }
  for(const [index,surface]of(model.sportsInfrastructure?.walkSurfaces||[]).entries()){
    if(!surface.polygon?.length)continue;
    addObstacle([[surface.polygon.map(p=>[p.x,p.z]),...(surface.holes||[]).map(r=>r.map(p=>[p.x,p.z]))]],.35,'sports-access',`sports-walk-${index}`);
  }
  function blocked(x,z,radius=0){
    const reach=Math.ceil(radius/cellSize),cx=Math.floor(x/cellSize),cz=Math.floor(z/cellSize),seen=new Set();
    for(let ix=-reach;ix<=reach;ix++)for(let iz=-reach;iz<=reach;iz++)for(const o of cells.get(`${cx+ix}/${cz+iz}`)||[]){if(seen.has(o))continue;seen.add(o);if(pointInLandcover(x,z,o.polygons))return true;const m=o.margin+radius;for(const p of o.polygons)for(const ring of p)for(let i=0;i<ring.length;i++)if(sqSegment(x,z,ring[i],ring[(i+1)%ring.length])<m*m)return true;}return false;
  }
  const treeCells=new Map();
  function addTree(p){if(trees.length>=maxTrees||blocked(p.x,p.z))return false;const cx=Math.floor(p.x/6),cz=Math.floor(p.z/6);for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)for(const t of treeCells.get(`${cx+x}/${cz+z}`)||[])if((p.x-t.x)**2+(p.z-t.z)**2<(((p.spacing||5.1)+(t.spacing||5.1))*.5)**2)return false;trees.push(p);const key=`${cx}/${cz}`;if(!treeCells.has(key))treeCells.set(key,[]);treeCells.get(key).push(p);return true;}
  const sources=model.records.filter(r=>kindFor(r));
  const largeWoods=sources.filter(r=>kindFor(r)==='wood'&&(r.flatArea||0)>80000);
  const smallTreeBudget=sources.filter(r=>kindFor(r)==='wood'&&(r.flatArea||0)<=80000).reduce((sum,r)=>sum+Math.floor((r.flatArea||0)/58),0);
  const largeWeight=largeWoods.reduce((sum,r)=>sum+Math.sqrt(r.flatArea),0);
  // Reserve a share for EVERY large wood, including the last northern polygon.
  // A global first-come cap previously left it entirely bare.
  const largeQuotas=new Map(largeWoods.map(r=>[r.id,Math.floor(Math.max(0,maxTrees-smallTreeBudget-250)*Math.sqrt(r.flatArea)/largeWeight)]));
  // Small campus planting patches retain detail before the large northern woods
  // consume the bounded instance budget. Sampling stays deterministic per source.
  sources.sort((a,b)=>(kindFor(a)==='row'?-1:0)-(kindFor(b)==='row'?-1:0)||(a.flatArea||0)-(b.flatArea||0)||a.id.localeCompare(b.id));
  for(const r of sources){
    const kind=kindFor(r),rng=seeded(r.id),polygons=sourcePolygons(r),featureId=r.id,evidence={featureId,sourceUrl:r.feature.properties?.sourceUrl,positionStatus:kind==='row'?'sampled-on-source-tree-row':'sampled-inside-source-planting-polygon',dimensionsStatus:'photo-informed estimate'};
    if(kind==='row'){
      const g=r.feature.geometry,lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
      for(const line of lines){const pts=line.map(local);let carry=3.5;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);while(carry<l){const v=carry/l;addTree({x:a[0]+(b[0]-a[0])*v,z:a[1]+(b[1]-a[1])*v,y:.025,height:9.5+rng()*4,radius:3.15+rng()*1.55,seed:rng(),form:rng()<.72?'spreading':'oval',ageClass:'mature-row',...evidence});carry+=7.3+rng()*1.5;}carry-=l;}}continue;
    }
    if(!polygons.length)continue;
    const box=bounds(polygons),candidates=obstacles.filter(o=>intersects(box,o.bounds)),cuts=candidates.flatMap(o=>o.polygons);
    const clipped=cuts.length?polygonClipping.difference(polygons,...cuts):polygons;
    if(!clipped.length)continue;
    const coverage={featureId,kind,polygons:clipped,sourcePolygons:polygons,bounds:bounds(clipped),area:polygonArea(clipped),evidence};coverages.push(coverage);
    const area=coverage.area,desired=kind==='wood'?(largeQuotas.get(r.id)??Math.floor(area/58)):0;
    // Continuous deterministic density field produces groves, small clearings
    // and younger gaps inside the SAME source woodland, without a regular grid.
    const phase=rng()*Math.PI*2,densityAt=(x,z)=>.58+.19*Math.sin(x*.041+phase)*Math.cos(z*.033-phase)+.15*Math.sin(x*.087+z*.059+phase);
    for(let attempt=0,n=0;attempt<desired*45&&n<desired&&trees.length<maxTrees;attempt++){
      const x=box.minX+rng()*(box.maxX-box.minX),z=box.minZ+rng()*(box.maxZ-box.minZ);if(!pointInLandcover(x,z,clipped))continue;
      const density=densityAt(x,z);if(rng()>density)continue;
      const age=rng(),young=age<.16,height=young?6+age*13:9.4+age*7.3,form=['spreading','oval','upright'][Math.floor(rng()*3)],spacing=young?3.7:4.3+age*1.4;
      if(addTree({x,z,y:.025,height,radius:form==='upright'?(young?1.7:2.4)+age*1.1:(young?2.1:3.5)+age*2.1,spacing,seed:rng(),form,ageClass:young?'young':'mature',densityStatus:'patchy distribution inferred within source woodland',...evidence}))n++;
    }
    // Lawn/meadow is deliberately open. Low forms are restricted to explicit
    // scrub, garden/flowerbed, and a sparse understory inside small woodland.
    const desiredShrubs=kind==='lawn'?0:Math.min(kind==='wood'?70:180,Math.floor(area/(kind==='wood'?220:24)));
    for(let attempt=0,n=0;attempt<desiredShrubs*30&&n<desiredShrubs&&shrubs.length<maxShrubs;attempt++){
      const x=box.minX+rng()*(box.maxX-box.minX),z=box.minZ+rng()*(box.maxZ-box.minZ),radius=.65+rng()*.65;
      // The photographs show open grass here. Keep the map planting polygons
      // and tree rows, but do not scatter decorative shrubs across that lawn.
      if(blocked(x,z,radius)||!pointInLandcover(x,z,clipped)||photoOpenLawns.some(lawn=>pointInLandcover(x,z,lawn.polygons)))continue;
      if(Array.from({length:8},(_,i)=>[x+Math.cos(i*Math.PI/4)*radius,z+Math.sin(i*Math.PI/4)*radius]).some(p=>!pointInLandcover(...p,clipped)))continue;
      if(trees.some(t=>(t.x-x)**2+(t.z-z)**2<1.3**2)||shrubs.some(s=>(s.x-x)**2+(s.z-z)**2<((radius+s.radius)*.8)**2))continue;
      shrubs.push({x,z,y:.035,height:kind==='scrub'?.7+rng()*.6:.45+rng()*.5,radius,seed:rng(),...evidence});n++;
    }
  }
  return{trees,shrubs,coverages,obstacles,blocked,evidence:CAMPUS_VEGETATION_EVIDENCE,counts:{trees:trees.length,shrubs:shrubs.length,sourceFeatures:sources.length,coverages:coverages.length,woodlandArea:Math.round(coverages.filter(c=>c.kind==='wood').reduce((s,c)=>s+c.area,0))}};
}

/** Render sampled canopies and genuine source land-cover, in batches. All new
 * surfaces are cut around existing road/building/water/sports/parking geometry. */
export function createCampusLandcover(THREE,model,options={}){
  const plan=planCampusLandcover(model,options),group=new THREE.Group();group.name='源植被范围 · 林冠、灌木与地被';group.userData={...CAMPUS_VEGETATION_EVIDENCE,sourceFeatures:plan.counts.sourceFeatures};
  const geometries=[],materials=[],surfaces=options.surfaces,trees=createTreeLayer(THREE,plan.trees,{name:'source-multilayer-canopy',detail:'forest',whitewash:false,barkMaterial:surfaces?.bark});group.add(trees.group);
  const palette={wood:'#a6aa8c',lawn:'#e8e6cb',garden:'#c5d0a8',scrub:'#adb591',bed:'#caba9a'},coverBatches=new Map();
  for(const coverage of plan.coverages){if(!coverBatches.has(coverage.kind))coverBatches.set(coverage.kind,[]);coverBatches.get(coverage.kind).push(coverage);}
  for(const[kind,covers]of coverBatches){
    const mat=surfaces?.grass?.clone()||new THREE.MeshStandardMaterial({roughness:1});mat.color.set(palette[kind]);mat.roughness=1;mat.polygonOffset=true;mat.polygonOffsetFactor=-1;mat.polygonOffsetUnits=-1;materials.push(mat);
    const shapes=covers.flatMap(c=>c.polygons.map(p=>{const s=new THREE.Shape(p[0].map(q=>new THREE.Vector2(q[0],-q[1])));s.holes=p.slice(1).map(r=>new THREE.Path(r.map(q=>new THREE.Vector2(q[0],-q[1]))));return s;}));
    const geometry=applyWorldUV(new THREE.ShapeGeometry(shapes,1),1,'xy');geometries.push(geometry);const mesh=new THREE.Mesh(geometry,mat);mesh.name=`source-${kind}-ground-cover`;mesh.rotation.x=-Math.PI/2;mesh.position.y=.031;mesh.receiveShadow=true;mesh.renderOrder=199;mesh.userData={component:'source-landcover-ground',sourceIds:covers.map(c=>c.featureId),footprint:'source minus existing hardscape; unmodified source data',materialStatus:'photo-informed estimate'};group.add(mesh);
  }
  const shrubs=createShrubLayer(THREE,plan.shrubs);group.add(shrubs.group);
  let disposed=false;
  return{group,plan,counts:{...plan.counts,drawCalls:trees.counts.drawCalls+coverBatches.size+shrubs.counts.drawCalls},update(camera){trees.update(camera);shrubs.update(camera);},dispose(){if(disposed)return;disposed=true;trees.dispose();shrubs.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.removeFromParent();group.clear();}};
}
