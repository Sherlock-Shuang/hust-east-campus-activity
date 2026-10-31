import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createCampus3D} from '../src/campus-3d.js';
import {getCampusPlayerSpawn,createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {campusLandmarkArrival} from '../src/campus-landmark-arrival.js';
import {planCampusAIMurals,createCampusAIMurals} from '../src/campus-ai-murals.js';
import {CAMPUS_POETRY} from '../src/campus-poetry-art.js';
import {pointInLandcover} from '../src/campus-landcover.js';

// Use the same merged source map, reconstructed facades and initial player
// position as the actual campus. A standalone flat-wall fixture misses signs
// hidden by the real canteen's columns, cornice or projecting display frame.
const read=name=>JSON.parse(readFileSync(new URL(`../public/data/${name}`,import.meta.url),'utf8'));
const base=read('east-campus.geojson'),extension=read('opto-southeast.geojson');
const sourceBefore=JSON.stringify([base,extension]);
const data=mergeCampusExtension(base,extension),mergedBefore=JSON.stringify(data);
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal);
const campus=createCampus3D(THREE,model,{frame,geoToLocal});
const plan=campus.aiMuralPlan,spawn=getCampusPlayerSpawn(model),facades=campus.layers.get('building');
campus.group.updateMatrixWorld(true);
after(()=>{campus.dispose();model.dispose();});

const arrivalIds=['canteen-arrival','canteen-entry-display'];
const pointOnSign=(item,u=0,v=0)=>new THREE.Vector3(item.x+item.nz*u,item.y+v,item.z-item.nx*u);
// Failed ray assertions compare presence only. A raw hit owns its Mesh and
// the complete parent scene; formatting that value can exhaust test memory
// before Node can report the useful obstruction name.
const probe=(origin,target,stopBefore=.005)=>{
  const delta=target.clone().sub(origin),length=delta.length();
  return new THREE.Raycaster(origin,delta.normalize(),0,length-stopBefore).intersectObject(facades,true)[0];
};

test('the real campus registers stable AI artwork and leaves both source maps unchanged',()=>{
  assert.ok(Array.isArray(plan),'createCampus3D must expose the wall plan, not only an unconnected module');
  const layer=facades.children.find(o=>o.userData.component==='campus-ai-murals');
  assert.ok(layer,'AI artwork is attached to the visible building layer');
  assert.equal(campus.counts.aiMurals,plan.length);
  assert.equal(layer.userData.count,plan.length);
  assert.equal(new Set(plan.map(p=>p.id)).size,plan.length);
  assert.deepEqual(planCampusAIMurals(model,campus.records,{frame,geoToLocal}),plan,'same map produces the same wall placements');
  assert.equal(JSON.stringify([base,extension]),sourceBefore);
  assert.equal(JSON.stringify(data),mergedBefore,'artwork does not become source GIS');
});

test('restrained arrival inscriptions face the unchanged spawn without large opaque billboards',()=>{
  assert.ok(spawn);
  for(const id of arrivalIds){
    const item=plan.find(p=>p.id===id);assert.ok(item,id);
    const dx=spawn.x-item.x,dz=spawn.z-item.z,distance=Math.hypot(dx,dz);
    assert.ok(distance<20,`${id}: not another sign behind a distant building`);
    assert.ok((dx*item.nx+dz*item.nz)/distance>.2,`${id}: the spawn must see the front, not the back or grazing edge of its single-sided plane`);
    assert.ok(item.width<=2.8&&item.height<=1.15,'arrival copy stays within a small facade/display inscription');
    assert.equal(item.background,null,'transparent pigment does not cover the architecture with a billboard');
    assert.ok(item.opacity>=.55&&item.opacity<=.78,'nearby copy remains readable without full-opacity advertising');
    assert.ok(item.fadeStart>=10&&item.maxDistance<=65&&item.maxDistance>item.fadeStart,'arrival copy has a bounded distance fade');
    const planeNormal=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0),item.yaw);
    assert.ok(planeNormal.dot(new THREE.Vector3(item.nx,0,item.nz))>.9999,'plane rotation agrees with the source-facing normal');
  }
});

test('spawn eye-level rays reach both inscriptions without hitting the real building first',()=>{
  const eye=new THREE.Vector3(spawn.x,1.7,spawn.z);
  for(const id of arrivalIds){
    const item=plan.find(p=>p.id===id);
    // Cover the inscription interior, not just a convenient clear centre.
    for(const u of [-.4,0,.4])for(const v of [-.4,0,.4]){
      const target=pointOnSign(item,item.width*u,item.height*v),hit=probe(eye,target);
      assert.equal(Boolean(hit),false,`${id} (${u},${v}) is obscured by ${hit?.object.name} before its text plane`);
    }
  }
});

test('arrival paint stays on the blank band and within the existing display, not doors or windows',()=>{
  for(const id of arrivalIds){
    const item=plan.find(p=>p.id===id),normal=new THREE.Vector3(item.nx,0,item.nz);
    const expected=id==='canteen-arrival'?'canteen-entry-adjacent-solid-panel':'canteen-entry-dark-display';
    // Cast through the entire artwork footprint, including near its edges.
    // The first real surface behind each point must be its intended support.
    for(const u of [-.49,-.25,0,.25,.49])for(const v of [-.49,0,.49]){
      const point=pointOnSign(item,item.width*u,item.height*v),origin=point.clone().addScaledVector(normal,.02);
      const hit=new THREE.Raycaster(origin,normal.clone().negate(),0,2).intersectObject(facades,true)[0];
      assert.equal(hit?.object.name,expected,`${id} (${u},${v}) covers ${hit?.object.name||'empty space'} instead of ${expected}`);
    }
  }
});

test('several ambient messages remain beside mapped surface roads on their viewing side',()=>{
  const scattered=plan.filter(p=>p.id.startsWith('scattered-'));
  assert.ok(scattered.length>=3,'arrival text must not replace all roadside discoveries');
  const roads=model.roads.flatMap(record=>{
    const f=record.feature,t=f.properties.tags||{};if(t.bridge==='yes'||t.tunnel==='yes')return [];
    const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.type==='MultiLineString'?f.geometry.coordinates:[];
    return lines.map(line=>line.map(c=>geoToLocal({longitude:c[0],latitude:c[1],coordinateSystem:'EPSG:4326'},frame)));
  });
  for(const p of scattered){
    let distance=Infinity;
    for(const line of roads)for(let i=1;i<line.length;i++){
      const a=line[i-1],b=line[i],dx=b.x-a.x,dz=b.z-a.z,den=dx*dx+dz*dz;
      const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/den)):0;
      const qx=a.x+dx*t-p.x,qz=a.z+dz*t-p.z,d=Math.hypot(qx,qz);
      if(qx*p.nx+qz*p.nz>d*.45)distance=Math.min(distance,d);
    }
    assert.ok(distance<=24.05,`${p.id}: a reachable viewing-side road should be within 24m, got ${distance}`);
    assert.ok(p.lines.length===1&&[...p.lines[0]].length<=24,'narrow roadside bands use concise copy');
    assert.ok(p.height<=.95&&p.background===null,'enlarged roadside copy stays inside the available window-free band');
  }
});

test('enlarged activity copy outside the canteen stays on solid source facades with clear sightlines',()=>{
  const signs=plan.filter(p=>!p.poetryId&&p.featureId!=='way/103814566');
  assert.ok(signs.length>=6);
  for(const item of signs){
    const normal=new THREE.Vector3(item.nx,0,item.nz),distance=item.id.startsWith('gym-')?36:20;
    const eye=new THREE.Vector3(item.x+item.nx*distance,1.79,item.z+item.nz*distance);
    for(const u of [-.49,-.25,0,.25,.49])for(const v of [-.49,0,.49]){
      const point=pointOnSign(item,item.width*u,item.height*v);
      const support=new THREE.Raycaster(point.clone().addScaledVector(normal,.02),normal.clone().negate(),0,.7).intersectObject(facades,true)[0];
      assert.ok(support,`${item.id}: unsupported paint at ${u},${v}`);
      assert.equal(support.object.userData.featureId,item.featureId,`${item.id}: must stay on its source building`);
      assert.ok(!/window|glaz|door|conditioner/i.test(support.object.name),`${item.id}: covers ${support.object.name}`);
      assert.equal(Boolean(probe(eye,point)),false,`${item.id}: obscured lettering at ${u},${v}`);
    }
  }
});

test('all ten authored poems are attached to the real campus plan exactly once with their complete copy',()=>{
  const poems=plan.filter(p=>p.poetryId);
  assert.equal(poems.length,10,'an exported copy list alone is not a placed artwork');
  assert.deepEqual(new Set(poems.map(p=>p.poetryId)),new Set(CAMPUS_POETRY.map(p=>p.id)));
  for(const item of poems){
    const authored=CAMPUS_POETRY.find(p=>p.id===item.poetryId);
    assert.equal(item.text,authored.text);assert.deepEqual(item.lines,authored.lines);
    assert.equal(item.motif,authored.motif);
    assert.ok(item.inspection&&Number.isFinite(item.inspection.x+item.inspection.y+item.inspection.z));
    assert.ok(item.expectedSupportNames?.length,'placement records its actual blank supporting surface');
    assert.ok(!item.background);assert.ok(item.opacity>=.6&&item.opacity<=.98);
    assert.ok(item.fadeStart>=16&&item.maxDistance<=220&&item.maxDistance>item.fadeStart,'ordinary approach distances remain readable, with a finite distant fade');
    assert.ok(Math.hypot(item.nx,item.nz)>.999&&Math.hypot(item.nx,item.nz)<1.001);
  }
});

test('every poem footprint stays on its intended solid surface and can be seen from its inspection point',()=>{
  for(const item of plan.filter(p=>p.poetryId)){
    const normal=new THREE.Vector3(item.nx,0,item.nz),eye=new THREE.Vector3(item.inspection.x,item.inspection.y+1.65,item.inspection.z);
    if(item.presentation==='rooftop'){
      assert.equal(item.roofY,campus.records.get(item.featureId).height);
      const source=model.records.find(r=>r.id===item.featureId);
      const polygons=source.shapes.map(s=>[s.getPoints().map(p=>[p.x,-p.y]),...s.holes.map(h=>h.getPoints().map(p=>[p.x,-p.y]))]);
      for(const u of [-.36,0,.36])assert.ok(pointInLandcover(item.x+item.nz*item.width*u-item.nx*.7,item.z-item.nx*item.width*u-item.nz*.7,polygons),`${item.poetryId}: mount feet must stay on the original roof footprint`);
    }
    for(const u of [-.49,-.25,0,.25,.49])for(const v of [-.49,0,.49]){
      const point=pointOnSign(item,item.width*u,item.height*v);
      // Wall paint uses solid support; sculptural letters are supported by
      // the registered roof and their mounts, checked above.
      const hit=item.presentation==='rooftop'?null:new THREE.Raycaster(point.clone().addScaledVector(normal,.015),normal.clone().negate(),0,.65).intersectObject(campus.group,true)[0];
      if(item.presentation!=='rooftop'){
        assert.ok(hit,`${item.poetryId} (${u},${v}) floats without supporting architecture`);
        assert.ok(item.expectedSupportNames.includes(hit.object.name),`${item.poetryId} (${u},${v}) covers ${hit.object.name} instead of its blank surface`);
        if(item.expectedSupportFeatureId)assert.equal(hit.object.userData.featureId,item.expectedSupportFeatureId,`${item.poetryId} must not attach to a different unnamed building mesh`);
      }else assert.ok(item.y-item.height/2>item.roofY+.5,'roof letters clear the existing roof');
      const delta=point.clone().sub(eye),distance=delta.length();
      const obstruction=new THREE.Raycaster(eye,delta.normalize(),0,distance-.005).intersectObject(campus.group,true)[0];
      assert.equal(Boolean(obstruction),false,`${item.poetryId} inspection blocked by ${obstruction?.object.name}`);
    }
  }
});

test('relocated poems are visible from safe ordinary route approaches, not only their close inspection points',()=>{
  const relocated=plan.filter(p=>p.poetryId&&p.approach);
  assert.ok(relocated.length>=6,'at least the two rear canteen, two deep corridor and two ankle-height placements need ordinary-route access');
  const world=createPlayerWorld(model);
  const player=createPlayerMotion({world,route:{points:[{x:400,z:400,y:.14},{x:1000,z:400,y:.14}]}});
  for(const item of relocated){
    const pose=item.approach;
    assert.ok(item.approachLabel?.trim(),'name the actual entrance or walking route used for the sightline');
    assert.ok(Number.isFinite(pose.x+pose.y+pose.z+pose.yaw+pose.pitch));
    assert.deepEqual(campusLandmarkArrival(campus,`${item.id}-approach`),pose,'shared review link uses this ordinary route viewpoint');
    assert.equal(player.placeWalker(pose).ok,true,`${item.poetryId}: normal walker must fit at the route approach`);
    assert.ok(Math.abs(player.state.y-pose.y)<.04,`${item.poetryId}: approach belongs to ground level, not an airborne camera`);
    if(pose.sourceId){
      const road=model.roads.find(record=>record.id===pose.sourceId),geometry=road?.feature.geometry;
      assert.ok(geometry,`${item.poetryId}: claimed approach road exists in the real map`);
      const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.type==='MultiLineString'?geometry.coordinates:[];
      let nearest=Infinity;
      for(const line of lines){
        const points=line.map(c=>geoToLocal({longitude:c[0],latitude:c[1],coordinateSystem:'EPSG:4326'},frame));
        for(let i=1;i<points.length;i++){
          const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,lengthSq=dx*dx+dz*dz;
          const t=lengthSq?Math.max(0,Math.min(1,((pose.x-a.x)*dx+(pose.z-a.z)*dz)/lengthSq)):0;
          nearest=Math.min(nearest,Math.hypot(pose.x-a.x-dx*t,pose.z-a.z-dz*t));
        }
      }
      assert.ok(nearest<.02,`${item.poetryId}: sightline starts on its declared road, not an invented convenient point`);
    }
    if(item.poetryId==='life-ai')assert.ok(Math.hypot(pose.x-spawn.x,pose.z-spawn.z)<.02,'the front canteen poem is visible from the existing spawn');
    const eye=new THREE.Vector3(pose.x,pose.y+1.65,pose.z),horizontal=Math.hypot(pose.x-item.x,pose.z-item.z);
    assert.ok(horizontal>=1.2&&horizontal<=(item.presentation==='rooftop'?100:18),`${item.poetryId}: ordinary approach distance ${horizontal}`);
    assert.ok(((pose.x-item.x)*item.nx+(pose.z-item.z)*item.nz)/horizontal>.25,`${item.poetryId}: not visible only at a grazing angle`);
    assert.ok(Math.abs(Math.atan2(item.y-eye.y,horizontal))<Math.PI/4,`${item.poetryId}: does not require looking straight up or down`);
    for(const u of [-.49,-.25,0,.25,.49])for(const v of [-.49,0,.49]){
      const target=pointOnSign(item,item.width*u,item.height*v),delta=target.clone().sub(eye),distance=delta.length();
      const hit=new THREE.Raycaster(eye,delta.normalize(),0,distance-.005).intersectObject(campus.group,true)[0];
      assert.equal(Boolean(hit),false,`${item.poetryId}: ordinary route view (${u},${v}) blocked by ${hit?.object.name}`);
    }
  }
  assert.equal(campusLandmarkArrival(campus,null),null,'the normal URL keeps the existing canteen spawn');
  assert.equal(campusLandmarkArrival(campus,'poem-unknown-approach'),null,'unknown review links cannot invent a camera pose');
});

test('poetry placements keep clear of other inscriptions on the same facade',()=>{
  for(let i=0;i<plan.length;i++)for(let j=i+1;j<plan.length;j++){
    const a=plan[i],b=plan[j];
    if(!a.poetryId&&!b.poetryId)continue;
    if(a.nx*b.nx+a.nz*b.nz<.999)continue;
    const dx=b.x-a.x,dz=b.z-a.z;
    if(Math.abs(dx*a.nx+dz*a.nz)>.5)continue;
    const along=Math.abs(dx*a.nz-dz*a.nx),vertical=Math.abs(b.y-a.y);
    assert.ok(along>=(a.width+b.width)/2+.12||vertical>=(a.height+b.height)/2+.12,`${a.id} and ${b.id} overlap or crowd the same wall`);
  }
});

test('production artwork meshes stay matte and readable nearby, fade continuously, and disappear at distance',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  let layer;
  // Only the canvas transport is stubbed. We exercise the actual plan,
  // texture/material construction and update(), not a second fade formula.
  const canvases=[];
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(tag){
    assert.equal(tag,'canvas');
    const text=[],stack=[];
    const ctx={font:'10px serif',textAlign:'start',globalAlpha:1,
      measureText(value){const px=Number(this.font.match(/([\d.]+)px/)?.[1]||10);return {width:[...value].reduce((n,c)=>n+(/\s/.test(c)?.35:/[\u0000-\u007f]/.test(c)?.64:1.05),0)*px,px};},
      fillText(value,x,y){const {width,px}=this.measureText(value),left=x-(this.textAlign==='center'?width/2:this.textAlign==='right'?width:0);text.push({value,left,right:left+width,top:y-px*.52,bottom:y+px*.52});},
      save(){stack.push({font:this.font,textAlign:this.textAlign,globalAlpha:this.globalAlpha});},
      restore(){Object.assign(this,stack.pop());},
    };
    for(const name of ['clearRect','fillRect','scale','beginPath','moveTo','lineTo','bezierCurveTo','stroke','strokeRect','strokeText','arc','ellipse','fill'])ctx[name]=()=>{};
    const canvas={width:0,height:0,text,getContext(type){assert.equal(type,'2d');return ctx;}};canvases.push(canvas);return canvas;
  }}});
  try{
    layer=createCampusAIMurals(THREE,model,campus.records,{frame,geoToLocal});
    assert.equal(layer.group.children.length,layer.plan.length,'each planned artwork has a runtime mesh');
    assert.equal(canvases.length,layer.plan.filter(p=>p.presentation!=='rooftop').length);
    let canvasIndex=0;
    const camera=new THREE.PerspectiveCamera();
    for(const [index,item]of layer.plan.entries()){
      const mesh=layer.group.getObjectByName(`ai-wall-${item.id}`),material=mesh.material;
      const canvas=item.presentation==='rooftop'?null:canvases[canvasIndex++];
      if(canvas){
      const commands=item.vertical||item.motif==='orbit'?[...item.lines.join('')]:item.lines;
      assert.deepEqual(canvas.text.map(t=>t.value),commands,`${item.id}: production canvas keeps all original characters`);
      for(const t of canvas.text)assert.ok(t.left>=0&&t.right<=canvas.width&&t.top>=0&&t.bottom<=canvas.height,`${item.id}: production texture ${canvas.width}×${canvas.height} clips ${JSON.stringify(t)}`);
      }
      assert.ok(material.isMeshStandardMaterial&&material.transparent);
      assert.ok(material.roughness>=(item.presentation==='rooftop'?.5:.9));
      assert.equal(material.depthWrite,item.presentation==='rooftop','only solid roof lettering writes depth');
      const at=distance=>{camera.position.set(item.x+item.nx*distance,item.y,item.z+item.nz*distance);layer.update(camera);};
      at(2);assert.equal(mesh.visible,true);assert.ok(Math.abs(material.opacity-item.opacity)<1e-8);
      const nearOpacity=material.opacity;
      at((item.fadeStart+item.maxDistance)/2);assert.equal(mesh.visible,true);assert.ok(material.opacity>0&&material.opacity<nearOpacity);
      const middleOpacity=material.opacity;
      at(item.maxDistance-.5);assert.ok(material.opacity>=0&&material.opacity<middleOpacity);
      at(item.maxDistance+1);assert.equal(mesh.visible,false);assert.equal(material.opacity,0);
      at(2);assert.equal(mesh.visible,true);assert.ok(Math.abs(material.opacity-nearOpacity)<1e-8,'approaching restores readable pigment');
    }
  }finally{
    if(layer?.dispose)layer.dispose();
    else layer?.group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
    if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;
  }
});
