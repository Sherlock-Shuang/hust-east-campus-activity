import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {getBuildingPartGroups} from '../src/building-profiles.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createCampus3D} from '../src/campus-3d.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';

const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8')),original=JSON.stringify(source);
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),route=createCommuteRoute(source,{frame,geoToLocal});
// Real plinth positions verified against complete part volumes and person
// radius before checking visible triangles. The gym sample is inside a real
// part and must stay blocked; the other two samples are open courtyard space.
const cases=[
  {id:'way/1228689191',name:'计算机与人工智能大楼',x:289.8705526773595,z:359.4526147978103},
  {id:'way/1484333085',name:'source compound 1484333085',x:729.1951169037625,z:29.66390198850193,insidePart:true},
  {id:'relation/20970638',name:'source compound 20970638',x:669.142651001762,z:161.88939762155633},
];
const created=[];
for(const fixture of cases){
  const partGroup=getBuildingPartGroups(source).find(g=>g.outlineId===fixture.id),ids=new Set([fixture.id,...partGroup.partIds]);
  const fc={...source,features:source.features.filter(f=>ids.has(f.id))},scene=new THREE.Scene(),model=createGeoScene(THREE,scene,fc,frame,geoToLocal),campus=createCampus3D(THREE,model,{frame,geoToLocal});
  scene.add(campus.group);scene.updateMatrixWorld(true);created.push({...fixture,partGroup,model,campus,world:createPlayerWorld(model)});
}
after(()=>{for(const {model,campus}of created){campus.dispose();model.dispose();}assert.equal(JSON.stringify(source),original);});

for(const fixture of created)test(`${fixture.name} uses source parts and its rendered base without a duplicate parent collider`,()=>{
  const {model,campus,world,partGroup,x,z,id}=fixture;
  assert.equal(campus.records.get(id).displayMode,'part-composite-base');
  const ray=new THREE.Raycaster(new THREE.Vector3(x,2.3,z),new THREE.Vector3(0,-1,0));
  const hit=ray.intersectObject(campus.group,true).find(h=>h.object.isMesh);
  assert.ok(hit);assert.ok(Math.abs(hit.point.y-.3)<1e-5,'fixture still targets the actual rendered low base');
  assert.ok(model.architectureInfrastructure.replacedBuildingIds.includes(id));
  assert.ok(!world.buildings.some(b=>b.id===id),'conceptual parent shell is removed only from collision');
  for(const partId of partGroup.partIds)assert.ok(world.buildings.some(b=>b.id===partId),`${partId} remains solid`);
  const motion=createPlayerMotion({route,world});
  if(fixture.insidePart){assert.equal(motion.canPlaceMode({x,z,y:.3,yaw:0},'walk').reason,'建筑边界','real gym part remains solid');return;}
  const before=createPlayerMotion({route,world:createPlayerWorld({...model,architectureInfrastructure:{}})});
  assert.equal(before.canPlaceMode({x,z,y:.3,yaw:0},'walk').reason,'建筑边界','old parent shell reproduced the invisible block');
  const placed=motion.placeWalker({x,z,y:.3,yaw:0});assert.equal(placed.ok,true,`open visible plinth is accessible: ${JSON.stringify(placed)}`);
  assert.equal(motion.state.y,.3);assert.equal(motion.state.grounded,true);
  const surface=world.walkSurfaces.find(s=>s.sourceId===id);assert.ok(surface);assert.notEqual(surface.bridge,true,'land plinth is not a water-crossing permission');
  assert.equal(motion.groundAt(x,z,0,.3).onBridge,false);
});

test('part rooms stay solid and compound plinth holes remain unsupported',()=>{
  let checkedParts=0,checkedHoles=0;
  for(const {model,world,partGroup}of created){
    const motion=createPlayerMotion({route,world});
    for(const id of partGroup.partIds){
      const body=world.buildings.find(b=>b.id===id);if(body.minHeight>1)continue;
      const ring=body.rings[0],point=ring.reduce((p,q)=>({x:p.x+q.x/ring.length,z:p.z+q.z/ring.length}),{x:0,z:0});
      // Centroids of concave footprints can fall outside; choose only a source
      // part centre that the normal building query confirms is occupied.
      const blocked=motion.canPlaceMode({...point,y:.3,yaw:0},'walk');
      if(blocked.reason==='建筑边界')checkedParts++;
    }
    for(const surface of world.walkSurfaces.filter(s=>s.id?.includes(':composite-plinth:')))for(const hole of surface.holes||[]){
      assert.ok(hole.length>=3);checkedHoles++;
      const originalShape=model.buildings.find(b=>b.id===surface.sourceId).shapes;
      assert.ok(originalShape.some(s=>s.holes.some(h=>JSON.stringify(h.getPoints().map(p=>({x:p.x,z:-p.y})))===JSON.stringify(hole))),'void boundaries remain the original source rings');
    }
  }
  assert.ok(checkedParts>=3,'regression must exercise retained real room/building-part collisions');
  assert.ok(checkedHoles>=1,'real compound footprint holes stay available to terrain queries');
});
