export const EAST_NINE_BUILDERS_POSTER_SOURCE_ID = 'way/1023544717';
export const EAST_NINE_BUILDERS_POSTER_IMAGE = '/images/activity/hust-ai-builders-xiaohongshu.jpg';

const NORTH_EDGE_START = [114.4221485,30.5163435];
const NORTH_ENTRANCE = [114.4215014,30.5164424];
const NORTH_FOOTWAY_ID = 'way/655063746';
const sameCoordinate = (a,b) => Array.isArray(a)&&Array.isArray(b)&&Math.abs(a[0]-b[0])<1e-7&&Math.abs(a[1]-b[1])<1e-7;

/** Activity artwork beside the existing A-north entrance. The source edge is
 * the northern facade, distinct from the east-facing stair tower. Its door
 * already leaves a small window-free bay; this plan changes no architecture.
 * Viewpoint y values are the player's feet, with a 1.65m first-person eye. */
export function planEastNineBuildersPoster(model,{frame,geoToLocal}={}) {
  if(!Array.isArray(model?.records)||!frame||typeof geoToLocal!=='function')return null;
  const source=model.records.find(record=>record.id===EAST_NINE_BUILDERS_POSTER_SOURCE_ID);
  const geometry=source?.feature?.geometry;
  if(geometry?.type!=='Polygon'||!source.shapes?.length)return null;
  const ring=geometry.coordinates?.[0]?.slice();
  if(!ring||ring.length<4||ring.some(point=>!Array.isArray(point)||!Number.isFinite(point[0])||!Number.isFinite(point[1])))return null;
  if(sameCoordinate(ring[0],ring.at(-1)))ring.pop();
  const start=ring.findIndex(point=>sameCoordinate(point,NORTH_EDGE_START));
  const end=ring.findIndex(point=>sameCoordinate(point,NORTH_ENTRANCE));
  if(start<0||end<0)return null;
  const followsRing=(start+1)%ring.length===end;
  if(!followsRing&&(end+1)%ring.length!==start)return null;

  const footway=model.records.find(record=>record.id===NORTH_FOOTWAY_ID)?.feature?.geometry;
  if(footway?.type!=='LineString'||!Array.isArray(footway.coordinates)||footway.coordinates.length!==2||footway.coordinates.some(point=>!Array.isArray(point)||!Number.isFinite(point[0])||!Number.isFinite(point[1])))return null;
  const doorIndex=footway.coordinates.findIndex(point=>sameCoordinate(point,NORTH_ENTRANCE));
  if(doorIndex<0)return null;
  const local=([longitude,latitude])=>geoToLocal({longitude,latitude,height:0,coordinateSystem:'EPSG:4326'},frame);
  const points=ring.map(local),a=points[start],b=points[end],outer=local(footway.coordinates[1-doorIndex]);
  if([...points,outer].some(point=>!Number.isFinite(point?.x)||!Number.isFinite(point?.z)))return null;
  const length=Math.hypot(b.x-a.x,b.z-a.z);
  if(length<10)return null;
  const area=points.reduce((sum,point,index)=>{const next=points[(index+1)%points.length];return sum+point.x*next.z-next.x*point.z;},0);
  const direction=(area<0?1:-1)*(followsRing?1:-1);
  const tx=(b.x-a.x)/length,tz=(b.z-a.z)/length,nx=-tz*direction,nz=tx*direction;
  if(nz>-.9)return null;

  const out=.06,x=b.x-tx*3.10+nx*out,z=b.z-tz*3.10+nz*out,y=2.13;
  const pose=(px,pz)=>({x:px,y:.14,z:pz,yaw:Math.atan2(px-x,pz-z),pitch:Math.atan2(.14+1.65-y,Math.hypot(px-x,pz-z))});
  return {
    id:'east-nine-builders-poster',featureId:source.id,sourceId:source.id,
    imagePath:EAST_NINE_BUILDERS_POSTER_IMAGE,
    x,y,z,nx,nz,yaw:Math.atan2(nx,nz),width:2.05,height:2.05*1347/987,
    surface:'east-nine-north-entry-blank-wall',
    sourceEdge:{start:[...NORTH_EDGE_START],end:[...NORTH_ENTRANCE]},
    expectedSupportNames:['teaching-wing'],
    // The road junction itself contains a forecourt pedestrian; the quarter
    // point remains on the mapped footway with a clear view of the whole card.
    approach:{...pose(outer.x+(b.x-outer.x)*.25,outer.z+(b.z-outer.z)*.25),sourceId:NORTH_FOOTWAY_ID},
    approachLabel:'东九 A 座北门步道',
    inspection:pose(x+nx*4,z+nz*4),
  };
}
