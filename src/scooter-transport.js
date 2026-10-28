// Mutable gameplay copies of the scooters already rendered by the commute layer.
// Source parking coordinates and the authored campus export never change.
const finite=Number.isFinite;
const isScooter=a=>a?.active!==false&&a.phase!=='arrived'&&(a.kind??a.type)==='scooter';
const poseOf=a=>({x:a.x,y:(a.y??.16)-.021,z:a.z,yaw:a.yaw??0});

export function createScooterTransport({parking=[],simulation,onChange=()=>{}}={}){
  const parked=parking.map(p=>({...p,active:true,type:'scooter',kind:'scooter',speed:0}));
  const entries=new Map(),trafficEntries=new WeakMap();
  let sequence=0,disposed=false;
  function entry(record,origin,id){
    const item={id,mode:'scooter',label:'电动车',source:'scooter',origin,interactionRadius:2.8,mounted:false,
      appearance:{id:record.id,colorIndex:record.colorIndex??0},record,adapter:null};
    Object.assign(item,poseOf(record));entries.set(id,item);return item;
  }
  for(let i=0;i<parked.length;i++)entry(parked[i],'parking',`scooter:parking:${i}:${parked[i].id??''}`);
  function update(){
    if(disposed)return;
    const current=new Set();
    for(const a of simulation?.agents??[]){
      if(!isScooter(a))continue;
      let item=trafficEntries.get(a);
      if(!item){item=entry(a,'traffic',`scooter:traffic:${++sequence}:${a.id}`);trafficEntries.set(a,item);item.adapter=api;}
      current.add(item.id);Object.assign(item,poseOf(a));
    }
    // Drop finished traffic candidates; keep claimed vehicles and parked returns.
    for(const [id,item]of entries){
      if(item.origin==='traffic'&&!item.mounted&&!current.has(id))entries.delete(id);
      else if(!item.mounted)Object.assign(item,poseOf(item.record));
    }
  }
  function owns(item){return !disposed&&entries.get(item?.id)===item;}
  function nearest(pose,maxDistance=2.8){
    if(!pose||![pose.x,pose.z].every(finite))return null;
    update();let best=null,distance=Math.max(0,maxDistance);
    for(const item of entries.values()){
      if(item.mounted||Math.abs((pose.y??.14)-item.y)>1.8)continue;
      const d=Math.hypot(item.x-pose.x,item.z-pose.z);
      if(d<=Math.min(distance,item.interactionRadius)){best=item;distance=d;}
    }return best;
  }
  function take(item){
    if(!owns(item)||item.mounted)return{ok:false,reason:'这辆电动车暂不可用'};
    if(item.origin==='traffic'){
      const result=simulation?.takeScooter?.(item.record);
      if(!result?.ok)return{ok:false,reason:'车辆已驶离，请重新靠近'};
      item.trafficLease=result;
    }else item.record.active=false;
    Object.assign(item,poseOf(item.record));item.mounted=true;item.pickupPose={x:item.x,y:item.y,z:item.z,yaw:item.yaw};
    onChange();return{ok:true,item,pose:{...item.pickupPose}};
  }
  function release(item,pose){
    if(!owns(item)||!item.mounted)return{ok:false,reason:'车辆没有被骑行'};
    if(!pose||![pose.x,pose.z,pose.yaw].every(finite))return{ok:false,reason:'无效的停车位置'};
    // A live rider is removed once; returning only leaves their vehicle, never
    // a second rider or an automatically resumed vehicle at its old position.
    if(item.origin==='traffic'){
      item.record={...item.record};parked.push(item.record);item.origin='parking';
    }
    Object.assign(item.record,{x:pose.x,y:(finite(pose.y)?pose.y:.14)+.021,z:pose.z,yaw:pose.yaw,
      active:true,phase:'parked',speed:0,groundSpeed:0,steeringAngle:0,lean:0,footDown:0,braking:false});
    delete item.record.progress;delete item.trafficLease;
    item.mounted=false;Object.assign(item,poseOf(item.record));onChange();return{ok:true};
  }
  function restore(item){
    if(!owns(item)||!item.mounted)return{ok:false};
    if(item.origin==='traffic'){
      const result=simulation?.restoreScooter?.(item.trafficLease);
      if(!result?.ok)return release(item,item.pickupPose);
      delete item.trafficLease;
    }else item.record.active=true;
    item.mounted=false;Object.assign(item,poseOf(item.record));onChange();return{ok:true};
  }
  const api={nearest,take,release,restore,owns,update,
    get items(){update();return[...entries.values()];},
    get parkedAgents(){return parked.filter(p=>p.active!==false);},
    dispose(){disposed=true;entries.clear();parked.length=0;},
  };
  for(const item of entries.values())item.adapter=api;
  update();return api;
}
