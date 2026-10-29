import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebSwingMotion} from '../src/web-swing-motion.js';

const BASE=.14,DECK=11.14;
const polygon=(x1,z1,x2,z2,height)=>({height,rings:[[{x:x1,z:z1},{x:x2,z:z1},{x:x2,z:z2},{x:x1,z:z2}]]});
// A layered ground provider follows the public player-motion query contract.
// The bridge occupies this corridor; its underside is handled by the shared
// swept barriers in player-motion and covered by player-bridge-layers tests.
const layeredGround=(x,z,radius=0,referenceY=Infinity)=>({height:referenceY+.22>=DECK?DECK:BASE,allowed:true,onBridge:referenceY+.22>=DECK,progress:-z});
const plainGround=()=>({height:BASE,allowed:true,onBridge:false,progress:0});
function make({groundAt=layeredGround,buildings=[],y=BASE,grounded=true}={}){
  const state={mode:'spider',x:0,y,z:0,yaw:0,speed:0,pitch:0,lean:0,distance:0,grounded,progress:0};
  const motion=createWebSwingMotion({state,world:{buildings},groundAt});
  return {motion,state};
}
function step(player,seconds,input={}){for(let i=0;i<Math.round(seconds*120);i++)player.motion.step(1/120,input);}

test('spider ground movement below a viaduct uses the lower floor instead of the overhead deck',()=>{
  const player=make();step(player,3,{forward:1});
  assert.equal(player.state.y,BASE);
  assert.equal(player.state.grounded,true);
  assert.ok(player.state.z<-16,'the bridge projection does not act like a vertical wall');
  assert.equal(player.state.blockedReason,'');
});

test('the same horizontal position supports the correct bridge level when approached from above',()=>{
  const player=make({y:DECK+.35,grounded:false});
  assert.equal(player.motion.supportAt({x:0,z:0,y:BASE}).height,BASE);
  assert.equal(player.motion.supportAt({x:0,z:0,y:DECK+.35}).height,DECK);
  player.state.verticalSpeed=-42;
  step(player,.1);
  assert.equal(player.state.y,DECK);
  assert.equal(player.state.grounded,true);
  assert.equal(player.state.verticalSpeed,0);
  step(player,.5,{forward:1});
  assert.equal(player.state.y,DECK);
  assert.ok(player.state.z<-.5,'landing does not trap the player on the deck');
});

test('overhead bridge height does not change initial web pivot or low-altitude auto reeling',()=>{
  const buildings=[polygon(-20,-100,-10,-5,22),polygon(10,-100,20,-5,22)];
  const under=make({buildings}),open=make({buildings,groundAt:plainGround});
  step(under,.2,{swing:true,forward:1});step(open,.2,{swing:true,forward:1});
  assert.ok(under.state.anchor&&open.state.anchor,'normal manual web press still attaches');
  assert.ok(under.state.y<DECK-2.08);
  for(const key of ['x','y','z','vx','vz','verticalSpeed','ropeLength','swingCount'])assert.ok(Math.abs(under.state[key]-open.state[key])<1e-9,key);
  assert.deepEqual(under.state.swingPivot,open.state.swingPivot,'bridge above the player must not raise the gameplay pivot');
  const previous=under.state.anchor;
  step(under,.05,{swing:true});
  assert.deepEqual(under.state.anchor,previous,'holding web still never switches anchor');
});
