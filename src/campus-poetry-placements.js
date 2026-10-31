import {planCanteenBoundary} from './yunyuan-canteen.js';
import {planEinsteinSquare} from './einstein-square.js';
import {planOptoBuilding,OPTO_BUILDING_ID} from './opto-building.js';

// Activity artwork only. These are surfaces of the existing reconstruction,
// not claims that these poems are painted on the real campus. Wall paintings
// and the two roof-mounted letter sculptures do not change collision or GIS.
const IDS=['life-ai','life-art','responsibility','chocolate','birds','possibility','heroes','breeze','day','stay'];

function edges(record){
  return (record?.shapes||[]).flatMap(shape=>{
    const ring=shape.getPoints().map(p=>({x:p.x,z:-p.y}));
    if(ring.length>1&&Math.hypot(ring[0].x-ring.at(-1).x,ring[0].z-ring.at(-1).z)<1e-6)ring.pop();
    const area=ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a.x*b.z-b.x*a.z;},0),sign=area<0?1:-1;
    return ring.map((a,i)=>{
      const b=ring[(i+1)%ring.length],length=Math.hypot(b.x-a.x,b.z-a.z);
      if(length<.1)return null;
      const tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
      return {a,b,length,tx,tz,nx:-tz*sign,nz:tx*sign};
    }).filter(Boolean);
  });
}

function nearestWall(record,point){
  let selected;
  for(const edge of edges(record)){
    const u=Math.max(0,Math.min(edge.length,(point.x-edge.a.x)*edge.tx+(point.z-edge.a.z)*edge.tz));
    const x=edge.a.x+edge.tx*u,z=edge.a.z+edge.tz*u,distance=Math.hypot(point.x-x,point.z-z);
    if(!selected||distance<selected.distance)selected={...edge,x,z,distance};
  }
  return selected;
}

function pathPoint(path,fraction){
  const a=path.points[0],b=path.points.at(-1),length=Math.hypot(b.x-a.x,b.z-a.z),tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
  return {x:a.x+(b.x-a.x)*fraction,z:a.z+(b.z-a.z)*fraction,nx:-tz,nz:tx};
}

/** A pure plan over source-derived, already rendered blank surfaces.
 * inspection.y is the player's FOOT height; camera eye height is 1.65m above.
 * Source-edge seeds select a face and project onto it, so changing the local
 * frame does not detach inscriptions from their supporting architecture.
 */
export function planCampusPoetryPlacements(model,records,{frame,geoToLocal}={}){
  if(!model?.records||!records?.get||!frame||typeof geoToLocal!=='function')return [];
  const source=new Map(model.records.map(r=>[r.id,r])),plan=[];
  const local=([longitude,latitude])=>geoToLocal({longitude,latitude,height:0,coordinateSystem:'EPSG:4326'},frame);
  function roadApproach(id,face,minimumDistance=0){
    const roads=id?model.roads.filter(r=>r.id===id):model.roads;
    let nearest;
    for(const road of roads){const geometry=road.feature.geometry;
    const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.type==='MultiLineString'?geometry.coordinates:[];
    for(const line of lines){const points=line.map(local);for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,lengthSq=dx*dx+dz*dz;
      const projected=lengthSq?Math.max(0,Math.min(1,((face.x-a.x)*dx+(face.z-a.z)*dz)/lengthSq)):0;
      const samples=minimumDistance?Array.from({length:Math.ceil(Math.sqrt(lengthSq)/3)+1},(_,j)=>j/Math.max(1,Math.ceil(Math.sqrt(lengthSq)/3))):[projected];
      for(const t of samples){
      const x=a.x+dx*t,z=a.z+dz*t,distance=Math.hypot(x-face.x,z-face.z);
      if(distance<minimumDistance||(x-face.x)*face.nx+(z-face.z)*face.nz<=distance*(minimumDistance?.65:.4))continue;
      if(!nearest||distance<nearest.distance)nearest={x,z,y:.14,distance,sourceId:road.id};
    }}}}
    return nearest;
  }
  function add(index,record,face,{width,height,y,out=.035,surface,distance=5,floor=.14,ink,expectedSupportNames=[],approach,approachRoadId,approachLabel,presentation='paint',roofY}){
    if(!face)return;
    const x=face.x+face.nx*out,z=face.z+face.nz*out,yaw=Math.atan2(face.nx,face.nz);
    const routePoint=approach||(presentation==='rooftop'?roadApproach(null,face,Math.max(36,y+5)):approachRoadId&&roadApproach(approachRoadId,face));
    const routePose=routePoint&&{...routePoint,y:routePoint.y??floor,yaw:Math.atan2(routePoint.x-x,routePoint.z-z),pitch:Math.atan2((routePoint.y??floor)+1.65-y,Math.hypot(routePoint.x-x,routePoint.z-z))};
    plan.push({id:`poem-${index}`,poetryId:IDS[index],index,featureId:record.id,
      building:record.feature?.properties?.name||(record.id==='way/1484333086'?'韵苑体育馆 · 基座':record.id),surface,x,y,z,nx:face.nx,nz:face.nz,yaw,width,height,
      presentation,...(roofY!==undefined?{roofY}:{}),...(ink?{ink}:{}),expectedSupportNames,expectedSupportFeatureId:index===5?null:record.id,
      ...(routePose?{approach:routePose,approachLabel}:{}),
      inspection:presentation==='rooftop'&&routePose?{...routePose}:{x:x+face.nx*distance,y:floor,z:z+face.nz*distance,yaw,pitch:Math.atan2(floor+1.65-y,distance)}});
  }
  function sourceWall(index,id,seed,options){
    const record=source.get(id);
    if(record&&records.has(id)){
      const face=nearestWall(record,local(seed));
      if(face&&options.center){face.x=(face.a.x+face.b.x)/2;face.z=(face.a.z+face.b.z)/2;}
      if(face&&options.along){face.x+=face.tx*options.along;face.z+=face.tz*options.along;}
      add(index,record,face,options);
    }
  }

  const canteen=source.get('way/103814566'),builtCanteen=records.get(canteen?.id);
  if(canteen&&builtCanteen?.displayMode==='yunyuan-local-photo-informed'){
    const boundary=planCanteenBoundary(canteen);
    const entrance=pathPoint(boundary.adjacent,2.4/boundary.adjacent.length);
    // The actual normal spawn/forecourt faces this modest blank patch above
    // the equipment housing and below the original arrival inscription.
    add(0,canteen,pathPoint(boundary.adjacent,5.5/boundary.adjacent.length),{
      width:1.8,height:.92,y:3.22,out:.17,distance:5,surface:'canteen-main-entry-side-wall',
      expectedSupportNames:['canteen-entry-adjacent-solid-panel'],
      approach:{x:entrance.x+entrance.nx*10,z:entrance.z+entrance.nz*10,y:.14},approachLabel:'韵苑食堂入口前场 · 正常出生位置',
    });
    // The eastern secondary entrance is beside the existing public road,
    // unlike the former rear wall. Keep the display frame and signage clear.
    add(1,canteen,pathPoint(boundary.secondary,.5),{
      width:3,height:1.8,y:2.2,out:.27,distance:5,surface:'canteen-east-secondary-entry-wall',
      expectedSupportNames:['canteen-secondary-entry-tower'],approachRoadId:'way/97057001',approachLabel:'韵苑食堂东侧道路 · 次入口前',
    });
  }

  // Two quiet exterior faces of the gym's EXISTING lower part. Its 5m body
  // sits in front of the upper windowed gym; painting the upper wall at eye
  // level would bury artwork behind that actual rendered lower volume.
  sourceWall(2,'way/1484333086',[114.42899115417319,30.51535230642861],{
    width:34,height:3.8,y:2.75,center:true,out:.04,distance:25,surface:'gym-southwest-base-blank-wall',expectedSupportNames:[''],
  });
  sourceWall(4,'way/1484333086',[114.4293349597728,30.51532522465536],{
    width:34,height:3.8,y:2.75,center:true,out:.04,distance:28,surface:'gym-southeast-base-blank-wall',expectedSupportNames:[''],
  });

  // A-wing end is intentionally blind here, unlike its glazed stair tower.
  sourceWall(3,'way/1023544717',[114.422122550059,30.51621457780646],{
    width:5.6,height:11.4,y:11.6,center:true,along:-6.1,out:.06,distance:22,surface:'east-nine-a-blank-end-wall-tall',expectedSupportNames:[''],
  });
  // Roof lettering clears the windows and floor bands altogether.
  const eastNineRoof=records.get('way/1023544717')?.height??20;
  sourceWall(8,'way/1023544717',[114.4210,30.51504],{
    width:30,height:3.8,y:eastNineRoof+2.7,roofY:eastNineRoof,presentation:'rooftop',out:.15,center:true,along:28,distance:55,surface:'east-nine-d-rooftop-lettering',expectedSupportNames:['roof-mount'],
    approachLabel:'东九湖边道路 · 屋顶大字远景',
  });

  const square=planEinsteinSquare(model,{frame,geoToLocal}),squareRecord=source.get(square.sourceId);
  if(square.accepted&&square.statue&&squareRecord){
    const p=square.statue,c=Math.cos(p.yaw),s=Math.sin(p.yaw);
    // The original inscription is on +Z. Use the west SIDE of the existing
    // dark stone plinth and keep clear of its cap and foot course.
    add(5,squareRecord,{x:p.x-c*p.plinthWidth/2,z:p.z+s*p.plinthWidth/2,nx:-c,nz:s},{
      width:2.12,height:1.38,y:p.y+.96,out:.025,distance:4,floor:.16,
      surface:'einstein-plinth-west-side',ink:'#bcc2b2',expectedSupportNames:['雕塑、阶梯、柱架与矮篱'],
    });
  }

  const opto=source.get(OPTO_BUILDING_ID),optoPlan=opto&&planOptoBuilding(opto,{frame,geoToLocal});
  if(optoPlan){
    for(const [index,e,width,height,y,distance]of[
      [6,optoPlan.groundFloor.college,7.2,3.65,2.3,4.5],
      [7,optoPlan.rear,3.6,3.65,2.3,4.2],
    ])add(index,opto,{x:e.x-e.nx*(index===6?3.8:2)+e.tx*e.width/2,z:e.z-e.nz*(index===6?3.8:2)+e.tz*e.width/2,nx:-e.tx,nz:-e.tz},{
      // The photo-derived stone lining/poster relief projects up to 0.1225 m
      // into this corridor. Keep the enlarged paint 7.5 mm clear of that
      // finish, while the ordinary entrance approach stays unchanged.
      width,height,y,out:.13,distance,floor:.14,surface:index===6?'opto-left-entry-corridor-right-wall':'opto-north-foyer-right-wall',
      approach:{x:e.x-e.nx*.35-e.tx*e.width*.15,z:e.z-e.nz*.35-e.tz*e.width*.15,y:.14},
      approachLabel:index===6?'学院左侧楼门 · 进入门槛即见':'光电楼后门 · 进入门槛即见',
      ink:'#304139',expectedSupportNames:['opto-photo-light-stone-details','opto-photo-dark-details','opto-window-head-sill'],
    });
  }

  const lifeScienceRoof=records.get('way/98867881')?.height??27.4;
  sourceWall(9,'way/98867881',[114.4278446600322,30.513006891543753],{
    width:22,height:5.5,y:lifeScienceRoof+3.5,roofY:lifeScienceRoof,presentation:'rooftop',out:.15,along:-8,distance:65,surface:'east-eleven-rooftop-lettering',
    expectedSupportNames:['roof-mount'],approachLabel:'东十一前道路 · 屋顶 STAY 远景',
  });
  return plan.sort((a,b)=>a.index-b.index);
}
