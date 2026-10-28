import {buildSkinTemplate} from './spider-skin-template.js';
const ASSET_VERSION=1,ASSET_HEADER_BYTES=64,ASSET_MAGIC='HUSTSP01';
const ASSET_FIELDS=[['positions',Float32Array],['normals',Float32Array],['indices',Uint32Array],['skinIndices',Uint16Array],['skinWeights',Float32Array],['colors',Float32Array],['suitCoords',Float32Array],['owners',Uint8Array]];

export function decodeSpiderGeometryAsset(buffer){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<ASSET_HEADER_BYTES||buffer.byteLength>24*1024*1024)throw new Error('Invalid spider geometry asset size');
  const bytes=new Uint8Array(buffer),header=new DataView(buffer);
  if(new TextDecoder().decode(bytes.subarray(0,8))!==ASSET_MAGIC||header.getUint32(8,true)!==ASSET_VERSION)throw new Error('Unsupported spider geometry version');
  const geometry={};let offset=ASSET_HEADER_BYTES;
  for(let i=0;i<ASSET_FIELDS.length;i++){
    const[name,Type]=ASSET_FIELDS[i],length=header.getUint32(12+i*4,true);offset=(offset+3)&~3;
    if(!length||offset+length*Type.BYTES_PER_ELEMENT>buffer.byteLength)throw new Error('Truncated spider geometry asset');
    geometry[name]=new Type(buffer,offset,length);offset+=length*Type.BYTES_PER_ELEMENT;
  }
  if(offset!==buffer.byteLength)throw new Error('Unexpected spider geometry data');
  const vertices=geometry.positions.length/3;
  if(!Number.isInteger(vertices)||vertices<100||geometry.normals.length!==vertices*3||geometry.colors.length!==vertices*3||geometry.suitCoords.length!==vertices*3||geometry.skinIndices.length!==vertices*4||geometry.skinWeights.length!==vertices*4||geometry.owners.length!==vertices||geometry.indices.length%3)throw new Error('Inconsistent spider geometry attributes');
  for(const[name,Type]of ASSET_FIELDS)if(Type===Float32Array&&!geometry[name].every(Number.isFinite))throw new Error('Non-finite spider geometry data');
  if(!geometry.indices.every(index=>index<vertices)||!geometry.skinIndices.every(index=>index<16)||!geometry.owners.every(index=>index<16))throw new Error('Invalid spider geometry indices');
  return geometry;
}

// Deterministic authoring/worker output, not an additional runtime download.
export function createSpiderGeometryAsset(THREE){
  const template=buildSkinTemplate(THREE);let length=ASSET_HEADER_BYTES;
  for(const[name]of ASSET_FIELDS){length=(length+3)&~3;length+=template[name].byteLength;}
  const buffer=new ArrayBuffer(length),bytes=new Uint8Array(buffer),header=new DataView(buffer);
  bytes.set(new TextEncoder().encode(ASSET_MAGIC));header.setUint32(8,ASSET_VERSION,true);let offset=ASSET_HEADER_BYTES;
  ASSET_FIELDS.forEach(([name],index)=>{const data=template[name];offset=(offset+3)&~3;header.setUint32(12+index*4,data.length,true);bytes.set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength),offset);offset+=data.byteLength;});
  return {buffer,version:ASSET_VERSION,vertices:template.positions.length/3,triangles:template.indices.length/3};
}

