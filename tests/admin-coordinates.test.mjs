import test from 'node:test';
import assert from 'node:assert/strict';
import {readAdminCoordinates,bindAdminCoordinateInputs} from '../src/admin-coordinates.js';

function fixture(t) {
  const xInput=Object.assign(new EventTarget(),{value:'58.2'}),zInput=Object.assign(new EventTarget(),{value:'17.6'});
  const previews=[],errors=[];
  const editor=bindAdminCoordinateInputs({xInput,zInput,onValid:point=>previews.push(point),onInvalid:error=>errors.push(error.message)});
  t.after(()=>editor.dispose());
  return {xInput,zInput,previews,errors,editor};
}

test('saving reads current X/Z even when a programmatic fill has not emitted change or blur',t=>{
  const f=fixture(t);
  f.xInput.value='505.8';f.zInput.value='-79.4';
  assert.deepEqual(f.editor.read(),{x:505.8,z:-79.4});
  assert.deepEqual(f.previews.at(-1),{x:505.8,z:-79.4});
  f.xInput.value='440.2';
  assert.deepEqual(f.editor.read(),{x:440.2,z:-79.4},'a later submit cannot reuse the previous cached selection');
});

test('input and blur update the preview without rewriting either coordinate draft',t=>{
  const f=fixture(t);
  f.xInput.value='505.';f.zInput.value='-79.40';
  f.xInput.dispatchEvent(new Event('input'));
  assert.deepEqual(f.previews.at(-1),{x:505,z:-79.4});
  assert.equal(f.xInput.value,'505.');assert.equal(f.zInput.value,'-79.40');
  f.xInput.value='505.8';f.xInput.dispatchEvent(new Event('blur'));
  assert.deepEqual(f.previews.at(-1),{x:505.8,z:-79.4});
  assert.equal(f.zInput.value,'-79.40','blurring X does not normalize the untouched Z draft');
  f.zInput.value='-80.2';f.zInput.dispatchEvent(new Event('change'));
  assert.deepEqual(f.previews.at(-1),{x:505.8,z:-80.2});
});

test('incomplete or invalid coordinates preserve drafts and block saving instead of becoming zero',t=>{
  const f=fixture(t);
  f.xInput.value='';f.zInput.value='-79.4';f.xInput.dispatchEvent(new Event('input'));
  assert.equal(f.previews.length,0);assert.equal(f.errors.length,0,'partial typing does not show an error on each keystroke');
  assert.throws(()=>f.editor.read(),/完整/);
  f.xInput.dispatchEvent(new Event('blur'));assert.equal(f.errors.length,1);
  assert.equal(f.xInput.value,'');assert.equal(f.zInput.value,'-79.4');
  for(const value of ['6000.1','-6000.1','NaN','Infinity','--1']){
    f.xInput.value=value;assert.throws(()=>f.editor.read(),/有效数字/);
  }
  assert.equal(f.previews.length,0,'invalid edits never replace the last valid map selection');
  f.xInput.value='0';assert.deepEqual(f.editor.read(),{x:0,z:-79.4});
  assert.deepEqual(readAdminCoordinates('-6000','6000'),{x:-6000,z:6000});
});

test('tearing down coordinate handlers stops preview changes',t=>{
  const f=fixture(t);f.editor.dispose();
  for(const type of ['input','change','blur'])f.xInput.dispatchEvent(new Event(type));
  assert.equal(f.previews.length,0);
});
