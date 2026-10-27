import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {applyWorldUV} from './surface-materials.js';
import {createStreetFurniture} from './street-furniture.js';
import {createRoadClearance} from './street-clearance.js';

/** Styling follows campus road photographs. These strips, pits and drainage
 * fittings are inferred details, not a new survey of pavement boundaries.
 * Everything remains outside the supplied source road centreline corridor.
 */
export function createStreetDetails(THREE,route,surfaces,{treesForPits=route.roadsideTrees||[]}={}) {
  const group=new THREE.Group();group.name='照片参考 · 路缘铺装与树池';
  group.userData={component:'photo-informed-street-details',dimensionsEvidence:'estimated',positionEvidence:'inferred along source road corridors; not surveyed fixtures',clearanceEvidence:'full inferred footprints exclude source road and footway ribbons; no invented dorm access'};
  const obstructsRoad=createRoadClearance(route),placements={curbs:[],paving:[],treePits:[]};
  const batches=new Map(),geometries=new Set(),materials=new Set();
  const own=m=>{materials.add(m);return m;};
  const curb=own(surfaces.concrete.clone());curb.color.set('#777b78');
  const grate=own(new THREE.MeshStandardMaterial({color:'#4c5451',roughness:.9,metalness:.25}));
  const soil=own(new THREE.MeshStandardMaterial({color:'#73715a',roughness:1}));
  const grassBlade=own(new THREE.MeshStandardMaterial({color:'#6a7950',roughness:1,side:THREE.DoubleSide}));
  const repairedAsphalt=own(surfaces.asphalt.clone());repairedAsphalt.color.set('#d0d3cf');
  const lakesidePaving=own(surfaces.paving.clone());lakesidePaving.color.set('#b9aaa2');
  lakesidePaving.userData={...lakesidePaving.userData,photoReference:'截屏2026-10-06 20.21.05.png',evidence:'grey-brown paved lake-road shoulder; exact block dimensions estimated'};
  const seal=own(new THREE.MeshStandardMaterial({color:'#454d47',roughness:.97}));
  function bake(g,material,position=[0,0,0],rotation=0) {
    g.rotateY(rotation);g.translate(...position);applyWorldUV(g);const non=g.index?g.toNonIndexed():g;if(g.index)g.dispose();
    if(!batches.has(material))batches.set(material,[]);batches.get(material).push(non);
  }
  const box=(w,h,d,material,position,yaw=0)=>bake(new THREE.BoxGeometry(w,h,d),material,position,yaw);
  const junctions=[...(route.trafficSignals||[]),...(route.crossings||[]),...(route.trafficOrigins||[]).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.z))];
  const insideJunction=(x,z)=>junctions.some(p=>Math.hypot(p.x-x,p.z-z)<(p.stopLine?Math.max(11,p.stopLine.clearance||0):(p.geometryEvidence?12:4.5)));
  let curbCount=0,drainCount=0,pavingLength=0,repairs=0,clearanceOmissions=0;
  for(const segment of route.segments||[]) {
    if(segment.mode!=='ride'||segment.width<4||segment.bridge||segment.length<1.1)continue;
    const dx=(segment.to.x-segment.from.x)/segment.length,dz=(segment.to.z-segment.from.z)/segment.length,nx=-dz,nz=dx,yaw=-Math.atan2(dz,dx);
    for(let s=.52;s<segment.length-.1;s+=1.04) {
      const progress=segment.startProgress+s;
      if(route.ramps?.some(r=>progress>=r.startProgress-1&&progress<=r.endProgress+1))continue;
      const x=segment.from.x+dx*s,z=segment.from.z+dz*s;if(insideJunction(x,z))continue;
      // A few subdued utility reinstatements reveal the road surface at rider
      // height. These are inferred wear, never mapped as real defects/obstacles.
      if(segment.sourceId!=='way/97080595'&&s>1.2&&s<segment.length-1.2&&Math.floor(progress/67)!==Math.floor((progress-1.04)/67)){
        const offset=(repairs%2?1:-1)*segment.width*.24,px=x+nx*offset,pz=z+nz*offset;
        box(1.72,.003,.72,seal,[px,.142,pz],yaw);
        box(1.68,.003,.68,repairedAsphalt,[px,.144,pz],yaw);repairs++;
      }
      // Do not invent a continuous urban sidewalk alongside unplanted edges.
      // The photo-inferred row of trees provides the corridor for this detail.
      for(const side of[-1,1]) {
        const sideX=x+nx*(segment.width/2+1.65)*side,sideZ=z+nz*(segment.width/2+1.65)*side;
        if(!(route.roadsideTrees||[]).some(t=>Math.hypot(t.x-sideX,t.z-sideZ)<16))continue;
        const edge=segment.width/2+.105,px=x+nx*(edge+1.1)*side,pz=z+nz*(edge+1.1)*side;
        // Keep the source branch opening continuous. A nearby tree is not
        // evidence that a pavement or raised kerb may cover an access road.
        if(!obstructsRoad(px,pz,1.045,2.05,yaw)){
          box(1.045,.1,2.05,segment.sourceId==='way/97080595'?lakesidePaving:surfaces.paving,[px,.12,pz],yaw);pavingLength+=1.04;
          placements.paving.push({x:px,z:pz,width:1.045,depth:2.05,yaw,sourceRoadId:segment.sourceId,progress});
        }else clearanceOmissions++;
        const curbX=x+nx*edge*side,curbZ=z+nz*edge*side;
        if(!obstructsRoad(curbX,curbZ,1,.18,yaw)){
          box(1,.17,.18,curb,[curbX,.145,curbZ],yaw);curbCount++;
          placements.curbs.push({x:curbX,z:curbZ,width:1,depth:.18,yaw,sourceRoadId:segment.sourceId,progress});
        }else clearanceOmissions++;
        // Shallow, dark storm drain with individual metal bars at sparse intervals.
        if(Math.floor((progress+.3)/27)!==Math.floor((progress-.74)/27)) {
          const gx=x+nx*(edge-.27)*side,gz=z+nz*(edge-.27)*side;
          box(.7,.006,.38,soil,[gx,.145,gz],yaw);
          for(let k=-.3;k<=.31;k+=.09)box(.038,.009,.35,grate,[gx+dx*k,.149,gz+dz*k],yaw);
          for(const sign of[-1,1])box(.74,.009,.035,grate,[gx+nx*.18*sign,.149,gz+nz*.18*sign],yaw);drainCount++;
        }
      }
    }
  }
  for(const tree of treesForPits) {
    // The user's lakeside frames show trunks in continuous grass/soil, not
    // a row of isolated square raised tree pits. Keep the trees themselves.
    if(tree.sourceRoadId==='way/97080595')continue;
    const near=route.locate({x:tree.x,z:tree.z}),yaw=near.yaw+Math.PI/2;
    if(obstructsRoad(tree.x,tree.z,1.8,1.8,yaw)){clearanceOmissions++;continue;}
    placements.treePits.push({x:tree.x,z:tree.z,width:1.8,depth:1.8,yaw,sourceRoadId:tree.sourceRoadId});
    box(1.52,.035,1.52,soil,[tree.x,.18,tree.z],yaw);
    // Square stone tree-pit edging and a sparse grass cover match the official
    // campus road photographs. Dimensions and individual locations are inferred.
    for(const side of[-1,1]){
      const a=new THREE.Vector3(0,0,side*.82).applyAxisAngle(new THREE.Vector3(0,1,0),yaw),b=new THREE.Vector3(side*.82,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),yaw);
      box(1.8,.1,.16,curb,[tree.x+a.x,.20,tree.z+a.z],yaw);box(.16,.1,1.48,curb,[tree.x+b.x,.20,tree.z+b.z],yaw);
    }
    const blades=[];
    for(let i=0;i<34;i++) {
      const angle=i*2.399,radial=.29+(i%7)*.066,x=Math.cos(angle)*radial,z=Math.sin(angle)*radial,h=.055+(i%4)*.02;
      blades.push(x-.018,.204,z,x+.018,.204,z,x+.03,.204+h,z+.016,x,.204,z-.018,x,.204,z+.018,x-.016,.204+h,z+.03);
    }
    const grassGeometry=new THREE.BufferGeometry();grassGeometry.setAttribute('position',new THREE.Float32BufferAttribute(blades,3));grassGeometry.computeVertexNormals();bake(grassGeometry,grassBlade,[tree.x,0,tree.z],yaw);
  }
  for(const[material,parts]of batches){const geometry=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());geometries.add(geometry);const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;mesh.castShadow=material===curb;mesh.renderOrder=204;mesh.userData=group.userData;group.add(mesh);}
  const furniture=createStreetFurniture(THREE,route,surfaces);group.add(furniture.group);
  let disposed=false;
  return{group,fixtures:furniture.fixtures,placements,counts:{curbs:curbCount,drains:drainCount,pavingMetres:Math.round(pavingLength),treePits:placements.treePits.length,roadRepairs:repairs,clearanceOmissions,...furniture.counts},dispose(){if(disposed)return;disposed=true;furniture.dispose();group.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.clear();}};
}
