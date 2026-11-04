import {campusLandmarkArrival} from './campus-landmark-arrival.js';
import {getCampusPlayerSpawn} from './player-experience.js';

const PLACES=[
  ['canteen','韵苑食堂','从熟悉的食堂前出发'],
  ['cbd','校园商业街','店铺、街角与休憩空间'],
  ['gomoku','操场五子棋','加入后与同学两两配对'],
  ['message-board','操场留言板','给活动后台留一句话'],
  ['opto-c1','C1 入口 / C118 报告厅','前往光电大楼，步行进门'],
  ['opto-c2','光电 C2 入口','参观光电大楼另一侧'],
  ['life-science','生命科学楼','沿校园道路探索'],
  ['einstein','爱因斯坦广场','雕塑与树荫下的广场'],
  ['yunyuan-south','韵苑南部生活区','食堂与校园生活街区'],
  ['east-gate','东校门','校园东侧入口'],
  ['yunyuan-gate','韵苑门','宿舍区附近的校园入口'],
];
export function campusNavigationPlaces(campus,model){
  return PLACES.flatMap(([id,label,description])=>{
    const pose=id==='canteen'?(model?.buildings?getCampusPlayerSpawn(model):null):campusLandmarkArrival(campus,id);
    return pose&&Number.isFinite(pose.x)&&Number.isFinite(pose.z)?[{id,label,description,x:pose.x,z:pose.z,y:pose.y??.14}]:[];
  });
}
const validPoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z);
export function navigationReading(position,target,heading=0){
  if(!validPoint(position)||!validPoint(target))return null;
  const dx=target.x-position.x,dz=target.z-position.z,distance=Math.hypot(dx,dz);
  const angle=Math.atan2(Math.sin(Math.atan2(dx,-dz)+heading),Math.cos(Math.atan2(dx,-dz)+heading));
  return {distance,angle,arrived:distance<12&&Math.abs((position.y??.14)-(target.y??.14))<3};
}
export function formatCampusDistance(distance){
  if(!Number.isFinite(distance))return '';
  return distance>=1000?`${(distance/1000).toFixed(1)} km`:`${Math.max(0,Math.round(distance/5)*5)} m`;
}
export function nearbyCampusName(position,places){
  if(!validPoint(position))return '东校区';
  let best=null,distance=180;
  for(const place of places){const d=Math.hypot(place.x-position.x,place.z-position.z);if(d<distance){distance=d;best=place;}}
  return best?`${best.label}附近`:'东校区漫游';
}

export function campusMapFocus(places,fallback,padding=140){
  const points=places.filter(validPoint);if(!points.length)return [...fallback];
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
  const minZ=Math.min(...points.map(p=>p.z)),maxZ=Math.max(...points.map(p=>p.z));
  return [minX-padding,minZ-padding,Math.max(160,maxX-minX)+padding*2,Math.max(160,maxZ-minZ)+padding*2];
}

/** One immutable path per source category, built once per campus load. No map
 * request or second WebGL renderer is needed for the north-up campus guide. */
export function campusMapGeometry(model){
  const paths={green:[],sports:[],water:[],building:[],road:[]},points=[];
  const n=value=>Math.round(value*10)/10;
  function pathOf(vertices,closed){
    if(vertices.length<2)return '';
    points.push(...vertices);
    return vertices.map((p,i)=>`${i?'L':'M'}${n(p.x)},${n(p.z)}`).join('')+(closed?'Z':'');
  }
  for(const record of model?.records||[]){
    if(!paths[record.category])continue;
    for(const shape of record.shapes||[]){
      let d=pathOf(shape.getPoints().map(p=>({x:p.x,z:-p.y})),true);
      for(const hole of shape.holes||[])d+=pathOf(hole.getPoints().map(p=>({x:p.x,z:-p.y})),true);
      paths[record.category].push(d);
    }
    if(record.category==='road')record.group?.traverse?.(object=>{
      if(!object.isLine)return;
      const a=object.geometry?.attributes?.position;if(!a)return;
      const vertices=[];for(let i=0;i<a.count;i++)vertices.push({x:a.getX(i),z:a.getZ(i)});
      paths.road.push(pathOf(vertices,false));
    });
  }
  const bounds=points.length?{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity}:{minX:-500,maxX:500,minZ:-500,maxZ:500};
  for(const p of points){bounds.minX=Math.min(bounds.minX,p.x);bounds.maxX=Math.max(bounds.maxX,p.x);bounds.minZ=Math.min(bounds.minZ,p.z);bounds.maxZ=Math.max(bounds.maxZ,p.z);}
  const padding=55,width=Math.max(100,bounds.maxX-bounds.minX)+padding*2,height=Math.max(100,bounds.maxZ-bounds.minZ)+padding*2;
  return {paths:Object.fromEntries(Object.entries(paths).map(([key,value])=>[key,value.join('')])),viewBox:[bounds.minX-padding,bounds.minZ-padding,width,height],markerScale:Math.max(width,height)/640};
}
