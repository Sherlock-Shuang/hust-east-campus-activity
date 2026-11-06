import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createClient} from '@libsql/client';
import {adaptLibsql} from '../serverless/database.mjs';
import {createProductionServer} from '../server/production.mjs';
import {LEARNING_BOARD} from '../src/activity-catalog.js';
import {GOMOKU_POINT} from '../src/gomoku-rules.js';

const origin='https://campus.example.test',password='local-production-host-test';
async function fixture(t,options={}){
  const dir=await mkdtemp(path.join(tmpdir(),'campus-production-')),distDir=path.join(dir,'dist');
  await mkdir(distDir);
  const write=async(name,body)=>{const filename=path.join(distDir,name);await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,body);return filename;};
  await write('index.html','campus');await write('admin.html','admin');
  const apps=[],cleanup=[];
  t.after(async()=>{for(const app of apps)await app.close();for(const fn of cleanup)await fn();await rm(dir,{recursive:true,force:true});});
  const start=async(extra={})=>{
    const app=await createProductionServer({distDir,publicOrigin:origin,env:{},activity:()=>new Response('API',{status:404}),...options,...extra});
    apps.push(app);const address=await app.listen(0,'127.0.0.1');
    const base=`http://127.0.0.1:${address.port}`;
    return {app,base,request:(route,init={})=>fetch(base+route,{...init,headers:{Origin:origin,'Content-Type':'application/json',...init.headers}})};
  };
  return {dir,distDir,write,start,cleanup};
}

test('portable host requires a canonical origin and valid SQL/admin config before listening',async t=>{
  const f=await fixture(t);
  for(const publicOrigin of [undefined,'https://campus.example.test/','https://campus.example.test/path','ftp://host','https://user:pass@host']){
    await assert.rejects(createProductionServer({distDir:f.distDir,env:{},publicOrigin,activity:()=>new Response()}),/PUBLIC_ORIGIN/);
  }
  await assert.rejects(createProductionServer({distDir:f.distDir,publicOrigin:origin,env:{}}),/ADMIN_PASSWORD/);
  await assert.rejects(createProductionServer({distDir:f.distDir,publicOrigin:origin,env:{ADMIN_PASSWORD:password}}),/database configuration/);
  await assert.rejects(createProductionServer({distDir:f.distDir,publicOrigin:origin,env:{ADMIN_PASSWORD:password,TURSO_DATABASE_URL:'file:/tmp/not-remote',TURSO_AUTH_TOKEN:'test'}}),/remote/);
  const {app,request}=await f.start({publicOrigin:undefined,env:{RENDER_EXTERNAL_URL:origin}});
  assert.equal(app.publicOrigin,origin);assert.deepEqual(await (await request('/healthz')).json(),{ok:true});
});

test('static route aliases, trailing slash redirects and Tasay history fallback preserve the deployment contract',async t=>{
  const f=await fixture(t);
  for(const name of ['library','wanyan','tasay','she-love-me'])await f.write(`works/${name}/index.html`,name);
  await f.write('works/library/games/isaac/index.html','isaac');
  await f.write('works/library/api/games.json','{"games":[]}');
  const {request}=await f.start();
  for(const route of ['/','/index.html'])assert.equal(await (await request(route)).text(),'campus');
  for(const route of ['/admin','/admin/','/admin.html'])assert.equal(await (await request(route)).text(),'admin');
  for(const route of ['/api/games','/api/games/','/works/library/api/games','/works/library/api/games/']){
    const r=await request(route);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/json/);assert.deepEqual(await r.json(),{games:[]});
  }
  for(const name of ['library','wanyan','tasay','she-love-me','library/games/isaac']){
    const r=await request('/works/'+name+'?campusAttempt=keep',{redirect:'manual'});
    assert.equal(r.status,308);assert.equal(r.headers.get('location'),'/works/'+name+'/?campusAttempt=keep');
    assert.equal((await request('/works/'+name+'/')).status,200);
  }
  assert.equal(await (await request('/works/tasay/conversation/123')).text(),'tasay');
  for(const route of ['/api/unknown','/works/unknown','/works/tasay/api/nope','/works/tasay/assets/nope','/works/tasay/missing.js','/unknown']){
    const r=await request(route);assert.equal(r.status,404,route);assert.doesNotMatch(r.headers.get('content-type')||'',/text\/html/);
  }
  assert.equal((await request('/works/library/',{method:'POST',body:'{}'})).status,405);
  assert.equal((await request('/api/games',{method:'POST',body:'{}'})).status,404);
});

test('portable static host uses runtime MIME and conservative cache policies',async t=>{
  const f=await fixture(t),hash='a'.repeat(64),versioned='/works/library/assets/'+hash+'/model.glb';
  const manifestFile=path.join(f.dir,'manifest.json');
  await writeFile(manifestFile,JSON.stringify({routes:{[versioned]:{sha256:hash}}}));
  const assets=[
    ['assets/main-Abcdef12.js','text/javascript',true],['assets/plain.js','text/javascript',false],
    ['works/tasay/assets/index-A1234567.css','text/css',true],['data/settings.json','application/json',false],
    ['audio/music.m4a','audio/mp4',false],['video/film.mp4','video/mp4',false],['game.wasm','application/wasm',false],
    ['font.woff2','font/woff2',false],[versioned.slice(1),'model/gltf-binary',true],
  ];
  for(const [name] of assets)await f.write(name,'asset');
  const {request}=await f.start({manifestFile});
  for(const [name,mime,immutable] of assets){
    const r=await request('/'+name);assert.ok(r.headers.get('content-type').startsWith(mime),name);
    assert.equal(r.headers.get('cache-control').includes('immutable'),immutable,name);
    assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  }
  assert.equal((await request('/')).headers.get('cache-control'),'no-cache');
  assert.equal((await request('/data/settings.json')).headers.get('cache-control'),'no-cache');
});

test('byte ranges and HEAD stream only the selected portion of media, including a sparse file over 512 MB',async t=>{
  const f=await fixture(t);await f.write('video.mp4','0123456789');
  const filename=await f.write('large.data',''),handle=await open(filename,'r+'),offset=768*1024*1024;
  await handle.truncate(offset+8);await handle.write(Buffer.from('lastbyte'),0,8,offset);await handle.close();
  const {request}=await f.start();
  for(const [range,status,body,contentRange] of [
    ['bytes=2-5',206,'2345','bytes 2-5/10'],['bytes=-3',206,'789','bytes 7-9/10'],
    ['bytes=8-',206,'89','bytes 8-9/10'],['bytes=8-999',206,'89','bytes 8-9/10'],
    ['bytes=10-',416,'','bytes */10'],['bytes=-0',416,'','bytes */10'],
  ]){
    const r=await request('/video.mp4',{headers:{Range:range}});assert.equal(r.status,status);assert.equal(await r.text(),body);assert.equal(r.headers.get('content-range'),contentRange);
  }
  const head=await request('/video.mp4',{method:'HEAD',headers:{Range:'bytes=2-5'}});
  assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
  for(const headers of [{Range:'bytes=0-1,5-6'},{Range:'bytes=2-5','If-Range':'"old"'}])assert.equal(await (await request('/video.mp4',{headers})).text(),'0123456789');
  const last=await request('/large.data',{headers:{Range:`bytes=${offset}-`}});
  assert.equal(last.status,206);assert.equal(last.headers.get('content-length'),'8');assert.equal(await last.text(),'lastbyte');
});

test('dotfiles, encoded traversal and symlink escapes cannot read outside the built site',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.dir,'private.txt'),'secret');
  await f.write('.env','secret');await symlink(path.join(f.dir,'private.txt'),path.join(f.distDir,'escape.txt'));
  await symlink(f.dir,path.join(f.distDir,'linked'));await symlink(path.join(f.dir,'private.txt'),path.join(f.distDir,'directory-index'));
  const {base,request}=await f.start();
  for(const route of ['/escape.txt','/linked/private.txt','/.env','/%2eenv','/%5cprivate.txt','/%00file'])assert.equal((await request(route)).status,404,route);
  const raw=route=>new Promise((resolve,reject)=>{
    http.get(base,{path:route},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));}).once('error',reject);
  });
  assert.equal(await raw('/%2e%2e/private.txt'),404);
  assert.equal(await raw('/broken%ZZ'),400);
  assert.equal(await raw('//untrusted.example/api/live/state'),400);
});

test('proxy headers and the Vercel rewrite parameter cannot alter canonical origin or the trusted client address',async t=>{
  const f=await fixture(t),{request}=await f.start({activity:req=>Response.json({url:req.url,headers:Object.fromEntries(req.headers)})});
  const r=await request('/api/live/state?__activity_path=admin/session&q=retained',{headers:{
    Host:'attacker.test','X-Forwarded-Host':'attacker.test','X-Forwarded-Proto':'http','X-Forwarded-For':'192.0.2.1',
    'X-Vercel-Forwarded-For':'192.0.2.2',Forwarded:'for=192.0.2.3;proto=http',
  }});
  const data=await r.json();assert.equal(data.url,origin+'/api/live/state?q=retained');
  assert.equal(data.headers.host,'campus.example.test');assert.equal(data.headers['x-forwarded-proto'],'https');
  assert.equal(data.headers['x-vercel-forwarded-for'],'127.0.0.1');assert.equal(data.headers['x-forwarded-for'],undefined);
  assert.equal(data.headers.forwarded,undefined);assert.equal(data.headers['x-forwarded-host'],undefined);
});

async function sqlFixture(t){
  const f=await fixture(t),dbUrl=pathToFileURL(path.join(f.dir,'activity.db')).href;
  const clients=[createClient({url:dbUrl}),createClient({url:dbUrl})],dbs=clients.map(adaptLibsql);
  f.cleanup.push(()=>clients.forEach(client=>client.close()));
  const schema=await readFile(new URL('../serverless/schema.sql',import.meta.url),'utf8');
  await dbs[0].batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>dbs[0].prepare(s)));
  const start=i=>f.start({activity:undefined,db:dbs[i],env:{ADMIN_PASSWORD:password}});
  return {...f,dbs,start};
}

test('real Node HTTP preserves SQL identities, admin login, CSRF, messages and paired games across host replacement',async t=>{
  const f=await sqlFixture(t),first=await f.start(0),request=first.request;
  const wrongOrigin=await request('/api/admin/login',{method:'POST',headers:{Origin:'https://wrong.test'},body:JSON.stringify({password})});assert.equal(wrongOrigin.status,403);
  const login=await request('/api/admin/login',{method:'POST',body:JSON.stringify({password})});assert.equal(login.status,200);
  assert.match(login.headers.get('set-cookie'),/; Secure/);
  const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrfToken;
  const initial=(await (await request('/api/live/state')).json()).state;
  const save={method:'PUT',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify({state:{...initial,skyQrVisible:true},expectedRevision:initial.revision})};
  assert.equal((await request('/api/admin/state',{...save,headers:{Cookie:cookie}})).status,403);
  assert.equal((await request('/api/admin/state',save)).status,200);
  const people=[];
  for(let i=0;i<2;i++){
    const r=await request('/api/audience/join',{method:'POST',body:JSON.stringify({nickname:'迁移测试'+i,tabId:'production-tab-'+i})});assert.equal(r.status,200);
    people.push({cookie:r.headers.get('set-cookie').split(';')[0],...await r.json()});
  }
  const person=people[0],headers={Cookie:person.cookie,'X-CSRF-Token':person.csrfToken};
  assert.equal((await request('/api/audience/events',{method:'POST',headers,body:JSON.stringify({type:'learning_request',eventId:'production-message',tabId:'production-tab-0',position:LEARNING_BOARD,text:'迁移后保留留言'})})).status,200);
  for(const p of people)assert.equal((await request('/api/audience/gomoku',{method:'POST',headers:{Cookie:p.cookie,'X-CSRF-Token':p.csrfToken},body:JSON.stringify({action:'join',position:GOMOKU_POINT})})).status,200);
  await first.app.close();const second=await f.start(1),again=second.request;
  assert.equal((await (await again('/api/live/state')).json()).state.skyQrVisible,true);
  assert.equal((await (await again('/api/admin/session',{headers:{Cookie:cookie}})).json()).authenticated,true);
  assert.equal((await (await again('/api/audience/me',{headers})).json()).audience.id,person.audience.id);
  const messages=await (await again('/api/admin/learning-requests',{headers:{Cookie:cookie}})).json();assert.match(JSON.stringify(messages),/迁移后保留留言/);
  const games=await Promise.all(people.map(p=>again('/api/audience/gomoku',{headers:{Cookie:p.cookie}}).then(r=>r.json())));
  assert.ok(games[0].game.id);assert.equal(games[0].game.id,games[1].game.id);
  assert.equal((await again('/api/works/tasay/default/chat/completions',{method:'POST',body:'{}'})).status,401);
});

test('client-selected edge IP headers cannot bypass SQL admin login throttling on the portable host',async t=>{
  const f=await sqlFixture(t),{request}=await f.start(0);
  for(let i=0;i<9;i++){
    const r=await request('/api/admin/login',{method:'POST',headers:{'X-Vercel-Forwarded-For':`192.0.2.${i+1}`,'X-Forwarded-For':`198.51.100.${i+1}`},body:'{"password":"incorrect"}'});
    assert.equal(r.status,i<8?401:429);
  }
  assert.equal((await f.dbs[0].prepare('SELECT COUNT(*) AS n FROM activity_login_attempts').first()).n,1);
});

test('SQL SSE streams reach browsers and disconnect without leaving active leases',async t=>{
  const f=await sqlFixture(t),{request}=await f.start(0),abort=new AbortController();
  const response=await request('/api/live/events',{signal:abort.signal});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const reader=response.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/event: snapshot/);
  abort.abort();await reader.cancel().catch(()=>{});
  const deadline=Date.now()+2000;
  while((await f.dbs[0].prepare('SELECT COUNT(*) AS n FROM activity_connections').first()).n&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await f.dbs[0].prepare('SELECT COUNT(*) AS n FROM activity_connections').first()).n,0);
});
