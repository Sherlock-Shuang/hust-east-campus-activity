import {planCanteenBoundary} from './yunyuan-canteen.js';
import {planEinsteinSquare} from './einstein-square.js';
import {planOptoBuilding,OPTO_BUILDING_ID} from './opto-building.js';

// Activity artwork only. These are surfaces of the existing reconstruction,
// not claims that these poems are painted on the real campus. No new backing
// walls, collision geometry, map features or architectural proportions are added.
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
  function add(index,record,face,{width,height,y,out=.035,surface,distance=5,floor=.14,ink,expectedSupportNames=[]}){
    if(!face)return;
    const x=face.x+face.nx*out,z=face.z+face.nz*out,yaw=Math.atan2(face.nx,face.nz);
    plan.push({id:`poem-${index}`,poetryId:IDS[index],index,featureId:record.id,
      building:record.feature?.properties?.name||(record.id==='way/1484333086'?'韵苑体育馆 · 基座':record.id),surface,x,y,z,nx:face.nx,nz:face.nz,yaw,width,height,
      ...(ink?{ink}:{}),expectedSupportNames,expectedSupportFeatureId:[5,9].includes(index)?null:record.id,
      inspection:{x:x+face.nx*distance,y:floor,z:z+face.nz*distance,yaw,pitch:Math.atan2(floor+1.65-y,distance)}});
  }
  function sourceWall(index,id,seed,options){
    const record=source.get(id);
    if(record&&records.has(id)){
      const face=nearestWall(record,local(seed));
      if(face&&options.along){face.x+=face.tx*options.along;face.z+=face.tz*options.along;}
      add(index,record,face,options);
    }
  }

  const canteen=source.get('way/103814566'),builtCanteen=records.get(canteen?.id);
  if(canteen&&builtCanteen?.displayMode==='yunyuan-local-photo-informed'){
    const boundary=planCanteenBoundary(canteen),base=builtCanteen.baseHeight+.08,h=builtCanteen.height;
    const low=Math.max(base+h*.275+.975+.12,base+h*.5+.12),high=base+h*.775-.975-.12;
    if(high-low>=1.1)for(let i=0;i<2;i++)add(i,canteen,pathPoint(boundary.rear[i],.12),{
      // Leave the projecting floor band below both lettering and line art.
      width:3.1,height:Math.min(1.3,high-low),y:(low+high)/2,out:.04,distance:5,surface:'canteen-rear-blank-wall',
      expectedSupportNames:['canteen-secondary-wall'],
    });
  }

  // Two quiet exterior faces of the gym's EXISTING lower part. Its 5m body
  // sits in front of the upper windowed gym; painting the upper wall at eye
  // level would bury artwork behind that actual rendered lower volume.
  sourceWall(2,'way/1484333086',[114.42899115417319,30.51535230642861],{
    width:3,height:1.4,y:2.2,out:.04,distance:5,surface:'gym-southwest-base-blank-wall',expectedSupportNames:[''],
  });
  sourceWall(4,'way/1484333086',[114.4293349597728,30.51532522465536],{
    width:3.4,height:1.8,y:2.2,out:.04,distance:5,surface:'gym-southeast-base-blank-wall',expectedSupportNames:[''],
  });

  // A-wing end is intentionally blind here, unlike its glazed stair tower.
  sourceWall(3,'way/1023544717',[114.422122550059,30.51621457780646],{
    width:3.2,height:1.8,y:1.8,out:.06,distance:5,surface:'east-nine-a-blank-end-wall-low',expectedSupportNames:[''],
  });
  // A small phrase below the D-wing windows, facing the existing lakeside path.
  sourceWall(8,'way/1023544717',[114.42165914853514,30.5150771016799],{
    width:2,height:.3,y:.55,out:.06,distance:4,surface:'east-nine-d-low-blank-wall',expectedSupportNames:[''],
  });

  const square=planEinsteinSquare(model,{frame,geoToLocal}),squareRecord=source.get(square.sourceId);
  if(square.accepted&&square.statue&&squareRecord){
    const p=square.statue,c=Math.cos(p.yaw),s=Math.sin(p.yaw);
    // The original inscription is on +Z. Use the west SIDE of the existing
    // dark stone plinth and keep clear of its cap and foot course.
    add(5,squareRecord,{x:p.x-c*p.plinthWidth/2,z:p.z+s*p.plinthWidth/2,nx:-c,nz:s},{
      width:1.9,height:1.1,y:p.y+.96,out:.025,distance:4,floor:.16,
      surface:'einstein-plinth-west-side',ink:'#bcc2b2',expectedSupportNames:['雕塑、阶梯、柱架与矮篱'],
    });
  }

  const opto=source.get(OPTO_BUILDING_ID),optoPlan=opto&&planOptoBuilding(opto,{frame,geoToLocal});
  if(optoPlan){
    for(const [index,e,width,height,y,distance]of[
      [6,optoPlan.groundFloor.college,3,2.6,1.8,4],
      [7,optoPlan.rear,2,2.8,1.9,4.2],
    ])add(index,opto,{x:e.x-e.nx*3+e.tx*e.width/2,z:e.z-e.nz*3+e.tz*e.width/2,nx:-e.tx,nz:-e.tz},{
      width,height,y,out:.025,distance,floor:.14,surface:index===6?'opto-left-entry-corridor-right-wall':'opto-north-foyer-right-wall',
      ink:'#e4e2d3',expectedSupportNames:[index===6?'relation/13705821:central-high:ground:0':'relation/13705821:north-wing:ground:0'],
    });
  }

  // The low projecting plinth is a real blank solid, below both the windows
  // and the AI line on the first-storey band. Its front is .145m off the wall.
  sourceWall(9,'way/98867881',[114.4278446600322,30.513006891543753],{
    width:1.4,height:.35,y:.375,out:.17,along:-15,distance:4,surface:'east-eleven-low-plinth',
    expectedSupportNames:['plinths'],
  });
  return plan.sort((a,b)=>a.index-b.index);
}
