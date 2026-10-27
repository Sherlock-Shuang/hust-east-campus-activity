import {waterFootprint} from './water-details.js';
import {createLakesideLamps} from './street-furniture.js';

/** The source embankment footway supplies the corridor; individual lamp
 * positions and dimensions remain estimates informed by the 2021 campus photo. */
export function createLakesideDetails(THREE,model,{frame,geoToLocal,surfaces}) {
  const lake=model.water.find(record=>record.id==='relation/13705236');
  const footprint=lake&&waterFootprint(lake), fixtures=[];
  if(footprint)for(const road of model.roads){
    const tags=road.feature.properties?.tags||{};
    if(tags.highway!=='footway'||tags.embankment!=='yes'||road.feature.geometry.type!=='LineString')continue;
    const points=road.feature.geometry.coordinates.map(c=>geoToLocal({longitude:c[0],latitude:c[1],coordinateSystem:'EPSG:4326'},frame));
    let traversed=0, next=6;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.z-a.z);
      if(length<.01)continue;
      const dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
      while(next<traversed+length){
        const t=(next-traversed)/length,p={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
        const candidates=[-1,1].map(side=>({x:p.x-dz*1.65*side,z:p.z+dx*1.65*side}));
        const q=candidates.filter(q=>!footprint.contains(q.x,q.z)&&footprint.distance(q.x,q.z)<12)
          .sort((a,b)=>footprint.distance(b.x,b.z)-footprint.distance(a.x,a.z))[0];
        if(q&&fixtures.every(f=>Math.hypot(f.x-q.x,f.z-q.z)>16))fixtures.push({...q,y:.14,yaw:Math.atan2(-(p.z-q.z),p.x-q.x),sourcePathId:road.id});
        next+=22;
      }
      traversed+=length;
    }
  }
  return createLakesideLamps(THREE,fixtures,surfaces);
}
