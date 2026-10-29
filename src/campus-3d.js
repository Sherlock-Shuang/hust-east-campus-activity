import polygonClipping from 'polygon-clipping';
import {createStaticInstanceSelection,createStaticXZIndex} from './static-instance-lod.js';
import {createYunyuanForecourt} from './yunyuan-forecourt.js';
import {createCampusLawnLandmarks} from './campus-lawn-landmarks.js';
import {createLakesideDetails} from './lakeside-details.js';
import {createAquaticPlants} from './aquatic-plants.js';
import {createBridgeDetails} from './bridge-details.js';
import {planBridgeStructure} from './bridge-infrastructure.js';
import { getBuildingProfile, getRoadProfile, getBuildingPartGroups } from './building-profiles.js';
import { createEastNineDetails } from './east-nine.js';
import { createArchitecturalMaterials, applyBuildingUV } from './architectural-materials.js';
import { createSurfaceMaterials, applyWorldUV, applySurfaceDepthBias } from './surface-materials.js';
import { createCampusLandcover } from './campus-landcover.js';
import { createCampusLandmarkDetails } from './campus-landmarks.js';
import { getReconstructionBuildings } from './campus-feature-selection.js';
import { createEastNineForecourt } from './east-nine-forecourt.js';
import { createEastNineGround } from './east-nine-ground.js';
import { alignEastNineColumnFeet } from './east-nine-ground-contact.js';
import { collectEastNineAccess } from './east-nine-access.js';
import { createYunyuanDetails } from './yunyuan-details.js';
import {streetFootprint,polygonsOverlap} from './street-clearance.js';
import {createEinsteinSquare} from './einstein-square.js';
import {createOptoBuilding,OPTO_BUILDING_ID} from './opto-building.js';

/** Low road-edge stones, derived from the existing road ribbons. Accesses are
 * left open wherever another mapped road or footpath reaches the edge. These
 * are appearance estimates, not a new surveyed kerb/sidewalk boundary. */
export function planCampusRoadEdges(roads) {
  const cells=new Map(),cellSize=24,edges=[],nodes=new Map(),pointKey=p=>`${p.x.toFixed(4)}/${p.z.toFixed(4)}`;
  // Match the endpoint normals used by the rendered road ribbons, including
  // two connected source ways. A segment's raw normal cuts across short bends.
  for(const road of roads){if(!road.motor||Math.abs(road.elevation||0)>.001)continue;for(let i=0;i<road.points.length;i++){const p=road.points[i],k=pointKey(p);if(!nodes.has(k))nodes.set(k,{point:p,neighbors:new Set(),width:0});const n=nodes.get(k);n.width=Math.max(n.width,road.width);if(i)n.neighbors.add(pointKey(road.points[i-1]));if(i<road.points.length-1)n.neighbors.add(pointKey(road.points[i+1]));}}
  for(const road of roads){
    if(road.tunnel||Math.abs(road.elevation||0)>.001)continue;
    const points=road.points.filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.z-all[i-1].z)>.01);
    const sides=points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];let dx=b.x-a.x,dz=b.z-a.z;const joint=nodes.get(pointKey(p));
      if((!i||i===points.length-1)&&joint?.neighbors.size===2&&Math.abs(joint.width-road.width)<.01){const [j,k]=[...joint.neighbors].map(id=>nodes.get(id)?.point);if(j&&k){const sign=(k.x-j.x)*dx+(k.z-j.z)*dz<0?-1:1;dx=(k.x-j.x)*sign;dz=(k.z-j.z)*sign;}}
      const length=Math.hypot(dx,dz)||1,nx=-dz/length*road.width/2,nz=dx/length*road.width/2;return[{x:p.x+nx,z:p.z+nz},{x:p.x-nx,z:p.z-nz}];});
    for(let i=1;i<points.length;i++){
      const polygon=[sides[i-1][0],sides[i][0],sides[i][1],sides[i-1][1]],edge={road,polygon,sides:[sides[i-1],sides[i]]};edges.push(edge);
      const xs=polygon.map(p=>p.x),zs=polygon.map(p=>p.z);
      for(let x=Math.floor((Math.min(...xs)-.8)/cellSize);x<=Math.floor((Math.max(...xs)+.8)/cellSize);x++)for(let z=Math.floor((Math.min(...zs)-.8)/cellSize);z<=Math.floor((Math.max(...zs)+.8)/cellSize);z++){const k=`${x}/${z}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(edge);}
    }
  }
  const stones=[];
  for(const edge of edges){
    const {road}=edge;if(!road.motor||road.width<6||road.kind==='service'||road.bridge)continue;
    for(const side of[-1,1]){
      const index=side===1?0:1,a=edge.sides[0][index],b=edge.sides[1][index],length=Math.hypot(b.x-a.x,b.z-a.z);if(length<.15)continue;
      const dx=(b.x-a.x)/length,dz=(b.z-a.z)/length,parts=Math.ceil(length/1.25),pitch=length/parts,yaw=-Math.atan2(dz,dx);
      for(let i=0;i<parts;i++){
        const along=(i+.5)*pitch,offset=side*.125,x=a.x+dx*along-dz*offset,z=a.z+dz*along+dx*offset,stoneLength=Math.max(.04,pitch-.025);
        const footprint=streetFootprint(x,z,stoneLength,.24,yaw),accessClearance=streetFootprint(x,z,stoneLength+.9,1.14,yaw);
        // Full polygons also catch the owning road's adjacent bent segment;
        // checking only a centre or excluding the same way left crossed stones.
        if((cells.get(`${Math.floor(x/cellSize)}/${Math.floor(z/cellSize)}`)||[]).some(other=>polygonsOverlap(other.road.id===road.id?footprint:accessClearance,other.polygon)))continue;
        stones.push({x,z,y:.13,length:stoneLength,width:.24,height:.27,yaw,featureId:road.id,side,sourceWidth:road.width});
      }
    }
  }
  return stones;
}

/** A reconstruction layer over the unmodified WGS84 source geometries.
 * Heights, facade divisions and untagged road widths are model estimates, not surveyed data.
 */
export function createCampus3D(THREE, model, { frame, geoToLocal } = {}) {
  if (!model?.records || !frame || typeof geoToLocal !== 'function') throw new TypeError('Source scene records and an explicit projection are required.');
  const architecture=createArchitecturalMaterials(THREE),surfaces=createSurfaceMaterials(THREE);
  let forestLayer=null,optoBuilding=null;const detailDisposers=[];
  const group = new THREE.Group(); group.name = '校园三维重建 · 源轮廓与估算外观';
  group.userData = { units: 'metres', reconstruction: true, terrain: 'flat display datum; no measured terrain' };
  const layers = new Map(), records = new Map(), materials = new Map(), sharedGeometries = new Set(), warnings = [];
  const counts = { buildings: 0, buildingParts: 0, compositeBuildings: 0, roads: 0, bridges: 0, facadeWindows: 0, estimatedHeights: 0, sourceHeights: 0, estimatedRoadWidths: 0, airConditioners:0, slopingRoofs:0 };
  const bridgeInfrastructure={barriers:[],walkSurfaces:[]};
  model.bridgeInfrastructure=bridgeInfrastructure;
  const compositeInfrastructure={replacedBuildingIds:[],walkSurfaces:[]};
  function layer(name) { if (!layers.has(name)) { const g = new THREE.Group(); g.name = name; group.add(g); layers.set(name, g); } return layers.get(name); }
  const solid = (color, roughness = .86, metalness = 0) => { const key = `${color}/${roughness}/${metalness}`; if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide })); return materials.get(key); };
  const sourceMeta = (r, extra = {}) => ({ feature: r.feature, featureId: r.id, category: r.category, reconstruction: true, ...extra });
  const profileFeature = r => getBuildingProfile(r.feature);
  const partGroups = getBuildingPartGroups({ type: 'FeatureCollection', features: model.records.map(r => r.feature) });
  const partsByParent = new Map(partGroups.map(g => [g.outlineId, g.partIds]));
  const sourceById = new Map(model.records.map(r => [r.id, r]));
  const eastNineId = 'way/1023544717', eastNinePart = 'way/1528957937';
  const batches = new Map(), temp = new THREE.Object3D();
  const box = new THREE.BoxGeometry(1, 1, 1), pane = new THREE.PlaneGeometry(1, 1);
  sharedGeometries.add(box); sharedGeometries.add(pane);
  const glassMaterial = solid('#ffffff', .26, .13), frameMaterial = solid('#b8c4c2', .64, .15), trimMaterial = solid('#d1d3c8');
  function instance(key, geometry, material, x, y, z, sx, sy, sz, yaw, featureId, color, category = 'building') {
    if (!batches.has(key)) batches.set(key, { geometry, material, matrices: [], ids: [], colors: [], category });
    const b = batches.get(key); temp.position.set(x, y, z); temp.scale.set(sx, sy, sz); temp.rotation.set(0, yaw, 0); temp.updateMatrix();
    b.matrices.push(temp.matrix.clone()); b.ids.push(featureId); b.colors.push(color || null);
  }
  function extrude(shapes, height, y, wallColor, roofColor, r, holder) {
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: Math.max(.08, height), bevelEnabled: false, steps: 1, curveSegments: 1 });
    applyBuildingUV(geo);
    const mesh = new THREE.Mesh(geo, [solid(roofColor), architecture.wall(wallColor)]); mesh.rotation.x = -Math.PI / 2; mesh.position.y = y;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.renderOrder = 201; mesh.userData = sourceMeta(r); holder.add(mesh); return mesh;
  }
  function contours(shapes) { return shapes.flatMap(s => [{points:s.getPoints(),outer:true}, ...s.holes.map(h => ({points:h.getPoints(),outer:false}))]); }
  function signedArea(ring) { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
  function facade(r, profile, holder, height, baseHeight) {
    const floorHeight = profile.floorHeight || 3.4, levels = Math.max(1, Math.round((height - baseHeight) / floorHeight));
    const kind=profile.kind, dorm=kind==='dormitory', canteen=r.id==='way/103814566', industrial=/sports|industrial|utility/.test(kind);
    const floorStep=(height-baseHeight)/levels, windowH=dorm?1.68:profile.windowHeight, spacing=profile.facadeModuleWidth;
    const windowW=dorm?2.12:profile.windowWidth, wallColor=new THREE.Color(profile.wallColor),windowColor=new THREE.Color(profile.windowColor);
    const ivory=solid('#e1ded2'), aged=solid('#b4b3aa'), dark=solid('#515b57',.86),metal=solid('#899593',.57,.35),white=solid('#d9dcd5'),warm=solid('#c3c0b0');
    let seed=0;for(const c of r.id)seed=(Math.imul(seed,31)+c.charCodeAt(0))>>>0;
    const rings=contours(r.shapes), allEdges=[];
    for(const contour of rings){
      const ring=[...contour.points];if(ring.length>1&&ring[0].distanceToSquared(ring.at(-1))<1e-9)ring.pop();if(ring.length<3)continue;
      const outwardSign=(signedArea(ring)<0?-1:1)*(contour.outer?1:-1);
      for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=-(b.y-a.y),length=Math.hypot(dx,dz);if(length<1.1)continue;
        const tx=dx/length,tz=dz/length,nx=-tz*outwardSign,nz=tx*outwardSign,edgeYaw=-Math.atan2(tz,tx),planeYaw=Math.atan2(nx,nz),cx=(a.x+b.x)/2,cz=-(a.y+b.y)/2;
        const edge={a,b,dx,dz,length,tx,tz,nx,nz,edgeYaw,planeYaw,cx,cz};if(contour.outer)allEdges.push(edge);
        const at=(key,mat,u,y,out,w,h,d,color)=>instance(key,box,mat,a.x+tx*u+nx*out,y,-a.y+tz*u+nz*out,w,h,d,edgeYaw,r.id,color);
        at('roof-coping',ivory,length/2,height+.22,.1,length+.15,.28,.56,wallColor);
        at('eave-shadow',aged,length/2,height-.12,.13,length,.11,.23);
        at('plinths',aged,length/2,baseHeight+.36,.05,length,.64,.19);
        if(length<windowW+.8||height-baseHeight<2.3)continue;
        const columns=Math.max(1,Math.floor((length-.8)/spacing)),pitch=(length-.8)/columns;
        const balcony=dorm&&profile.facadeFeatures?.balconies===true&&length>18&&nz>.45;
        const gallery=canteen&&length>20&&nz>.6;
        for(let floor=0;floor<levels;floor++){
          if(floor>=(profile.facadeFeatures?.windowFloorLimit??Infinity))continue;
          const slabY=baseHeight+floor*floorStep;
          const y=slabY+floorStep*.56;
          if(y+windowH/2>height-.3)continue;
          if(floor>0&&!industrial){at('floor-shadow-joints',aged,length/2,slabY-.06,.09,length,.07,.17);at('floor-strips',ivory,length/2,slabY+.13,.16,length,dorm?.21:.27,.29);}
          if(gallery){
            at('canteen-recessed-galleries',dark,length/2,slabY+floorStep*.53,.04,length-.6,floorStep*.72,.08);
            at('canteen-gallery-slabs',ivory,length/2,slabY+.1,.66,length,.24,1.4);
            at('canteen-gallery-lintel',ivory,length/2,slabY+floorStep-.22,.64,length,.36,1.4);
            if(floor)at('canteen-gallery-railwall',ivory,length/2,slabY+.72,1.22,length,.7,.14);
            for(let col=0;col<=columns;col++)at('canteen-gallery-columns',ivory,.4+col*pitch,slabY+floorStep/2,1.13,.38,floorStep,.4);
          }
          for(let col=0;col<columns;col++){
            const u=.4+(col+.5)*pitch,x=a.x+tx*u,z=-a.y+tz*u,actualW=Math.min(windowW,pitch*.70);
            const tint=windowColor.clone().lerp(new THREE.Color('#bbc6c2'),(dorm?.20:.32)+.05*floor/Math.max(1,levels-1)).multiplyScalar(.94+((seed+i*7+floor*3+col*13)%11)*.011);
            // The dark recess, projecting sill and four edge jambs give the window a visible wall depth.
            at('window-recesses',dark,u,y,.065,actualW+.25,windowH+.23,.06);
            at('window-glass-depth',glassMaterial,u,y,.11,actualW,windowH,.06,tint);
            instance('distant-window-panes',pane,glassMaterial,x+nx*.12,y,z+nz*.12,actualW,windowH,1,planeYaw,r.id,tint);
            for(const side of[-1,1])at('window-side-jambs',ivory,u+side*(actualW/2+.055),y,.18,.11,windowH+.21,.25);
            at('window-lintels',ivory,u,y+windowH/2+.075,.15,actualW+.3,.15,.22);
            at('window-sills',aged,u,y-windowH/2-.08,.24,actualW+.36,.13,.43);
            at('window-mullions',white,u,y,.2,.055,windowH,.06);
            at('window-transoms',white,u,y+windowH*.19,.2,actualW,.045,.06);
            if((seed+col*11+floor*5)%7===0){
              // Opaque inner curtain panel, offset behind the frame. No expensive transparent facade sorting.
              const curtain=new THREE.Color(['#c2c8bd','#d5cbbb','#8d9c97'][(col+floor)%3]);
              at('window-curtains',white,u+actualW*.24,y,.145,actualW*.34,windowH*.9,.018,curtain);
            }
            counts.facadeWindows++;
            if(balcony&&floor>0){
              const w=Math.min(pitch-.16,3.4),depth=.95;
              at('dorm-balcony-slabs',ivory,u,slabY+.03,depth/2,w,.16,depth);
              for(const side of[-1,1])at('dorm-balcony-divider',ivory,u+side*w/2,slabY+1.34,depth/2,.13,2.65,depth);
              at('dorm-balcony-lowwall',ivory,u,slabY+.37,depth,w,.55,.12);
              at('dorm-balcony-hand-rails',metal,u,slabY+1.04,depth,w,.065,.065);
              for(let k=0;k<5;k++)at('dorm-balcony-balusters',metal,u+(k-2)*w/5,slabY+.76,depth,.032,.48,.032);
              if((col+floor*3+seed)%9===0)at('dorm-hanging-fabric',white,u+.36,slabY+1.57,.78,.55,.83,.028,new THREE.Color(['#adabbc','#c1a399','#a5b1b1'][(col+floor)%3]));
            } else if(dorm&&floor<2){
              for(let k=0;k<5;k++)at('dorm-ground-window-guards',metal,u+(k-2)*actualW/5,y,.3,.022,windowH,.025);
              for(const v of[-.3,.3])at('dorm-ground-window-guards',metal,u,y+v,.3,actualW,.025,.025);
            }
            if(profile.facadeFeatures?.airConditioners!==false&&(dorm||kind==='academic'||kind==='teaching')&&(col+floor)%2===0&&length>10){
              const acU=u+Math.min(actualW*.63,pitch*.34),acY=y-.66,acOut=balcony?1.13:.44;
              at('air-conditioner-housings',white,acU,acY,acOut,.72,.5,.33);
              at('air-conditioner-grilles',dark,acU-.10,acY,acOut+.18,.36,.35,.025);
              for(let k=0;k<4;k++)at('air-conditioner-fins',aged,acU-.1,acY+(k-1.5)*.075,acOut+.2,.36,.018,.025);
              for(const side of[-1,1])at('air-conditioner-support',metal,acU+side*.25,acY-.29,acOut-.03,.045,.09,.46);
              counts.airConditioners++;
            }
          }
        }
        if(!industrial&&length>12){for(const u of[.55,length-.55]){at('rainwater-pipes',warm,u,(height+baseHeight)/2,.27,.085,height-baseHeight,.085);for(let f=1;f<levels;f++)at('pipe-clamps',metal,u,baseHeight+f*floorStep,.28,.14,.06,.12);}}
      }
    }
    // A restrained entrance/roof marker distinguishes a building's ground level.
    const front=allEdges.filter(e=>e.length>12&&e.nz>.3).sort((a,b)=>b.length-a.length)[0]||allEdges.sort((a,b)=>b.length-a.length)[0];
    if(front&&!industrial&&!profile.isPart&&profile.facadeFeatures?.inferredEntrance!==false){
      const {cx,cz,nx,nz,tx,tz,edgeYaw,length}=front,w=canteen?7.5:dorm?3.4:4.4;
      const put=(key,mat,u,y,out,sx,sy,sz,color)=>instance(key,box,mat,cx+tx*u+nx*out,y,cz+tz*u+nz*out,sx,sy,sz,edgeYaw,r.id,color);
      put('entrance-recesses',dark,0,baseHeight+1.35,.17,w,2.6,.2);
      for(const side of[-1,1]){put('entrance-door-glazing',glassMaterial,side*w*.22,baseHeight+1.34,.29,w*.41,2.45,.08,new THREE.Color('#6d8788'));put('entrance-door-frames',white,side*w*.44,baseHeight+1.35,.34,.07,2.55,.08);put('entrance-door-handles',metal,side*.15,baseHeight+1.25,.42,.035,.6,.05);}
      put('entrance-canopies',ivory,0,baseHeight+2.98,.8,w+.6,.18,1.7);
      if(dorm&&profile.facadeFeatures?.stairTower===true){
        put('dorm-entry-nameplates',solid('#655c50'),w*.6,baseHeight+1.9,.21,.49,.67,.09);
        // A projecting stair bay follows the photographed dormitory vocabulary;
        // which particular source edge carries a staircase is still inferred.
        put('dorm-stair-bay-glazing',glassMaterial,0,(height+baseHeight)/2+.4,.3,2.72,height-baseHeight-1,.1,new THREE.Color('#809394'));
        for(const side of[-1,1])put('dorm-stair-bay-piers',ivory,side*1.53,(height+baseHeight)/2,.35,.34,height-baseHeight,.65);
        for(let f=1;f<levels;f++)put('dorm-stair-bay-spandrels',ivory,0,baseHeight+f*floorStep,.4,3.35,.45,.72);
        for(const u of[-.9,0,.9])put('dorm-stair-bay-mullions',white,u,(height+baseHeight)/2,.4,.065,height-baseHeight-.6,.08);
        put('dorm-stair-bay-cornice',ivory,0,height+.12,.48,3.8,.28,1.13);
        if(profile.roofForm!=='pitched'){put('roof-stairwell',ivory,0,height+.62,-2.9,4.6,1.16,3.6);put('roof-stairwell-coping',aged,0,height+1.23,-2.9,4.8,.13,3.8);}
      }
      if(canteen){
        // Historic photograph: two levels, recessed gallery, cylindrical blue-green roundel and broad entrance tower.
        put('canteen-sign-band',solid('#9c4237'),0,baseHeight+2.64,.48,Math.min(20,length*.72),.66,.13);
        put('canteen-entry-tower',ivory,-length*.21,height*.6,.73,4.6,height*1.17,1.65);
        for(const side of[-1,1])put('canteen-tower-piers',ivory,-length*.21+side*1.77,height+1.1,.75,.46,1.9,.65);
        const circle=new THREE.CircleGeometry(1.2,32);sharedGeometries.add(circle);
        instance('canteen-roundel',circle,glassMaterial,cx+tx*(-length*.21)+nx*1.59,height*.78,cz+tz*(-length*.21)+nz*1.59,1,1,1,Math.atan2(nx,nz),r.id,new THREE.Color('#3f7376'));
        const ringGeo=new THREE.TorusGeometry(1.23,.105,8,40);sharedGeometries.add(ringGeo);
        instance('canteen-roundel-frame',ringGeo,ivory,cx+tx*(-length*.21)+nx*1.63,height*.78,cz+tz*(-length*.21)+nz*1.63,1,1,1,Math.atan2(nx,nz),r.id);
      }
    }
    holder.userData.facadeProvenance={status:profile.landmarkEvidence?'building-specific-evidence-with-estimated-dimensions':'generic-unverified-openings',style:profile.facadeStyle,individualOpenings:'inferred, not a measured elevation',evidence:profile.facadeEvidence,sources:profile.landmarkEvidence?.sourceUrl?[profile.landmarkEvidence.sourceUrl]:[]};
  }
  function pitchedRoof(r,p,holder,height){
    if(p.roofForm!=='pitched')return;
    for(const shape of r.shapes){
      if(shape.holes.length)continue;
      const ring=shape.getPoints().slice();if(ring[0].distanceToSquared(ring.at(-1))<1e-9)ring.pop();
      let longest={length:0};for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],l=a.distanceTo(b);if(l>longest.length)longest={length:l,a,b};}
      const tangent=longest.b.clone().sub(longest.a).normalize(),n=new THREE.Vector2(-tangent.y,tangent.x),values=ring.map(p=>p.dot(n)),low=Math.min(...values),high=Math.max(...values),mid=(low+high)/2,half=(high-low)/2,rise=p.roofRise||1.25;
      const roofY=q=>height+Math.max(0,1-Math.abs(q.dot(n)-mid)/half)*rise;
      const vertices=[];
      const push=(a,b,c,ya,yb,yc)=>vertices.push(a.x,ya,-a.y,b.x,yb,-b.y,c.x,yc,-c.y);
      function clip(sign){const out=[];for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],da=(a.dot(n)-mid)*sign,db=(b.dot(n)-mid)*sign;if(da>=0)out.push(a.clone());if((da>=0)!==(db>=0))out.push(a.clone().lerp(b,da/(da-db)));}return out;}
      for(const sign of[-1,1]){const halfRing=clip(sign);for(const[a,b,c]of THREE.ShapeUtils.triangulateShape(halfRing,[]))push(halfRing[a],halfRing[b],halfRing[c],roofY(halfRing[a]),roofY(halfRing[b]),roofY(halfRing[c]));}
      for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length],da=a.dot(n)-mid,db=b.dot(n)-mid;
        // Splitting at the ridge is essential: both end points of a gable
        // edge are at the eaves, but its centre rises to the ridge.
        const edge=da*db<0?[a,a.clone().lerp(b,da/(da-db)),b]:[a,b];
        for(let j=1;j<edge.length;j++){const u=edge[j-1],v=edge[j],yu=roofY(u),yv=roofY(v);if(yu>height+.0001)push(u,v,u,height,height,yu);if(yv>height+.0001)push(v,v,u,height,yv,yu);}
      }
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();
      const mesh=new THREE.Mesh(geo,solid('#777b72',.94));mesh.name='source-confirmed-sloping-roof';mesh.castShadow=true;mesh.receiveShadow=true;mesh.renderOrder=203;mesh.userData=sourceMeta(r,{roofFormEvidence:p.roofEvidence,roofRiseEstimate:rise});holder.add(mesh);counts.slopingRoofs++;
    }
  }
  for (const r of getReconstructionBuildings(model)) {
    if (!r.shapes?.length) continue;
    const p = profileFeature(r), isPart = !!p.isPart || !!r.isPart;
    if(r.derivedBuilding)p.facadeFeatures={...p.facadeFeatures,inferredEntrance:false,airConditioners:false};
    counts[isPart ? 'buildingParts' : 'buildings']++; counts[p.estimated === false ? 'sourceHeights' : 'estimatedHeights']++;
    if (r.id === eastNinePart && sourceById.has(eastNineId)) continue;
    const parts = (partsByParent.get(r.id) || []).map(id => sourceById.get(id)).filter(Boolean);
    const holder = new THREE.Group(); holder.name = r.feature.properties?.name || r.id; holder.userData = sourceMeta(r, { profile: p }); layer('building').add(holder);
    const height = Math.max(.2, p.height || 12), baseHeight = Math.max(0, p.baseHeight || 0);
    const record = { id: r.id, feature: r.feature, group: holder, height, baseHeight, profile: p, category: 'building', parts: parts.map(part => part.id), derivedBuilding:!!r.derivedBuilding }; records.set(r.id, record);
    if(model.sportsInfrastructure?.replacedBuildingIds?.includes(r.id)){record.displayMode='photo-inferred-low-stand';holder.userData.renderedBy='campus-sports';continue;}
    if(r.derivedBuilding){holder.userData.footprintEvidence=r.footprintEvidence;holder.userData.sourceCategory=r.sourceCategory;holder.userData.derivedBuilding=true;}
    if(r.id===OPTO_BUILDING_ID){
      optoBuilding=createOptoBuilding(THREE,r,{frame,geoToLocal});
      holder.add(optoBuilding.group);detailDisposers.push(optoBuilding.dispose);
      record.height=33;record.displayMode='opto-source-courtyards-photo-informed';continue;
    }
    if (r.id === eastNineId) {
      try {
      const detailed = createEastNineDetails(THREE, r, { ...p, parts }); holder.add(detailed.group || detailed);if(detailed.disposeArchitecturalTextures)detailDisposers.push(detailed.disposeArchitecturalTextures);
      holder.traverse(o => { if (o.isMesh || o.isLine || o.isPoints) o.renderOrder = Math.max(201, o.renderOrder || 0); });
      for (const part of parts) records.set(part.id, { ...record, id: part.id, feature: part.feature, profile: profileFeature(part), displayMode: 'east-nine-source-part' });
      record.displayMode = 'east-nine-photo-informed'; continue;
      } catch (error) { const warning=`${r.id}: detailed East Nine unavailable (${error.message}); using the source-footprint reconstruction.`; warnings.push(warning); holder.userData.warning=warning; record.displayMode='source-footprint-fallback'; for (const part of parts) records.set(part.id,{...record,id:part.id,feature:part.feature,profile:profileFeature(part)}); }
    }
    const yunyuan=createYunyuanDetails(THREE,r,p);
    if(yunyuan){
      holder.add(yunyuan);
      holder.userData.facadeProvenance=yunyuan.userData;
      record.displayMode='yunyuan-local-photo-informed';
      continue;
    }
    if (parts.length && r.id !== eastNineId) {
      // Source part volumes express the building composition; a full parent extrusion would swallow them.
      const baseY=.06,baseThickness=.24;
      record.mesh = extrude(r.shapes, baseThickness, baseY, p.wallColor || '#d5d2c8', p.roofColor || '#b8b9b2', r, holder);
      // The same rule must hold for physics: retain every source part collider,
      // but replace the conceptual parent volume with its visible low plinth.
      compositeInfrastructure.replacedBuildingIds.push(r.id);
      r.shapes.forEach((shape,i)=>compositeInfrastructure.walkSurfaces.push({id:`${r.id}:composite-plinth:${i}`,sourceId:r.id,
        polygon:shape.getPoints().map(v=>({x:v.x,z:-v.y})),holes:shape.holes.map(h=>h.getPoints().map(v=>({x:v.x,z:-v.y}))),
        surfaceY:baseY+baseThickness,geometryEvidence:'same base and thickness as the rendered composite-building plinth'}));
      record.displayMode = 'part-composite-base'; counts.compositeBuildings++; continue;
    }
    record.mesh = extrude(r.shapes, height - baseHeight, baseHeight + .08, p.wallColor || '#d6d0c0', p.roofColor || '#9fa69e', r, holder);
    if (!p.isRoof) facade(r, p, holder, height + .08, baseHeight + .08);
    pitchedRoof(r,p,holder,height+.08);
    const landmark=createCampusLandmarkDetails(THREE,r,p,{frame,geoToLocal});
    if(landmark){holder.add(landmark);record.displayMode='landmark-photo-informed';}
  }
  function local(c) { const p = geoToLocal({ longitude: c[0], latitude: c[1], height: 0, coordinateSystem: 'EPSG:4326' }, frame); return new THREE.Vector3(p.x, 0, p.z); }
  function roadOutline(points,width) {
    const left=[],right=[];
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];let dx = b.x - a.x, dz = b.z - a.z;
      const joint=roadJoints.get(`${points[i].x.toFixed(4)}/${points[i].z.toFixed(4)}`);
      if((i===0||i===points.length-1)&&joint&&Math.abs(joint.width-width)<.01){const sign=joint.dx*dx+joint.dz*dz<0?-1:1;dx=joint.dx*sign;dz=joint.dz*sign;}
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len * width / 2, nz = dx / len * width / 2, p = points[i];
      left.push([p.x+nx,p.z+nz]);right.push([p.x-nx,p.z-nz]);
    }
    return {left,right,ring:[...left,...[...right].reverse(),left[0]]};
  }
  function ribbon(points, width, y, material, holder, meta, depth = .12) {
    if (points.length < 2) return null;
    const vertices = [], indices = [],outline=roadOutline(points,width);
    for (let i = 0; i < points.length; i++) {
      const [lx,lz]=outline.left[i],[rx,rz]=outline.right[i];
      vertices.push(lx,y,lz,rx,y,rz,lx,y-depth,lz,rx,y-depth,rz);
      if (i) { const o = i * 4, q = o - 4; indices.push(q,o,q+1,q+1,o,o+1,q+2,o+2,q,o+2,o,q,q+1,o+1,q+3,o+1,o+3,q+3); }
    }
    // The lake branch starts at the asphalt road centreline. Trim only its
    // displayed top where those source ribbons overlap, rather than keeping
    // ~100 m² of coplanar competing triangles. Source geometry/physics stay put.
    const mainRoad=sourceById.get('way/1228820956');
    if(meta.featureId==='way/97080595'&&mainRoad?.feature.geometry.type==='LineString'){
      const cut=roadOutline(mainRoad.feature.geometry.coordinates.map(local),getRoadProfile(mainRoad.feature).width);
      const polygons=polygonClipping.difference([outline.ring],[cut.ring]);
      const sides=indices.filter((_,i)=>i%18>=6);indices.length=0;indices.push(...sides);
      const shapes=polygons.map(rings=>{const shape=new THREE.Shape(rings[0].map(([x,z])=>new THREE.Vector2(x,-z)));for(const ring of rings.slice(1))shape.holes.push(new THREE.Path(ring.map(([x,z])=>new THREE.Vector2(x,-z))));return shape;});
      const top=new THREE.ShapeGeometry(shapes);top.rotateX(-Math.PI/2);
      const p=top.attributes.position,offset=vertices.length/3;
      for(let i=0;i<p.count;i++)vertices.push(p.getX(i),y,p.getZ(i));
      for(const i of top.index.array)indices.push(offset+i);
      top.dispose();meta.renderedTopClipAgainst=mainRoad.id;
    }
    const indexed = new THREE.BufferGeometry(); indexed.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); indexed.setIndex(indices);
    // Upward deck faces and hard slab edges prevent the shadow bias from
    // treating the road surface as its own occluder at a low camera angle.
    const g = indexed.toNonIndexed(); indexed.dispose(); g.computeVertexNormals(); applyWorldUV(g);
    const m = new THREE.Mesh(g, material); m.userData = meta; m.receiveShadow = true;
    // Piers and rails cast the bridge shadows; the thin double-sided deck
    // receives them without self-shadow banding in the metre-scale scene.
    m.castShadow = false; m.renderOrder = 200; holder.add(m); return m;
  }
  const roadMaterial = surfaces.asphalt, pathMaterial = surfaces.paving, bridgeMaterial = surfaces.concrete, markingMaterial = surfaces.paint, railMaterial = solid('#b7c3bf', .55, .3);
  const centreMaterial=solid('#c6ad67',.91);
  applySurfaceDepthBias(markingMaterial,4);applySurfaceDepthBias(centreMaterial,4);
  // Shared source vertices determine junction clearance. Separate ways that
  // merely continue one another do not create an intersection.
  const roadNodes=new Map(),roadKey=c=>`${c[0].toFixed(7)},${c[1].toFixed(7)}`;
  for(const road of model.roads){const profile=getRoadProfile(road.feature);if(!profile.motor||profile.elevation!==0)continue;
    const g=road.feature.geometry,lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
    for(const line of lines)for(let i=0;i<line.length;i++){const id=roadKey(line[i]);if(!roadNodes.has(id))roadNodes.set(id,{point:local(line[i]),neighbors:new Set(),width:0});const n=roadNodes.get(id);n.width=Math.max(n.width,profile.width);if(i)n.neighbors.add(roadKey(line[i-1]));if(i<line.length-1)n.neighbors.add(roadKey(line[i+1]));}
  }
  const roadJunctions=[...roadNodes.values()].filter(n=>n.neighbors.size>=3);
  const roadJoints=new Map();
  for(const n of roadNodes.values()){if(n.neighbors.size!==2)continue;const [a,b]=[...n.neighbors].map(id=>roadNodes.get(id)?.point);if(!a||!b)continue;roadJoints.set(`${n.point.x.toFixed(4)}/${n.point.z.toFixed(4)}`,{dx:b.x-a.x,dz:b.z-a.z,width:n.width});}
  const markingClear=(x,z,halfLength=0)=>!roadJunctions.some(n=>Math.hypot(x-n.point.x,z-n.point.z)<n.width/2+3+halfLength);
  const edgeRoads=[];
  for(const r of model.roads){const p=getRoadProfile(r.feature),g=r.feature.geometry,lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];for(const coords of lines)edgeRoads.push({id:r.id,...p,points:coords.map(local)});}
  const roadEdgePlan=planCampusRoadEdges(edgeRoads);
  for(const edge of roadEdgePlan)instance('estimated-road-edge-stones',box,solid('#b8b9b0',.93),edge.x,edge.y,edge.z,edge.length,edge.height,edge.width,edge.yaw,edge.featureId,null,'road');
  counts.roadEdgeStones=roadEdgePlan.length;
  const pierGeometry = new THREE.CylinderGeometry(1, 1.2, 1, 8); sharedGeometries.add(pierGeometry);
  for (const r of model.roads) {
    const p = getRoadProfile(r.feature), holder = new THREE.Group(); holder.name = r.feature.properties?.name || r.id;
    holder.userData = sourceMeta(r, { profile: p }); layer('road').add(holder); const meta = sourceMeta(r, { profile: p });
    counts.roads++; if (p.bridge) counts.bridges++; if (p.estimated) counts.estimatedRoadWidths++;
    const record = { id: r.id, feature: r.feature, category: 'road', group: holder, profile: p, width: p.width }; records.set(r.id, record);
    if(model.sportsInfrastructure?.replacedRoadIds?.includes(r.id)){record.displayMode='source-sports-steps-and-walk';holder.userData.renderedBy='campus-sports';continue;}
    if(p.campusBridge?.renderedByMainBridge&&sourceById.has(p.campusBridge.mainId)){
      holder.userData.renderedBy=p.campusBridge.mainId;
      continue;
    }
    // Separate coincident road/footway surfaces by 2 mm so asphalt stays
    // continuous under crossing paint. The logarithmic depth buffer does not
    // reliably resolve polygonOffset alone at these coplanar intersections.
    const y = (p.elevation || 0) + .14 + (p.motor ? .002 : 0), width = Math.max(.7, p.width || 3);
    const material = /foot|path|pedestrian|steps/.test(p.kind || '') ? pathMaterial : r.id==='way/97080595'?surfaces.roadPavers:roadMaterial;
    if(r.id==='way/97080595')meta.surfaceEvidence={type:'photo-informed-block-paving',photos:['截屏2026-10-06 20.20.36.png','截屏2026-10-06 20.21.05.png'],paverDimensions:'estimated',captureDate:'unknown'};
    if (r.shapes?.length) { record.mesh = extrude(r.shapes, .12, y - .12, '#a9afa3', '#969f96', r, holder); continue; }
    const geo = r.feature.geometry, lines = geo.type === 'LineString' ? [geo.coordinates] : geo.type === 'MultiLineString' ? geo.coordinates : [];
    for (const coords of lines) {
      const points = coords.map(local).filter((point, i, arr) => i === 0 || point.distanceToSquared(arr[i - 1]) > .0001);
      ribbon(points, width, y, material, holder, meta, p.bridge ? (p.campusBridge?.deckDepth??.75) : .12);
      const wideCorridor=p.reserveMotorCenter&&width>=10;
      // Small residential/service alleys are shared roads, not miniature
      // highways. Mark only evidenced broad corridors / tagged lane roads.
      if (p.motor && (wideCorridor||p.lanes>=2) && !p.tunnel) {
        let travel = 0;
        for (let j = 1; j < points.length; j++) {
          const a = points[j-1], b = points[j], length = a.distanceTo(b); if (length < .01) continue; const dx=(b.x-a.x)/length, dz=(b.z-a.z)/length, yaw=-Math.atan2(dz,dx);
          const mark=(key,offset,lateral,length,m,width=.12)=>{const x=a.x+dx*offset-dz*lateral,z=a.z+dz*offset+dx*lateral;if(!markingClear(x,z,length/2))return;instance(key,box,m,x,y+.006,z,length,.003,width,yaw,r.id,null,'road');};
          if(wideCorridor){
            for(let offset=.5;offset<length;offset+=1){const l=Math.min(1,length-offset+.5);if(l<.08)continue;for(const side of[-1,1]){mark('avenue-centre-lines',offset,side*.14,l,centreMaterial,.10);mark('avenue-cycle-boundaries',offset,side*(width/2-p.cycleBandWidth),l,markingMaterial,.10);}}
          }
          for (let start=Math.ceil(travel/10)*10; start<travel+length; start+=10) { const offset=start-travel, dash=Math.min(3.2,length-offset); if(dash<.4)continue;
            if(wideCorridor&&width>=14)for(const side of[-1,1])mark('avenue-motor-lane-dashes',offset+dash/2,side*(width/2-p.cycleBandWidth)/2,dash,markingMaterial);
            else if(wideCorridor)continue;
            else mark('road-dashes',offset+dash/2,0,dash,markingMaterial);
          }
          travel+=length;
        }
      }
      if (p.bridge && r.id === 'way/1228820957') {
        const sidewalks=(p.campusBridge?.sidewalkIds||[]).map(id=>sourceById.get(id)).filter(Boolean).map(side=>({sourceId:side.id,points:side.feature.geometry.coordinates.map(local),width:getRoadProfile(side.feature).width}));
        const details=createBridgeDetails(THREE,{points,width,surfaceY:y,surfaces,sourceId:r.id,sidewalks});
        holder.add(details.group);detailDisposers.push(details.dispose);
        bridgeInfrastructure.barriers.push(...details.infrastructure.barriers);
        bridgeInfrastructure.walkSurfaces.push(...details.infrastructure.walkSurfaces);
      } else if (p.bridge) {
        const structure=planBridgeStructure({points,width,surfaceY:y,sourceId:r.id});
        for(const part of structure.piers)instance('bridge-piers',pierGeometry,bridgeMaterial,part.x,part.y,part.z,part.radiusTop,part.height,part.radiusTop,0,r.id,null,'road');
        for(const part of structure.rails)instance('bridge-rails',box,railMaterial,part.x,part.y,part.z,part.length,part.height,part.width,part.yaw,r.id,null,'road');
        bridgeInfrastructure.barriers.push(...structure.barriers);
      }
    }
  }
  // Source planting footprints are reconstructed as separate canopy, shrub and
  // ground-cover layers. Sampling excludes roads, buildings, water and sports.
  const lawnLandmarks=createCampusLawnLandmarks(THREE,model,{frame,geoToLocal,surfaces});
  const einsteinSquare=createEinsteinSquare(THREE,model,{frame,geoToLocal});
  layer('environment').add(einsteinSquare.group);detailDisposers.push(einsteinSquare.dispose);
  forestLayer=createCampusLandcover(THREE,model,{frame,geoToLocal,surfaces,photoOpenLawns:[...lawnLandmarks.plan.lawns,{polygons:einsteinSquare.plan.polygons}]});
  layer('environment').add(forestLayer.group);
  counts.trees=forestLayer.counts.trees;
  counts.shrubs=forestLayer.counts.shrubs;
  counts.vegetationSourceFeatures=forestLayer.counts.sourceFeatures;
  counts.landcoverPatches=forestLayer.counts.coverages;
  layer('environment').userData={source:'OSM woodland/tree_row/grass/meadow/scrub/garden/flowerbed footprints',individualPositions:'procedural within explicit source planting coverage, not surveyed',height:'6–17 m tree / 0.45–1.3 m shrub display estimate',excluded:'source buildings, roads, parking, water and sports; lawns remain open',photoEvidence:forestLayer.plan.evidence};
  const yunyuanForecourt=createYunyuanForecourt(THREE,model,{surfaces,existingTrees:forestLayer.plan.trees});
  layer('environment').add(yunyuanForecourt.group);detailDisposers.push(yunyuanForecourt.dispose);
  model.photoForecourtReservations=['sculptures','parkingSigns','noticeboards','shrubs','trees'].flatMap(k=>yunyuanForecourt.plan[k]);
  counts.yunyuanPhotoFixtures=model.photoForecourtReservations.length;
  const lakeFurniture=createLakesideDetails(THREE,model,{frame,geoToLocal,surfaces});
  let eastNineDetail=null;
  group.traverse(object=>{if(object.userData.detailModel==='east-nine-source-footprint'&&object.userData.columnPositions)eastNineDetail=object;});
  const eastNineGround=createEastNineGround(THREE,model,{surfaces,entrySurfaces:collectEastNineAccess(eastNineDetail).walkSurfaces});
  model.eastNineGround=eastNineGround;
  layer('environment').add(eastNineGround.group);detailDisposers.push(eastNineGround.dispose);
  if(eastNineDetail){
    alignEastNineColumnFeet(THREE,eastNineDetail,eastNineGround.surfaceHeightAt);
    const access=collectEastNineAccess(eastNineDetail);
    model.architectureInfrastructure={...access,walkSurfaces:[...access.walkSurfaces,...eastNineGround.infrastructure.walkSurfaces],barriers:[...access.barriers,...eastNineGround.infrastructure.barriers]};
  }
  if(compositeInfrastructure.replacedBuildingIds.length){
    const access=model.architectureInfrastructure||{};
    model.architectureInfrastructure={...access,
      replacedBuildingIds:[...(access.replacedBuildingIds||[]),...compositeInfrastructure.replacedBuildingIds],
      walkSurfaces:[...(access.walkSurfaces||[]),...compositeInfrastructure.walkSurfaces]};
  }
  {
    const access=model.architectureInfrastructure||{};
    const opto=optoBuilding?.infrastructure||{};
    model.architectureInfrastructure={...access,
      replacedBuildingIds:[...(access.replacedBuildingIds||[]),...(opto.replacedBuildingIds||[])],
      buildings:[...(access.buildings||[]),...(opto.buildings||[])],
      barriers:[...(access.barriers||[]),...einsteinSquare.infrastructure.barriers,...(opto.barriers||[])],
      walkSurfaces:[...(access.walkSurfaces||[]),...einsteinSquare.infrastructure.walkSurfaces,...(opto.walkSurfaces||[])]};
  }
  const forecourt=createEastNineForecourt(THREE,model,{surfaces,existingTrees:forestLayer.plan.trees,heightAt:eastNineGround.heightAt});
  layer('environment').add(forecourt.group);detailDisposers.push(forecourt.dispose);counts.forecourtPlantInstances=forecourt.plan.planting.plants.length;
  layer('environment').add(lakeFurniture.group);detailDisposers.push(lakeFurniture.dispose);counts.lakesideLamps=lakeFurniture.counts.lakesideLamps;
  const aquaticPlants=createAquaticPlants(THREE,{record:model.water.find(record=>record.id==='relation/13705236'),roads:model.roads});
  layer('environment').add(aquaticPlants.group);detailDisposers.push(aquaticPlants.dispose);counts.aquaticLeaves=aquaticPlants.counts.leaves;
  layer('environment').add(lawnLandmarks.group);detailDisposers.push(lawnLandmarks.dispose);
  counts.photoLawnLandmarks=lawnLandmarks.plan.stones.length+lawnLandmarks.plan.canopies.length;
  const facadeLods=[];
  for (const [key, b] of batches) {
    if (!b.matrices.length) continue;
    const mesh = new THREE.InstancedMesh(b.geometry, b.material, b.matrices.length); mesh.name = key; mesh.renderOrder = 202;
    b.matrices.forEach((m, i) => { mesh.setMatrixAt(i, m); if (b.colors[i]) mesh.setColorAt(i, b.colors[i]); });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = /coping|plinth|strip|pier|rail|tree|balcony|canop|jamb|sill|conditioner|tower|edge-stones/.test(key); mesh.receiveShadow = true;
    mesh.userData = { category: b.category, reconstruction: true, instanceFeatureIds: b.ids, decorative: true };
    if(key==='estimated-road-edge-stones')mesh.userData.detailEvidence='estimated 0.24 m edge stones along unmodified source-road widths; mapped intersections and footpath access left open';
    if(b.category==='building'||key==='estimated-road-edge-stones'||/avenue-|road-dashes/.test(key)){
      const distant=key==='distant-window-panes',roadEdges=key==='estimated-road-edge-stones';
      // Fine slats and bars are already below one pixel at these distances;
      // retain glass, roof lines and broad structural silhouettes farther away.
      const maxDistance=roadEdges?120:distant?1500:b.category==='road'?600:/roof|canteen|entrance|plinth/.test(key)?450:/balcony/.test(key)?240:/fins|guards|clamps|curtains|handles/.test(key)?60:/jambs|sills|mullions|transoms/.test(key)?100:/conditioner/.test(key)?120:180;
      const positions=b.matrices.map(m=>new THREE.Vector3().setFromMatrixPosition(m));
      const spatialCells=createStaticXZIndex(positions),selection=createStaticInstanceSelection(mesh,{matrices:b.matrices,colors:b.colors,ids:b.ids});
      facadeLods.push({mesh,b,positions,maxDistance,distant,spatialCells,selection,roadEdges,candidates:[],visible:[]});mesh.frustumCulled=false;if(distant)mesh.count=0;
    } if(b.category==='environment'){mesh.raycast=()=>{};mesh.userData.individualPositions='procedural; not surveyed';} layer(b.category).add(mesh);
  }
  function setVisible(visible) { group.visible = !!visible; }
  function setLayerVisible(name, visible) { const key = ({ buildings: 'building', roads: 'road' })[name] || name; if (layers.has(key)) layers.get(key).visible = !!visible; }
  const facadeFrustum=new THREE.Frustum(),facadeMatrix=new THREE.Matrix4(),facadeSphere=new THREE.Sphere(),lastPosition=new THREE.Vector3(Infinity,Infinity,Infinity),lastQuaternion=new THREE.Quaternion();
  let fullDetail=false,detailedRoadIds=new Set(),lastDetailScale=-1;
  function setDetailedRoadIds(ids=[]){detailedRoadIds=new Set(ids);group.userData.detailedRoadIds=[...detailedRoadIds];counts.reservedRoadEdgeStones=roadEdgePlan.filter(e=>detailedRoadIds.has(e.featureId)).length;fullDetail=true;}
  function update(camera,{viewportHeight=800,detailDistanceScale=1}={}){
    const detailScale=Number.isFinite(detailDistanceScale)?Math.max(.35,Math.min(1.5,detailDistanceScale)):1;
    forestLayer?.update?.(camera,{detailDistanceScale:detailScale});
    einsteinSquare.update?.(camera);
    optoBuilding?.update?.(camera,{detailDistanceScale:detailScale});
    yunyuanForecourt.update(camera,{detailDistanceScale:detailScale});
    aquaticPlants.update?.(camera,{viewportHeight});
    if(!camera){for(const {b,distant,selection,roadEdges,visible}of facadeLods){visible.length=0;if(!distant)for(let i=0;i<b.matrices.length;i++)if(!roadEdges||!detailedRoadIds.has(b.ids[i]))visible.push(i);selection.update(visible);}fullDetail=true;return;}
    if(!fullDetail&&lastDetailScale===detailScale&&lastPosition.distanceToSquared(camera.position)<1&&Math.abs(lastQuaternion.dot(camera.quaternion))>.99997)return;
    fullDetail=false;lastDetailScale=detailScale;lastPosition.copy(camera.position);lastQuaternion.copy(camera.quaternion);camera.updateMatrixWorld();
    facadeMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);facadeFrustum.setFromProjectionMatrix(facadeMatrix);
    for(const {mesh,b,positions,maxDistance,distant,spatialCells,selection,roadEdges,candidates,visible}of facadeLods){
      const range=maxDistance*detailScale;visible.length=0;
      spatialCells.query(camera.position,range,candidates);mesh.userData.lastCandidateCount=candidates.length;
      for(const i of candidates){if(roadEdges&&detailedRoadIds.has(b.ids[i]))continue;const p=positions[i],distanceSq=p.distanceToSquared(camera.position);if(distanceSq>range*range||distant&&distanceSq<(180*detailScale)**2)continue;facadeSphere.center.copy(p);facadeSphere.radius=distant?3:8;if(!facadeFrustum.intersectsSphere(facadeSphere))continue;visible.push(i);}
      selection.update(visible);
    }
  }
  function dispose() {
    if(model.eastNineGround===eastNineGround)delete model.eastNineGround;
    forestLayer?.dispose();detailDisposers.forEach(dispose=>dispose());architecture.dispose();surfaces.dispose();
    const geometries = new Set(sharedGeometries), usedMaterials = new Set(materials.values()); group.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) usedMaterials.add(m); });
    geometries.forEach(g => g.dispose()); usedMaterials.forEach(m => m.dispose()); group.removeFromParent();
  }
  function tick(dt,camera){return forecourt.update?.(dt,camera)||false;}
  return { group, records, counts, layers, warnings, roadEdgePlan,
    optoEntry:optoBuilding?{...optoBuilding.entry,label:'光电信息大楼 · C118 报告厅'}:null,optoViewpoints:optoBuilding?.viewpoints,
    einsteinSquarePlan:einsteinSquare.plan, landcoverPlan:forestLayer?.plan, lawnLandmarkPlan:lawnLandmarks.plan, dynamicGroups:forecourt.dynamicGroup?[forecourt.dynamicGroup]:[], tick, update, setVisible, setLayerVisible, setDetailedRoadIds, dispose };
}
