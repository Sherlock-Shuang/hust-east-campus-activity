import {getRoadProfile} from './building-profiles.js';
import {streetFootprint,createRoadClearance} from './street-clearance.js';
import {footprintIntersectsRing} from './yunyuan-parking.js';

export const EAST_NINE_PARKING_IDS=Object.freeze(['node/11395860770','node/1186784735','node/1186784614','node/11394531551']);
const PHOTO='/references/local-campus/east-nine-curtainwall.webp';
const random=seed=>{const x=Math.sin(seed*127.1+61.7)*43758.5453;return x-Math.floor(x);};

/** The POIs locate parking areas, not individual vehicles. Short mixed rows,
 * empty bays and access aisles follow the local forecourt photograph; every
 * offset, count and heading remains an appearance estimate, not a traffic count.
 * A positive numeric id is essential: the shared actor library uses it to select
 * a vehicle family. Unidentified parking silently repeated family/colour zero.
 */
export function createEastNineParking(fc,{frame,geoToLocal,roadSurfaces=[],locate}={}){
  const project=c=>{const p=geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);return{x:p.x,z:p.z};};
  const obstacles=fc.features.filter(f=>['building','water','green'].includes(f.properties?.category)).flatMap(f=>{
    const polygons=f.geometry?.type==='Polygon'?[f.geometry.coordinates]:f.geometry?.type==='MultiPolygon'?f.geometry.coordinates:[];
    // A conservative outer-ring test also leaves source gardens and lake holes
    // untouched. None of these four POIs requires an island interior.
    return polygons.map(rings=>rings[0].map(project));
  });
  const roads=fc.features.filter(f=>f.properties?.category==='road'&&['LineString','MultiLineString'].includes(f.geometry?.type)).flatMap(f=>{
    const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates,profile=getRoadProfile(f);
    return lines.flatMap(line=>line.slice(1).map((c,i)=>{const a=project(line[i]),b=project(c),dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);return{a,b,sourceId:f.id,width:profile.width,motor:profile.motor,corridor:streetFootprint((a.x+b.x)/2,(a.z+b.z)/2,profile.width+.7,l,Math.atan2(dx,dz))};}));
  });
  const roadBlocked=createRoadClearance({roadSurfaces}),parking=[],occupied=[];
  for(const [areaIndex,sourceId]of EAST_NINE_PARKING_IDS.entries()){
    const feature=fc.features.find(f=>f.id===sourceId);if(feature?.geometry?.type!=='Point')continue;
    const centre=project(feature.geometry.coordinates);if(locate&&locate(centre).distance>110)continue;
    let closest=null;
    for(const e of roads){if(!e.motor)continue;const dx=e.b.x-e.a.x,dz=e.b.z-e.a.z,l=Math.hypot(dx,dz);if(l<.01)continue;
      const t=Math.max(0,Math.min(1,((centre.x-e.a.x)*dx+(centre.z-e.a.z)*dz)/(l*l))),d=Math.hypot(centre.x-e.a.x-t*dx,centre.z-e.a.z-t*dz);
      if(!closest||d<closest.distance)closest={distance:d,tx:dx/l,tz:dz/l,sourceRoadId:e.sourceId};
    }
    if(!closest)continue;
    const {tx,tz}=closest,nx=-tz,nz=tx;
    // The full 3.6 m central aisle crosses both rows. Cars, walkers and the
    // curved facade retain their own space; no continuous wall of parking.
    for(const band of[-1,1])for(const side of[-1,1]){
      let slot=0;
      for(let u=2.4;u<9.2;slot++){
        const key=areaIndex*419+(band+1)*73+(side+1)*37+slot*19,along=side*(u+random(key)*.16);
        u+=1.12+random(key+1)*.24+(slot===2?.50:0);
        if(random(key+2)<.16)continue;
        const across=band*(2.35+(random(key+3)-.5)*.32),reversed=random(key+4)<.19;
        const yaw=-Math.atan2(tz,tx)+(random(key+5)-.5)*.13+(reversed?Math.PI:0);
        const x=centre.x+tx*along+nx*across,z=centre.z+tz*along+nz*across;
        const footprint=streetFootprint(x,z,1.02,2.08,yaw),reserved=streetFootprint(x,z,1.09,2.15,yaw);
        if(footprint.some(p=>Math.abs((p.x-centre.x)*tx+(p.z-centre.z)*tz)<1.8))continue;
        if(roadBlocked(x,z,1.02,2.08,yaw)||obstacles.some(r=>footprintIntersectsRing(reserved,r)))continue;
        // Check all source roads too, including roads absent from the chosen
        // commute route. Test a full corridor, rather than only bike centres.
        if(roads.some(e=>footprintIntersectsRing(reserved,e.corridor)))continue;
        if(occupied.some(r=>footprintIntersectsRing(reserved,r)))continue;
        const id=91000+areaIndex*401+parking.length*7+slot%3;
        parking.push({id,colorIndex:Math.floor(random(key+6)*8),x,y:.16,z,yaw,steeringAngle:(random(key+7)-.5)*.45,lean:(random(key+8)-.5)*.04,
          sourceId,buildingSourceId:'way/1023544717',sourceParkingCentre:{...centre},sourceRoadId:closest.sourceRoadId,photo:PHOTO,
          row:band,clusterId:`${sourceId}/${band}/${side}`,frontageProgress:along,frontageOffset:across,frontageTangent:{x:tx,z:tz},reversed,
          footprintWidth:1.02,footprintLength:2.08,accessAisleWidth:3.6,
          locationEvidence:'mapped bicycle-parking POI; individual vehicle offsets are not surveyed',
          layoutEvidence:'photo-informed inferred mixed parking pockets and empty bays; counts, orientation and spacing are appearance estimates, not observed morning demand'});
        occupied.push(reserved);
      }
    }
  }
  return parking;
}
