/** Seat positions are illustrations of the current hall plan, not reservations.
 * The walker stays in a valid aisle while the camera occupies a chair.
 */
export const c118SeatId=seat=>`${seat.block}-${seat.row}-${seat.column}`;
/** Preserve the screen's horizontal framing on narrower displays. */
export function c118SeatedFov(view,aspect){
  const viewportAspect=Number.isFinite(aspect)&&aspect>0?aspect:16/9;
  return Math.min(115,2*Math.atan(Math.tan(view.fov*Math.PI/360)*Math.max(1,(16/9)/viewportAspect))*180/Math.PI);
}
const finitePose=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]));
const inside=(p,polygon)=>{let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const a=polygon[i],b=polygon[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)hit=!hit;
}return hit;};
const segmentDistance=(p,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);};
function safeStandingPose(plan,p){
  if(!finitePose(p))return false;
  const support=plan.walkSurfaces.filter(s=>inside(p,s.polygon)&&s.surfaceY<=p.y+.2).sort((a,b)=>b.surfaceY-a.surfaceY)[0];
  if(!support||Math.abs(support.surfaceY-p.y)>.12)return false;
  return !plan.colliders.some(c=>p.y<c.height-.02&&p.y+1.68>c.minHeight+.02&&
    (inside(p,c.polygon)||c.polygon.some((v,i)=>segmentDistance(p,v,c.polygon[(i+1)%c.polygon.length])<.27)));
}

export function createC118Seating(plan){
  const blockName={left:'左区',centre:'中区',right:'右区'};
  const seats=plan.seats.map(s=>({...s,id:c118SeatId(s),label:`${s.row+1} 排 · ${blockName[s.block]||s.block} ${s.column+1} 座`}));
  const byId=new Map(seats.map(s=>[s.id,s]));
  // The third row gives the screen a cinema-like share of the view while
  // retaining a seated eye height and the stage below it.
  const desiredRow=Math.min(2,plan.config.frontRows-1);
  const recommendedSeat=[...seats].sort((a,b)=>{
    const score=s=>Math.abs(s.row-desiredRow)*2+Math.abs(s.x)+(s.block==='centre'?0:100);
    return score(a)-score(b)||a.column-b.column;
  })[0];
  const getSeat=id=>byId.get(typeof id==='string'?id:id?.id)||null;
  const target={x:0,y:plan.stage.height+3.75,z:-plan.config.depth/2+.43};
  function viewFor(id){
    const s=getSeat(id);if(!s)return null;
    // A seated adult's eyes stay below the room's standing camera and above
    // the previous terrace's audience. A tighter lens enlarges the screen without cropping its edges.
    const x=s.x,y=s.y+1.30,z=s.z-.025,dx=target.x-x,dz=target.z-z;
    return {x,y,z,yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(target.y-y,Math.hypot(dx,dz)),fov:38,seatId:s.id,label:s.label};
  }
  function nearest(position,maxDistance=2.4){
    if(!finitePose(position)||!Number.isFinite(maxDistance)||maxDistance<0)return null;
    let best=null,distance=maxDistance;
    for(const s of seats){if(Math.abs(s.y-position.y)>.55)continue;const d=Math.hypot(s.x-position.x,s.z-position.z);if(d<distance){best=s;distance=d;}}
    return best;
  }
  function exitPoseFor(id,preferredPose){
    if(safeStandingPose(plan,preferredPose))return {...preferredPose};
    const s=getSeat(id)||recommendedSeat;if(!s)return null;
    const candidates=plan.aisles.map(a=>({x:(a.x0+a.x1)/2,y:s.y,z:s.z+.12,yaw:0,pitch:0}));
    candidates.sort((a,b)=>Math.abs(a.x-s.x)-Math.abs(b.x-s.x));
    return candidates.find(p=>safeStandingPose(plan,p))||({...plan.spawn});
  }
  return {seats,recommendedSeat,getSeat,nearest,viewFor,exitPoseFor};
}
