import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createChamferedStone,createChamferedColumn} from '../src/architectural-profiles.js';
import {createCampus3D} from '../src/campus-3d.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createSurfaceMaterials} from '../src/surface-materials.js';
import {createStreetDetails} from '../src/street-details.js';
import {createRoadClearance} from '../src/street-clearance.js';

const data=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url)));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});

test('stone and pier refinements are closed, outward-facing solids contained in the original boxes',()=>{
  for(const [make,dimensions]of [[createChamferedStone,[1,.17,.18]],[createChamferedStone,[1.8,.1,.16]],[createChamferedColumn,[.49,8,.60]]]){
    const geometry=make(THREE,...dimensions),p=geometry.attributes.position,n=geometry.attributes.normal,edges=new Map();
    try{
      geometry.computeBoundingBox();
      for(let axis=0;axis<3;axis++){
        assert.ok(Math.abs(geometry.boundingBox.min.getComponent(axis)+dimensions[axis]/2)<1e-6);
        assert.ok(Math.abs(geometry.boundingBox.max.getComponent(axis)-dimensions[axis]/2)<1e-6);
      }
      const vertex=i=>new THREE.Vector3().fromBufferAttribute(p,i),key=v=>v.toArray().map(x=>x.toFixed(6)).join(',');
      for(let i=0;i<p.count;i+=3){
        const vertices=[vertex(i),vertex(i+1),vertex(i+2)],face=vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0]));
        assert.ok(face.length()>1e-8,'no degenerate end-cap triangles');face.normalize();
        for(let j=0;j<3;j++){
          assert.ok(face.dot(new THREE.Vector3().fromBufferAttribute(n,i+j))>.99999,'declared normal agrees with front-face winding');
          const a=key(vertices[j]),b=key(vertices[(j+1)%3]),edge=[a,b].sort().join('|');
          const entry=edges.get(edge)||{count:0,direction:0};entry.count++;entry.direction+=a<b?1:-1;edges.set(edge,entry);
        }
      }
      for(const edge of edges.values()){assert.equal(edge.count,2,'every edge has a matching face');assert.equal(edge.direction,0,'paired edges have opposite directions');}
      assert.ok(p.count/3<=28,'profile stays bounded at 28 triangles');
    }finally{geometry.dispose();}
  }
});

test('refined street stones retain real road clearance, batch budget, and borrowed texture ownership',()=>{
  const route=createCommuteRoute(data,{frame,geoToLocal}),surfaces=createSurfaceMaterials(THREE),street=createStreetDetails(THREE,route,surfaces),obstructsRoad=createRoadClearance(route),resources=new Set(),borrowed=new Set();
  for(const surface of Object.values(surfaces))if(surface?.isMaterial){borrowed.add(surface);for(const value of Object.values(surface))if(value?.isTexture)borrowed.add(value);}
  let calls=0,triangles=0;street.group.traverse(o=>{if(!o.isMesh)return;calls++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.count??1);resources.add(o.geometry);if(!borrowed.has(o.material))resources.add(o.material);if(o.isInstancedMesh)resources.add(o);});
  const disposed=new Map();for(const resource of [...resources,...borrowed])resource.addEventListener('dispose',()=>disposed.set(resource,(disposed.get(resource)||0)+1));
  try{
    assert.ok(street.placements.curbs.length>700,'exercise the whole source commute route');
    for(const placements of Object.values(street.placements))for(const p of placements)assert.ok(!obstructsRoad(p.x,p.z,p.width,p.depth,p.yaw),'full original stone envelope remains outside source road corridors');
    assert.ok(calls<=13,`${calls} street batches`);assert.ok(triangles<45000,`${triangles} street triangles`);
    street.dispose();street.dispose();
    for(const resource of resources)assert.equal(disposed.get(resource),1,'each street resource disposed once');
    for(const resource of borrowed)assert.equal(disposed.get(resource)||0,0,'street owner does not dispose shared campus surfaces');
  }finally{street.dispose();surfaces.dispose();}
});

test('campus owns authored glass, new pier/stone geometry and remaining instance buffers exactly once',()=>{
  const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal),campus=createCampus3D(THREE,model,{frame,geoToLocal}),resources=new Set(),glazing=new Set();
  campus.group.traverse(o=>{
    if(o.geometry?.userData?.preservesBoxBounds){resources.add(o.geometry);if(o.isInstancedMesh)resources.add(o);}
    for(const material of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])if(material.userData.architecturalGlazing){resources.add(material);glazing.add(material);}
  });
  const disposed=new Map();for(const resource of resources)resource.addEventListener('dispose',()=>disposed.set(resource,(disposed.get(resource)||0)+1));
  try{
    assert.ok(resources.size>=7,'real campus contains instanced piers, stone profiles and glazing');assert.ok(glazing.size>=2);
    for(const material of glazing){assert.equal(material.isMeshPhysicalMaterial,true);assert.equal(material.transparent,false);assert.equal(material.transmission,0);assert.equal(Object.values(material).some(v=>v?.isTexture),false,'glazing borrows the environment without new material textures');}
    campus.dispose();campus.dispose();for(const resource of resources)assert.equal(disposed.get(resource),1,'new/changed resource released exactly once');
  }finally{campus.dispose();model.dispose();}
});
