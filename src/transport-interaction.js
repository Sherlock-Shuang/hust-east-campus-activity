// Local scene inventory: one world object becomes the player's vehicle, then
// returns to the scene at dismount. This is separate from shared activity state.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const poseOf=s=>({x:s.x,y:s.y,z:s.z,yaw:s.yaw});
const valid=r=>r!==false&&r?.ok!==false;
const exits={scooter:1.35,roadster:2.1,hoverboard:2.2,helicopter:4.7,spider:1.1,boat:4.1};

export function createTransportInteraction({motion,sources=[],notify=()=>{},onChange=()=>{}}){
  let mounted=null;
  function nearest(){
    if(motion.state.mode!=='walk')return null;
    const pose=motion.state;
    return sources.map(source=>({source,item:source.nearest(pose)})).filter(hit=>hit.item)
      .sort((a,b)=>distance(pose,a.item.boardingPose||a.item)-distance(pose,b.item.boardingPose||b.item))[0]||null;
  }
  function candidates(item,pose,source){
    const supplied=source?.getDismountCandidates?.(item,pose)||[];
    const start=exits[pose.mode]||1.4;
    for(const r of[start,start+1,start+2])for(const angle of[Math.PI/2,-Math.PI/2,Math.PI,0,Math.PI/4,-Math.PI/4,Math.PI*3/4,-Math.PI*3/4]){
      supplied.push({x:pose.x+Math.sin(pose.yaw+angle)*r,z:pose.z+Math.cos(pose.yaw+angle)*r,yaw:pose.yaw});
    }
    return supplied.filter(p=>distance(p,pose)<=8);
  }
  function reject(reason){notify(reason);return {ok:false,reason};}
  function mount(hit=nearest()){
    if(mounted||motion.state.mode!=='walk')return reject('请先下车或脱下战衣');
    if(!hit)return {ok:false,reason:'靠近电动车、载具或战衣后按 F'};
    const {item,source}=hit,original=poseOf(item);
    if(!valid(source.take(item)))return reject('这辆载具暂时无法使用，请靠近后再试');
    const placed=motion.placeMode(item,item.mode);
    if(!placed.ok){source.restore?source.restore(item):source.release(item,original);return reject(placed.reason);}
    mounted={item,source};onChange(item.mode);return {ok:true,mode:item.mode,id:item.id};
  }
  function dismount(){
    const s=motion.state;
    if(!mounted)return {ok:false,reason:'当前没有使用场景载具'};
    if(!s.grounded||s.mode!=='boat'&&Math.abs(s.y-motion.groundAt(s.x,s.z,0,s.y).height)>.35)return reject('请先在地面降落，再按 F 下车');
    if(Math.abs(s.speed)>2.4)return reject(s.mode==='spider'?'先停稳，再按 F 脱下战衣':'先按空格减速停稳，再按 F 下车');
    const previous={...poseOf(s),mode:s.mode};
    // A source may remember an old boarding height. Resolve every nearby exit
    // from the current level, then carry that level through placement/corridor
    // checks so an overhead deck cannot capture a ground-level dismount.
    const next=candidates(mounted.item,previous,mounted.source).map(p=>({...p,y:previous.y})).find(p=>{
      const ground=motion.groundAt(p.x,p.z,0,previous.y);p.y=ground.height;
      if(!ground.allowed||previous.mode!=='boat'&&Math.abs(ground.height-previous.y)>=.45||!motion.canPlaceMode(p,'walk').ok)return false;
      // Vehicle body at the starting point is ignored by the inventory while
      // mounted; sample the full exit corridor to avoid hopping through fences.
      const steps=Math.ceil(distance(previous,p)/.2);
      for(let i=1;i<steps;i++){
        const q={x:previous.x+(p.x-previous.x)*i/steps,y:previous.y+(p.y-previous.y)*i/steps,z:previous.z+(p.z-previous.z)*i/steps,yaw:p.yaw};
        if(previous.mode==='boat'&&!motion.groundAt(q.x,q.z,.27,q.y).allowed)continue;
        if(!motion.canPlaceMode(q,'walk').ok)return false;
      }return true;
    });
    if(!next)return reject(s.mode==='boat'?'请靠近可步行的岸边，再按 F 下船':'旁边暂时没有落脚处，移到空地后再试');
    const placed=motion.placeWalker(next);if(!placed.ok)return reject(placed.reason);
    const old=mounted;
    if(!valid(old.source.release(old.item,previous))){motion.placeMode(previous,previous.mode);return reject('载具无法停在这里，请换个位置');}
    if(previous.mode==='boat')old.item.boardingPose={...poseOf(motion.state)};
    mounted=null;onChange('walk');return {ok:true,mode:'walk'};
  }
  function interact(){return mounted?dismount():mount();}
  function capture(){return mounted?{id:mounted.item.id,mode:mounted.item.mode}:null;}
  // Same-tab iframe return keeps the live object. On a refreshed return, claim
  // the saved original so the parked copy does not coexist with the player.
  function restore(saved){
    if(!saved)return !mounted;
    if(mounted)return mounted.item.id===saved.id;
    for(const source of sources){const item=source.items.find(i=>i.id===saved.id&&i.mode===saved.mode);
      if(item&&valid(source.take(item))){mounted={source,item};return true;}}
    return false;
  }
  function cancelRestore(){if(!mounted)return;const old=mounted;old.source.restore?old.source.restore(old.item):old.source.release(old.item,old.item);mounted=null;}
  return {nearest,mount,dismount,interact,capture,restore,cancelRestore,get mounted(){return mounted;}};
}
