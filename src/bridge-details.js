import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {applyWorldUV} from './surface-materials.js';
import {YUDAI_BRIDGE_PROFILE} from './bridge-profile.js';

/** The main deck is rendered by campus-3d; this builds the two source-aligned
 * sidewalks as parts of that same broad bridge, with rails only at the river
 * edges. There is no invented free-standing bent/column structure. All small
 * dimensions are photo-informed estimates, not surveyed engineering details. */
export function createBridgeDetails(THREE,{points,width,surfaceY,surfaces,sourceId,sidewalks=[]}){
  if(points?.length<2||!Number.isFinite(width)||width<=0||!Number.isFinite(surfaceY))throw new TypeError('Bridge source points, width and surfaceY are required.');
  const profile=YUDAI_BRIDGE_PROFILE,group=new THREE.Group();
  group.name='喻岱桥 · 宽桥断面、连续步道与玻璃栏杆';
  group.userData={component:'photo-informed-bridge-details',sourceId,coordinateSystem:'LOCAL_ENU',units:'metres',
    centrelineEvidence:'unaltered source main and sidewalk ways',dimensionsEvidence:'photo-and-source-spacing-estimates',
    detailEvidence:'stainless steel and glass rails corroborated by 2020 on-site report; no inferred pier or bearing design',
    sourceUrl:profile.sourceUrl,corroborationUrl:profile.corroborationUrl,surfaceY,carriagewayWidth:width,
    sidewalkSourceIds:sidewalks.map(s=>s.sourceId),supportEvidence:'not resolved in photographs; omitted'};
  const batches=new Map(),materials=new Set(),geometries=new Set();
  const own=m=>{materials.add(m);return m;};
  const concrete=own(surfaces.concrete.clone());concrete.color.set('#aeb7b2');
  const edgeStone=own(surfaces.concrete.clone());edgeStone.color.set('#d0d6ce');
  const wood=own(surfaces.paving.clone());wood.color.set('#8c796c');
  const seam=own(new THREE.MeshStandardMaterial({color:'#594e45',roughness:.96}));
  const steel=own(new THREE.MeshStandardMaterial({color:'#b8c5c2',roughness:.28,metalness:.75}));
  const glass=own(new THREE.MeshPhysicalMaterial({color:'#bacfc8',roughness:.2,metalness:0,transparent:true,opacity:.23,depthWrite:false,side:THREE.DoubleSide}));
  const rubber=own(new THREE.MeshStandardMaterial({color:'#39413e',roughness:.95}));
  function bake(key,g,m){applyWorldUV(g);const non=g.index?g.toNonIndexed():g;if(non!==g)g.dispose();const k=`${key}/${m.uuid}`;if(!batches.has(k))batches.set(k,{key,material:m,parts:[]});batches.get(k).parts.push(non);}
  function box(key,w,h,d,m,p,yaw=0){if(w<=0||h<=0||d<=0)return;const g=new THREE.BoxGeometry(w,h,d);g.rotateY(yaw);g.translate(p.x,p.y,p.z);bake(key,g,m);}
  function tube(key,r,m,a,b){const av=new THREE.Vector3(a.x,a.y,a.z),bv=new THREE.Vector3(b.x,b.y,b.z),delta=bv.clone().sub(av),g=new THREE.CylinderGeometry(r,r,delta.length(),8);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);bake(key,g,m);}
  function makePath(input){
    const edges=[];let length=0;
    for(let i=1;i<input.length;i++){const a=input[i-1],b=input[i],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);if(l<.001)continue;edges.push({a,b,length:l,start:length,dx:dx/l,dz:dz/l,nx:-dz/l,nz:dx/l,yaw:-Math.atan2(dz,dx)});length+=l;}
    if(!edges.length)throw new TypeError('Bridge paths must contain distinct points.');
    return{edges,length,pose(s,offset=0){const edge=edges.find(e=>s<=e.start+e.length+.001)||edges.at(-1),t=Math.max(0,Math.min(edge.length,s-edge.start));return{x:edge.a.x+edge.dx*t+edge.nx*offset,y:surfaceY,z:edge.a.z+edge.dz*t+edge.nz*offset,edge};}};
  }
  const main=makePath(points),length=main.length,axis=main.edges[0];
  const sideOf=p=>Math.sign((p.x-axis.a.x)*axis.nx+(p.z-axis.a.z)*axis.nz)||1;
  // A fallback is useful for isolated previews/tests; production passes the
  // independently mapped sidewalk centre lines and never invents their position.
  const paths=sidewalks.length?sidewalks: [-1,1].map(side=>({sourceId:null,width:profile.sidewalkWidth,points:points.map((p,i)=>{const e=main.edges[Math.min(i,main.edges.length-1)];return{x:p.x+e.nx*side*(width/2+profile.sidewalkWidth/2),z:p.z+e.nz*side*(width/2+profile.sidewalkWidth/2)};})}));
  let posts=0,glassPanels=0,planks=0;const walkwayRecords=[];
  for(const supplied of paths){
    const path=makePath(supplied.points),walkWidth=supplied.width??profile.sidewalkWidth,mid=path.pose(path.length/2),side=sideOf(mid);
    // OSM lines can run in either direction: outer is determined geometrically,
    // not from the order of their vertices.
    const alignment=Math.sign(mid.edge.nx*axis.nx+mid.edge.nz*axis.nz)||1;
    const outerSign=side*alignment,outer=outerSign*(walkWidth/2-.10),walkY=surfaceY+profile.sidewalkRise;
    const railSegments=[];
    for(const e of path.edges){
      const p=path.pose(e.start+e.length/2);
      box('bridge-sidewalk-slab',e.length,.45,walkWidth,concrete,{...p,y:surfaceY-.125},e.yaw);
      box('bridge-weathered-wood-deck',e.length,.045,walkWidth-.12,wood,{...p,y:walkY-.0225},e.yaw);
      const inner=path.pose(e.start+e.length/2,-outerSign*(walkWidth/2-.08));
      box('bridge-inner-dropped-kerb',e.length,.09,.16,edgeStone,{...inner,y:surfaceY+.045},e.yaw);
      const rail=path.pose(e.start+e.length/2,outer);
      box('bridge-outer-edge-band',e.length,.17,.22,edgeStone,{...rail,y:walkY-.02},e.yaw);
      // Fill the shoulder between carriageway and mapped sidewalk. This closes
      // the old water/air slots while retaining both source centre lines.
      const shoulder=[];
      for(const ep of [e.a,e.b]){
        const longitudinal=(ep.x-axis.a.x)*axis.dx+(ep.z-axis.a.z)*axis.dz;
        const road={x:axis.a.x+axis.dx*longitudinal+axis.nx*side*width/2,z:axis.a.z+axis.dz*longitudinal+axis.nz*side*width/2};
        let sidewalk={x:ep.x-e.nx*outerSign*walkWidth/2,z:ep.z-e.nz*outerSign*walkWidth/2};
        if(side*((sidewalk.x-road.x)*axis.nx+(sidewalk.z-road.z)*axis.nz)<.01)sidewalk={...road};
        shoulder.push(road,sidewalk);
      }
      const shoulderVertices=[];
      for(const tri of [[0,2,1],[1,2,3]]){
        const [a,b,c]=tri.map(i=>shoulder[i]);
        const up=(b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z);
        if(Math.abs(up)<.00001)continue;
        for(const v of up>0?[a,b,c]:[a,c,b])shoulderVertices.push(v.x,surfaceY+.003,v.z);
      }
      if(shoulderVertices.length){const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(shoulderVertices,3));sg.computeVertexNormals();bake('bridge-continuous-shoulders',sg,concrete);}
      const ar=path.pose(e.start,outer),br=path.pose(e.start+e.length,outer);railSegments.push({a:ar,b:br});
      tube('bridge-stainless-handrail',.045,steel,{...ar,y:walkY+profile.railingHeight},{...br,y:walkY+profile.railingHeight});
      tube('bridge-stainless-bottom-rail',.023,steel,{...ar,y:walkY+.20},{...br,y:walkY+.20});
      // The visible side elevation has three shallow scalloped lower edges.
      // This is a fascia silhouette, NOT an assertion of hidden arch structure.
      const shape=new THREE.Shape(),top=-.25,spans=3,steps=72;shape.moveTo(0,top);shape.lineTo(e.length,top);
      for(let k=steps;k>=0;k--){const x=e.length*k/steps,t=(x/e.length*spans)%1;const bottom=-1.28+.72*Math.pow(Math.sin(Math.PI*t),.62);shape.lineTo(x,bottom);}
      shape.closePath();const fg=new THREE.ExtrudeGeometry(shape,{depth:.18,bevelEnabled:false,steps:1,curveSegments:1});fg.translate(0,surfaceY,-.09);fg.rotateY(e.yaw);fg.translate(ar.x,0,ar.z);bake('bridge-three-scallop-fascia',fg,edgeStone);
    }
    const intervals=Math.max(1,Math.ceil(path.length/2.2)),spacing=path.length/intervals;
    for(let i=0;i<=intervals;i++){
      const p=path.pose(Math.min(path.length,i*spacing),outer);
      box('bridge-stainless-posts',.075,profile.railingHeight,.075,steel,{...p,y:walkY+profile.railingHeight/2},p.edge.yaw);posts++;
      if(i<intervals){const q=path.pose((i+.5)*spacing,outer);box('bridge-glass-infill',spacing-.12,.79,.018,glass,{...q,y:walkY+.66},q.edge.yaw);glassPanels++;}
    }
    for(let s=.32;s<path.length;s+=.32){const p=path.pose(s);box('bridge-deck-plank-joints',.012,.002,walkWidth-.14,seam,{...p,y:walkY+.001},p.edge.yaw);planks++;}
    walkwayRecords.push({sourceId:supplied.sourceId,width:walkWidth,length:path.length,side,railSegments,top:walkY});
  }
  // Two restrained flush deck joints remain an explicitly estimated detail.
  const joints=[];
  for(const station of [.20,length-.20]){const p=main.pose(station);box('bridge-expansion-seals',width-.16,.004,.08,rubber,{...p,y:surfaceY+.003},p.edge.yaw+Math.PI/2);joints.push({progress:station,top:surfaceY+.005});}
  for(const{key,material,parts}of batches.values()){
    const geometry=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());geometries.add(geometry);
    const mesh=new THREE.Mesh(geometry,material);mesh.name=key;mesh.castShadow=!/glass|seal|joints|shoulders/.test(key);mesh.receiveShadow=true;mesh.renderOrder=material===glass?206:204;
    mesh.userData={...group.userData,detailPart:key};group.add(mesh);
  }
  let disposed=false;
  return{group,counts:{posts,glassPanels,planks,drains:0,expansionJoints:joints.length,supportBents:0,sidewalks:paths.length},joints,length,walkways:walkwayRecords,
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.clear();}};
}
