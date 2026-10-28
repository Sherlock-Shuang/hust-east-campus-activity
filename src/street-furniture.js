import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {applyWorldUV} from './surface-materials.js';
import {createRoadClearance} from './street-clearance.js';

/** Baked metre-scale street fittings. Source roads/crossings determine the
 * corridor; fixture spacing, construction and dimensions are reconstructed.
 * The pale single curved arm follows the user's street/route photographs,
 * not a fixture survey. Fine-scale dimensions remain estimates.
 */
function bakedLayer(THREE,name,metadata) {
  const group=new THREE.Group();group.name=name;group.userData=metadata;
  const batches=new Map(),materials=new Set(),geometries=new Set();
  function own(material){materials.add(material);return material;}
  function add(geometry,material,matrix){
    if(matrix)geometry.applyMatrix4(matrix);applyWorldUV(geometry);
    const g=geometry.index?geometry.toNonIndexed():geometry;if(g!==geometry)geometry.dispose();
    if(!batches.has(material))batches.set(material,[]);batches.get(material).push(g);
  }
  function finish(){for(const[material,parts]of batches){const geometry=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());geometries.add(geometry);const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.renderOrder=204;mesh.userData=metadata;group.add(mesh);}batches.clear();}
  let disposed=false;
  return{group,own,add,finish,dispose(){if(disposed)return;disposed=true;group.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.clear();}};
}

export function createStreetFurniture(THREE,route,surfaces) {
  const layer=bakedLayer(THREE,'沿路单曲臂叶片灯具',{
    component:'photo-informed-roadside-lamps',positionEvidence:'estimated spacing along source roads; not surveyed lamp positions',
    designEvidence:'user-provided route photographs: pale slender pole, single rising arm, narrow leaf-shaped LED head and curved brace; small fittings inferred',
    photoReferences:['截屏2026-10-06 20.19.16.png','截屏2026-10-06 20.19.49.png','截屏2026-10-06 20.20.36.png'],
    dimensionsEvidence:'estimated',units:'metres',operatingState:'daylight, lamps off',
  });
  const white=layer.own(new THREE.MeshStandardMaterial({color:'#d9ddd6',roughness:.58,metalness:.18}));
  const foot=layer.own(surfaces.concrete.clone());foot.color.set('#9fa69e');
  const metal=layer.own(new THREE.MeshStandardMaterial({color:'#74827e',roughness:.5,metalness:.52}));
  const dark=layer.own(new THREE.MeshStandardMaterial({color:'#343f3c',roughness:.68,metalness:.28}));
  const lens=layer.own(new THREE.MeshStandardMaterial({color:'#d9e6de',roughness:.37,metalness:0}));
  const dummy=new THREE.Object3D(),local=new THREE.Object3D(),matrix=new THREE.Matrix4();
  const fixtures=[],junctions=[...(route.trafficSignals||[]),...(route.crossings||[])],obstructsRoad=createRoadClearance(route);
  function put(g,m,x=0,y=0,z=0,rotationX=0,rotationZ=0){local.position.set(x,y,z);local.rotation.set(rotationX,0,rotationZ);local.scale.set(1,1,1);local.updateMatrix();matrix.multiplyMatrices(dummy.matrix,local.matrix);layer.add(g,m,matrix);}
  function box(w,h,d,m,x,y,z){put(new THREE.BoxGeometry(w,h,d),m,x,y,z);}
  for(let s=21,index=0;s<(route.dismountProgress??route.length)-8;s+=39,index++){
    const segment=(route.segments||[]).find(p=>s>=p.startProgress&&s<=p.endProgress);
    if(!segment||segment.mode!=='ride'||segment.width<4||segment.bridge||route.ramps?.some(r=>s>=r.startProgress-8&&s<=r.endProgress+8))continue;
    const dx=(segment.to.x-segment.from.x)/segment.length,dz=(segment.to.z-segment.from.z)/segment.length,nx=-dz,nz=dx;
    const cx=segment.from.x+dx*(s-segment.startProgress),cz=segment.from.z+dz*(s-segment.startProgress);
    let chosen=null;
    // Prefer alternate sides, allowing the opposite side only when the planting
    // corridor already exists and the pole clears trunks and mapped junctions.
    for(const side of[index%2?1:-1,index%2?-1:1]){
      const x=cx+nx*(segment.width/2+.88)*side,z=cz+nz*(segment.width/2+.88)*side;
      const nearest=route.locate({x,z});if(nearest.distance<nearest.width/2+.70)continue;
      if(obstructsRoad(x,z,.69,.69))continue;
      if(junctions.some(p=>Math.hypot(x-p.x,z-p.z)<11))continue;
      if(!(route.roadsideTrees||[]).some(t=>Math.hypot(x-t.x,z-t.z)<19))continue;
      if((route.roadsideTrees||[]).some(t=>Math.hypot(x-t.x,z-t.z)<2.1))continue;
      if((route.parkingPlaces||[]).some(p=>Math.hypot(x-p.x,z-p.z)<2))continue;
      chosen={x,z,y:.17,side,progress:s,sourceRoadId:segment.sourceId,yaw:Math.atan2(nz*side,-nx*side),headDirection:{x:-nx*side,z:-nz*side},family:'single-leaf-arm',dimensionsEvidence:'estimated',positionEvidence:'inferred source-road edge spacing'};break;
    }
    if(!chosen)continue;
    fixtures.push(chosen);dummy.position.set(chosen.x,chosen.y,chosen.z);dummy.rotation.set(0,chosen.yaw,0);dummy.scale.set(1,1,1);dummy.updateMatrix();
    // Root plate, plinth, taper, access panel and neck collars all meet the pole.
    box(.45,.13,.45,foot,0,.065,0);box(.30,.028,.30,metal,0,.144,0);
    put(new THREE.CylinderGeometry(.055,.10,6.65,10),white,0,3.485,0);
    put(new THREE.CylinderGeometry(.125,.135,.45,10),white,0,.385,0);
    put(new THREE.CylinderGeometry(.086,.086,.065,10),metal,0,.63,0);
    box(.105,.29,.018,metal,0,.86,.09);box(.012,.045,.012,dark,.031,.87,.104);
    for(const x of[-.11,.11])for(const z of[-.11,.11])put(new THREE.CylinderGeometry(.017,.017,.035,6),metal,x,.175,z);
    const arm=new THREE.CatmullRomCurve3([
      new THREE.Vector3(0,5.65,0),new THREE.Vector3(.10,6.25,0),
      new THREE.Vector3(.51,6.85,0),new THREE.Vector3(1.13,7.35,0),new THREE.Vector3(1.48,7.51,0),
    ]);
    put(new THREE.TubeGeometry(arm,17,.039,7,false),white);
    const brace=new THREE.CatmullRomCurve3([
      new THREE.Vector3(.26,6.52,0),new THREE.Vector3(-.28,5.68,0),
      new THREE.Vector3(-.42,5.39,0),new THREE.Vector3(-.16,5.23,0),new THREE.Vector3(.30,5.37,0),
    ]);
    put(new THREE.TubeGeometry(brace,16,.025,6,false),white);
    // The observed narrow LED body is angled with the rising arm. There is
    // one head over the carriageway, not two drooping decorative bowls.
    put(new THREE.SphereGeometry(1,12,6).scale(.41,.055,.145),metal,1.61,7.57,0,0,.34);
    put(new THREE.BoxGeometry(.54,.018,.19),lens,1.61,7.538,0,0,.34);
    put(new THREE.CylinderGeometry(.058,.058,.055,8),metal,0,6.78,0);
  }
  layer.finish();layer.group.userData.fixtureCount=fixtures.length;
  return{group:layer.group,fixtures,counts:{lamps:fixtures.length},dispose:layer.dispose};
}

/** A distinct lakeside fixture family, following the observed campus photograph:
 * black single crook, shallow round cap, hanging frosted hemisphere and pole box.
 * The caller owns source-path placement/shore clearance. Local +X is the hook
 * direction; coordinates and yaw must already be in the campus metre frame.
 */
export function createLakesideLamps(THREE,fixtures,surfaces) {
  const layer=bakedLayer(THREE,'湖岸单曲臂灯具',{
    component:'photo-informed-lakeside-lamps',designEvidence:'observed official campus lakeside lamp photograph: black single crook, downward bell shade, collars and pole-mounted box',
    positionEvidence:'estimated positions along caller-selected source footways; not surveyed individual lamp positions',
    dimensionsEvidence:'estimated',units:'metres',operatingState:'daylight, lamps off',
  });
  const black=layer.own(new THREE.MeshStandardMaterial({color:'#34423b',roughness:.62,metalness:.30}));
  const rim=layer.own(new THREE.MeshStandardMaterial({color:'#59665d',roughness:.48,metalness:.48}));
  const diffuser=layer.own(new THREE.MeshStandardMaterial({color:'#c4cfc3',roughness:.43,metalness:0}));
  const base=layer.own(surfaces.concrete.clone());base.color.set('#9eaa9b');
  const dummy=new THREE.Object3D(),local=new THREE.Object3D(),matrix=new THREE.Matrix4();
  const accepted=[];
  function put(g,m,x=0,y=0,z=0){local.position.set(x,y,z);local.rotation.set(0,0,0);local.scale.set(1,1,1);local.updateMatrix();matrix.multiplyMatrices(dummy.matrix,local.matrix);layer.add(g,m,matrix);}
  const box=(w,h,d,m,x,y,z)=>put(new THREE.BoxGeometry(w,h,d),m,x,y,z);
  for(const fixture of fixtures||[]){
    if(![fixture.x,fixture.y??.14,fixture.z,fixture.yaw??0].every(Number.isFinite))continue;
    accepted.push({...fixture});dummy.position.set(fixture.x,fixture.y??.14,fixture.z);dummy.rotation.set(0,fixture.yaw??0,0);dummy.scale.set(1,1,1);dummy.updateMatrix();
    box(.34,.10,.34,base,0,.05,0);box(.25,.028,.25,rim,0,.114,0);
    put(new THREE.CylinderGeometry(.043,.062,3.99,10),black,0,2.14,0);
    put(new THREE.CylinderGeometry(.092,.11,.32,10),black,0,.30,0);
    for(const y of[.49,1.08,2.90,3.20])put(new THREE.CylinderGeometry(y<2?.075:.058,y<2?.075:.058,.042,10),rim,0,y,0);
    for(const x of[-.088,.088])for(const z of[-.088,.088])put(new THREE.CylinderGeometry(.014,.014,.027,6),rim,x,.145,z);
    const crook=new THREE.CatmullRomCurve3([
      new THREE.Vector3(0,3.88,0),new THREE.Vector3(.035,4.25,0),
      new THREE.Vector3(.37,4.43,0),new THREE.Vector3(.73,4.28,0),new THREE.Vector3(.82,3.98,0),
    ]);
    put(new THREE.TubeGeometry(crook,20,.038,8,false),black);
    put(new THREE.CylinderGeometry(.043,.043,.14,8),black,.82,3.94,0);
    // Disc top and frosted lower hemisphere remain visibly separate parts.
    put(new THREE.SphereGeometry(1,16,5,0,Math.PI*2,0,Math.PI/2).scale(.27,.085,.27),black,.82,3.875,0);
    put(new THREE.CylinderGeometry(.29,.29,.035,16),rim,.82,3.866,0);
    put(new THREE.SphereGeometry(1,16,8,0,Math.PI*2,Math.PI/2,Math.PI/2).scale(.22,.24,.22),diffuser,.82,3.846,0);
    put(new THREE.CylinderGeometry(.036,.025,.035,8),black,.82,3.60,0);
    // Black weatherproof/AP-style box and two brackets observed on the pole;
    // its technical function is deliberately not asserted by the model metadata.
    box(.185,.35,.135,black,0,3.06,.13);box(.145,.30,.012,rim,0,3.06,.204);
    for(const y of[2.93,3.18])box(.19,.028,.11,rim,0,y,.075);
    box(.055,.12,.045,black,.10,2.99,.12);
  }
  layer.finish();layer.group.userData.fixtureCount=accepted.length;layer.group.userData.sourcePathIds=[...new Set(accepted.map(p=>p.sourcePathId).filter(Boolean))];
  return{group:layer.group,fixtures:accepted,counts:{lakesideLamps:accepted.length},dispose:layer.dispose};
}

export function createCrossingDetails(THREE,route,surfaces) {
  const layer=bakedLayer(THREE,'源地图人行横道 · 薄漆与路缘',{
    component:'source-crossing-details',locationEvidence:'source crossing nodes',dimensionsEvidence:'estimated',units:'metres',
  });
  const paint=layer.own(surfaces.paint.clone());paint.polygonOffset=true;paint.polygonOffsetFactor=-1;paint.polygonOffsetUnits=-1;
  // Shader-written logarithmic depth overrides hardware polygon offset. Give
  // the paint four 24-bit depth steps of separation, while retaining depth
  // testing/writing so shoes, wheels and vehicles still occlude the stripes.
  paint.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <logdepthbuf_fragment>',`#include <logdepthbuf_fragment>
      #if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
        gl_FragDepth = max(0.0, gl_FragDepth - 0.0000002384185791015625);
      #endif`);
  };
  paint.customProgramCacheKey=()=>'crossing-paint-log-depth-v1';
  const stone=layer.own(surfaces.concrete.clone());stone.color.set('#a6a99d');
  const tactile=layer.own(new THREE.MeshStandardMaterial({color:'#b6a16c',roughness:.96}));
  const dummy=new THREE.Object3D(),matrix=new THREE.Matrix4(),local=new THREE.Object3D();
  const crossings=[];let stripes=0;
  function put(g,m,x,y,z){local.position.set(x,y,z);local.rotation.set(0,0,0);local.scale.set(1,1,1);local.updateMatrix();matrix.multiplyMatrices(dummy.matrix,local.matrix);layer.add(g,m,matrix);}
  for(const crossing of route.crossings||[]){
    if(crossing.tags?.['crossing:markings']!=='yes'&&crossing.tags?.crossing!=='marked')continue;
    const deck=(crossing.y??.16)-.02;
    dummy.position.set(crossing.x,deck,crossing.z);dummy.rotation.set(0,crossing.yaw,0);dummy.scale.set(1,1,1);dummy.updateMatrix();
    crossings.push({sourceId:crossing.sourceId,x:crossing.x,z:crossing.z,surfaceY:deck,paintTop:deck+.006,width:crossing.width,yaw:crossing.yaw});
    let stripeIndex=0;
    for(let x=-crossing.width*.43;x<crossing.width*.44;x+=.8,stripeIndex++){
      // Millimetre-scale paint follows the source deck. Slightly irregular ends
      // represent wear without thick floating blocks or noisy black speckles.
      const shrink=(stripeIndex%4)*.017,shape=new THREE.Shape();
      shape.moveTo(-.21,-1.5+shrink);shape.lineTo(.20,-1.5);shape.lineTo(.215,.93);shape.lineTo(.197,1.5-shrink);
      shape.lineTo(-.205,1.5);shape.lineTo(-.217,-.68);shape.closePath();
      // A single upward-facing painted surface keeps the existing top height
      // without almost coincident underside/side faces at shallow view angles.
      const g=new THREE.ShapeGeometry(shape);g.rotateX(-Math.PI/2);
      put(g,paint,x,.006,0);stripes++;
    }
    // Flush dropped kerbs are authored only beside a mapped marked crossing.
    // No new crossing or signal is inferred from these small construction parts.
    for(const side of[-1,1]){
      const x=side*(crossing.width/2+.68),w=1.25,d=3.3,top=.035;
      put(new THREE.BoxGeometry(w,.025,d),stone,x,top-.0125,0);
      const edge=side*(crossing.width/2+.14);
      const v=[edge,.006,-1.65,edge,.006,1.65,edge+side*.34,.035,-1.65,edge+side*.34,.035,1.65];
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(side===1?[0,1,2,1,3,2]:[0,2,1,1,2,3]);g.computeVertexNormals();put(g,stone,0,0,0);
      // A source tactile_paving=no must remain visible as an absence. Only an
      // explicit positive tag permits warning pavers; unknown is not invented.
      if(crossing.tags?.tactile_paving==='yes'){
        for(let k=-2;k<=2;k++)put(new THREE.BoxGeometry(.29,.018,.29),tactile,x+side*.24,.049,k*.30);
        for(let k=-2;k<=2;k++)for(const a of[-.075,.075])for(const b of[-.075,.075])put(new THREE.CylinderGeometry(.015,.019,.008,5),tactile,x+side*.24+a,.062,k*.30+b);
      }
    }
  }
  layer.finish();layer.group.traverse(o=>{if(o.isMesh)o.castShadow=o.material!==paint;});
  layer.group.userData.sourceIds=crossings.map(p=>p.sourceId);
  return{group:layer.group,crossings,counts:{crossings:crossings.length,stripes},dispose:layer.dispose};
}
