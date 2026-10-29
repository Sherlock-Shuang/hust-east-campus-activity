import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLiveServer} from '../server/index.mjs';

async function fixture(t){
  const root=await mkdtemp(path.join(tmpdir(),'campus-media-test-'));
  const distDir=path.join(root,'dist');await mkdir(path.join(distDir,'media'),{recursive:true});
  const bytes=Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
  await writeFile(path.join(distDir,'media','demo.mp4'),bytes);
  await writeFile(path.join(distDir,'media','empty.mp4'),'');
  const app=await createLiveServer({rootDir:root,distDir,dataDir:path.join(root,'data'),password:'campus-media-test-password',workRouter:async()=>false});
  const {port}=await app.listen(0),origin=`http://127.0.0.1:${port}`;
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  return {distDir,bytes,origin,request:(headers={},method='GET',file='demo.mp4')=>fetch(`${origin}/media/${file}`,{method,headers})};
}

test('MP4 full responses and HEAD expose the media type, length and byte-range support',async t=>{
  const f=await fixture(t),response=await f.request();
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/mp4');
  assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(response.headers.get('content-length'),String(f.bytes.length));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes);
  const head=await f.request({Range:'bytes=2-5'},'HEAD');
  assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(f.bytes.length));
  assert.equal(head.headers.get('content-range'),null);assert.equal((await head.arrayBuffer()).byteLength,0);
});

test('MP4 seeking serves bounded, open-ended, suffix and clamped single ranges exactly',async t=>{
  const f=await fixture(t);
  for(const [range,start,end] of [['bytes=0-1',0,1],['bytes=8-15',8,15],['bytes=30-',30,35],['bytes=-5',31,35],['bytes=30-1000',30,35],['bytes=-1000',0,35]]){
    const response=await f.request({Range:range});
    assert.equal(response.status,206,range);assert.equal(response.headers.get('content-type'),'video/mp4');
    assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${f.bytes.length}`);
    assert.equal(response.headers.get('content-length'),String(end-start+1));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes.subarray(start,end+1),range);
  }
});

test('unsatisfiable ranges return 416 with the representation length and no body',async t=>{
  const f=await fixture(t);
  for(const range of ['bytes=36-','bytes=7-2','bytes=-0','bytes=-','bytes=abc-def','bytes=99999999999999999999-']){
    const response=await f.request({Range:range});assert.equal(response.status,416,range);
    assert.equal(response.headers.get('content-range'),'bytes */36');
    assert.equal(response.headers.get('content-length'),'0');assert.equal((await response.arrayBuffer()).byteLength,0);
  }
  const empty=await f.request({Range:'bytes=0-'},'GET','empty.mp4');assert.equal(empty.status,416);
  assert.equal(empty.headers.get('content-range'),'bytes */0');await empty.arrayBuffer();
});

test('unsupported multipart/units and unvalidated If-Range fall back to a full response',async t=>{
  const f=await fixture(t);
  for(const headers of [{Range:'bytes=0-1,8-10'},{Range:'items=0-1'},{Range:'bytes=0-1','If-Range':'"stale-version"'}]){
    const response=await f.request(headers);assert.equal(response.status,200);
    assert.equal(response.headers.get('content-range'),null);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes);
  }
  const empty=await f.request({},'GET','empty.mp4');assert.equal(empty.status,200);assert.equal((await empty.arrayBuffer()).byteLength,0);
});

test('leaving a video closes its file stream after the HTTP client disconnects',async t=>{
  const f=await fixture(t),large=path.join(f.distDir,'media','large.mp4');
  const handle=await open(large,'w');await handle.truncate(64*1024*1024);await handle.close();
  const canonicalLarge=fs.realpathSync(large);
  const original=fs.createReadStream;let stream;
  let resolveClosed;const closed=new Promise(resolve=>{resolveClosed=resolve;});
  fs.createReadStream=function(filename,options){
    const result=original.call(this,filename,options);
    if(filename===canonicalLarge){stream=result;result.once('close',resolveClosed);}
    return result;
  };
  syncBuiltinESMExports();
  t.after(()=>{fs.createReadStream=original;syncBuiltinESMExports();});
  await new Promise((resolve,reject)=>{
    const req=http.get(`${f.origin}/media/large.mp4`,res=>{
      res.once('data',()=>{req.destroy();res.destroy();resolve();});
    });req.once('error',reject);
  });
  await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Video stream stayed open after disconnect')),2000);timer.unref();})]);
  assert.ok(stream?.destroyed);assert.ok(stream.bytesRead<64*1024*1024,'closing the player must not read the rest of the file');
  const subsequent=await f.request({Range:'bytes=0-1'});assert.equal(subsequent.status,206);await subsequent.arrayBuffer();
});
