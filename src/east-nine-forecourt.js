import {waterFootprint} from './water-details.js';
import {getRoadProfile} from './building-profiles.js';
import {createEastNinePeople} from './east-nine-people.js';
import {createEastNinePlanting} from './east-nine-planting.js';

const PATCH_IDS=new Set(['way/102754430','way/102754452']);
const PHOTO='https://www.hust.edu.cn/images/22/09/29/1z26t6x3br/11.jpg';
function distance(x,z,a,b){const dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/l)):0;return Math.hypot(x-a.x-t*dx,z-a.z-t*dz);}
function roadMasks(roads){const masks=[];for(const road of roads){const footprint=road.shapes?.length&&waterFootprint(road);if(footprint)masks.push((x,z,r)=>footprint.contains(x,z)||footprint.distance(x,z)<r+.3);
  const width=getRoadProfile(road.feature).width;road.group?.updateWorldMatrix(true,true);road.group?.traverse(o=>{if(!o.isLine||o.isLineSegments)return;const p=o.geometry.attributes.position,m=o.matrixWorld.elements,at=i=>({x:m[0]*p.getX(i)+m[4]*p.getY(i)+m[8]*p.getZ(i)+m[12],z:m[2]*p.getX(i)+m[6]*p.getY(i)+m[10]*p.getZ(i)+m[14]});for(let i=1;i<p.count;i++){const a=at(i-1),b=at(i);masks.push((x,z,r)=>distance(x,z,a,b)<width/2+.35+r);}});}return(x,z,r)=>masks.some(mask=>mask(x,z,r));}

/** Two registered forecourt source greens only. The photo supports low oval
 * hedges and small planted islands, not an exact horticultural survey. */
export function planEastNineForecourt(model){
  const blocked=roadMasks(model.roads??[]),patches=[],plants=[];
  for(const record of model.records??[]){if(!PATCH_IDS.has(record.id))continue;const footprint=waterFootprint(record);if(!footprint)continue;
    const ring=footprint.polygons[0][0],centre=ring.reduce((c,p)=>({x:c.x+p.x/ring.length,z:c.z+p.z/ring.length}),{x:0,z:0});
    let longest={length:0};for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],length=Math.hypot(b.x-a.x,b.z-a.z);if(length>longest.length)longest={length,tx:(b.x-a.x)/length,tz:(b.z-a.z)/length};}
    const {tx,tz}=longest,nx=-tz,nz=tx,local=ring.map(p=>({u:(p.x-centre.x)*tx+(p.z-centre.z)*tz,v:(p.x-centre.x)*nx+(p.z-centre.z)*nz}));
    const a=(Math.max(...local.map(p=>p.u))-Math.min(...local.map(p=>p.u)))*.34,b=(Math.max(...local.map(p=>p.v))-Math.min(...local.map(p=>p.v)))*.30;
    const safe=(x,z,r)=>footprint.contains(x,z)&&footprint.distance(x,z)>r+.15&&!blocked(x,z,r);
    const put=(u,v,r,h,kind,yaw=0)=>{const x=centre.x+tx*u+nx*v,z=centre.z+tz*u+nz*v;if(safe(x,z,r))plants.push({x,z,radius:r,height:h,kind,yaw,sourceId:record.id});};
    const steps=Math.ceil(2*Math.PI*Math.sqrt((a*a+b*b)/2)/.48);
    for(let i=0;i<steps;i++){const theta=i/steps*Math.PI*2,u=a*Math.cos(theta),v=b*Math.sin(theta),du=-a*Math.sin(theta),dv=b*Math.cos(theta);put(u,v,.58,.55,'hedge',-Math.atan2(tz*du+nz*dv,tx*du+nx*dv));}
    // A few low round islands inside each oval; no lettering or filled plaza.
    for(const f of[-.58,-.2,.2,.58]){const u=a*f,rr=Math.min(1.4,b*.27);for(let i=0;i<16;i++){const theta=i*Math.PI/8;put(u+Math.cos(theta)*rr,Math.sin(theta)*rr,.43,.36,'accent',theta);}}
    patches.push({id:record.id,footprint,centre,axes:{tx,tz,nx,nz},radii:{a,b}});
  }
  return{patches,plants};
}

export function createEastNineForecourt(THREE,model,{surfaces,existingTrees=[],heightAt}={}){
  const plan=planEastNineForecourt(model),group=new THREE.Group();group.name='东九前场 · 源绿地内低曲线绿篱';
  group.userData={component:'east-nine-forecourt',sourceIds:plan.patches.map(p=>p.id),photo:PHOTO,sourceFootprintPreserved:true,dimensions:'estimated',basis:'Official aerial photograph: low curved hedges and planted islands in the two side greens; exact contours, species, heights and seasonal colours not surveyed',plantCount:plan.plants.length};
  const planting=createEastNinePlanting(THREE,model,{plan,existingTrees});group.add(planting.group);plan.planting=planting.plan;
  const people=createEastNinePeople(THREE,model,{heightAt});group.add(people.group);plan.people=people.plan.people;group.userData.personCount=plan.people.length;
  let disposed=false;return{group,plan,dynamicGroup:people.group,update:people.update,dispose(){if(disposed)return;disposed=true;people.dispose();planting.dispose();group.removeFromParent();group.clear();}};
}
