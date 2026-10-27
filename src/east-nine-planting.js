import {waterFootprint} from './water-details.js';
import {getRoadProfile} from './building-profiles.js';

const SOURCE_IDS=new Set(['way/102754430','way/102754452']);
export const EAST_NINE_PLANTING_EVIDENCE=Object.freeze({
  photographs:['/references/local-campus/east-nine-curtainwall.webp','/references/local-campus/east-nine-approach.webp'],
  observed:'Low clipped green hedges, unequal purple-leaved rounded shrubs, open grass and a few radial feather-leaf plants beside entrances; no dense tall trees across the forecourt.',
  inferred:'Species, individual planting positions, hedge contours and dimensions are photo-informed estimates within the two existing source greens; not a horticultural survey.',
  sourceFootprintPreserved:true,units:'metres',dimensionsStatus:'photo-informed estimate',
});
const randomFrom=seed=>{let state=seed>>>0;return()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};};
function distance(x,z,a,b){const dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/l)):0;return Math.hypot(x-a.x-t*dx,z-a.z-t*dz);}
function exclusions(model,existingTrees){
  const footprints=(model.records||[]).filter(r=>['road','building','water','sports'].includes(r.category)||r.feature?.properties?.tags?.amenity==='parking').map(r=>({footprint:waterFootprint(r),margin:r.category==='road'?.35:.2})).filter(o=>o.footprint);
  const segments=[];
  for(const road of model.roads||[]){const width=getRoadProfile(road.feature).width;road.group?.updateWorldMatrix(true,true);road.group?.traverse(o=>{if(!o.isLine||o.isLineSegments)return;const p=o.geometry.attributes.position,m=o.matrixWorld.elements,at=i=>({x:m[0]*p.getX(i)+m[4]*p.getY(i)+m[8]*p.getZ(i)+m[12],z:m[2]*p.getX(i)+m[6]*p.getY(i)+m[10]*p.getZ(i)+m[14]});for(let i=1;i<p.count;i++)segments.push({a:at(i-1),b:at(i),clearance:width/2+.35});});}
  return(x,z,r)=>footprints.some(o=>o.footprint.contains(x,z)||o.footprint.distance(x,z)<r+o.margin)||segments.some(s=>distance(x,z,s.a,s.b)<r+s.clearance)||existingTrees.some(t=>Math.hypot(x-t.x,z-t.z)<r+.7);
}

/** Reuses the accepted forecourt hedge path and accent-island centres. New
 * canopy/soil footprints are checked against the actual source and every road,
 * water/building/parking mask. A rejected object is omitted, never relocated. */
export function planEastNinePlanting(model,forecourtPlan,{existingTrees=[]}={}){
  if(!model?.records||!forecourtPlan?.patches||!forecourtPlan?.plants)throw new TypeError('Source model and planEastNineForecourt plan required');
  const blocked=exclusions(model,existingTrees),patches=[],plants=[],soil=[],grass=[];
  for(const sourcePatch of forecourtPlan.patches){
    if(!SOURCE_IDS.has(sourcePatch.id))continue;const record=model.records.find(r=>r.id===sourcePatch.id),footprint=record&&waterFootprint(record);if(!footprint)continue;
    const patch={...sourcePatch,footprint};patches.push(patch);const safe=(x,z,r)=>footprint.contains(x,z)&&footprint.distance(x,z)>r+.15&&!blocked(x,z,r),rng=randomFrom(patch.id.endsWith('430')?102754430:102754452);
    const basis={sourceId:patch.id,positionStatus:'inferred within unchanged source green',dimensionsStatus:'photo-informed estimate'};
    const at=(u,v)=>({x:patch.centre.x+patch.axes.tx*u+patch.axes.nx*v,z:patch.centre.z+patch.axes.tz*u+patch.axes.nz*v});
    // Preserve every accepted point of the existing continuous hedge path.
    for(const p of forecourtPlan.plants.filter(p=>p.sourceId===patch.id&&p.kind==='hedge'))if(safe(p.x,p.z,p.radius))plants.push({...p,height:p.height*(.95+rng()*.1),kind:'hedge',seed:rng(),...basis});
    // The previous sixteen tiny blocks around each island are one rounded
    // clipped shrub now; centres still follow the original four-island plan.
    for(const [i,f]of[-.58,-.2,.2,.58].entries()){
      const centre=at(patch.radii.a*f,0),oldRadius=Math.min(1.4,patch.radii.b*.27),radius=oldRadius+.25,height=.85+(i%2)*.23+rng()*.16;
      if(safe(centre.x,centre.z,radius)){plants.push({...centre,radius,height,kind:'purple-mound',yaw:rng()*Math.PI,seed:rng(),...basis});soil.push({...centre,radius:radius*.78,y:.052,seed:rng(),...basis});}
    }
    // Two modest feather-leaf accents in total, inside the registered greens.
    // The photographs do not justify adding palms or trees across the entrance.
    const palm=at(0,patch.radii.b*.50),palmRadius=1.35;
    if(safe(palm.x,palm.z,palmRadius)&&plants.every(p=>Math.hypot(p.x-palm.x,p.z-palm.z)>p.radius+palmRadius*.75)){plants.push({...palm,radius:palmRadius,height:1.5,kind:'cycad',yaw:rng()*Math.PI,seed:rng(),...basis});soil.push({...palm,radius:.45,y:.054,seed:rng(),...basis});}
    // Sparse grass tufts and shallow exposed-soil marks stay inside each green;
    // neither the existing lawn mesh nor the kerb is reproduced by this layer.
    const b=footprint.bounds;
    for(let attempt=0;attempt<1000&&grass.filter(p=>p.sourceId===patch.id).length<100;attempt++){
      const x=b.minX+rng()*(b.maxX-b.minX),z=b.minZ+rng()*(b.maxZ-b.minZ),radius=.08+rng()*.08;
      if(!safe(x,z,radius)||plants.some(p=>Math.hypot(p.x-x,p.z-z)<p.radius+.15))continue;
      grass.push({x,z,radius,height:.07+rng()*.10,seed:rng(),...basis});
      if(attempt%37===0&&safe(x,z,.22))soil.push({x,z,radius:.12+rng()*.1,y:.046,seed:rng(),...basis});
    }
  }
  return{patches,plants,soil,grass,blocked,evidence:EAST_NINE_PLANTING_EVIDENCE};
}

function foliageTexture(THREE){
  const size=128,pixels=new Uint8Array(size*size*4),rng=randomFrom(438941),leaves=[];
  for(let i=0;i<108;i++){const a=rng()*Math.PI*2,r=Math.sqrt(rng())*.43;leaves.push({x:.5+Math.cos(a)*r,y:.5+Math.sin(a)*r,rx:.028+rng()*.036,ry:.022+rng()*.023,a:rng()*Math.PI,shade:.78+rng()*.22});}
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const u=(x+.5)/size,v=(y+.5)/size;let alpha=0,shade=1;for(const l of leaves){const dx=u-l.x,dy=v-l.y,c=Math.cos(l.a),s=Math.sin(l.a),d=((dx*c+dy*s)/l.rx)**2+((-dx*s+dy*c)/l.ry)**2;if(d<1){alpha=255;shade=l.shade*(.90+.10*Math.sqrt(1-d));}}const value=Math.round(shade*255);pixels.set([value,value,value,alpha],(y*size+x)*4);}
  const texture=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
function makeGeometry(THREE,positions,colors,uvs){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));if(uvs)g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.computeVertexNormals();g.computeBoundingSphere();return g;}
function normaliseCanopy(g){const p=g.attributes.position;let r=0,minY=Infinity,maxY=-Infinity;for(let i=0;i<p.count;i++){r=Math.max(r,Math.hypot(p.getX(i),p.getZ(i)));minY=Math.min(minY,p.getY(i));maxY=Math.max(maxY,p.getY(i));}g.translate(0,-minY,0);g.scale(1/r,1/(maxY-minY),1/r);g.computeBoundingSphere();return g;}
function moundGeometry(THREE,{purple=false,seed=14}={}){
  const rng=randomFrom(seed),positions=[],colors=[],uvs=[],q=new THREE.Quaternion(),normal=new THREE.Vector3(),centre=new THREE.Vector3(),v=new THREE.Vector3(),tint=new THREE.Color(),corners=[[-.5,-.5,0],[.5,-.5,0],[.5,.5,0],[-.5,.5,0],[0,0,.035]],faces=[[0,1,4],[1,2,4],[2,3,4],[3,0,4]];
  // Small tangent sprays wrap a soft clipped oval, with an uneven leafy edge.
  // No solid sphere or rounded box is left visible beneath the foliage.
  for(let i=0;i<(purple?108:64);i++){const a=i*2.39996+rng()*.3,y=.08+rng()*.88,r=Math.sqrt(Math.max(0,1-(y*2-1)**2))*(.78+rng()*.17);centre.set(Math.cos(a)*r,y,Math.sin(a)*r);normal.set(centre.x,(y-.5)*2,centre.z).normalize();q.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);const size=.40+rng()*.14;
    tint.set(purple?(i%4?'#49313b':'#553c43'):(i%4?'#486035':'#59733d')).multiplyScalar(.86+rng()*.24+(y-.5)*.08);
    for(const face of faces)for(const index of face){const p=corners[index];v.set(p[0]*size,p[1]*size,p[2]).applyQuaternion(q).add(centre);positions.push(v.x,v.y,v.z);colors.push(tint.r,tint.g,tint.b);uvs.push(p[0]+.5,p[1]+.5);}
  }
  return normaliseCanopy(makeGeometry(THREE,positions,colors,uvs));
}
function cycadGeometry(THREE){
  const positions=[],colors=[],color=new THREE.Color(),triangle=(a,b,c,tint)=>{color.set(tint);for(const p of[a,b,c]){positions.push(...p);colors.push(color.r,color.g,color.b);}},point=(a,r,y,t=0)=>[Math.cos(a)*r-Math.sin(a)*t,y,Math.sin(a)*r+Math.cos(a)*t];
  const trunk=new THREE.CylinderGeometry(.12,.18,.72,9,3).toNonIndexed();trunk.translate(0,.36,0);const p=trunk.attributes.position;for(let i=0;i<p.count;i++){positions.push(p.getX(i),p.getY(i),p.getZ(i));color.set(i%7?'#514832':'#6b6041');colors.push(color.r,color.g,color.b);}trunk.dispose();
  for(let f=0;f<13;f++){const a=f*Math.PI*2/13,yaw=.06*Math.sin(f*3),path=t=>point(a+yaw,.06+t*1.12,.69+Math.sin(t*Math.PI)*.44-t*.12);
    for(let n=1;n<=15;n++){const t=n/15,c=path(t),before=path((n-1)/15),width=.011;triangle([before[0]-Math.sin(a)*width,before[1],before[2]+Math.cos(a)*width],[c[0],c[1],c[2]],[before[0]+Math.sin(a)*width,before[1],before[2]-Math.cos(a)*width],'#516332');
      if(n<2||n>14)continue;const length=.25*Math.sin(t*Math.PI)**.6+.04;
      for(const side of[-1,1]){const base=path(t-.025),tip=point(a+yaw,.06+t*1.12+.10,.69+Math.sin(t*Math.PI)*.44-t*.12-.08,side*length),ridge=[(c[0]+tip[0])*.5,(c[1]+tip[1])*.5+.015,(c[2]+tip[2])*.5],other=path(t+.025);triangle(base,ridge,tip,side>0?'#304c2e':'#3d5d32');triangle(ridge,other,tip,'#426334');}
    }
  }
  return normaliseCanopy(makeGeometry(THREE,positions,colors));
}
function grassGeometry(THREE){const positions=[],colors=[],color=new THREE.Color();for(let i=0;i<9;i++){const a=i*2.399,r=(i%3)*.15,w=.035,h=.55+(i%4)*.13,base=[Math.cos(a)*r,0,Math.sin(a)*r],tip=[base[0]+Math.cos(a)*.35,h,base[2]+Math.sin(a)*.35];color.set(i%3?'#687a44':'#8b8c55');for(const p of[[base[0]-Math.sin(a)*w,0,base[2]+Math.cos(a)*w],tip,[base[0]+Math.sin(a)*w,0,base[2]-Math.cos(a)*w]]){positions.push(...p);colors.push(color.r,color.g,color.b);}}return normaliseCanopy(makeGeometry(THREE,positions,colors));}

/** Replaces only the old hedge/accent visuals. No hardscape, kerbs, parking,
 * people or tall trees are added; all foliage uses a bounded instance budget. */
export function createEastNinePlanting(THREE,model,{plan:forecourtPlan,existingTrees=[]}={}){
  const plan=planEastNinePlanting(model,forecourtPlan,{existingTrees}),group=new THREE.Group();group.name='东九前场 · 低绿篱、紫叶圆丘与苏铁';group.userData={component:'east-nine-photo-planting',...EAST_NINE_PLANTING_EVIDENCE,sourceIds:plan.patches.map(p=>p.id),plantCount:plan.plants.length};
  const texture=foliageTexture(THREE),foliage=new THREE.MeshStandardMaterial({color:'#ffffff',map:texture,alphaTest:.43,alphaToCoverage:true,roughness:.96,side:THREE.DoubleSide,vertexColors:true}),solid=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.95,side:THREE.DoubleSide,vertexColors:true}),soilMat=new THREE.MeshStandardMaterial({color:'#5b5940',roughness:1,side:THREE.DoubleSide}),geometries=[],materials=[foliage,solid,soilMat],meshes=[],dummy=new THREE.Object3D(),color=new THREE.Color();
  const metadata={...group.userData,dimensionsStatus:'photo-informed estimate',positionsStatus:'accepted forecourt layout within source geometry'};
  function batch(items,geometry,material,name,{ground=false}={}){geometries.push(geometry);if(!items.length)return;const mesh=new THREE.InstancedMesh(geometry,material,items.length);mesh.name=name;items.forEach((p,i)=>{dummy.position.set(p.x,ground?p.y||.046:.055,p.z);dummy.rotation.set(0,p.yaw??p.seed*Math.PI*2,0);dummy.scale.set(p.radius,ground?1:p.height,p.radius);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);color.setHSL(.08,.015,.88+(p.seed||0)*.12);mesh.setColorAt(i,color);});mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=!ground;mesh.receiveShadow=true;mesh.renderOrder=ground?202:205;mesh.raycast=()=>{};mesh.userData={...metadata,component:name,instanceSourceIds:items.map(p=>p.sourceId),instanceFootprints:items.map(p=>({x:p.x,z:p.z,radius:p.radius,height:p.height||0}))};meshes.push(mesh);group.add(mesh);}
  batch(plan.plants.filter(p=>p.kind==='hedge'),moundGeometry(THREE),foliage,'east-nine-leafy-hedge');
  batch(plan.plants.filter(p=>p.kind==='purple-mound'),moundGeometry(THREE,{purple:true,seed:42}),foliage,'east-nine-purple-mound');
  batch(plan.plants.filter(p=>p.kind==='cycad'),cycadGeometry(THREE),solid,'east-nine-radial-cycad');
  batch(plan.grass,grassGeometry(THREE),solid,'east-nine-sparse-grass');
  const soilGeometry=new THREE.CircleGeometry(1,13);soilGeometry.rotateX(-Math.PI/2);batch(plan.soil,soilGeometry,soilMat,'east-nine-thin-soil',{ground:true});
  plan.counts={plants:plan.plants.length,hedges:plan.plants.filter(p=>p.kind==='hedge').length,purpleMounds:plan.plants.filter(p=>p.kind==='purple-mound').length,cycads:plan.plants.filter(p=>p.kind==='cycad').length,grass:plan.grass.length,soil:plan.soil.length,drawCalls:meshes.length,triangles:meshes.reduce((n,m)=>n+(m.geometry.index?.count||m.geometry.attributes.position.count)/3*m.count,0)};
  let disposed=false;return{group,plan,dispose(){if(disposed)return;disposed=true;meshes.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());texture.dispose();group.removeFromParent();group.clear();}};
}
