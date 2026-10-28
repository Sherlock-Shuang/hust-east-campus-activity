import assert from 'node:assert/strict';

// Activity-only display copy. Same UTF-8 byte lengths preserve every Unity
// container/IL2CPP offset; no executable, save, combat or victory state changes.
export const WANYAN_PUBLIC_TEXT=new Map([
  ['归心静候余烬','圣所静候余烬'],
  ['晚言踏入归心。\n击退空壳骑士，直面玄烬。\n饼可以画，胜负得靠打。','晚言踏入圣所。\n击退空壳骑士，直面玄烬。\n饼可以画，胜负得靠打。'],
  ['玄烬已倒下，归心重归安宁。','玄烬已倒下，圣所重归安宁。'],
  ['踏入归心　→','踏入圣所　→'],
]);

export function publicWanyanData(input){
  assert(Buffer.isBuffer(input),'Unity data must be a Buffer');
  assert(input.length>=20&&input.subarray(0,16).equals(Buffer.from('UnityWebData1.0\0')),'Unsupported Unity data container');
  const headerSize=input.readUInt32LE(16);
  assert(headerSize>=20&&headerSize<=input.length,'Invalid Unity header');
  let metadata=null;
  for(let cursor=20;cursor<headerSize;){
    assert(cursor+12<=headerSize,'Truncated Unity file entry');
    const offset=input.readUInt32LE(cursor),size=input.readUInt32LE(cursor+4),length=input.readUInt32LE(cursor+8);cursor+=12;
    assert(cursor+length<=headerSize&&offset>=headerSize&&offset+size<=input.length,'Invalid Unity file bounds');
    const name=input.toString('utf8',cursor,cursor+length);cursor+=length;
    if(name==='Il2CppData/Metadata/global-metadata.dat'){
      assert(!metadata,'Duplicate Unity metadata');metadata={offset,size};
    }
  }
  assert(metadata&&metadata.size>=500,'Missing Unity metadata');
  const meta=input.subarray(metadata.offset,metadata.offset+metadata.size);
  assert.equal(meta.readUInt32LE(0),0xfab11baf,'Invalid IL2CPP metadata');
  assert.equal(meta.readUInt32LE(4),108,'Review text patch for this IL2CPP version');
  const table=meta.readUInt32LE(8),tableSize=meta.readUInt32LE(12),count=meta.readUInt32LE(16);
  const data=meta.readUInt32LE(20),dataSize=meta.readUInt32LE(24),dataCount=meta.readUInt32LE(28);
  assert(table>=500&&tableSize===count*4&&count>1&&table+tableSize<=meta.length,'Invalid literal index table');
  assert(data>=table+tableSize&&data+dataSize<=meta.length&&dataCount===count-1,'Invalid literal data section');
  assert.equal(meta.readUInt32LE(table),0,'Invalid first literal');
  assert.equal(meta.readUInt32LE(table+(count-1)*4),dataSize,'Invalid literal sentinel');
  const edits=[],seen=new Set();
  for(let i=0;i<count-1;i++){
    const start=meta.readUInt32LE(table+i*4),end=meta.readUInt32LE(table+(i+1)*4);
    assert(start<=end&&end<=dataSize,'Invalid literal bounds');
    const text=meta.toString('utf8',data+start,data+end);
    if(!text.includes('归心'))continue;
    assert(WANYAN_PUBLIC_TEXT.has(text)&&!seen.has(text),'Unexpected or duplicate sanctuary wording; review original build');
    const replacement=Buffer.from(WANYAN_PUBLIC_TEXT.get(text));
    assert.equal(replacement.length,end-start,'Text patch must preserve UTF-8 length');
    seen.add(text);edits.push({offset:metadata.offset+data+start,replacement});
  }
  assert.equal(seen.size,WANYAN_PUBLIC_TEXT.size,'Expected four original sanctuary messages');
  const output=Buffer.from(input);
  for(const {offset,replacement}of edits)replacement.copy(output,offset);
  return output;
}
