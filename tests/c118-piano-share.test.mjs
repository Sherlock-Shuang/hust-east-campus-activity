import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {planOptoC118Interior} from '../src/opto-c118-interior.js';
import {shouldOpenC118PianoShare,C118_PIANO_SHARE_URL} from '../src/c118-piano-share.js';
const plan=planOptoC118Interior(),position={x:plan.piano.x-1.65,y:plan.stage.height,z:plan.piano.z+.2,mode:'walk',grounded:true};
const event={code:'KeyF'},context={plan,position};

test('hidden shortcut opens only while standing on stage near the piano',()=>{
  assert.equal(shouldOpenC118PianoShare(event,context),true);
  assert.equal(shouldOpenC118PianoShare({key:'f',code:'Unidentified'},context),true);
  for(const pose of [{...position,x:0},{...position,y:plan.config.floorY},{...position,y:position.y+2},{...position,mode:'spider'},{...position,grounded:false}])
    assert.equal(shouldOpenC118PianoShare(event,{...context,position:pose}),false);
  for(const state of [{active:false},{seated:true},{swimming:true},{floodRunning:true},{plan:null},{position:null}])
    assert.equal(shouldOpenC118PianoShare(event,{...context,...state}),false);
});

test('typing, modified shortcuts and held F never open the presentation',()=>{
  for(const change of [{code:'KeyE'},{repeat:true},{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true},
    {target:{isContentEditable:true}},{target:{closest:()=>({tagName:'INPUT'})}}])
    assert.equal(shouldOpenC118PianoShare({...event,...change},context),false);
});

test('the served deck preserves the supplied portable HTML byte for byte',async()=>{
  const html=await readFile(new URL('../public/'+C118_PIANO_SHARE_URL.slice(2),import.meta.url));
  assert.equal(createHash('sha256').update(html).digest('hex'),'d7ebf46f300a5a14fcd74d6e27ce3caa97fafe2db332f0623f9d5a9f6b9389c5');
});
