import test from 'node:test';
import assert from 'node:assert/strict';
import {publicWanyanData,WANYAN_PUBLIC_TEXT} from './wanyan-public-text.mjs';

function fixture(strings=[...WANYAN_PUBLIC_TEXT.keys(),'victory callback remains untouched']){
  const values=strings.map(s=>Buffer.from(s)),count=values.length+1,table=500,data=table+count*4;
  const metadata=Buffer.alloc(data+values.reduce((n,b)=>n+b.length,0));
  for(const [offset,value]of [[0,0xfab11baf],[4,108],[8,table],[12,count*4],[16,count],[20,data],[24,metadata.length-data],[28,count-1]])metadata.writeUInt32LE(value,offset);
  let position=0;values.forEach((value,i)=>{metadata.writeUInt32LE(position,table+i*4);value.copy(metadata,data+position);position+=value.length;});metadata.writeUInt32LE(position,table+(count-1)*4);
  const name=Buffer.from('Il2CppData/Metadata/global-metadata.dat'),headerSize=32+name.length,buffer=Buffer.alloc(headerSize+metadata.length+6);
  Buffer.from('UnityWebData1.0\0').copy(buffer);buffer.writeUInt32LE(headerSize,16);buffer.writeUInt32LE(headerSize,20);buffer.writeUInt32LE(metadata.length,24);buffer.writeUInt32LE(name.length,28);name.copy(buffer,32);metadata.copy(buffer,headerSize);buffer.fill(0xab,headerSize+metadata.length);
  return {buffer,metadataStart:headerSize,dataStart:headerSize+data};
}

test('only the four intended literal names change, preserving source, offsets and all other bytes',()=>{
  const {buffer,dataStart}=fixture(),before=Buffer.from(buffer),patched=publicWanyanData(buffer);
  assert.deepEqual(buffer,before);assert.equal(patched.length,buffer.length);
  const expected=Buffer.from(buffer);let start=dataStart;
  for(const [from,to]of WANYAN_PUBLIC_TEXT){Buffer.from(to).copy(expected,start);start+=Buffer.byteLength(from);}
  assert.deepEqual(patched,expected);
  assert.equal(patched.includes(Buffer.from('归心')),false);
  for(const value of WANYAN_PUBLIC_TEXT.values())assert(patched.includes(Buffer.from(value)));
});

test('a changed Unity build fails closed rather than patching arbitrary binary bytes',()=>{
  for(const strings of [[...WANYAN_PUBLIC_TEXT.keys()].slice(1),[...WANYAN_PUBLIC_TEXT.keys(),'另一个归心'],[...WANYAN_PUBLIC_TEXT.keys(),[...WANYAN_PUBLIC_TEXT.keys()][0]]])assert.throws(()=>publicWanyanData(fixture(strings).buffer));
  const unsupported=fixture();unsupported.buffer.writeUInt32LE(109,unsupported.metadataStart+4);assert.throws(()=>publicWanyanData(unsupported.buffer),/version/);
  const bounds=fixture();bounds.buffer.writeUInt32LE(0xffffffff,bounds.metadataStart+20);assert.throws(()=>publicWanyanData(bounds.buffer),/section/);
  assert.throws(()=>publicWanyanData(Buffer.from('not a Unity file')),/container/);
});
