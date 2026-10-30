// Deterministic stress world for behavioral equivalence, not a campus survey.
export const rectangle=(x0,z0,x1,z1)=>[{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}];
export function spatialWorld(){
  const buildings=[
    {id:'left',rings:[rectangle(-20,-150,-10,-5)],height:22,minHeight:0},
    {id:'right',rings:[rectangle(10,-150,20,-5)],height:22,minHeight:0},
    {id:'thin',rings:[rectangle(-5,-45,5,-44.96)],height:16,minHeight:0},
    {id:'overhead',rings:[rectangle(-6,-28,6,-23)],height:11,minHeight:4.2},
    {id:'court',rings:[rectangle(28,-60,65,-5),rectangle(32,-54,61,-9)],height:25,minHeight:.14},
  ];
  for(let row=0;row<20;row++)for(let col=0;col<20;col++)buildings.push({id:`distant-${row}-${col}`,rings:[rectangle(100+col*35,100+row*40,125+col*35,128+row*40)],height:12+(row%7)*3,minHeight:row%5===0?4:0});
  return {buildings,bounds:{minX:-200,maxX:1000,minZ:-500,maxZ:1000},water:[]};
}
export const spatialRoute={length:300,points:[{x:0,y:.16,z:0,progress:0},{x:0,y:.16,z:-300,progress:300}],segments:[{startProgress:0,endProgress:300,width:7.2}]};
const round=value=>typeof value==='number'?Number.isFinite(value)?Math.round(value*1e8)/1e8:String(value):Array.isArray(value)?value.map(round):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,round(value[key])])):value;

export function motionReplay(createPlayerMotion,world=spatialWorld(),{frames=480}={}){
  const result={};
  for(const mode of ['walk','scooter','roadster','hoverboard','helicopter','spider']){
    const player=createPlayerMotion({route:spatialRoute,world});player.reset(0,mode);
    if(['roadster','hoverboard','helicopter'].includes(mode))Object.assign(player.state,{y:2.3,grounded:false,flightEnabled:true,rotorPower:1});
    const trace=[];
    for(let n=0;n<frames;n++){
      const input={forward:n%240<190?1:-.4,turn:n%240>140?.4:0,fast:n%180>90,brake:n%240>210,
        moveX:mode==='walk'||mode==='spider'?Math.sin(n*.002)*.24:undefined,moveZ:mode==='walk'||mode==='spider'?-1:undefined,
        jump:mode==='spider'&&n%90===0,swing:mode==='spider'&&n%100<82,reel:mode==='spider'&&n%240>130,
        lift:n%180<95?1:0,vertical:n%180<95?.65:-.3,point:mode==='spider'&&n===215,trick:mode==='spider'&&n>360};
      const dt=n%137===136?.125:1/60;player.step(dt,input);
      if(n%24===0||n===frames-1)trace.push(round(player.state));
    }
    result[mode]=trace;
  }
  return result;
}

export function cameraReplay(calculatePlayerCamera,constrainPlayerCamera,world=spatialWorld()){
  const out=[];
  for(let n=0;n<600;n++){
    const state={mode:n%2?'spider':'walk',x:Math.sin(n*.07)*45,y:n%70*.17,z:-n%140,yaw:n*.1,speed:12,vx:0,vz:-12,verticalSpeed:-2,grounded:n%3===0};
    const options={world,pitch:Math.sin(n*.04)*.5,heading:n*.01,groundAt:()=>.14};
    const pose=calculatePlayerCamera(state,options);
    out.push(round(constrainPlayerCamera(state,pose,options)));
  }
  return out;
}
