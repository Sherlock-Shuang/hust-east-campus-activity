import {sampleC118Flood} from './c118-flood-effect.js';

const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const smooth=(a,b,value)=>{const t=clamp((value-a)/(b-a));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const TAU=Math.PI*2;
const obstacleCache=new WeakMap();

/** A stable third of the crowd chooses to swim once the water is deep enough. */
export const isC118AudienceSwimmer=person=>((person.seed>>>4)%100)<33;

/** Conservative furniture/floor envelope for the whole moving body. Side
 * walls are handled by path margins, not treated as platforms to swim over. */
export function c118AudienceObstacleY(plan,x,z,radiusX=1.25,radiusZ=radiusX){
  let obstacles=obstacleCache.get(plan);
  if(!obstacles){
    obstacles=[...plan.walkSurfaces,...plan.colliders.filter(c=>!c.id.includes('wall'))].map(item=>({
      minX:Math.min(...item.polygon.map(p=>p.x)),maxX:Math.max(...item.polygon.map(p=>p.x)),
      minZ:Math.min(...item.polygon.map(p=>p.z)),maxZ:Math.max(...item.polygon.map(p=>p.z)),
      y:item.surfaceY??item.height,
    }));obstacleCache.set(plan,obstacles);
  }
  let y=plan.config.floorY;
  for(const obstacle of obstacles)if(obstacle.y>y&&obstacle.maxX>=x-radiusX&&obstacle.minX<=x+radiusX&&obstacle.maxZ>=z-radiusZ&&obstacle.minZ<=z+radiusZ)y=obstacle.y;
  return y;
}

/** The hall floor is stepped. Sample actual tread polygons, including the
 * cross aisle, so walking and floating bodies cannot sink through terraces. */
export function c118AudienceFloorY(plan,x,z){
  let y=plan.config.floorY;
  for(const surface of plan.walkSurfaces){
    if(surface.surfaceY<=y)continue;
    const polygon=surface.polygon;let inside=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const a=polygon[i],b=polygon[j];
      if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
    }
    if(inside)y=surface.surfaceY;
  }
  return y;
}

/** People follow narrow oval paths entirely inside existing circulation
 * aisles. The small oval ends give them a real turn instead of a yaw snap. */
export function createC118Walkers(plan,count=14){
  const front=plan.seatRows[0].startZ-.25,rear=plan.seatRows.at(-1).endZ+.35;
  return Array.from({length:count},(_,i)=>{
    const cross=i>=count-2,aisle=plan.aisles[i%plan.aisles.length];
    return {id:`c118-walker-${i}`,seed:7919+i*104729,walker:true,
      hair:i%5<3?'short':i%5===3?'long':'tied',
      route:cross?{cross:true,x:0,z:plan.crossAisle.z,radius:plan.config.width/2-1.6,lane:(i%2-.5)*.28}:
        {cross:false,x:(aisle.x0+aisle.x1)/2,z:(front+rear)/2,radius:(rear-front)/2,lane:((Math.floor(i/4)%3)-1)*.19},
    };
  });
}

function walkingPosition(person,time){
  const route=person.route,phase=person.seed*.00013;
  // Reducing time before trig keeps precision stable for epoch timestamps.
  const speed=.065+(person.seed%11)*.002,angle=(time%(TAU/speed))*speed+phase;
  const along=route.radius*Math.sin(angle),across=.11*Math.cos(angle)+route.lane;
  const dx=route.cross?route.radius*speed*Math.cos(angle):-.11*speed*Math.sin(angle);
  const dz=route.cross?-.11*speed*Math.sin(angle):route.radius*speed*Math.cos(angle);
  return {x:route.x+(route.cross?along:across),z:route.z+(route.cross?across:along),
    yaw:Math.atan2(-dx,-dz),speed:Math.hypot(dx,dz)};
}

/** Direct time sampling, with no accumulated velocity or per-person timers.
 * A late join, rewind, reset and resumed tab produce the same body poses. The
 * root is the pelvis; every point below is an articulated local-space joint. */
export function sampleC118AudiencePose(plan,person,{time=0,elapsed=null,reducedMotion=false}={}){
  const now=Number.isFinite(time)?time:0,t=Number.isFinite(elapsed)&&elapsed>=0?elapsed:null;
  const phase=(person.seed%997)/997*TAU;
  // Once flooded, a walker drifts from the route position at event start.
  const base=person.walker?walkingPosition(person,t===null?now:now-t):{...person.seat,yaw:((person.seed%17)-8)*.007,speed:0};
  let x=base.x,z=base.z,floor=c118AudienceFloorY(plan,x,z);
  const initial=sampleC118Flood(plan,{x,y:floor,z},t);
  const depth=t===null?0:Math.max(0,initial.waterY-floor);
  const wet=smooth(.12,.75,depth),floating=smooth(1.0,1.75,depth);
  const mode=wet>.001?'flooded':person.walker?'walking':'seated';
  // Dry walkers keep moving during the warning and while the first wave is
  // still at the far door. They only lose their route once the water hits.
  if(person.walker&&mode==='walking'){
    Object.assign(base,walkingPosition(person,now));x=base.x;z=base.z;floor=c118AudienceFloorY(plan,x,z);
  }
  const motion=reducedMotion?.22:1,waveTime=t??0;
  if(floating>0){
    const drift=floating*motion,age=waveTime*.58+phase;
    x+=drift*(1.75*Math.sin(age*.67)+.6*Math.sin(age*1.71)+(initial.currentX||0)*.48);
    z+=drift*(1.8*Math.sin(age*.49+1.2)+.8*Math.cos(age*1.17)+(initial.currentZ||0)*.48);
    x=clamp(x,-plan.config.width/2+1.35,plan.config.width/2-1.35);
    z=clamp(z,plan.stage.front+1.45,plan.config.depth/2-1.4);
  }
  let swimming=0,diveEnvelope=0,swimHeading=0,swimObstacle=0;
  const swimmer=isC118AudienceSwimmer(person);
  if(swimmer&&waveTime>18&&floating>.5){
    const centreX=clamp(base.x,-plan.config.width/2+2.7,plan.config.width/2-2.7);
    const centreZ=clamp(base.z,plan.stage.front+2.8,plan.config.depth/2-2.8);
    const routeSpeed=.25+(person.seed%5)*.014,routeAngle=waveTime*routeSpeed+phase;
    const swimX=centreX+.95*Math.cos(routeAngle)*motion,swimZ=centreZ+1.25*Math.sin(routeAngle)*motion;
    const routeHeading=Math.atan2(.95*Math.sin(routeAngle),-1.25*Math.cos(routeAngle)),unwrappedHeading=Math.PI-routeAngle;
    swimHeading=unwrappedHeading+Math.atan2(Math.sin(routeHeading-unwrappedHeading),Math.cos(routeHeading-unwrappedHeading));
    swimObstacle=c118AudienceObstacleY(plan,centreX,centreZ,2.2,2.5);
    // Use the lowest possible settled surface for eligibility, so passing
    // ripples never repeatedly turn a person between upright and prone.
    const peak=Math.min(plan.config.floorY+plan.config.height-1.4,
      Math.max(plan.config.floorY+6.5,Math.max(...plan.seatRows.map(row=>row.y))+1.9));
    swimming=peak-.55-swimObstacle>2.75?smooth(18,24,waveTime):0;
    x=mix(x,swimX,swimming);z=mix(z,swimZ,swimming);
    const period=(18+person.seed%7)*(reducedMotion?1.6:1),cycle=((waveTime-18)/period+phase/TAU)%1;
    diveEnvelope=smooth(.07,.32,cycle)*(1-smooth(.64,.92,cycle));
    swimObstacle=Math.max(swimObstacle,c118AudienceObstacleY(plan,x,z));
  }
  // Include the span of both legs and a tumbling body, not only its root.
  floor=mode==='walking'?c118AudienceFloorY(plan,x,z):Math.max(c118AudienceFloorY(plan,x,z),c118AudienceFloorY(plan,x-.48,z-.55),
    c118AudienceFloorY(plan,x+.48,z+.55),c118AudienceFloorY(plan,x,z+.85));
  const water=sampleC118Flood(plan,{x,y:floor,z},t);
  const stand=person.walker?1:wet;
  const gaitSpeed=5.1+(person.seed%7)*.12,gait=(now%(TAU/gaitSpeed))*gaitSpeed+phase;
  const stride=person.walker?clamp(base.speed/1.05)*motion*(1-floating):0;
  const tumble=waveTime*(.8+(person.seed%13)*.045)+phase;
  // Some people roll onto their backs, others tread water. Slow continuous
  // yaw and asynchronous pitch/roll keep the crowd from bobbing as one block.
  let roll=floating*motion*(.55*Math.sin(tumble*.81)+.7*Math.sin(tumble*.32+phase));
  let pitch=floating*motion*(.76*Math.sin(tumble*.61+phase)+.22*Math.cos(tumble*1.57));
  let yaw=base.yaw+floating*motion*(waveTime*.36+.6*Math.sin(tumble*.37));
  const groundedHip=floor+mix(.58,.955,stand)+Math.abs(Math.sin(gait))*.024*stride;
  const floatHip=Math.max(floor+1.08,water.waterY-.30+.11*Math.sin(tumble*1.5)*motion);
  let y=clamp(mix(groundedHip,floatHip,floating),floor+.57,plan.config.floorY+plan.config.height-1.08);
  if(swimming>0){
    const targetDepth=.04+diveEnvelope*(1.5+(person.seed%101)/100*2-.04);
    // One metre of body clearance covers the entire transition from upright
    // to prone, including hands/feet, over chairs, tables and the stage.
    const swimY=Math.max(swimObstacle+1.05,water.waterY-targetDepth);
    y=Math.max(swimObstacle+1.05,mix(y,swimY,swimming));
    const nosePitch=-Math.PI/2+.08*(1-diveEnvelope)+.04*Math.sin(waveTime*1.3+phase)*motion;
    // Convert Y-heading / X-prone rotation to the same XYZ convention used by
    // the instance batches. Keep the route heading unwrapped: interpolating
    // wrapped +/- PI angles would flip a half-turned swimmer at that seam.
    const targetPitch=Math.atan2(Math.sin(nosePitch),Math.cos(swimHeading)*Math.cos(nosePitch));
    const targetYaw=Math.asin(clamp(Math.sin(swimHeading)*Math.cos(nosePitch),-1,1));
    const rawRoll=Math.atan2(-Math.sin(swimHeading)*Math.sin(nosePitch),Math.cos(swimHeading));
    const targetRoll=swimHeading+Math.atan2(Math.sin(rawRoll-swimHeading),Math.cos(rawRoll-swimHeading));
    pitch=mix(pitch,targetPitch,swimming);yaw=mix(yaw,targetYaw,swimming);roll=mix(roll,targetRoll,swimming);
  }
  const joints={shoulders:[],elbows:[],wrists:[],hips:[],knees:[],ankles:[]};
  for(const side of[-1,1]){
    const cycle=gait+(side>0?Math.PI:0),swing=Math.sin(cycle)*stride;
    const panic=waveTime*(3.4+(person.seed%5)*.17)+phase+side*1.2;
    const flail=wet*motion;
    joints.shoulders.push([side*.17,.445,0]);
    joints.elbows.push([side*(.205+flail*(.105+.065*Math.sin(panic))),
      .20+flail*(.16+.14*Math.sin(panic*.83)),mix(-.08,.06,stand)+swing*.13+flail*.13*Math.cos(panic)]);
    joints.wrists.push([side*(.115+.09*stand+flail*(.14+.08*Math.cos(panic))),
      mix(.065,-.025,stand)+flail*(.39+.2*Math.sin(panic*.83+.8)),mix(-.25,0,stand)-swing*.24-flail*(.19+.14*Math.sin(panic))]);
    joints.hips.push([side*.087,-.015,0]);
    joints.knees.push([side*(.095+floating*.12),mix(-.09,-.45,stand)+floating*.19*Math.sin(panic*.74),
      mix(-.335,-.035,stand)-swing*.16-floating*(.13+.15*Math.cos(panic*.71))]);
    joints.ankles.push([side*(.098+floating*.19),mix(-.445,-.865,stand)+Math.max(0,swing)*.15+floating*(.22+.15*Math.sin(panic*.74+1)),
      mix(-.35,0,stand)-swing*.31+floating*.23*Math.sin(panic*.91)]);
    if(mode==='walking'){
      const ankle=joints.ankles.at(-1),knee=joints.knees.at(-1),sy=.975+((person.seed>>>5)%6)*.008,sx=.94+(person.seed%9)*.012;
      const floorAtFoot=(toe)=>c118AudienceFloorY(plan,x+Math.cos(yaw)*ankle[0]*sx+Math.sin(yaw)*(ankle[2]+toe),
        z-Math.sin(yaw)*ankle[0]*sx+Math.cos(yaw)*(ankle[2]+toe));
      const footFloor=Math.max(floorAtFoot(-.18),floorAtFoot(.075));
      ankle[1]=(footFloor-y)/sy+.073+Math.max(0,swing)*.13;
      knee[1]+=(ankle[1]+.865)*.45;
    }
    if(swimming>0){
      const stroke=waveTime*(2.0+(person.seed%5)*.1)+phase+(side>0?Math.PI:0),kick=waveTime*4.5+phase+(side>0?Math.PI:0);
      const gesture=.3+.7*motion;
      const swimJoints={
        elbows:[side*(.22+.055*Math.sin(stroke)),.40+.26*Math.cos(stroke)*gesture,.08+.17*Math.sin(stroke)*gesture],
        wrists:[side*(.22+.10*Math.sin(stroke)),.35+.55*Math.cos(stroke)*gesture,.06+.25*Math.sin(stroke)*gesture],
        knees:[side*.105,-.43,.045+.08*Math.sin(kick)*gesture],
        ankles:[side*.12,-.85,.045+.15*Math.sin(kick+.55)*gesture],
      };
      for(const [joint,target] of Object.entries(swimJoints)){
        const point=joints[joint].at(-1);for(let axis=0;axis<3;axis++)point[axis]=mix(point[axis],target[axis],swimming);
      }
    }
  }
  return {mode,position:{x,y,z},rotation:{x:pitch,y:yaw,z:roll},joints,
    wet,floating,swimmer,swimming,diving:swimming>.5&&water.waterY-y>.8,diveDepth:Math.max(0,water.waterY-y),
    waterY:water.waterY,floorY:floor,obstacleY:swimming>0?swimObstacle:null};
}
