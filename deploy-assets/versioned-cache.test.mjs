import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoutes} from './materialize.mjs';
test('deployment route cache is immutable only for a matching complete content hash',()=>{
 const hash='a'.repeat(64),routes=createRoutes({routes:{['/works/library/assets/'+hash+'/model.glb']:{sha256:hash,mime:'model/gltf-binary'},'/works/library/model.glb':{sha256:hash,mime:'model/gltf-binary'}}}).routes;
 const versioned=routes.find(route=>route.headers?.['Cache-Control']?.includes('immutable'));assert(versioned);
 assert.equal(routes.filter(route=>route.headers?.['Cache-Control']?.includes('immutable')).length,1);
});
