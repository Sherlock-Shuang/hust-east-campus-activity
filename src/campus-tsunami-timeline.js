// Fixed LOCAL_ENU coordinates (x east, z south). Each crest travels from the
// southern horizon through the whole playable campus, including z = -3942 m.
// Camera motion never moves the wave; only the shared event clock does.
export const CAMPUS_TSUNAMI_PLACEMENT=Object.freeze({x:1400,z:0,width:9000,farFront:2200,shoreFront:2050,speed:50,arcDepth:600,period:220,interval:110});
// A single constant-speed journey starts on the horizon at the broadcast,
// rather than covering kilometres during the three-second lead-in.
export const campusTsunamiFront=age=>CAMPUS_TSUNAMI_PLACEMENT.shoreFront-CAMPUS_TSUNAMI_PLACEMENT.speed*age;
