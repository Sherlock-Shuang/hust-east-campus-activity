import {sampleC118Flood} from './c118-flood-effect.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const BODY_BELOW=.65,HEAD_ABOVE=.17,RADIUS=.24,EPS=.004;
function inside(x,z,polygon){
  let hit=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)hit=!hit;
  }
  return hit;
}
function records(items){return items.filter(r=>r.polygon?.length>=3).map(r=>({...r,
  minX:Math.min(...r.polygon.map(p=>p.x)),maxX:Math.max(...r.polygon.map(p=>p.x)),
  minZ:Math.min(...r.polygon.map(p=>p.z)),maxZ:Math.max(...r.polygon.map(p=>p.z)),
}));}
function overlaps(x,z,r){
  if(x+RADIUS<r.minX||x-RADIUS>r.maxX||z+RADIUS<r.minZ||z-RADIUS>r.maxZ)return false;
  if(inside(x,z,r.polygon))return true;
  for(let i=0;i<r.polygon.length;i++){
    const a=r.polygon[i],b=r.polygon[(i+1)%r.polygon.length],dx=b.x-a.x,dz=b.z-a.z;
    const u=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);
    if((x-a.x-u*dx)**2+(z-a.z-u*dz)**2<RADIUS*RADIUS)return true;
  }
  return false;
}

/** Renderer-free swimming. x/y/z are camera/eye coordinates; moveX/moveZ
 * are world-space controls, vertical is -1 (dive) to +1 (rise). Room solids
 * use the same absolute height ranges as the walking collision plan.
 */
export function createC118Swimming(plan){
  const c=plan.config,halfW=c.width/2,halfD=c.depth/2,f=plan.foyer;
  const bounds={minX:-halfW+RADIUS+.18,maxX:halfW-RADIUS-.18,
    minZ:-halfD+RADIUS+.12,maxZ:halfD-RADIUS-.12,maxY:c.floorY+c.height-HEAD_ABOVE-.08};
  const doors=(plan.doors||[]).map(d=>({...d,axis:'x',side:d.side??Math.sign(d.x),y:d.y??c.floorY}));
  if(f){
    bounds.minX=f.end-.4;bounds.maxX=Math.max(bounds.maxX,f.right-RADIUS);
    bounds.maxZ=f.front+.4;bounds.maxY=Math.max(bounds.maxY,f.y+f.height+.7-HEAD_ABOVE-.08);
    doors.push({id:'opto-c2',axis:'z',x:0,z:f.front,side:1,width:5.6,y:f.y,height:3.16},
      {id:'opto-c1',axis:'x',x:f.end,z:(f.near+f.far)/2,side:-1,width:f.far-f.near-2.6,y:f.y,height:3.16});
  }
  // The foyer, connecting corridor and exterior thresholds share the hall's
  // collision plan. Their ceilings differ, so entering a lower room requires diving.
  function ceilingAt(x,z){
    if(!f)return bounds.maxY;
    if(x>=f.left&&x<=f.right&&z>=f.back-.2&&z<=f.front)return f.y+f.height+.7-HEAD_ABOVE-.08;
    if(x>=f.end&&x<=f.left+.1&&z>=f.near&&z<=f.far)return f.y+3.25-HEAD_ABOVE-EPS;
    if(x>=f.end-.4&&x<f.end&&Math.abs(z-(f.near+f.far)/2)<(f.far-f.near)/2-1.3)return f.y+3.16-HEAD_ABOVE-EPS;
    if(z>f.front&&z<=f.front+.4&&Math.abs(x)<2.8)return f.y+3.16-HEAD_ABOVE-EPS;
    if(Math.abs(x)<=halfW-RADIUS-.18&&z>=-halfD+RADIUS+.12&&z<=halfD)return c.floorY+c.height-HEAD_ABOVE-.08;
    return null;
  }
  const surfaces=records(plan.walkSurfaces||[]),extras=[];
  // These visible, full-height stage wings predate the navigation collision
  // list. Swimming reaches them, so include their rendered occupied volume.
  if(plan.stage)for(const side of[-1,1]){
    const x=side*(plan.stage.halfWidth+.38),z=(plan.stage.back+plan.stage.front-1.3)/2,
      depth=plan.stage.front-plan.stage.back-1.3;
    extras.push({minHeight:c.floorY,height:c.floorY+c.height,polygon:[
      {x:x-.38,z:z-depth/2},{x:x+.38,z:z-depth/2},{x:x+.38,z:z+depth/2},{x:x-.38,z:z+depth/2},
    ]});
  }
  const solids=records([...(plan.colliders||[]),...extras]);
  const state={active:false,x:0,y:c.floorY+1.65,z:0,vx:0,vy:0,vz:0,waterY:c.floorY-1,
    submerged:false,currentX:0,currentZ:0,exitDoorId:null};
  function doorAt(x,y,z){
    return doors.find(d=>d.side*(d.axis==='z'?z-d.z:x-d.x)>=-RADIUS-.18-EPS&&
      Math.abs(d.axis==='z'?x-d.x:z-d.z)<=d.width/2-RADIUS-EPS&&
      y-BODY_BELOW>=d.y-EPS&&y+HEAD_ABOVE<=d.y+d.height-EPS);
  }
  function floorAt(x,z){
    let y=c.floorY;
    for(const s of surfaces)if(s.surfaceY>y&&overlaps(x,z,s))y=s.surfaceY;
    return y;
  }
  function blocked(x,y,z){
    // Beyond the ordinary room shell, the entire swimming body must fit a
    // real door aperture. This also prevents slipping sideways out of a door
    // recess into the solid wall, or escaping over a door's lintel.
    if(f){
      const ceiling=ceilingAt(x,z),door=doorAt(x,y,z);
      if(ceiling===null&&!door)return true;
      if(y>(ceiling??door.y+door.height-HEAD_ABOVE-EPS)+EPS)return true;
    }else if((x<bounds.minX-EPS||x>bounds.maxX+EPS)&&!doorAt(x,y,z))return true;
    if(y-BODY_BELOW<floorAt(x,z)-EPS)return true;
    return solids.some(s=>y-BODY_BELOW<s.height-EPS&&y+HEAD_ABOVE>(s.minHeight??c.floorY)+EPS&&overlaps(x,z,s));
  }
  function verticalBounds(x,y,z){
    let low=floorAt(x,z)+BODY_BELOW+EPS,high=ceilingAt(x,z)??bounds.maxY;
    if(x<bounds.minX||x>bounds.maxX){
      const door=doorAt(x,y,z);
      if(door){low=Math.max(low,door.y+BODY_BELOW+EPS);high=Math.min(high,door.y+door.height-HEAD_ABOVE-EPS);}
    }
    for(const s of solids){
      if(!overlaps(x,z,s))continue;
      if(y+HEAD_ABOVE<=(s.minHeight??c.floorY)+EPS)high=Math.min(high,(s.minHeight??c.floorY)-HEAD_ABOVE-EPS);
      else if(y-BODY_BELOW>=s.height-EPS)low=Math.max(low,s.height+BODY_BELOW+EPS);
    }
    return {low,high};
  }
  function setWater(elapsed,reducedMotion=false){
    const water=sampleC118Flood(plan,state,elapsed,{reducedMotion});
    state.waterY=water.waterY;state.submerged=water.submerged;
    state.currentX=water.currentX;state.currentZ=water.currentZ;
    return water;
  }
  return {
    state,
    enter(pose={}){
      state.x=clamp(finite(pose.x),bounds.minX,bounds.maxX);
      state.z=clamp(finite(pose.z),bounds.minZ,bounds.maxZ);
      state.y=clamp(finite(pose.y,c.floorY+1.65),floorAt(state.x,state.z)+BODY_BELOW+EPS,ceilingAt(state.x,state.z)??bounds.maxY);
      // A seated eye can begin inside a chair's navigation volume. Lift only
      // clear of that low solid, so the first stroke cannot get stuck in it.
      for(const s of solids)if(overlaps(state.x,state.z,s)&&state.y-BODY_BELOW<s.height&&
        state.y+HEAD_ABOVE>(s.minHeight??c.floorY)&&s.height+BODY_BELOW<bounds.maxY)state.y=s.height+BODY_BELOW+EPS;
      state.vx=state.vy=state.vz=0;state.active=true;state.exitDoorId=null;
      state.waterY=c.floorY-1;state.submerged=false;state.currentX=state.currentZ=0;
      return state;
    },
    step(dt,{moveX=0,moveZ=0,vertical=0,elapsed=-1,reducedMotion=false}={}){
      if(!state.active||state.exitDoorId)return state;
      const duration=clamp(finite(dt),0,.1),steps=Math.max(1,Math.ceil(duration/(1/120))),h=duration/steps;
      const mx=finite(moveX),mz=finite(moveZ),magnitude=Math.max(1,Math.hypot(mx,mz)),up=clamp(finite(vertical),-1,1);
      for(let i=0;i<steps;i++){
        const water=setWater(elapsed,reducedMotion),drift=reducedMotion?.3:.7;
        const tx=mx/magnitude*2.7+water.currentX*drift,tz=mz/magnitude*2.7+water.currentZ*drift;
        const buoyancy=clamp((water.waterY+.22-state.y)*1.7,-1.8,2.3);
        // A deliberate dive overrides buoyancy; releasing the control floats
        // back up. The finite acceleration preserves a visible water inertia.
        const ty=up<-.01?up*2.7:up>.01?up*3.1:buoyancy;
        const blend=1-Math.exp(-h*4.6);
        state.vx+=(tx-state.vx)*blend;state.vz+=(tz-state.vz)*blend;state.vy+=(ty-state.vy)*blend;
        const limits=verticalBounds(state.x,state.y,state.z);
        const ceiling=Math.max(limits.low,Math.min(limits.high,water.waterY+.38));
        const y=clamp(state.y+state.vy*h,limits.low,ceiling);
        if(y!==state.y+state.vy*h)state.vy=0;
        state.y=y;
        const wantedX=state.x+state.vx*h,opening=doorAt(wantedX,state.y,state.z);
        const x=clamp(wantedX,opening?.axis==='x'&&opening.side<0?Math.min(bounds.minX,opening.x-.4):bounds.minX,opening?.axis==='x'&&opening.side>0?Math.max(bounds.maxX,opening.x+.4):bounds.maxX);
        if(blocked(x,state.y,state.z))state.vx=0;else{if(x!==state.x+state.vx*h)state.vx=0;state.x=x;}
        const z=clamp(state.z+state.vz*h,bounds.minZ,bounds.maxZ);
        if(blocked(state.x,state.y,z))state.vz=0;else{if(z!==state.z+state.vz*h)state.vz=0;state.z=z;}
        const crossed=doorAt(state.x,state.y,state.z);
        if(crossed&&crossed.side*(crossed.axis==='z'?state.z-crossed.z:state.x-crossed.x)>.25){
          state.exitDoorId=crossed.id;state.vx=state.vy=state.vz=0;break;
        }
      }
      setWater(elapsed,reducedMotion);return state;
    },
    reset(){state.active=false;state.exitDoorId=null;state.vx=state.vy=state.vz=0;state.currentX=state.currentZ=0;state.waterY=c.floorY-1;state.submerged=false;return state;},
  };
}
