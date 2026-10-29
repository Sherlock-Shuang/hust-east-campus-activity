import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getBuildingProfile, getRoadProfile, getBuildingPartGroups } from '../src/building-profiles.js';

const data=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const original=JSON.stringify(data);
function freezeDeep(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freezeDeep(child);}return value;}
freezeDeep(data);
const feature=tags=>({type:'Feature',properties:{tags}});
const source=id=>data.features.find(f=>f.id===id);
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} ≈ ${b}`);

test('explicit source height and minimum height take priority over inferred floors',()=>{
  const p=getBuildingProfile(feature({building:'university',height:'24',min_height:'8','building:levels':'6'}));
  assert.equal(p.height,24);assert.equal(p.baseHeight,8);assert.equal(p.extrusionHeight,16);
  assert.equal(p.heightEvidence,'source-height');assert.equal(p.baseHeightEvidence,'source-min-height');
  assert.equal(p.estimated,false);assert.equal(p.sourceLevels,6);
  close(getBuildingProfile(feature({building:'yes',height:'30 ft'})).height,9.144);
  close(getBuildingProfile(feature({building:'yes',height:'1200 cm'})).height,12);
});

test('a display-only or unknown heightMeters value never becomes a source height',()=>{
  const p=getBuildingProfile({properties:{heightMeters:999,heightStatus:'unknown',tags:{building:'residential'}}});
  assert.notEqual(p.height,999);assert.equal(p.heightEvidence,'estimated-use');assert.equal(p.estimated,true);
  const known=getBuildingProfile({properties:{heightMeters:25,heightStatus:'source',tags:{building:'residential'}}});
  assert.equal(known.height,25);assert.equal(known.heightEvidence,'source-height');
});

test('identified numbered teaching buildings avoid generic height without inventing source floors',()=>{
  const numbered=data.features.filter(f=>f.properties.category==='building'&&/[东西][零〇一二两三四五六七八九十百\d]+(?:教学)?楼/.test(f.properties.name??f.properties.tags.name??''));
  assert.deepEqual(new Set(numbered.map(f=>f.id)),new Set(['way/1023544717','way/98867867','way/98867881']));
  for(const f of numbered)assert.equal(getBuildingProfile(f).kind,'teaching',f.id);
  const p=getBuildingProfile(source('way/98867867'));
  assert.equal(p.height,20);assert.equal(p.levels,5);assert.equal(p.floorHeight,4);
  assert.equal(p.sourceLevels,null);assert.equal(p.heightEvidence,'estimated-use');assert.equal(p.levelsEvidence,'estimated-use');
  assert.equal(p.useEvidence.basis,'identified-campus-use');assert.equal(p.useEvidence.sourceUrl,'https://ei.hust.edu.cn/info/1196/7752.htm');
  assert.match(p.heightDescription,/未提供整栋层数或楼高/);
  const unchanged=getBuildingProfile(source('way/98867881'));
  assert.equal(unchanged.sourceLevels,10);assert.equal(unchanged.height,40);assert.equal(unchanged.heightEvidence,'estimated-levels');
  const unknown=getBuildingProfile(feature({building:'yes',name:'西十八楼'}));
  assert.equal(unknown.kind,'generic');assert.equal(unknown.height,10.5);assert.equal(unknown.useEvidence,null);
});

test('identified teaching use preserves source dimensions and explicit alternative use',()=>{
  const actual=source('way/98867867');
  const tagged=tags=>({...actual,properties:{...actual.properties,tags:{...actual.properties.tags,...tags}}});
  const floors=getBuildingProfile(tagged({'building:levels':'6'}));
  assert.equal(floors.height,24);assert.equal(floors.sourceLevels,6);assert.equal(floors.heightEvidence,'estimated-levels');
  const metres=getBuildingProfile(tagged({'building:levels':'6',height:'25 m'}));
  assert.equal(metres.height,25);assert.equal(metres.heightEvidence,'source-height');
  const office=getBuildingProfile(tagged({'building:use':'office'}));
  assert.equal(office.kind,'office');assert.equal(office.useEvidence,null);
  assert.equal(JSON.stringify(data),original);
});

test('elevated building parts preserve their source levels and leave space below',()=>{
  const p=getBuildingProfile(source('way/1528957937'));
  assert.equal(p.sourceLevels,5);assert.equal(p.levels,5);assert.equal(p.minLevel,3);
  assert.equal(p.occupiedLevels,2);assert.ok(p.baseHeight>0);
  close(p.baseHeight,6.4);close(p.height,p.baseHeight+p.extrusionHeight);
  assert.equal(p.arcadeScale.sourceMinLevelHeightEstimate,12,'source arithmetic remains available as evidence, not an asserted measurement');
  assert.equal(p.parentOutlineId,'way/1023544717');assert.equal(p.isPart,true);
  assert.equal(p.heightEvidence,'estimated-levels');assert.equal(p.baseHeightEvidence,'estimated-photo-arcade-proportion');
  const explicit=getBuildingProfile(feature({height:'24','building:levels':'6','building:min_level':'3'}));
  assert.equal(explicit.baseHeight,12,'source height and source levels establish the display floor module');
});

test('East Nine photo clearance applies only to its identified arcade and yields to explicit metre tags',()=>{
  const actual=source('way/1528957937'),tagged={...actual,properties:{...actual.properties,tags:{...actual.properties.tags,height:'26 m',min_height:'9 m'}}};
  const p=getBuildingProfile(tagged);assert.equal(p.height,26);assert.equal(p.baseHeight,9);
  assert.equal(p.heightEvidence,'source-height');assert.equal(p.baseHeightEvidence,'source-min-height');
  assert.equal(p.minLevel,3);assert.equal(p.arcadeScale.clearHeight,9);
  const unrelated=getBuildingProfile({...actual,id:'way/unrelated'});
  assert.equal(unrelated.arcadeScale,null);assert.equal(unrelated.baseHeightEvidence,'estimated-min-level');
  close(unrelated.baseHeight,unrelated.floorHeight*3);
  assert.equal(JSON.stringify(data),original);
});

test('conflicting source levels receive a labelled positive display fallback without rewriting tags',()=>{
  const f=source('way/1484333087'),p=getBuildingProfile(f);
  assert.equal(f.properties.tags['building:levels'],'3');assert.equal(f.properties.tags['building:min_level'],'3');
  assert.equal(p.sourceLevels,3);assert.equal(p.minLevel,3);assert.equal(p.occupiedLevels,0);
  assert.equal(p.heightEvidence,'estimated-conflicting-levels');assert.ok(p.warnings.length);
  assert.ok(p.extrusionHeight>0&&p.extrusionHeight<1);assert.equal(p.estimated,true);
});

test('roof-only source parts become raised canopy slabs rather than filled buildings',()=>{
  const roofs=data.features.filter(f=>f.properties.tags['building:part']==='roof');
  assert.equal(roofs.length,2);
  for(const f of roofs){const p=getBuildingProfile(f);assert.equal(p.isRoof,true);assert.ok(p.baseHeight>0);assert.ok(p.extrusionHeight>0&&p.extrusionHeight<1);assert.equal(p.baseHeightEvidence,'estimated-roof-slab');}
});

test('all 299 source building features obtain finite derived 3D dimensions with evidence',()=>{
  const buildings=data.features.filter(f=>f.properties.category==='building');assert.equal(buildings.length,299);
  const evidence={};let sourceLevels=0;
  for(const f of buildings){const p=getBuildingProfile(f);assert.ok(p.height>p.baseHeight&&p.baseHeight>=0,f.id);
    for(const key of ['height','baseHeight','extrusionHeight','levels','floorHeight','facadeModuleWidth','windowWidth','windowHeight'])assert.ok(Number.isFinite(p[key]),`${f.id} ${key}`);
    assert.ok(p.heightDescription.length);assert.ok(p.heightEvidence.startsWith('estimated-'));assert.equal(p.estimated,true);
    assert.ok(p.wallColor&&p.roofColor);sourceLevels+=Number(p.sourceLevels!==null);evidence[p.heightEvidence]=(evidence[p.heightEvidence]??0)+1;
  }
  assert.equal(sourceLevels,81);assert.deepEqual(evidence,{'estimated-levels':80,'estimated-use':218,'estimated-conflicting-levels':1});
});

test('source width wins while inferred road widths and elevations remain independently labelled',()=>{
  const p=getRoadProfile(feature({highway:'trunk',width:'8',lanes:'3',bridge:'yes',layer:'2'}));
  assert.equal(p.width,8);assert.equal(p.evidence,'source-width');assert.equal(p.bridge,true);
  assert.ok(p.elevation>0);assert.equal(p.elevationEvidence,'estimated-layer');assert.equal(p.estimated,true);
  const lanes=getRoadProfile(feature({highway:'service',lanes:'2'}));assert.equal(lanes.lanes,2);assert.equal(lanes.evidence,'estimated-lanes');assert.ok(lanes.width>0);
  const tunnel=getRoadProfile(feature({highway:'secondary',tunnel:'yes',layer:'-1'}));assert.ok(tunnel.elevation<0);assert.equal(tunnel.elevationEvidence,'estimated-layer');
  const ground=getRoadProfile(feature({highway:'footway'}));assert.equal(ground.elevation,0);assert.equal(ground.elevationEvidence,'assumed-level-ground');
});

test('all 483 roads obtain usable widths without turning any missing source widths into known data',()=>{
  const roads=data.features.filter(f=>f.properties.category==='road');assert.equal(roads.length,483);
  for(const f of roads){const p=getRoadProfile(f);assert.ok(Number.isFinite(p.width)&&p.width>0,f.id);assert.ok(Number.isFinite(p.elevation),f.id);
    assert.ok(p.evidence.startsWith('estimated-'));assert.ok(p.description.length);assert.equal(f.properties.widthStatus,'unknown');assert.equal(f.properties.widthMeters,undefined);
  }
});

test('four geometric part groups contain all 36 source parts once and support partial datasets',()=>{
  const groups=getBuildingPartGroups(data),parts=groups.flatMap(g=>g.partIds);
  assert.equal(groups.length,4);assert.equal(parts.length,36);assert.equal(new Set(parts).size,36);
  assert.deepEqual(new Set(parts),new Set(data.features.filter(f=>f.properties.isBuildingPart).map(f=>f.id)));
  for(const g of groups){assert.ok(source(g.outlineId));assert.equal(g.associationEvidence,'geometric-containment');}
  assert.deepEqual(getBuildingPartGroups({features:[source('way/1528957937')]}),[],'an absent outline must not be invented');
  const limited=getBuildingPartGroups({features:[source('way/1023544717'),source('way/1528957937')]});
  assert.equal(limited.length,1);assert.deepEqual(limited[0].partIds,['way/1528957937']);
});

test('derived profiles never mutate the source geometries, tags or unknown dimension status',()=>{
  for(const f of data.features){if(f.properties.category==='building')getBuildingProfile(f);if(f.properties.category==='road')getRoadProfile(f);}
  getBuildingPartGroups(data);assert.equal(JSON.stringify(data),original);
  for(const f of data.features){assert.equal(f.properties.heightMeters,undefined);assert.equal(f.properties.widthMeters,undefined);}
});

test('ground-level building passages stay on the road under gate beams, not in a fake tunnel',()=>{
  const passage=getRoadProfile(feature({highway:'unclassified',tunnel:'building_passage'}));
  assert.equal(passage.tunnel,true);assert.equal(passage.elevation,0);assert.equal(passage.elevationEvidence,'assumed-level-ground');
  assert.equal(getRoadProfile(feature({highway:'footway',tunnel:'building_passage',min_height:'2.4'})).elevation,2.4);
  assert.ok(getRoadProfile(feature({highway:'unclassified',tunnel:'yes',layer:'-1'})).elevation<0);
});
