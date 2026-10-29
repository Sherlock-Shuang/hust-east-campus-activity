import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPlayerMotion} from '../src/player-motion.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';

const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const route=createCommuteRoute(source,{frame,geoToLocal}),GROUND=.14,STEP=1/120;
const surfaces=['way/1337362138','way/456199549'].map(id=>route.roadSurfaces.find(s=>s.sourceId===id));
function crossing(surface){
  const [a,b,c,d]=surface.polygon,edge={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
  const center={x:(a.x+b.x+c.x+d.x)/4,z:(a.z+b.z+c.z+d.z)/4};
  const radius=Math.hypot(center.x-edge.x,center.z-edge.z),dx=(center.x-edge.x)/radius,dz=(center.z-edge.z)/radius;
  const alongLength=Math.hypot(b.x-a.x,b.z-a.z);
  return{center,dx,dz,width:radius*2,along:{x:(b.x-a.x)/alongLength,z:(b.z-a.z)/alongLength},spawn:{x:edge.x-dx*3,z:edge.z-dz*3,y:GROUND,yaw:Math.atan2(-dx,-dz)}};
}
function advance(player,seconds,input={},inspect=()=>{}){
  for(let i=0;i<Math.round(seconds/STEP);i++){const previous={...player.state};player.step(STEP,input);inspect(player.state,previous);}
  return player.state;
}
function placed(mode,pose){const player=createPlayerMotion({route});assert.equal(player.placeMode(pose,mode).ok,true,`${mode} should have clearance at the fixture`);return player;}
const high=surfaces[1],fixture=crossing(high);

for(const mode of ['walk','scooter','roadster','spider'])test(`${mode} crosses underneath real campus viaducts without snapping upward or freezing`,()=>{
  for(const surface of surfaces){
    const {spawn,dx,dz,width}=crossing(surface),player=placed(mode,spawn);
    const input=mode==='walk'||mode==='spider'?{moveX:dx,moveZ:dz}:{forward:1};
    let crossed=false;
    for(let i=0;i<8/STEP;i++){
      const previousY=player.state.y;player.step(STEP,input);const state=player.state;
      assert.ok(Number.isFinite(state.y),`${surface.sourceId}: non-finite support`);
      assert.ok(Math.abs(state.y-previousY)<.03,`${surface.sourceId}: ${mode} jumped from ${previousY} to ${state.y}`);
      assert.ok(Math.abs(state.y-GROUND)<.03,`${surface.sourceId}: overhead deck became floor at ${state.y}`);
      assert.ok(Math.abs(state.pitch)<.05,`${surface.sourceId}: nose pitched into the elevated deck`);
      assert.equal(state.blockedReason,'',`${surface.sourceId}: should be passable below the deck`);
      if((state.x-spawn.x)*dx+(state.z-spawn.z)*dz>width+6){crossed=true;break;}
    }
    assert.ok(crossed,`${surface.sourceId}: never reached the opposite side`);
  }
});

test('bridge support queries select a reachable vertical layer and retain explicit top-down inspection',()=>{
  const player=createPlayerMotion({route}),{x,z}=fixture.center;
  assert.equal(player.groundAt(x,z,0,GROUND).height,GROUND);
  assert.equal(player.groundAt.heightAt(x,z,GROUND),GROUND);
  assert.equal(player.groundAt(x,z,0,high.surfaceY-1).height,GROUND,'slab is not reachable from one metre below');
  assert.equal(player.groundAt(x,z,0,high.surfaceY).height,high.surfaceY);
  assert.equal(player.groundAt.heightAt(x,z,high.surfaceY+2),high.surfaceY);
  assert.equal(player.groundAt(x,z).height,high.surfaceY,'unbounded query remains available to scene placement');
  const solids=player.groundAt.solidsInBounds(x-1,z-1,x+1,z+1);
  const deck=[...solids].find(s=>Math.abs(s.height-high.surfaceY)<1e-8);
  assert.ok(deck,'deck remains a collision solid, not simply removed from physics');
  assert.ok(Math.abs(deck.height-deck.minHeight-.75)<1e-8);
  assert.ok(deck.rings?.[0]?.length>=3);
});

test('explicit placement and nearby mode switches preserve the selected bridge level',()=>{
  const pose={...fixture.center,y:GROUND,yaw:Math.atan2(-fixture.along.x,-fixture.along.z)},player=placed('walk',pose);
  assert.equal(player.state.y,GROUND,'ground-level placement does not teleport to a viaduct');
  assert.equal(player.setMode('scooter').ok,true);assert.ok(Math.abs(player.state.y-GROUND)<.01);
  assert.equal(player.setMode('walk').ok,true);assert.equal(player.state.y,GROUND);
  assert.equal(player.placeMode({...pose,y:high.surfaceY},'walk').ok,true);
  assert.equal(player.state.y,high.surfaceY);
  const {y,...sameLevel}=pose;
  assert.equal(player.placeMode(sameLevel,'walk').ok,true);
  assert.equal(player.state.y,high.surfaceY,'omitted y preserves the current supporting level');
});

for(const mode of ['hoverboard','helicopter','roadster'])test(`${mode} ascends below a real viaduct without punching through or jumping onto its slab`,()=>{
  const pose={...fixture.center,y:GROUND,yaw:Math.atan2(-fixture.along.x,-fixture.along.z)},player=placed(mode,pose);
  if(mode==='roadster')assert.equal(player.setFlightEnabled(true).ok,true);
  const bodyHeight=mode==='helicopter'?3.4:mode==='roadster'?1.7:2.2,underside=high.surfaceY-.75;
  const input=mode==='roadster'?{lift:1}:{vertical:1};
  advance(player,8,input,(state,previous)=>{
    assert.ok(Math.abs(state.y-previous.y)<.1,`${mode}: vertical collision must not teleport`);
    assert.ok(state.y+bodyHeight<=underside+.021,`${mode}: entered overhead slab at ${state.y}`);
    assert.ok(state.y>=GROUND-.001);
  });
  assert.ok(player.state.y>GROUND+1,'fixture actually exercised upward movement');
  assert.equal(player.state.grounded,false,'touching a ceiling does not count as landing on top');
  const stoppedY=player.state.y;
  advance(player,1,input);
  assert.ok(Math.abs(player.state.y-stoppedY)<.03,'held ascent remains stable at underside');
  advance(player,1,mode==='roadster'?{}:{vertical:-1});
  assert.ok(player.state.y<stoppedY-.2,'player can descend away instead of remaining stuck');
});

for(const mode of ['hoverboard','helicopter','roadster'])test(`${mode} can take off from a real viaduct, land on top, and continue on the same level`,()=>{
  const {x,z}=fixture.center,pose={x,z,y:high.surfaceY,yaw:Math.atan2(-fixture.along.x,-fixture.along.z)},player=placed(mode,pose);
  if(mode==='roadster')assert.equal(player.setFlightEnabled(true).ok,true);
  const up=mode==='roadster'?{lift:1}:{vertical:1};
  advance(player,3,up);
  assert.ok(player.state.y>high.surfaceY+2,'aircraft actually took off');
  assert.equal(player.state.grounded,false);
  const down=mode==='roadster'?{}:{vertical:-1};
  advance(player,10,down,state=>assert.ok(state.y>=high.surfaceY-.02,'cannot fall through the top into the underpass'));
  assert.equal(player.state.grounded,true);
  assert.ok(Math.abs(player.state.y-high.surfaceY)<.025);
  assert.ok(Math.abs(player.state.verticalSpeed)<.001);
  assert.equal(player.setMode('walk').ok,true);
  const start={x:player.state.x,z:player.state.z};
  advance(player,3,{moveX:fixture.along.x,moveZ:fixture.along.z},state=>{
    assert.equal(state.blockedReason,'');
    assert.ok(Math.abs(state.y-high.surfaceY)<.025);
  });
  assert.ok(Math.hypot(player.state.x-start.x,player.state.z-start.z)>7,'landing did not leave the player frozen');
});

for(const mode of ['scooter','roadster'])test(`${mode} keeps both axles supported at a real viaduct side edge and can reverse away`,()=>{
  for(const sign of [-1,1]){
    const dx=fixture.dx*sign,dz=fixture.dz*sign,pose={...fixture.center,y:high.surfaceY,yaw:Math.atan2(-dx,-dz)};
    const player=placed(mode,pose);
    advance(player,5,{forward:1},(state,previous)=>{
      assert.ok(Math.abs(state.y-high.surfaceY)<.02,`${mode}: axle fell off support at ${state.y}`);
      assert.ok(Math.abs(state.y-previous.y)<.02);
      assert.ok(Math.abs(state.pitch)<.03,`${mode}: nose dipped over deck edge`);
    });
    assert.ok(Math.hypot(player.state.x-pose.x,player.state.z-pose.z)>1,'vehicle actually approached the edge');
    assert.equal(player.state.speed,0,'side edge should stop a grounded vehicle');
    assert.match(player.state.blockedReason,/桥面/);
    const edge={x:player.state.x,z:player.state.z};
    advance(player,2,{forward:-1},state=>{
      assert.ok(Math.abs(state.y-high.surfaceY)<.02);
      assert.ok(Math.abs(state.pitch)<.03);
    });
    assert.equal(player.state.blockedReason,'','bridge-edge protection must allow backing away');
    assert.ok((player.state.x-edge.x)*dx+(player.state.z-edge.z)*dz<-.8);
  }
});

test('overlapping bridge levels stay independent of surface order when walking, driving, or rising between decks',()=>{
  const lower={...high,sourceId:'regression/lower-overlapping-deck',surfaceY:5.64,elevation:5.5};
  const baseRoads=route.roadSurfaces.filter(s=>s!==high);
  for(const decks of [[lower,high],[high,lower]]){
    const stacked={...route,roadSurfaces:[...baseRoads,...decks]},player=createPlayerMotion({route:stacked}),{x,z}=fixture.center;
    assert.equal(player.groundAt(x,z,0,GROUND).height,GROUND);
    assert.equal(player.groundAt(x,z,0,lower.surfaceY).height,lower.surfaceY);
    assert.equal(player.groundAt(x,z,0,lower.surfaceY+2).height,lower.surfaceY);
    assert.equal(player.groundAt(x,z,0,high.surfaceY).height,high.surfaceY);
    for(const y of [GROUND,lower.surfaceY,high.surfaceY]){
      const pose={x,z,y,yaw:Math.atan2(-fixture.along.x,-fixture.along.z)};
      assert.equal(player.placeMode(pose,'scooter').ok,true);
      advance(player,2,{forward:1},state=>{
        assert.equal(state.blockedReason,'');
        assert.ok(Math.abs(state.y-y)<.02,`wrong supporting deck for ${y}`);
        assert.ok(Math.abs(state.pitch)<.03);
      });
    }
    assert.equal(player.placeMode({x,z,y:lower.surfaceY,yaw:0},'roadster').ok,true);
    assert.equal(player.setFlightEnabled(true).ok,true);
    advance(player,4,{lift:1},state=>{
      assert.ok(state.y>=lower.surfaceY-.02);
      assert.ok(state.y+1.7<=high.surfaceY-.75+.02,'cannot rise through upper deck');
    });
    assert.equal(player.state.grounded,false);
    advance(player,4,{},state=>assert.ok(state.y>=lower.surfaceY-.02,'fall must land on lower deck'));
    assert.equal(player.state.grounded,true);
    assert.ok(Math.abs(player.state.y-lower.surfaceY)<.02);
  }
});
