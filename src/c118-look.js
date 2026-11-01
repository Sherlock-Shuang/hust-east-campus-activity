import {controlLookDelta} from './control-preferences.js';

// Browsers coalesce touch events during a slow frame. Preserve their complete
// displacement so dropped frames cannot swallow the user's turn.
export function c118LookPose({heading=0,pitch=0},dx,dy,options={}){
  const delta=controlLookDelta(dx,dy,options),clamp=(v,limit)=>Math.max(-limit,Math.min(limit,v));
  return {heading:heading-(options.touch?delta.x:clamp(delta.x,.8)),
    pitch:Math.max(-1.35,Math.min(1.3,pitch-(options.touch?delta.y:clamp(delta.y,.65))))};
}
