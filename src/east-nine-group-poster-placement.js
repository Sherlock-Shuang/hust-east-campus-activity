import {getBuildingProfile} from './building-profiles.js';

export const EAST_NINE_GROUP_POSTER_SOURCE_ID='way/1023544717';
export const EAST_NINE_GROUP_POSTER_IMAGE='/images/activity/hust-ai-builders-group.jpg';
export const EAST_NINE_GROUP_POSTER_UV=Object.freeze({repeat:Object.freeze([.84,.59]),offset:Object.freeze([.08,.25])});

const NORTH_ENTRANCE=[114.4215014,30.5164424];
const NORTH_WEST_CORNER=[114.4208807,30.5165372];
const NORTH_FOOTWAY_ID='way/655063746';
const sameCoordinate=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&Math.abs(a[0]-b[0])<1e-7&&Math.abs(a[1]-b[1])<1e-7;
const validCoordinate=point=>Array.isArray(point)&&Number.isFinite(point[0])&&Number.isFinite(point[1]);

/** The existing QQ group card moves to the north wall west of the entrance.
 * This is source edge 33, separate from the XHS card's edge 32. Its floor
 * bands are different original instances, so each facade cover can restore
 * its own decorations independently. The image file and established UV crop
 * are unchanged; qrRegion uses coordinates within the displayed cropped card. */
export function planEastNineGroupPoster(model,{frame,geoToLocal}={}){
  if(!Array.isArray(model?.records)||!frame||typeof geoToLocal!=='function')return null;
  const source=model.records.find(record=>record.id===EAST_NINE_GROUP_POSTER_SOURCE_ID),geometry=source?.feature?.geometry;
  if(geometry?.type!=='Polygon'||!source.shapes?.length||!Array.isArray(geometry.coordinates?.[0]))return null;
  const ring=geometry.coordinates[0].slice();
  if(ring.length<4||ring.some(point=>!validCoordinate(point)))return null;
  if(sameCoordinate(ring[0],ring.at(-1)))ring.pop();
  const start=ring.findIndex(point=>sameCoordinate(point,NORTH_ENTRANCE)),end=ring.findIndex(point=>sameCoordinate(point,NORTH_WEST_CORNER));
  if(start<0||end<0)return null;
  const followsRing=(start+1)%ring.length===end;
  if(!followsRing&&(end+1)%ring.length!==start)return null;
  const footway=model.records.find(record=>record.id===NORTH_FOOTWAY_ID)?.feature?.geometry;
  if(footway?.type!=='LineString'||!Array.isArray(footway.coordinates)||footway.coordinates.length!==2||footway.coordinates.some(point=>!validCoordinate(point)))return null;
  const doorIndex=footway.coordinates.findIndex(point=>sameCoordinate(point,NORTH_ENTRANCE));
  if(doorIndex<0)return null;
  const local=([longitude,latitude])=>geoToLocal({longitude,latitude,height:0,coordinateSystem:'EPSG:4326'},frame);
  const points=ring.map(local),a=points[start],b=points[end],outer=local(footway.coordinates[1-doorIndex]);
  if([...points,outer].some(point=>!Number.isFinite(point?.x)||!Number.isFinite(point?.z)))return null;
  const length=Math.hypot(b.x-a.x,b.z-a.z);
  if(length<10)return null;
  const area=points.reduce((sum,point,index)=>{const next=points[(index+1)%points.length];return sum+point.x*next.z-next.x*point.z;},0);
  const sign=(area<0?1:-1)*(followsRing?1:-1),tx=(b.x-a.x)/length,tz=(b.z-a.z)/length,nx=-tz*sign,nz=tx*sign;
  if(nz>-.9)return null;

  const profile=getBuildingProfile(source.feature),wallHeight=profile.height-profile.baseHeight;
  const repeat=[...EAST_NINE_GROUP_POSTER_UV.repeat],offset=[...EAST_NINE_GROUP_POSTER_UV.offset];
  const height=wallHeight-.70,width=height*(repeat[0]*1284)/(repeat[1]*2289),alongWest=43,out=.012;
  if(height<=0||alongWest-width/2<5||alongWest+width/2>length-.35)return null;
  const x=a.x+tx*alongWest+nx*out,z=a.z+tz*alongWest+nz*out,y=profile.baseHeight+wallHeight/2;
  const pointOnImage=(u,v)=>({x:x+nz*width*(u-.5),y:y+height*(.5-v),z:z-nx*width*(u-.5)});
  // Original pixels include the complete coloured code and its quiet zone.
  // Texture UV v grows from the image bottom; image-space top grows downward.
  const cropTop=1-offset[1]-repeat[1];
  const qrRegion={left:(195/1284-offset[0])/repeat[0],right:(1090/1284-offset[0])/repeat[0],top:(735/2289-cropTop)/repeat[1],bottom:(1635/2289-cropTop)/repeat[1]};
  const qr=pointOnImage((qrRegion.left+qrRegion.right)/2,(qrRegion.top+qrRegion.bottom)/2);
  const pose=(px,pz,target={x,y,z})=>({x:px,y:.14,z:pz,yaw:Math.atan2(px-target.x,pz-target.z),pitch:Math.atan2(.14+1.65-target.y,Math.hypot(px-target.x,pz-target.z))});
  return{
    id:'east-nine-group-poster',featureId:source.id,sourceId:source.id,imagePath:EAST_NINE_GROUP_POSTER_IMAGE,
    x,y,z,nx,nz,yaw:Math.atan2(nx,nz),width,height,wallHeight,mountOffset:out,repeat,offset,
    surface:'east-nine-north-west-full-height-wall',sourceEdge:{start:[...NORTH_ENTRANCE],end:[...NORTH_WEST_CORNER]},expectedSupportNames:['teaching-wing'],
    approach:pose(x+nx*32,z+nz*32),approachLabel:'东九 A 座北侧西段 QQ 群卡全幅观察点',
    inspection:pose(qr.x+nx*18,qr.z+nz*18,qr),qr,qrRegion,
    northEntrance:{x:a.x,y:profile.baseHeight,z:a.z,sourceFootwayId:NORTH_FOOTWAY_ID},
    entranceApproach:{...pose(outer.x+(a.x-outer.x)*.25,outer.z+(a.z-outer.z)*.25,{x:a.x,y:1.79,z:a.z}),sourceId:NORTH_FOOTWAY_ID},
  };
}
