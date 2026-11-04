export function createExplorationProgress(){
  let previous=null,turn=0,walk=0;
  return {get stage(){return turn<.32?'look':walk<2.5?'walk':'done';},reset(){previous=null;turn=walk=0;},sample(position,heading){
    if(!position||![position.x,position.z,heading].every(Number.isFinite)){previous=null;return;}
    if(previous){const distance=Math.hypot(position.x-previous.x,position.z-previous.z);if(distance<5){walk+=distance;turn+=Math.min(.5,Math.abs(Math.atan2(Math.sin(heading-previous.heading),Math.cos(heading-previous.heading))));}}
    previous={x:position.x,z:position.z,heading};
  },pause(){previous=null;}};
}
