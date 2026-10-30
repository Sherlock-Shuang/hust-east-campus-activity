/** Reproducible activity-only derivative. Dependencies live in a separate tool prefix.
 * npm install --prefix .tools/asset-optimizer @gltf-transform/core@4.2.1
 * @gltf-transform/extensions@4.2.1 @gltf-transform/functions@4.2.1 meshoptimizer@0.23.0 sharp@0.35.5
 */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const tools=createRequire(path.join(root,'.tools/asset-optimizer/package.json'));
const {NodeIO,Logger}=tools('@gltf-transform/core'),{ALL_EXTENSIONS,EXTMeshoptCompression}=tools('@gltf-transform/extensions');
const {weldPrimitive,simplifyPrimitive}=tools('@gltf-transform/functions');
const {MeshoptEncoder,MeshoptDecoder,MeshoptSimplifier}=tools('meshoptimizer'),sharp=createRequire(tools.resolve('ndarray-pixels'))('sharp');
const hash=b=>createHash('sha256').update(b).digest('hex');
function metadata(doc){return doc.getRoot().listNodes().map(n=>({name:n.getName(),extras:n.getExtras(),matrix:n.getMatrix(),children:n.listChildren().map(c=>doc.getRoot().listNodes().indexOf(c))}));}
function stats(doc){const meshes=doc.getRoot().listMeshes(),nodes=doc.getRoot().listNodes();let triangles=0,vertices=0,geometryBytes=0;const unique=new Set();
 const meshTriangles=new Map();for(const mesh of meshes){let count=0;for(const p of mesh.listPrimitives()){count+=(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3;vertices+=p.getAttribute('POSITION').getCount();for(const a of [...p.listAttributes(),p.getIndices()].filter(Boolean))if(!unique.has(a)){unique.add(a);geometryBytes+=a.getArray().byteLength;}}triangles+=count;meshTriangles.set(mesh,count);}
 return {meshes:meshes.length,nodes:nodes.length,materials:doc.getRoot().listMaterials().length,triangles,vertices,geometryBytes,nodeReferencedTriangles:nodes.reduce((n,x)=>n+(meshTriangles.get(x.getMesh())||0),0),animations:doc.getRoot().listAnimations().map(a=>a.getName()),skins:doc.getRoot().listSkins().length};}
function primitiveHash(mesh){return hash(Buffer.concat(mesh.listPrimitives().flatMap(p=>{
 const arrays=p.listAttributes().map(a=>Buffer.from(a.getArray().buffer,a.getArray().byteOffset,a.getArray().byteLength));
 const indices=p.getIndices()?.getArray();if(indices){
  // Meshopt's triangle codec may cyclically rotate a triangle, preserving its
  // vertices and winding. Canonicalize only this lossless index representation.
  const canonical=new Uint32Array(indices.length);for(let i=0;i<indices.length;i+=3){let start=0;if(indices[i+1]<indices[i+start])start=1;if(indices[i+2]<indices[i+start])start=2;for(let j=0;j<3;j++)canonical[i+j]=indices[i+(start+j)%3];}arrays.push(Buffer.from(canonical.buffer));
 }return arrays;
})));}
await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready,MeshoptSimplifier.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const output=path.join(root,'.staging/library-optimized');await mkdir(output,{recursive:true});
async function textureStats(doc){const images=[];for(const [index,texture]of doc.getRoot().listTextures().entries()){const bytes=texture.getImage();if(!bytes)continue;const m=await sharp(bytes).metadata();images.push({index,name:texture.getName(),width:m.width,height:m.height,bytes:bytes.length,mime:texture.getMimeType()});}const pixels=images.reduce((n,i)=>n+i.width*i.height,0);return {images,pixels,estimatedRgba8WithMipBytes:Math.ceil(pixels*4*4/3),scope:'Theoretical RGBA8 plus mipchain allocation, not measured GPU VRAM.'};}
const report={toolVersions:{gltfTransform:'4.2.1',meshoptimizer:'0.23.0',sharp:sharp.versions.sharp},assets:{},scope:'Activity derivative only. Source files, node hierarchy, portal IDs, hero rig and animations retained.'};
for(const name of ['model','hero']){
 const input=path.join(root,'work-assets/library',name+'.glb'),original=await readFile(input),doc=await io.readBinary(original),beforeMetadata=metadata(doc),before=stats(doc),texturesBefore=await textureStats(doc);doc.setLogger(new Logger(Logger.Verbosity.WARN));
 const protectedMeshes=new Set();for(const node of doc.getRoot().listNodes())if(node.getExtras().portal_id)node.traverse(n=>{if(n.getMesh())protectedMeshes.add(n.getMesh());});
 // Ground, architecture and portal attributes must survive byte for byte.
 for(const mesh of doc.getRoot().listMeshes())if(/floor|tile|ground|window|ceiling|wall|door|stair/i.test(mesh.getName()))protectedMeshes.add(mesh);
 const protectedHashes=new Map([...protectedMeshes].map(mesh=>[doc.getRoot().listMeshes().indexOf(mesh),primitiveHash(mesh)]));
 const changed=[];
 if(name==='model'){
  for(const [index,mesh] of doc.getRoot().listMeshes().entries()){
   if(protectedMeshes.has(mesh))continue;
   for(const [primitive,p] of mesh.listPrimitives().entries()){
    const triangles=(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3;
    if(triangles<4000||p.getMode()!==4)continue;
    weldPrimitive(p);
    const decoration=/Vegetation|Foliage|FountainSpray/i.test(mesh.getName());
    if(decoration)simplifyPrimitive(p,{simplifier:MeshoptSimplifier,ratio:.3,error:.001,lockBorder:false});
    // All non-decorative objects receive only exact duplicate-vertex welding.
    const after=p.getIndices().getCount()/3;changed.push({mesh:index,primitive,before:triangles,after});
   }
  }
 }else{
  for(const [index,texture] of doc.getRoot().listTextures().entries()){
   const bytes=texture.getImage();if(!bytes)continue;const info=await sharp(bytes).metadata();
   const max=Math.max(info.width,info.height),size=max>2048?2048:max>1024?1024:max;
   if(size===max)continue;
   const pipeline=sharp(bytes).resize({width:size,height:size,fit:'inside',withoutEnlargement:true});
   const jpeg=texture.getMimeType()==='image/jpeg';
   const resized=await(jpeg?pipeline.jpeg({quality:92,mozjpeg:true}):pipeline.png({compressionLevel:9})).toBuffer();
   texture.setImage(resized).setMimeType(jpeg?'image/jpeg':'image/png');const after=await sharp(resized).metadata();
   changed.push({image:index,beforeBytes:bytes.length,afterBytes:resized.length,before:[info.width,info.height],after:[after.width,after.height]});
  }
 }
 // The input is already quantized. Do not apply a second global quantize/flatten/join.
 doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
 const bytes=await io.writeBinary(doc),sha256=hash(bytes),file=name+'-'+sha256.slice(0,12)+'.glb';await writeFile(path.join(output,file),bytes);
 const check=await io.readBinary(bytes),after=stats(check);const finalMetadata=metadata(check);if(finalMetadata.length!==beforeMetadata.length||finalMetadata.some((n,i)=>JSON.stringify({...n,matrix:undefined})!==JSON.stringify({...beforeMetadata[i],matrix:undefined})||n.matrix.some((v,j)=>Math.abs(v-beforeMetadata[i].matrix[j])>1e-6)))throw new Error(name+' node metadata/hierarchy changed');
 if(name==='model')for(const [meshIndex,checksum] of protectedHashes){const mesh=check.getRoot().listMeshes()[meshIndex];if(!mesh||primitiveHash(mesh)!==checksum)throw new Error('Protected portal/architectural attributes changed: '+meshIndex);}
 if(name==='hero'&&(JSON.stringify(before.animations)!==JSON.stringify(after.animations)||before.skins!==after.skins||before.triangles!==after.triangles))throw new Error('Character rig or animation structure changed');
 report.assets[name]={inputSha256:hash(original),inputBytes:original.length,outputSha256:sha256,outputBytes:bytes.length,file,before,after,texturesBefore,texturesAfter:await textureStats(check),protectedMeshes:protectedMeshes.size,changed};
 console.log(JSON.stringify({asset:name,bytes:[original.length,bytes.length],triangles:[before.triangles,after.triangles],geometryBytes:[before.geometryBytes,after.geometryBytes],changes:changed.length}));
}
const decoder=path.join(path.dirname(tools.resolve('meshoptimizer')),'meshopt_decoder.module.js');await copyFile(decoder,path.join(output,'meshopt-decoder.mjs'));
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:path.join(output,'report.json')}));
