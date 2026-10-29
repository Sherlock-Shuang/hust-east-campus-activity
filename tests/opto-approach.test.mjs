import test,{after} from'node:test';
import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import * as THREE from'three';
import{mergeCampusExtension}from'../src/campus-data-merge.js';
import{createGeoScene}from'../src/geo-scene.js';
import{createLocalFrame,geoToLocal}from'../src/geospatial.js';
import{createOptoBuilding}from'../src/opto-building.js';
import{createOptoApproach,planOptoApproach,OPTO_APPROACH_BRIDGES}from'../src/opto-approach.js';
import{createCommuteRoute}from'../src/commute-route.js';
import{createPlayerWorld}from'../src/player-experience.js';
import{createPlayerMotion}from'../src/player-motion.js';
const base=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8')),extra=JSON.parse(readFileSync(new URL('../public/data/opto-southeast.geojson',import.meta.url),'utf8')),before=JSON.stringify([base,extra]),data=mergeCampusExtension(base,extra);
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal),opto=createOptoBuilding(THREE,model.buildings.find(b=>b.id==='relation/13705821'),{frame,geoToLocal}),made=createOptoApproach(THREE,model,{frame,geoToLocal,optoBuilding:opto}),route=createCommuteRoute(data,{frame,geoToLocal});
const world=createPlayerWorld({...model,architectureInfrastructure:{...opto.infrastructure,replacedRoadIds:made.infrastructure.replacedRoadIds,barriers:[...opto.infrastructure.barriers,...made.infrastructure.barriers],walkSurfaces:[...opto.infrastructure.walkSurfaces,...made.infrastructure.walkSurfaces]}});
const motion=()=>createPlayerMotion({route,world});
const near=(a,b,t=.005)=>assert.ok(Math.abs(a-b)<t,`${a} approximately ${b}`);
const walk=(a,b,{extension=0,label='path'}={})=>{
  const m=motion(),length=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length,yaw=Math.atan2(-dx,-dz);
  assert.equal(m.placeWalker({x:a.x-dx*extension,z:a.z-dz*extension,yaw}).ok,true,`${label} start`);const first={x:m.state.x,z:m.state.z};let previous=m.state.y,maximumDelta=0;
  for(let i=0;i<18000&&Math.hypot(m.state.x-first.x,m.state.z-first.z)<length+extension*2;i++){
    m.step(1/120,{forward:.45});assert.equal(m.state.blockedReason,'',`${label}: ${m.state.blockedReason} @ ${m.state.x},${m.state.y},${m.state.z}`);maximumDelta=Math.max(maximumDelta,Math.abs(m.state.y-previous));previous=m.state.y;
  }
  assert.ok(Math.hypot(m.state.x-first.x,m.state.z-first.z)>=length+extension*2-.05,`${label} reaches opposite end`);assert.ok(maximumDelta<.19,`${label} cannot jump 5.5 metres`);return m;
};
after(()=>{made.dispose();opto.dispose();model.dispose();});

test('six source bridges retain their path/width but meet the common ground datum at both banks',()=>{
  assert.deepEqual(made.plan.replacedRoadIds,[...OPTO_APPROACH_BRIDGES]);
  for(const bridge of made.plan.bridges){assert.equal(bridge.oldElevation,5.5);assert.ok(bridge.polygons.length);for(const s of made.plan.walkSurfaces.filter(s=>s.sourceId===bridge.id)){assert.equal(s.bridge,true);near(s.surfaceY,.14);near(s.deckDepth,.18);}}
  assert.equal(JSON.stringify([base,extra]),before);
});

test('walkers traverse every replacement bridge segment and both banks without a floating bridge edge',()=>{
  for(const bridge of made.plan.bridges)for(const line of bridge.lines)for(let i=1;i<line.length;i++){
    const m=walk(line[i-1],line[i],{extension:.12,label:`${bridge.id}:${i}`});near(m.state.y,.14);
  }
});

test('bridge rails leave the real C-side pedestrian branch open at its internal source node',()=>{
  const bridge=made.plan.bridges.find(b=>b.id==='way/1023544702'),p=bridge.lines[0][1],footway=model.roads.find(r=>r.id==='way/1483567207'),c=footway.feature.geometry.coordinates[1],end=geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame),l=Math.hypot(end.x-p.x,end.z-p.z);
  const m=walk(p,{x:p.x+(end.x-p.x)*5/l,z:p.z+(end.z-p.z)*5/l},{label:'C-side branch'});near(m.state.y,.14);
});

test('short connectors join the existing source footway and provisional C landing without modifying GIS or crossing a building',()=>{
  const c=made.plan.connectors.find(c=>c.id==='opto-c-entry-approach'),seam=made.plan.connectors.find(c=>c.id==='opto-footway-capture-seam');
  assert.ok(c&&c.length>3&&c.length<8);assert.equal(c.sourceId,'way/1483567207');assert.ok(c.reason.includes('unverified'));walk(c.a,c.b,{label:'C entry paving'});
  assert.ok(seam&&seam.length>3&&seam.length<5);assert.equal(seam.sourceId,'way/1483567253');walk(seam.a,seam.b,{label:'same-way capture seam'});
  assert.deepEqual(planOptoApproach(model,{frame,geoToLocal,optoBuilding:opto}),made.plan);
});

test('multi-line bridge fragments are all rebuilt instead of dropping one source fragment',()=>{
  const target=model.roads.find(r=>r.id==='way/1023544702'),coords=target.feature.geometry.coordinates,split={...target,feature:{...target.feature,geometry:{type:'MultiLineString',coordinates:[coords.slice(0,2),coords.slice(1)]}}};
  const plan=planOptoApproach({...model,roads:model.roads.map(r=>r.id===target.id?split:r)},{frame,geoToLocal,optoBuilding:opto});assert.equal(plan.bridges.find(b=>b.id===target.id).lines.length,2);
  const area=p=>p.reduce((sum,r)=>sum+Math.abs(r[0].reduce((s,a,i)=>{const b=r[0][(i+1)%r[0].length];return s+a[0]*b[1]-b[0]*a[1];},0)/2),0);
  near(area(plan.bridges.find(b=>b.id===target.id).polygons),area(made.plan.bridges.find(b=>b.id===target.id).polygons),.001);
});

test('static detail stays batched and borrowed road materials survive disposal',()=>{
  made.group.updateMatrixWorld(true);let draws=0;made.group.traverse(o=>{if(o.isMesh){draws++;assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));}});assert.ok(draws<=6,`${draws} draw calls`);
  const material=new THREE.MeshStandardMaterial();let disposed=0;material.addEventListener('dispose',()=>disposed++);const layer=createOptoApproach(THREE,model,{frame,geoToLocal,optoBuilding:opto,surfaces:{asphalt:material,paving:material}});layer.dispose();layer.dispose();assert.equal(disposed,0);material.dispose();
});
