// Fixed LOCAL_ENU coordinates (x east, z south). Each crest travels from the
// southern horizon through the whole playable campus, including z = -3942 m.
// Camera motion never moves the wave; only the shared event clock does.
export const CAMPUS_TSUNAMI_PLACEMENT=Object.freeze({x:1400,z:0,width:9000,farFront:4200,shoreFront:1100,speed:260,arcDepth:600,period:40,interval:20});
const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
export const campusTsunamiFront=age=>age<0?CAMPUS_TSUNAMI_PLACEMENT.farFront+(CAMPUS_TSUNAMI_PLACEMENT.shoreFront-CAMPUS_TSUNAMI_PLACEMENT.farFront)*smooth((age+3)/3):CAMPUS_TSUNAMI_PLACEMENT.shoreFront-CAMPUS_TSUNAMI_PLACEMENT.speed*age;

