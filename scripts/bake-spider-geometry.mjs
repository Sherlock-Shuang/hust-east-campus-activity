import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import * as THREE from 'three';
import {createSpiderGeometryAsset} from '../src/spider-geometry-asset.js';

const started=performance.now(),asset=createSpiderGeometryAsset(THREE);
// Authoring/benchmark output is deliberately outside public/: production builds
// generate this geometry in a small worker instead of downloading both copies.
const directory=new URL('../artifacts/spider-prebake/',import.meta.url),target=new URL(`spider-skin-v${asset.version}.bin`,directory);
const compressed=gzipSync(new Uint8Array(asset.buffer),{level:9});
await mkdir(directory,{recursive:true});await writeFile(target,new Uint8Array(asset.buffer));await writeFile(new URL(`${target.href}.gz`),compressed);
console.log(JSON.stringify({path:target.pathname,version:asset.version,bytes:asset.buffer.byteLength,gzipBytes:compressed.byteLength,vertices:asset.vertices,triangles:asset.triangles,sha256:createHash('sha256').update(new Uint8Array(asset.buffer)).digest('hex'),generationMs:+(performance.now()-started).toFixed(2)},null,2));
