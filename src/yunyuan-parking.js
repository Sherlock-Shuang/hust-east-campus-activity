import {createRoadClearance,streetFootprint} from './street-clearance.js';

const CANTEEN='way/103814566';
const PHOTO='/references/local-campus/yunyuan-canteen-market.webp';
const random=seed=>{const v=Math.sin(seed*127.1+48.7)*43758.5453;return v-Math.floor(v);};
const VEHICLE_WIDTH=.98,VEHICLE_LENGTH=2.12,CLEARANCE=.07;
function inside(p,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)hit=!hit;}return hit;}
function onSegment(p,a,b){const cross=(p.x-a.x)*(b.z-a.z)-(p.z-a.z)*(b.x-a.x);return Math.abs(cross)<1e-7&&p.x>=Math.min(a.x,b.x)-1e-7&&p.x<=Math.max(a.x,b.x)+1e-7&&p.z>=Math.min(a.z,b.z)-1e-7&&p.z<=Math.max(a.z,b.z)+1e-7;}
function intersects(a,b,c,d){
  const side=(a,b,p)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x),u=side(a,b,c),v=side(a,b,d),w=side(c,d,a),x=side(c,d,b);
  return u*v<0&&w*x<0||onSegment(a,c,d)||onSegment(b,c,d)||onSegment(c,a,b)||onSegment(d,a,b);
}
// Unlike a separating-axis-only test, this also handles concave source water
// and building outlines without falsely rejecting a remote part of the river.
export function footprintIntersectsRing(footprint,ring){
  if(footprint.some(p=>inside(p,ring))||ring.some(p=>inside(p,footprint)))return true;
  return footprint.some((a,i)=>ring.some((b,j)=>intersects(a,footprint[(i+1)%footprint.length],b,ring[(j+1)%ring.length])));
}

/** Photo-observed parking distribution beside the source canteen frontage.
 * This is deliberately separate from mapped amenity=bicycle_parking objects.
 * A small display population does not claim the photo's time or a live count.
 */
export function createYunyuanPhotoParking(fc,route,{frame,geoToLocal}){
  const source=fc.features.find(f=>f.id===CANTEEN);if(source?.geometry?.type!=='Polygon')return[];
  const project=c=>{const p=geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);return{x:p.x,z:p.z};};
  const ring=source.geometry.coordinates[0].map(project);if(Math.hypot(ring[0].x-ring.at(-1).x,ring[0].z-ring.at(-1).z)<.001)ring.pop();
  const area=ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p.x*q.z-q.x*p.z;},0)/2,sign=area>0?1:-1;
  const obstacles=fc.features.filter(f=>['building','water'].includes(f.properties?.category)&&f.geometry?.type==='Polygon').map(f=>f.geometry.coordinates[0].map(project));
  const obstructsRoad=createRoadClearance(route),parking=[];
  const occupied=(route.parkingPlaces||[]).map(p=>streetFootprint(p.x,p.z,VEHICLE_WIDTH+CLEARANCE,VEHICLE_LENGTH+CLEARANCE,p.yaw??0));
  for(let edgeIndex=0;edgeIndex<ring.length;edgeIndex++){
    const a=ring[edgeIndex],b=ring[(edgeIndex+1)%ring.length],length=Math.hypot(b.x-a.x,b.z-a.z),tx=(b.x-a.x)/length,tz=(b.z-a.z)/length,nx=tz*sign,nz=-tx*sign;
    if(length<14||!(nx>.6||nz>.6))continue;
    const frontageSide=nz>.6?'south':'east',cornerAtEnd=frontageSide==='south'?tx>0:tz>0;
    const start=cornerAtEnd?4.7:7.5,end=length-(cornerAtEnd?7.5:4.7),entryCenter=length*.42,entryHalfWidth=4.8;
    // The street frame shows pockets of parked vehicles separated by open
    // approaches. Keep a complete corridor through every depth band rather
    // than treating a small gap between two scooter centres as an entrance.
    const pockets=[[start,entryCenter-entryHalfWidth],[entryCenter+entryHalfWidth,end]];
    for(let pocketIndex=0;pocketIndex<pockets.length;pocketIndex++){
      const [lo,hi]=pockets[pocketIndex];if(hi-lo<1.25)continue;
      for(let band=0;band<3;band++){
        // The outer pocket is shorter and looser, so the result reads as
        // mixed clusters and individual parked bikes, not three filled rows.
        // Reserve the photo-refined curved gallery (up to 2.35 m beyond the
        // original outline) plus a pedestrian margin before the first bike.
        const seed=edgeIndex*97+pocketIndex*31+band*11,baseOffset=[4.6,7.95,11.1][band]+(random(seed)-.5)*.28;
        if(band===2&&hi-lo<5)continue;
        const inset=band===2?.85:.56,clusterYaw=(random(seed+4)-.5)*.19;
        let slot=0;
        for(let u=lo+inset+random(seed+8)*.28;u<hi-inset&&parking.length<65;slot++){
          const key=seed*53+slot*19,frontageProgress=u,frontageOffset=Math.max(4.3,baseOffset+(random(key+1)-.5)*.5);
          u+=[1.16,1.25,1.37][band]+random(key+2)*.19+(slot>0&&slot%4===0?.48:0);
          if(band===2&&random(key+3)<.17)continue;
          const reversed=random(key+4)<.16,yaw=Math.atan2(nx,nz)+clusterYaw+(random(key+5)-.5)*.075+(reversed?Math.PI:0);
          const x=a.x+tx*frontageProgress+nx*frontageOffset,z=a.z+tz*frontageProgress+nz*frontageOffset;
          const footprint=streetFootprint(x,z,VEHICLE_WIDTH,VEHICLE_LENGTH,yaw),reserved=streetFootprint(x,z,VEHICLE_WIDTH+CLEARANCE,VEHICLE_LENGTH+CLEARANCE,yaw);
          const projections=reserved.map(p=>(p.x-a.x)*tx+(p.z-a.z)*tz);
          if(Math.min(...projections)<lo||Math.max(...projections)>hi)continue;
          if(Math.min(...reserved.map(p=>(p.x-a.x)*nx+(p.z-a.z)*nz))<2.95)continue;
          if(obstructsRoad(x,z,VEHICLE_WIDTH,VEHICLE_LENGTH,yaw)||obstacles.some(r=>footprintIntersectsRing(footprint,r)))continue;
          if(occupied.some(r=>footprintIntersectsRing(reserved,r))||(route.roadsideTrees||[]).some(p=>Math.hypot(p.x-x,p.z-z)<1.6))continue;
          const index=parking.length;
          parking.push({id:80000+index*7+Math.floor(random(key+6)*3),colorIndex:Math.floor(random(key+7)*8),x,y:.16,z,yaw,
            steeringAngle:(random(key+8)-.5)*.38,lean:(random(key+9)-.5)*.045,
            buildingSourceId:CANTEEN,photo:PHOTO,photoReferences:[PHOTO,'/references/local-campus/yunyuan-food-dorm-junction.webp'],
            frontageSide,frontageProgress,frontageOffset,frontageLength:length,frontageEdgeIndex:edgeIndex,
            frontageOrigin:{x:a.x,z:a.z},frontageTangent:{x:tx,z:tz},frontageNormal:{x:nx,z:nz},entryCenter,entryHalfWidth,
            clusterId:`${frontageSide}-${edgeIndex}-${pocketIndex}`,depthBand:band,reversed,
            footprintWidth:VEHICLE_WIDTH,footprintLength:VEHICLE_LENGTH,
            locationEvidence:'photo-informed positions outside mapped canteen footprint; not mapped parking inventory',
            galleryClearanceEstimate:2.95,
            layoutEvidence:'estimated irregular frontage clusters with clear central approaches and allowance for the photo-refined curved gallery; count and dimensions are display estimates; photo capture time unknown'});
          occupied.push(reserved);
        }
      }
    }
  }
  return parking;
}
