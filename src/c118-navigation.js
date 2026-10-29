import {createPlayerMotion} from './player-motion.js';

// Reuse the campus fixed-step walker, step clearance and body collision.
// This route is only a local metric reference; no commute actors run indoors.
export function createC118Navigation(interior){
  const spawn=interior.spawn||interior.plan.spawn;
  const world={buildings:[],water:[],barriers:interior.colliders||[],walkSurfaces:interior.walkSurfaces||[],bounds:interior.plan.bounds};
  const route={points:[{x:spawn.x,y:.16,z:spawn.z,progress:0},{x:spawn.x,y:.16,z:spawn.z-1,progress:1}],length:1,segments:[]};
  const motion=createPlayerMotion({route,world});
  const result=motion.placeWalker(spawn);
  if(!result.ok)throw new Error(`C118 入口不可行走：${result.reason}`);
  return motion;
}

export function indoorMovement(heading,forward,sideways){
  const length=Math.max(1,Math.hypot(forward,sideways));
  return {moveX:(-Math.sin(heading)*forward+Math.cos(heading)*sideways)/length,
    moveZ:(-Math.cos(heading)*forward-Math.sin(heading)*sideways)/length};
}
