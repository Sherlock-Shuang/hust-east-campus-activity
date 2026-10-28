import {createStaticInstanceSelection} from './static-instance-lod.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

function randomFrom(seed) {
  let state=(seed>>>0)||1;
  return()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}

/** A cutout branch spray shared by tree and shrub batches. The mask is generated
 * from overlapping oval leaves; it is not a photo texture or an opaque ball. */
const sprayPixelCache=new Map();
function createSprayTexture(THREE,seed=915719) {
  const size=128;
  function textureFor(pixels){const texture=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;}
  // Each layer still owns its texture and data; only deterministic CPU mask
  // generation is reused. Disposal or edits cannot affect another layer.
  if(sprayPixelCache.has(seed))return textureFor(sprayPixelCache.get(seed).slice());
  const pixels=new Uint8Array(size*size*4),random=randomFrom(seed),leaves=[];
  // More, smaller leaves keep the spray's covered area while fixing oversized
  // near-camera leaves seen in the local lake photographs. 144 × .8² ≈ 92.
  for(let i=0;i<144;i++){
    const angle=random()*Math.PI*2,r=Math.sqrt(random())*.415;
    leaves.push({x:.5+Math.cos(angle)*r,y:.5+Math.sin(angle)*r,rx:(.035+random()*.047)*.8,ry:(.025+random()*.036)*.8,angle:random()*Math.PI,shade:.74+random()*.26});
  }
  for(const leaf of leaves){leaf.cos=Math.cos(leaf.angle);leaf.sin=Math.sin(leaf.angle);}
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let alpha=0,shade=1;const u=(x+.5)/size,v=(y+.5)/size;
    for(const leaf of leaves){const dx=u-leaf.x,dy=v-leaf.y,c=leaf.cos,s=leaf.sin,a=(dx*c+dy*s)/leaf.rx,b=(-dx*s+dy*c)/leaf.ry,d=a*a+b*b;if(d<1){alpha=255;shade=leaf.shade*(.88+.12*Math.sqrt(1-d));}}
    // Solid centre is also a UV swatch for individually modelled silhouette leaves.
    if(Math.abs(u-.5)<.025&&Math.abs(v-.5)<.025){alpha=255;shade=1;}
    const value=Math.round(255*shade);pixels.set([value,value,value,alpha],(y*size+x)*4);
  }
  if(sprayPixelCache.size>=4)sprayPixelCache.delete(sprayPixelCache.keys().next().value);
  sprayPixelCache.set(seed,pixels.slice());return textureFor(pixels);
}
function sprayGeometry(THREE,clumps,{random,count,folded=false,scale=1}={}){
  const positions=[],colors=[],uvs=[],tint=new THREE.Color(),matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();
  const corners=folded?[[-.5,-.5,0],[.5,-.5,0],[.5,.5,0],[-.5,.5,0],[0,0,.12]]:[[-.5,-.5,0],[.5,-.5,0],[.5,.5,0],[-.5,.5,0]],faces=folded?[[0,1,4],[1,2,4],[2,3,4],[3,0,4]]:[[0,1,2],[0,2,3]];
  for(let n=0;n<count;n++){
    const c=clumps[n%clumps.length],a=random()*Math.PI*2,r=Math.sqrt(random())*.72,dy=(random()-.5)*c.ry*1.2;
    // Multiple oblique, upright and horizontal sprays occupy a crown volume.
    // No spray faces the camera, so looking up into a tree retains its depth.
    rotation.setFromEuler(new THREE.Euler(n%3===0?Math.PI*.5+(random()-.5)*.45:(random()-.5)*2.5,random()*Math.PI*2,(random()-.5)*1.8));
    matrix.compose(new THREE.Vector3(c.x+Math.cos(a)*c.rx*r,c.y+dy,c.z+Math.sin(a)*c.rz*r),rotation,new THREE.Vector3(c.rx*2.05*scale,c.ry*1.8*scale,1));
    tint.setHSL(.245+random()*.045,.37+random()*.14,.235+random()*.075+(dy/c.ry)*.025,THREE.SRGBColorSpace);
    for(const face of faces)for(const index of face){const p=corners[index],v=new THREE.Vector3(...p).applyMatrix4(matrix);positions.push(v.x,v.y,v.z);colors.push(tint.r,tint.g,tint.b);uvs.push(p[0]+.5,p[1]+.5);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.computeVertexNormals();g.computeBoundingSphere();return g;
}

/** Photograph-informed mature, young and layered broadleaf trees. Crowns use
 * overlapping three-dimensional bough sprays plus silhouette leaves instead
 * of thousands of isolated leaf blades. Six shared forms have exact declared
 * height/crown bounds, instancing, frustum filtering and distance LOD.
 * Species, individual shapes and dimensions remain reconstruction estimates.
 */
export function createTreeLayer(THREE, trees, {name='photo-informed-trees',detail='street',whitewash=true,barkMaterial,foliageMaterial}={}) {
  const group=new THREE.Group();group.name=name;
  group.userData={component:name,geometryEvidence:'photo-informed forked broadleaf trees; species, individual form and dimensions inferred',individualPositions:'supplied source coverage or inferred roadside planting, not surveyed'};
  const geometries=new Set(),ownedMaterials=new Set(),textures=new Set(),models=[],farModels=[],horizonModels=[],modelBounds=[];
  const own=m=>{ownedMaterials.add(m);return m;};
  const bark=barkMaterial||own(new THREE.MeshStandardMaterial({color:'#706c56',roughness:.98}));
  const canopyTexture=createSprayTexture(THREE);textures.add(canopyTexture);
  const foliage=own(foliageMaterial?foliageMaterial.clone():new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.9,metalness:0,side:THREE.DoubleSide,vertexColors:true}));foliage.map=canopyTexture;foliage.alphaTest=.43;foliage.alphaToCoverage=true;foliage.side=THREE.DoubleSide;foliage.vertexColors=true;
  const lime=own(new THREE.MeshStandardMaterial({color:'#d5d5bb',roughness:1}));
  // Crown mass is supplied by 120/160 folded sprays, while true leaf blades
  // preserve close silhouettes. This cuts near-crown triangles by over 75%.
  const leafCount=detail==='forest'?240:420,sprayCount=detail==='forest'?120:160,variantCount=6,farLeafCount=64;
  const distantFoliage=own(new THREE.MeshStandardMaterial({color:'#ffffff',map:canopyTexture,alphaTest:.43,alphaToCoverage:true,roughness:.92,side:THREE.DoubleSide,vertexColors:true}));
  for(let variant=0;variant<variantCount;variant++) {
    const random=randomFrom(17339+variant*7717),branches=[],painted=[];
    const crownWidth=[1.16,.94,.73][variant%3],crownRise=[.83,1,1.13][variant%3];
    function branch(a,b,ra,rb,parts=branches) {
      const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),d=end.clone().sub(start),g=new THREE.CylinderGeometry(rb,ra,d.length(),detail==='forest'?5:7,1);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));g.translate(...start.add(end).multiplyScalar(.5).toArray());
      const non=g.toNonIndexed();g.dispose();parts.push(non);
    }
    const leanX=(random()-.5)*.44,leanZ=(random()-.5)*.38;
    branch([0,0,0],[leanX,.95,leanZ],.36,.30);
    branch([leanX,.95,leanZ],[leanX*.7,3.15,leanZ*.6],.30,.205);
    branch([leanX*.7,3.15,leanZ*.6],[leanX+.12,5.35,leanZ-.08],.205,.085);
    if(whitewash){branch([0,0,0],[leanX,.95,leanZ],.364,.304,painted);branch([leanX,.95,leanZ],[leanX*.92,1.5,leanZ*.9],.304,.281,painted);}
    // Roots remain low against the soil and stop well before a pavement edge.
    for(let k=0;k<5;k++){const angle=k*1.26+random()*.3;branch([Math.cos(angle)*.55,.03,Math.sin(angle)*.55],[0,.34,0],.06,.12);}
    const clumps=[];
    for(let k=0;k<15;k++) {
      const angle=k*2.399+variant*.7,r=k<10?1.55+random()*.75:.55+random()*.6;
      const c={x:Math.cos(angle)*r*crownWidth+leanX,y:5.4+((k<10?6.3+random()*1.35:8.2+random()*.35)-5.4)*crownRise,z:Math.sin(angle)*r*crownWidth+leanZ,rx:(1.18+random()*.42)*crownWidth,ry:(1.18+random()*.55)*crownRise,rz:(1.2+random()*.4)*crownWidth};clumps.push(c);
      const fork=[leanX*.6,3.3+(k%3)*.48,leanZ*.7],elbow=[c.x*.48,5.1+(k%3)*.25,c.z*.48];
      branch(fork,elbow,.115,.059);branch(elbow,[c.x,c.y-.35,c.z],.053,.018);
      if(detail!=='forest')for(let t=0;t<2;t++){const a=angle+(t?-.6:.6);branch([c.x*.7,c.y-.75,c.z*.7],[c.x+Math.cos(a)*.85,c.y+.1+random()*.4,c.z+Math.sin(a)*.85],.022,.006);}
    }
    const positions=[],colors=[],uvs=[],tints=new THREE.Color(),leafMatrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();
    // An oval outline and a softly curved midrib avoid angular paper-like crowns. Shading
    // and many overlapping leaf edges supply fine texture and dappled shadows.
    const blade=[[0,0,-.5],[-.43,.01,0],[0,.01,.5],[.43,.01,0],[0,.055,0]],faces=Array.from({length:4},(_,i)=>[i,(i+1)%4,4]);
    for(let i=0;i<leafCount;i++) {
      const c=clumps[i%clumps.length],angle=random()*Math.PI*2,vertical=random()*2-1,radial=Math.sqrt(1-vertical*vertical),radius=.7+random()*.3;
      const x=c.x+Math.cos(angle)*radial*radius*c.rx,y=c.y+vertical*radius*c.ry,z=c.z+Math.sin(angle)*radial*radius*c.rz;
      const length=(detail==='forest'?.27+random()*.14:.24+random()*.14)*.7,width=length*(.45+random()*.24);
      rotation.setFromEuler(new THREE.Euler((random()-.5)*1.45,random()*Math.PI*2,(random()-.5)*1.3));leafMatrix.compose(new THREE.Vector3(x,y,z),rotation,new THREE.Vector3(width,length,length));
      const shade=.26+random()*.105+(y-6)*.009;
      // Vertex colors are linear; choosing photographed foliage tones in sRGB
      // avoids the washed-out, silvery canopy caused by unconverted HSL values.
      tints.setHSL(.255+random()*.035,.34+random()*.16,shade,THREE.SRGBColorSpace);
      for(const face of faces)for(const index of face){const v=new THREE.Vector3(...blade[index]).applyMatrix4(leafMatrix);positions.push(v.x,v.y,v.z);colors.push(tints.r,tints.g,tints.b);uvs.push(.5,.5);}
    }
    const edgeLeaves=new THREE.BufferGeometry();edgeLeaves.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));edgeLeaves.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));edgeLeaves.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));edgeLeaves.computeVertexNormals();
    const sprays=sprayGeometry(THREE,clumps,{random,count:sprayCount,folded:true,scale:.9});
    const leaves=mergeGeometries([edgeLeaves,sprays],false);edgeLeaves.dispose();sprays.dispose();leaves.computeBoundingSphere();geometries.add(leaves);
    function merged(parts){if(!parts.length)return null;const g=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());g.computeBoundingSphere();geometries.add(g);return g;}
    const distantLeaves=sprayGeometry(THREE,clumps,{random:randomFrom(17339+variant*7717+991),count:farLeafCount,scale:1.15});geometries.add(distantLeaves);
    // Beyond a few hundred metres twigs/trunks are subpixel. Twelve volumetric
    // sprays retain each tree crown and its original placement at 24 triangles.
    const horizonLeaves=sprayGeometry(THREE,clumps,{random:randomFrom(17339+variant*7717+991),count:12,scale:1.15});geometries.add(horizonLeaves);
    horizonModels.push([{geometry:horizonLeaves,material:distantFoliage,part:'horizon-canopy'}]);
    // Normalise all LODs together so declared height/radius are real geometry
    // bounds, rather than an approximate divide-by-ten scale that varies by form.
    const extent=new THREE.Box3();let radius=0;
    for(const g of [leaves,distantLeaves,horizonLeaves]){g.computeBoundingBox();extent.union(g.boundingBox);const p=g.attributes.position;for(let i=0;i<p.count;i++)radius=Math.max(radius,Math.hypot(p.getX(i),p.getZ(i)));}
    modelBounds.push({height:extent.max.y,radius});
    const distantTrunk=merged(branches.slice(0,3).map(g=>g.clone()));
    farModels.push([{geometry:distantTrunk,material:bark,part:'branches-distant'},{geometry:distantLeaves,material:distantFoliage,part:'leaves-distant'}]);
    models.push([{geometry:merged(branches),material:bark,part:'branches'},{geometry:leaves,material:foliage,part:'leaves'},...(painted.length?[{geometry:merged(painted),material:lime,part:'whitewash'}]:[])]);
  }
  const transform=new THREE.Object3D(),color=new THREE.Color(),batches=[];
  for(let v=0;v<variantCount;v++) {
    const samples=trees.map((p,i)=>({...p,index:i})).filter(p=>{const formIndex={spreading:0,oval:1,upright:2}[p.form];return (formIndex===undefined?p.index%variantCount:formIndex+(p.index%2)*3)===v;});if(!samples.length)continue;
    for(const part of [...models[v],...farModels[v],...horizonModels[v]]) {
      const mesh=new THREE.InstancedMesh(part.geometry,part.material,samples.length);mesh.name=`${name}-${part.part}-${v}`;mesh.castShadow=!part.part.endsWith('distant')&&part.part!=='horizon-canopy';mesh.receiveShadow=true;mesh.renderOrder=205;
      mesh.userData={...group.userData,part:part.part,variant:v,instanceFeatureIds:samples.map(p=>p.featureId||p.sourceRoadId||null)};mesh.raycast=()=>{};
      const matrices=[],tints=[];samples.forEach((tree,i)=>{const seed=Number.isFinite(tree.seed)?tree.seed:(tree.index*.6180339)%1,h=tree.height||9,shape=modelBounds[v],spread=(tree.radius||h*.36)/shape.radius;
        transform.position.set(tree.x,tree.y||.1,tree.z);transform.rotation.set(0,seed*Math.PI*2,0);transform.scale.set(spread,h/shape.height,spread);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);matrices.push(transform.matrix.clone());
        color.setHSL(.08,.015,.83+(seed-.5)*.16);mesh.setColorAt(i,color);tints.push(color.clone());
      });mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);batches.push({mesh,samples,matrices,tints,variant:v,lod:part.part==='horizon-canopy'?'horizon':part.part.endsWith('distant')?'far':'near',selection:createStaticInstanceSelection(mesh,{matrices,colors:tints,ids:samples.map(p=>p.featureId||p.sourceRoadId||null)})});
    }
  }
  let disposed=false,lastView=null,lastDetailScale=-1;
  const frustum=new THREE.Frustum(),view=new THREE.Matrix4(),sphere=new THREE.Sphere(),cameraPosition=new THREE.Vector3(),visibleByVariant=Array.from({length:variantCount},()=>({near:[],far:[],horizon:[]}));
  const variantBatches=[...new Map(batches.map(batch=>[batch.variant,batch])).values()];
  function update(camera,{detailDistanceScale=1}={}) {
    const detailScale=Number.isFinite(detailDistanceScale)?Math.max(.35,Math.min(1.5,detailDistanceScale)):1;
    if(disposed)return;
    if(camera) {
      camera.updateMatrixWorld();camera.getWorldPosition(cameraPosition);
      const stamp=[...cameraPosition.toArray(),...camera.quaternion.toArray(),camera.projectionMatrix.elements[0],camera.projectionMatrix.elements[5]];
      if(lastView&&lastDetailScale===detailScale&&stamp.every((v,i)=>Math.abs(v-lastView[i])<(i<3?.25:.0005)))return;
      lastView=stamp;lastDetailScale=detailScale;view.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(view);
    } else lastView=null;
    // Visibility is classified once per tree and reused by its trunk, leaf and
    // paint batches. This avoids 4–5 repeated spatial checks per moving frame.
    for(const batch of variantBatches){const visible=visibleByVariant[batch.variant];visible.near.length=0;visible.far.length=0;visible.horizon.length=0;
      batch.samples.forEach((tree,i)=>{const height=tree.height||9;sphere.center.set(tree.x,(tree.y||.1)+height*.5,tree.z);sphere.radius=Math.max(height*.65,(tree.radius||3.3)*1.6);if(camera&&!frustum.intersectsSphere(sphere))return;const distanceSq=camera?sphere.center.distanceToSquared(cameraPosition):0;const lod=distanceSq>(280*detailScale)**2?'horizon':distanceSq>((detail==='forest'?70:100)*detailScale)**2?'far':'near';visible[lod].push(i);});
    }
    for(const batch of batches){batch.selection.update(visibleByVariant[batch.variant][batch.lod]);batch.mesh.frustumCulled=false;}


  }
  update(null);
  return{group,update,counts:{trees:trees.length,leavesPerTree:leafCount,spraysPerTree:sprayCount,variants:variantCount,nearCanopyTrianglesPerTree:leafCount*4+sprayCount*4,distantCanopyTrianglesPerTree:farLeafCount*2,horizonCanopyTrianglesPerTree:24,drawCalls:group.children.length},dispose(){if(disposed)return;disposed=true;group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});group.removeFromParent();geometries.forEach(g=>g.dispose());ownedMaterials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.clear();}};
}

/** Low leafy shrubs use intersecting cutout branch sprays, never solid rock-like
 * polyhedra. Both LODs fit the supplied height and radius and share two batches. */
export function createShrubLayer(THREE,shrubs,{name='source-low-shrub-clusters'}={}){
  const group=new THREE.Group();group.name=name;
  const texture=createSprayTexture(THREE,81927),material=new THREE.MeshStandardMaterial({color:'#ffffff',map:texture,alphaTest:.43,alphaToCoverage:true,roughness:.97,side:THREE.DoubleSide,vertexColors:true});
  const random=randomFrom(51893),clumps=Array.from({length:7},(_,i)=>{const angle=i*2.399;return{x:Math.cos(angle)*.36,y:.55+(i%3)*.12,z:Math.sin(angle)*.36,rx:.47+random()*.14,ry:.3+random()*.15,rz:.47+random()*.14};});
  const near=sprayGeometry(THREE,clumps,{random:randomFrom(9182),count:64,folded:true,scale:.75}),far=sprayGeometry(THREE,clumps,{random:randomFrom(9182),count:24,scale:1});
  let radius=0,minY=Infinity,maxY=-Infinity;for(const g of [near,far]){const p=g.attributes.position;for(let i=0;i<p.count;i++){radius=Math.max(radius,Math.hypot(p.getX(i),p.getZ(i)));minY=Math.min(minY,p.getY(i));maxY=Math.max(maxY,p.getY(i));}}
  for(const g of [near,far]){g.translate(0,-minY,0);g.scale(1/radius,1/(maxY-minY),1/radius);g.computeBoundingSphere();}
  const dummy=new THREE.Object3D(),color=new THREE.Color(),matrices=[],tints=[];
  shrubs.forEach(s=>{dummy.position.set(s.x,s.y||.035,s.z);dummy.scale.set(s.radius,s.height,s.radius);dummy.rotation.set(0,s.seed*Math.PI*2,0);dummy.updateMatrix();matrices.push(dummy.matrix.clone());color.setHSL(.08,.03,.84+s.seed*.12);tints.push(color.clone());});
  const meshes=[near,far].map((geometry,i)=>{const mesh=new THREE.InstancedMesh(geometry,material,shrubs.length);mesh.name=`${name}-${i?'distant':'near'}`;mesh.castShadow=!i;mesh.receiveShadow=true;mesh.renderOrder=204;mesh.raycast=()=>{};mesh.userData={component:name,dimensionsStatus:'photo-informed estimate',positionsStatus:'sampled within explicit planting sources',foliage:'alpha-cutout leaf sprays'};matrices.forEach((matrix,n)=>{mesh.setMatrixAt(n,matrix);mesh.setColorAt(n,tints[n]);});group.add(mesh);return mesh;});
  const selections=meshes.map(mesh=>createStaticInstanceSelection(mesh,{matrices,colors:tints,ids:shrubs.map(s=>s.featureId)})),visible=[[],[]];
  const cameraPosition=new THREE.Vector3(),frustum=new THREE.Frustum(),view=new THREE.Matrix4(),sphere=new THREE.Sphere();let disposed=false,lastView=null,lastDetailScale=-1;
  function update(camera,{detailDistanceScale=1}={}){
    const detailScale=Number.isFinite(detailDistanceScale)?Math.max(.35,Math.min(1.5,detailDistanceScale)):1;
    if(disposed)return;if(camera){camera.updateMatrixWorld();camera.getWorldPosition(cameraPosition);const stamp=[...cameraPosition.toArray(),...camera.quaternion.toArray(),camera.projectionMatrix.elements[0],camera.projectionMatrix.elements[5]];if(lastView&&lastDetailScale===detailScale&&stamp.every((v,i)=>Math.abs(v-lastView[i])<(i<3?.25:.0005)))return;lastView=stamp;lastDetailScale=detailScale;view.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(view);}else lastView=null;
    visible[0].length=0;visible[1].length=0;
    if(!camera||cameraPosition.y<420)shrubs.forEach((s,i)=>{sphere.center.set(s.x,(s.y||.035)+s.height*.5,s.z);sphere.radius=Math.max(s.radius,s.height);if(camera&&!frustum.intersectsSphere(sphere))return;const distanceSq=camera?sphere.center.distanceToSquared(cameraPosition):0;if(camera&&distanceSq>(260*detailScale)**2)return;visible[distanceSq>(65*detailScale)**2?1:0].push(i);});
    meshes.forEach((mesh,lod)=>{selections[lod].update(visible[lod]);mesh.frustumCulled=false;});
  }
  update(null);
  return{group,update,counts:{shrubs:shrubs.length,nearTrianglesPerShrub:256,distantTrianglesPerShrub:48,drawCalls:2},dispose(){if(disposed)return;disposed=true;meshes.forEach(m=>m.dispose());near.dispose();far.dispose();material.dispose();texture.dispose();group.removeFromParent();group.clear();}};
}
