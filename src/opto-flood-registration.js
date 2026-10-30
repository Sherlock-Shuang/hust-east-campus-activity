import {createLocalFrame,geoToLocal} from './geospatial.js';
import {OPTO_ACCESS} from './opto-access.js';

// Register the photo-estimated interior to the two actual campus portals.
// Its raised rear landing represents outdoor ground level, not a 6 m doorstep.
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const registrations=new WeakMap();
export function optoFloodRegistration(plan){
  const f=plan.foyer;if(!f)return null;
  if(registrations.has(plan))return registrations.get(plan);
  const c2=geoToLocal({...OPTO_ACCESS.collegeSteps,coordinateSystem:'EPSG:4326'},frame),c1=geoToLocal({...OPTO_ACCESS.c118,coordinateSystem:'EPSG:4326'},frame);
  const length=Math.hypot(14.5783,1.4965),zAxis={x:14.5783/length,z:1.4965/length};
  const dz=(f.near+f.far)/2-f.front;
  const xAxis={x:(c1.x-c2.x-zAxis.x*dz)/f.end,z:(c1.z-c2.z-zAxis.z*dz)/f.end};
  const origin={x:c2.x-zAxis.x*f.front,z:c2.z-zAxis.z*f.front};
  const registration={origin,xAxis,zAxis,datum:f.y,
    toCampus(p){return {x:origin.x+xAxis.x*p.x+zAxis.x*p.z,z:origin.z+xAxis.z*p.x+zAxis.z*p.z,y:(p.y??f.y)-f.y};}};
  registrations.set(plan,registration);return registration;
}
export function optoFloodPatches(plan){
  const c=plan.config,f=plan.foyer;
  const patches=[[-c.width/2,c.width/2,-c.depth/2,c.depth/2]];
  if(f)patches.push([f.left,f.right,f.back,f.front],[f.end,f.left,f.near,f.far],
    [-17.5,17.5,f.front,f.front+11],[f.end-11,f.end,(f.near+f.far)/2-12.5,(f.near+f.far)/2+12.5]);
  return patches;
}
