import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {planOptoC118Interior} from '../src/opto-c118-interior.js';
import {shouldOpenC118PianoShare,C118_PIANO_SHARE_URL,C118_PIANO_RETURN_KEY,prepareC118PianoShare,takeC118PianoReturn} from '../src/c118-piano-share.js';
import {pianoReturnURL} from '../public/presentations/piano-return.js';
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

test('only a return script is appended; every supplied deck byte remains unchanged',async()=>{
  const html=await readFile(new URL('../public/'+C118_PIANO_SHARE_URL.slice(2),import.meta.url));
  const trailer=Buffer.from('\n<!-- Campus presentation return navigation -->\n<script type="module" src="./piano-return.js"></script>\n');
  assert.deepEqual(html.subarray(-trailer.length),trailer);
  assert.equal(createHash('sha256').update(html.subarray(0,-trailer.length)).digest('hex'),'d7ebf46f300a5a14fcd74d6e27ce3caa97fafe2db332f0623f9d5a9f6b9389c5');
});

const store=()=>{const values=new Map();return{setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k),removeItem:k=>values.delete(k)};};
const hallUrl='https://example.test/c118.html?campusParentOrigin=https%3A%2F%2Fexample.test&campusAttempt=attempt-one&view=front';
test('piano round trip preserves the embedded hall identity, pose and view, then consumes the saved pose',()=>{
  const storage=store(),href=prepareC118PianoShare({hallUrl,position,heading:.7,pitch:-.2,storage,now:100});
  const destination=pianoReturnURL({href});
  assert.equal(new URL(destination).searchParams.get('campusAttempt'),'attempt-one');
  assert.equal(new URL(destination).searchParams.get('pianoReturn'),'1');
  assert.deepEqual(takeC118PianoReturn({hallUrl:destination,storage,now:200}),{x:position.x,y:position.y,z:position.z,yaw:.7,pitch:-.2});
  assert.equal(takeC118PianoReturn({hallUrl:destination,storage,now:200}),null);
});

test('legacy deck links return via the actual hall referrer or iframe and reject foreign destinations',()=>{
  const href='https://example.test/presentations/taste-is-all-you-need.html';
  for(const context of [{referrer:hallUrl},{referrer:href,frameSrc:hallUrl}])
    assert.equal(new URL(pianoReturnURL({href,...context})).searchParams.get('campusAttempt'),'attempt-one');
  for(const invalid of ['https://elsewhere.test/c118.html','https://example.test/admin.html','javascript:alert(1)','https://user:password@example.test/c118.html']){
    const deck=new URL(href);deck.searchParams.set('returnTo',invalid);
    assert.equal(pianoReturnURL({href:deck.href}),'https://example.test/c118.html?pianoReturn=1');
  }
});

test('blocked storage, stale data and invalid poses safely fall back to the piano viewpoint',()=>{
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  const href=prepareC118PianoShare({hallUrl,position,heading:0,pitch:0,storage:blocked});
  const destination=pianoReturnURL({href});
  assert.equal(takeC118PianoReturn({hallUrl:destination,storage:blocked}),null);
  const validPose={x:position.x,y:position.y,z:position.z,yaw:0,pitch:0};
  for(const saved of [null,{hallUrl:destination,savedAt:0,pose:validPose},{hallUrl:destination,savedAt:29_999_999,pose:{...validPose,x:'bad'}},{hallUrl:hallUrl,savedAt:29_999_999,pose:validPose}]){
    const storage=store();storage.setItem(C118_PIANO_RETURN_KEY,JSON.stringify(saved));
    assert.equal(takeC118PianoReturn({hallUrl:destination,storage,now:30_000_000}),null);
  }
});
