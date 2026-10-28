import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {planCampusLandcover,createCampusLandcover,pointInLandcover} from '../src/campus-landcover.js';
import {createTreeLayer,createShrubLayer} from '../src/vegetation.js';
import {planCampusLawnLandmarks} from '../src/campus-lawn-landmarks.js';
const data=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const sourceState=JSON.stringify(data),model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal);
const plan=planCampusLandcover(model,{frame,geoToLocal});
const covers=new Map(plan.coverages.map(c=>[c.featureId,c]));

test('photo-registered open lawns remove inferred shrubs while retaining source tree rows and geometry',()=>{
  const lawns=planCampusLawnLandmarks(model,{frame,geoToLocal}).lawns;
  assert.ok(plan.shrubs.some(s=>lawns.some(l=>pointInLandcover(s.x,s.z,l.polygons))),'fixture contains the old overgrown lake lawn');
  const updated=planCampusLandcover(model,{frame,geoToLocal,photoOpenLawns:lawns});
  assert.ok(updated.shrubs.every(s=>lawns.every(l=>!pointInLandcover(s.x,s.z,l.polygons))));
  assert.deepEqual(updated.trees,plan.trees);
  assert.deepEqual(updated.coverages,plan.coverages);
  assert.equal(JSON.stringify(data),sourceState);
});

test('planting is sourced, reproducible and all woodland regions receive canopy budget',()=>{
  assert.ok(plan.trees.length>6500&&plan.trees.length<=7800);
  assert.ok(plan.shrubs.length>600);
  assert.equal(plan.counts.sourceFeatures,41);
  for(const c of plan.coverages.filter(c=>c.kind==='wood'))assert.ok(plan.trees.some(t=>t.featureId===c.featureId),`${c.featureId} is not starved by the global budget`);
  assert.deepEqual(planCampusLandcover(model,{frame,geoToLocal}).trees,plan.trees);
  assert.equal(JSON.stringify(data),sourceState,'source GeoJSON remains untouched');
  assert.ok(plan.obstacles.some(o=>o.id==='way/98867853'&&o.category==='building'),'reviewed library outline excludes canopy without changing source category');
  assert.equal(new Set(plan.trees.map(t=>t.form)).size,3);
  assert.ok(Math.max(...plan.trees.map(t=>t.height))-Math.min(...plan.trees.map(t=>t.height))>7);
});

test('tree roots and shrubs never occupy roads, buildings, water, parking or sports',()=>{
  for(const tree of plan.trees){assert.equal(plan.blocked(tree.x,tree.z),false,`${tree.featureId} tree blocked`);const c=covers.get(tree.featureId);if(c)assert.ok(pointInLandcover(tree.x,tree.z,c.sourcePolygons));}
  for(const shrub of plan.shrubs){assert.equal(plan.blocked(shrub.x,shrub.z,shrub.radius),false);assert.ok(pointInLandcover(shrub.x,shrub.z,covers.get(shrub.featureId).sourcePolygons));}
  // Check the actual sampled trunks against source geometry independently of
  // the sampler's mask (including sports, which was previously omitted).
  for(const r of model.records.filter(r=>(['building','water','sports'].includes(r.category)||r.id==='way/98867853')&&r.shapes?.length)){
    const polygons=r.shapes.map(s=>[s.getPoints().map(p=>[p.x,-p.y]),...s.holes.map(h=>h.getPoints().map(p=>[p.x,-p.y]))]);
    for(const t of plan.trees)assert.equal(pointInLandcover(t.x,t.z,polygons),false,`${t.featureId} lies in ${r.id}`);
  }
});

test('row trees remain on mapped lines; lawn, square and untyped park do not become woods',()=>{
  const rows=plan.trees.filter(t=>t.positionStatus==='sampled-on-source-tree-row');assert.ok(rows.length>100);
  for(const tree of rows){const r=model.records.find(r=>r.id===tree.featureId),coords=r.feature.geometry.coordinates.map(c=>geoToLocal({longitude:c[0],latitude:c[1],coordinateSystem:'EPSG:4326'},frame));let distance=Infinity;for(let i=1;i<coords.length;i++){const a=coords[i-1],b=coords[i],dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((tree.x-a.x)*dx+(tree.z-a.z)*dz)/l));distance=Math.min(distance,Math.hypot(tree.x-a.x-dx*t,tree.z-a.z-dz*t));}assert.ok(distance<1e-6);}
  for(const c of plan.coverages.filter(c=>c.kind==='lawn')){assert.equal(plan.trees.some(t=>t.featureId===c.featureId),false);assert.equal(plan.shrubs.some(t=>t.featureId===c.featureId),false);}
  assert.equal(covers.has('way/98865830'),false,'爱因斯坦广场 park tag is not inferred lawn');
  assert.equal(covers.has('way/98831430'),false,'韵苑 residential polygon is not filled with vegetation');
});

test('clipped ground cover never repaints any hardscape exclusion polygon',()=>{
  for(const c of plan.coverages){
    const ringArea=r=>Math.abs(r.reduce((a,p,i)=>{const q=r[(i+1)%r.length];return a+p[0]*q[1]-q[0]*p[1];},0)/2);
    for(const o of plan.obstacles){
      if(c.bounds.minX>o.bounds.maxX||c.bounds.maxX<o.bounds.minX||c.bounds.minZ>o.bounds.maxZ||c.bounds.maxZ<o.bounds.minZ)continue;
      const snap=polys=>polys.map(p=>p.map(r=>r.map(v=>v.map(n=>Math.round(n*1e7)/1e7))));
      const overlap=polygonClipping.intersection(snap(c.polygons),snap(o.polygons)),area=overlap.reduce((a,p)=>a+ringArea(p[0])-p.slice(1).reduce((s,r)=>s+ringArea(r),0),0);
      assert.ok(area<.0001,`${c.featureId} paints ${area} square metres over ${o.category} ${o.id}`);
    }
    assert.ok(c.area>0);assert.ok(c.area<=(model.records.find(r=>r.id===c.featureId).flatArea||0)+.001);
  }
  const sports=model.records.find(r=>r.category==='sports'&&r.shapes?.length);assert.ok(sports);assert.ok(plan.obstacles.some(o=>o.id===sports.id));
});

test('canopy LOD reduces actual submitted triangles and retains six crown forms',()=>{
  const trees=[0,1,2,3,4,5].map(i=>({x:i*9,z:0,height:12,radius:4,seed:i/6,form:['spreading','oval','upright'][i%3]})),layer=createTreeLayer(THREE,trees,{detail:'forest',whitewash:false});
  assert.equal(layer.counts.variants,6);assert.equal(layer.counts.distantCanopyTrianglesPerTree,128);
  assert.ok(layer.counts.nearCanopyTrianglesPerTree<1800,'close crowns no longer submit thousands of isolated 8-face leaves');
  const near=layer.group.children.filter(m=>m.name.includes('-leaves-')&&!m.name.includes('distant')),far=layer.group.children.filter(m=>m.name.includes('leaves-distant'));
  assert.equal(near.length,6);assert.equal(far.length,6);
  assert.ok(near.every(m=>m.geometry.attributes.position.count<5400));assert.ok(far.every(m=>m.geometry.attributes.position.count===384));
  assert.ok(near.every(m=>m.material.map&&m.material.alphaTest>0&&m.material.vertexColors),'near leaves have dense cutout sprays with fine edge leaves');
  const cam=new THREE.PerspectiveCamera(50,1,.1,5000);cam.position.set(20,100,180);cam.lookAt(20,0,0);cam.updateProjectionMatrix();layer.update(cam);
  assert.equal(near.reduce((n,m)=>n+m.count,0),0);assert.equal(far.reduce((n,m)=>n+m.count,0),6);
  let textureDisposals=0;const tex=far[0].material.map;tex.addEventListener('dispose',()=>textureDisposals++);layer.dispose();layer.dispose();assert.equal(textureDisposals,1);
});

test('landcover owns its meshes and disposal leaves all source material and geometry intact',()=>{
  const geometries=model.records.map(r=>r.mesh?.geometry),materials=model.records.map(r=>r.mesh?.material),layer=createCampusLandcover(THREE,model,{frame,geoToLocal,maxTrees:800,maxShrubs:180});
  assert.ok(layer.group.children.some(m=>m.name==='source-lawn-ground-cover'));
  assert.ok(layer.counts.drawCalls<40,'batched rendering is independent of plant count');
  layer.dispose();layer.dispose();assert.deepEqual(model.records.map(r=>r.mesh?.geometry),geometries);assert.deepEqual(model.records.map(r=>r.mesh?.material),materials);
});


test('all six tree forms respect declared real-world height and crown radius at both LODs',()=>{
  const trees=['spreading','oval','upright','spreading','oval','upright'].map((form,i)=>({x:0,y:.1,z:0,height:10+i,radius:3.2+i*.2,seed:.127,form})),layer=createTreeLayer(THREE,trees,{detail:'street',whitewash:true}),matrix=new THREE.Matrix4(),point=new THREE.Vector3(),extents=new Map();
  for(const mesh of layer.group.children){const variant=mesh.userData.variant,tree=trees.find((t,i)=>({spreading:0,oval:1,upright:2}[t.form]+(i%2)*3)===variant),extent=extents.get(variant)||{tree,top:-Infinity,radius:0};mesh.getMatrixAt(0,matrix);const p=mesh.geometry.attributes.position;for(let n=0;n<p.count;n++){point.fromBufferAttribute(p,n).applyMatrix4(matrix);extent.top=Math.max(extent.top,point.y-tree.y);extent.radius=Math.max(extent.radius,Math.hypot(point.x,point.z));}extents.set(variant,extent);}
  assert.equal(extents.size,6);for(const[variant,{tree,top,radius}]of extents){assert.ok(Math.abs(top-tree.height)<1e-5,`variant ${variant} height ${top}`);assert.ok(Math.abs(radius-tree.radius)<1e-5,`variant ${variant} radius ${radius}`);}layer.dispose();
});

test('forest age and density estimates vary without moving mapped planting boundaries',()=>{
  const wood=plan.trees.filter(t=>t.positionStatus==='sampled-inside-source-planting-polygon');
  assert.ok(wood.some(t=>t.ageClass==='young'&&t.height<8.2));assert.ok(wood.some(t=>t.ageClass==='mature'&&t.height>15));
  assert.ok(Math.min(...wood.map(t=>t.spacing))<4);assert.ok(Math.max(...wood.map(t=>t.spacing))>5.5);
  assert.ok(wood.every(t=>t.densityStatus.includes('inferred')));
});

test('low shrubs are leafy cutouts with bounded footprints, frustum LOD and owned resources',()=>{
  const shrubs=[{x:0,y:.035,z:0,height:1,radius:1.2,seed:.2,featureId:'fixture'}],layer=createShrubLayer(THREE,shrubs),[near,far]=layer.group.children,matrix=new THREE.Matrix4(),point=new THREE.Vector3();
  assert.equal(near.geometry.type,'BufferGeometry');assert.ok(near.material.map&&near.material.alphaTest>0);assert.ok(layer.counts.distantTrianglesPerShrub<layer.counts.nearTrianglesPerShrub);
  for(const mesh of [near,far]){mesh.getMatrixAt(0,matrix);const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(matrix);assert.ok(Math.hypot(point.x,point.z)<=1.20001);assert.ok(point.y>=.03499&&point.y<=1.03501);}}
  const camera=new THREE.PerspectiveCamera(50,1,.1,5000);camera.position.set(0,20,100);camera.lookAt(0,0,0);camera.updateProjectionMatrix();layer.update(camera);assert.equal(near.count,0);assert.equal(far.count,1);
  camera.position.set(0,30,100);camera.lookAt(0,30,300);layer.update(camera);assert.equal(near.count+far.count,0);
  let textureDisposals=0;near.material.map.addEventListener('dispose',()=>textureDisposals++);layer.dispose();layer.dispose();assert.equal(textureDisposals,1);
});

test('tree layer never mutates or disposes borrowed surface materials',()=>{
  const bark=new THREE.MeshStandardMaterial(),foliage=new THREE.MeshStandardMaterial({color:'#123456'}),before=foliage.toJSON();let disposed=0;bark.addEventListener('dispose',()=>disposed++);foliage.addEventListener('dispose',()=>disposed++);
  const layer=createTreeLayer(THREE,[{x:0,z:0,height:12,radius:4}],{barkMaterial:bark,foliageMaterial:foliage});layer.dispose();assert.equal(disposed,0);assert.deepEqual(foliage.toJSON(),before);bark.dispose();foliage.dispose();
});


test('horizon crowns retain each tree while removing subpixel trunks and restore full geometry for export',()=>{
  const trees=Array.from({length:6},(_,i)=>({x:i*9,y:.1,z:0,height:12,radius:4,seed:i/6,featureId:`tree/${i}`}));
  const layer=createTreeLayer(THREE,trees,{detail:'forest',whitewash:false}),camera=new THREE.PerspectiveCamera(50,1,.1,5000);
  camera.position.set(20,80,500);camera.lookAt(20,5,0);layer.update(camera);
  const submitted=()=>layer.group.children.reduce((sum,m)=>sum+(m.visible?m.count*(m.geometry.index?.count||m.geometry.attributes.position.count)/3:0),0);
  assert.equal(submitted(),6*24);assert.equal(layer.group.children.filter(m=>m.name.includes('horizon-canopy')).reduce((sum,m)=>sum+m.count,0),6);
  const oldVersion=layer.group.children.map(m=>m.instanceMatrix.version);camera.rotation.y+=.001;layer.update(camera);
  assert.deepEqual(layer.group.children.map(m=>m.instanceMatrix.version),oldVersion,'small camera changes with identical visible trees cause no GPU reupload');
  camera.position.set(20,30,220);camera.lookAt(20,5,0);layer.update(camera,{detailDistanceScale:1});const balanced=submitted();
  layer.update(camera,{detailDistanceScale:.5});assert.equal(submitted(),6*24);assert.ok(balanced>submitted()*5,'quality switch applies while the camera is stationary');
  layer.update(null);assert.ok(submitted()>balanced);assert.equal(layer.group.children.filter(m=>m.name.includes('horizon-canopy')).reduce((sum,m)=>sum+m.count,0),0);
  assert.deepEqual(trees.map(t=>t.featureId),Array.from({length:6},(_,i)=>`tree/${i}`));layer.dispose();
});


test('reused tree mask generation leaves each layer texture storage and disposal independent',()=>{
  const trees=[{x:0,z:0,height:12,radius:4}],a=createTreeLayer(THREE,trees),b=createTreeLayer(THREE,trees);
  const map=layer=>layer.group.children.find(m=>m.name.includes('-leaves-')).material.map,ma=map(a),mb=map(b);
  assert.notEqual(ma,mb);assert.notEqual(ma.image.data,mb.image.data);assert.deepEqual(ma.image.data,mb.image.data);
  const before=mb.image.data[0];ma.image.data[0]^=255;assert.equal(mb.image.data[0],before);
  let disposed=0;mb.addEventListener('dispose',()=>disposed++);a.dispose();assert.equal(disposed,0);b.dispose();assert.equal(disposed,1);
});
