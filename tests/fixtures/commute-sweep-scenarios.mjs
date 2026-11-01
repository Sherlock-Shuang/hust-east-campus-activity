import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCommuteRoute} from '../../src/commute-route.js';
import {createLocalFrame,geoToLocal} from '../../src/geospatial.js';

export function sweepScenarios(){
  const data=JSON.parse(readFileSync(new URL('../../public/data/east-campus.geojson',import.meta.url)));
  const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
  const campus=JSON.parse(JSON.stringify(createCommuteRoute(data,{frame,geoToLocal})));
  const bridge={bidirectional:true,points:[{x:0,y:.16,z:0},{x:0,y:.16,z:-20},{x:0,y:2.16,z:-40},{x:0,y:2.16,z:-60},{x:0,y:.16,z:-80},{x:24,y:.16,z:-100}],segments:[{startProgress:0,endProgress:20,width:7.2},{startProgress:20,endProgress:80,width:3.2},{startProgress:80,endProgress:112,width:7.2}],trafficSignals:[{id:'bridge-signal',progress:84,greenSeconds:5,amberSeconds:2,redSeconds:8}]};
  const short={bidirectional:false,points:[{x:0,y:.16,z:0},{x:0,y:.16,z:-70}],segments:[{startProgress:0,endProgress:50,width:7.2},{startProgress:50,endProgress:70,width:2.4,mode:'walk'}],dismountProgress:50,trafficSignals:[{id:'short-signal',progress:30,greenSeconds:4,amberSeconds:1,redSeconds:5}]};
  return[
    {id:'campus-peak-bidirectional',route:campus,options:{seed:943108,startMinutes:478,peakAgents:420,maxAgents:600,scooterShare:.86},steps:500},
    {id:'campus-reset-and-player',route:campus,options:{seed:614,startMinutes:470,peakAgents:140,maxAgents:160,scooterShare:.55,opposingShare:.4},steps:500,variableDt:true,changing:true,player:true},
    {id:'bridge-opposing-signals',route:bridge,options:{seed:7303,startMinutes:478,peakAgents:90,maxAgents:100,opposingShare:.45,scooterShare:.83},steps:900},
    {id:'dismount-completion-borrow',route:short,options:{seed:113,startMinutes:478,peakAgents:60,maxAgents:70,scooterShare:.85},steps:1500,borrow:true},
  ];
}

export function scenarioInput(sim,scenario,tick,control={}){
  if(scenario.changing){
    if(tick===100)sim.setDensity(.5);
    if(tick===200)sim.setDensity(1.6);
    if(tick===300)sim.setScooterShare(.95);
    if(tick===375)sim.setTime(479.6);
    if(tick===400)sim.setSignals(false);
    if(tick===440)sim.setSignals(true);
  }
  if(scenario.player){
    let anchor=sim.getAgent(control.anchorId);if(!anchor?.active)anchor=sim.agents.find(a=>a.kind==='scooter');
    if(anchor)control.anchorId=anchor.id;
    const p=anchor?{x:anchor.x-Math.sin(anchor.yaw)*1.7,y:anchor.y,z:anchor.z-Math.cos(anchor.yaw)*1.7,yaw:anchor.yaw}:sim.getPoseAt(330,0,'scooter');
    const mode=['walk','roadster','hoverboard','scooter'][Math.floor(tick/80)%4];
    sim.setPlayerObstacle(tick%100>=80?null:{...p,mode,y:p.y+(mode==='hoverboard'?30:0),grounded:mode!=='hoverboard',pitch:.2,lean:.1});
  }
  if(scenario.borrow){
    if(tick===120||tick===360){const a=sim.agents.find(a=>a.kind==='scooter');if(a)control.lease=sim.takeScooter(a);}
    if(tick===160||tick===410){if(control.lease)sim.restoreScooter(control.lease);control.lease=null;}
  }
  return scenario.variableDt?[1/120,1/60,.05,.13,.24][tick%5]:.05;
}

export function scenarioSnapshot(sim,known){
  const active=new Set();for(const actor of sim.agents){known.add(actor.id);active.add(actor.id);}
  const completed=[];for(const id of known)if(!active.has(id))completed.push([id,sim.getAgent(id)??null]);
  return JSON.stringify({state:sim.state,completed});
}

export function runSweepScenario(factory,scenario){
  const sim=factory(structuredClone(scenario.route),scenario.options),known=new Set(),control={},hash=createHash('sha256');
  const coverage={directions:new Set(),signalStates:new Set(),constraints:new Set(),waitReasons:new Set(),arrivals:0,departures:0,dismounted:0,laneChanges:0};
  hash.update(scenarioSnapshot(sim,known));
  for(let tick=0;tick<scenario.steps;tick++){
    sim.step(scenarioInput(sim,scenario,tick,control));hash.update(scenarioSnapshot(sim,known));
    for(const a of sim.agents){coverage.directions.add(a.direction);if(a.motionConstraint)coverage.constraints.add(a.motionConstraint);if(a.waitReason)coverage.waitReasons.add(a.waitReason);}
    for(const s of sim.signals)coverage.signalStates.add(s.state);
    coverage.arrivals=Math.max(coverage.arrivals,sim.state.arrivals);coverage.departures=Math.max(coverage.departures,sim.state.departures);coverage.dismounted=Math.max(coverage.dismounted,sim.state.dismountedTotal);coverage.laneChanges=Math.max(coverage.laneChanges,sim.state.laneChangesTotal);
  }
  return{id:scenario.id,steps:scenario.steps,hash:hash.digest('hex'),coverage:Object.fromEntries(Object.entries(coverage).map(([k,v])=>[k,v instanceof Set?[...v].sort():v])),finalStats:sim.stats};
}
