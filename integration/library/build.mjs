import {readFile,writeFile,mkdir,copyFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {publicWanyanData} from './wanyan-public-text.mjs';
import {loadWanyanRuntime} from './wanyan-runtime.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const LIBRARY='/works/library/',WANYAN='/works/wanyan/';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.wasm':'application/wasm','.data':'application/octet-stream','.swf':'application/x-shockwave-flash','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.otf':'font/otf','.txt':'text/plain; charset=utf-8'};
const sha=data=>createHash('sha256').update(data).digest('hex');
const replaceExactly=(source,from,to,label)=>{
  if(!source.includes(from))throw new Error(`Source changed: missing ${label}`);
  return source.replace(from,to);
};
export function rebaseLibraryText(source){
  return source.replace(/(["'(])\/games\/wanyan\//g,`$1${WANYAN}`)
    .replace(/(["'(])\/(hub\/|vendor\/|story\/|api\/games\b|model\.glb\b|hero\.glb\b|portal-books\.json\b|isaac-source\/|games\/isaac\/)/g,`$1${LIBRARY}$2`);
}
function injectAdapter(html,work){
  const prefix=work==='wanyan'?WANYAN:LIBRARY;
  return replaceExactly(html,'</head>',`<script src="${prefix}activity-adapter.js" data-work="${work}"></script></head>`,'document head');
}
function mobileAssets(html,prefix){
  const viewport='<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
  html=/<meta name="viewport"[^>]*>/i.test(html)?html.replace(/<meta name="viewport"[^>]*>/i,viewport):html.replace('</head>',viewport+'</head>');
  return html.replace(viewport,viewport+`<link rel="stylesheet" href="${prefix}touch-controls.css">`);
}
export async function buildLibrary({sourceRoot,outputRoot,wanyanBuildRoot}){
  if(!sourceRoot)throw new Error('Specify --source or BOOKREALM_SOURCE; it is a build-time path only.');
  sourceRoot=path.resolve(sourceRoot);outputRoot=path.resolve(outputRoot||path.join(here,'../../work-assets'));
  const outputRelative=path.relative(sourceRoot,outputRoot);
  if(!outputRelative||(!outputRelative.startsWith(`..${path.sep}`)&&outputRelative!=='..'&&!path.isAbsolute(outputRelative)))throw new Error('Activity output must be outside the original source project');
  const unityRuntime=await loadWanyanRuntime(wanyanBuildRoot||path.join(here,'../../work-assets-source/wanyan-skill'));
  const unityVersion=unityRuntime.provenance.files.find(entry=>entry.file==='Build/wanyan.wasm').sha256.slice(0,12);
  const project=JSON.parse(await readFile(path.join(sourceRoot,'project.json'),'utf8'));
  const app=project.paths.app,isaac=project.paths.isaac,hero=project.paths.hero;
  const entries=[],sourceChecks=[],transforms=[];
  await mkdir(outputRoot,{recursive:true});
  async function put(relative,data,{source,sourceHash}={}){
    const file=path.join(outputRoot,relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data);
    const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
    entries.push({url:'/works/'+relative,file:relative,bytes:bytes.length,sha256:sha(bytes),contentType:types[path.extname(relative)]||'application/octet-stream'});
    if(source)sourceChecks.push({source,sha256:sourceHash});
  }
  async function copy(source,relative,transform){
    const data=await readFile(path.join(sourceRoot,source));
    await put(relative,transform?await transform(data.toString('utf8')):data,{source,sourceHash:sha(data)});
  }
  async function tree(source,dest,allow=()=>true,transform){
    for(const e of await readdir(path.join(sourceRoot,source),{withFileTypes:true})){
      if(e.isSymbolicLink())throw new Error(`Unexpected link in runtime whitelist: ${source}/${e.name}`);
      if(e.isDirectory())await tree(`${source}/${e.name}`,`${dest}/${e.name}`,allow,transform);
      else if(e.isFile()&&allow(e.name))await copy(`${source}/${e.name}`,`${dest}/${e.name}`,transform&&/\.(?:m?js|css|html|json)$/.test(e.name)?transform:undefined);
    }
  }
  const adapter=await readFile(path.join(here,'activity-adapter.js'),'utf8');
  await put('library/activity-adapter.js',adapter);await put('wanyan/activity-adapter.js',adapter);
  for(const file of ['touch-controls.mjs','touch-controls.css'])for(const work of ['library','wanyan'])await put(`${work}/${file}`,await readFile(path.join(here,file),'utf8'));
  for(const file of ['wanyan-touch.mjs','wanyan-touch-gamepad.mjs','wanyan-skill-state.mjs'])await put(`wanyan/${file}`,await readFile(path.join(here,file),'utf8'));
  await put('library/isaac-touch.mjs',await readFile(path.join(here,'isaac-touch.mjs'),'utf8'));
  await put('wanyan/pointer-lock-compat.js',await readFile(path.join(here,'wanyan-pointer-lock.js'),'utf8'));
  await copy(`${app}/viewer/index.html`,'library/index.html',s=>mobileAssets(injectAdapter(rebaseLibraryText(s),'library'),LIBRARY).replace('src="/works/library/hub/main.mjs"','src="/works/library/hub/main.mjs?v=mobile-20261028"'));
  await tree(`${app}/viewer/hub`,'library/hub',name=>/\.(?:m?js|css)$/.test(name),async source=>{
    let s=rebaseLibraryText(source).replaceAll('library-save-v1','campus-library-save-v1').replaceAll('library-view-mode','campus-library-view-mode');
    if(s.includes('function frame(now){')){
      s=`import {createTouchControls,isTouchLayout} from '../touch-controls.mjs';\n`+s;
      s=replaceExactly(s,"const $=s=>document.querySelector(s),stage=$('#stage'),loading=$('#loading');", "let campusSuspended=false,campusPhoneSuspended=false,campusAudioRunning=false;\nconst $=s=>document.querySelector(s),stage=$('#stage'),loading=$('#loading');",'library globals');
      s=replaceExactly(s,'let campusSuspended=false,','let campusTouch=null,campusTouchMove={x:0,y:0};\nlet campusSuspended=false,','touch globals');
      s=s.replaceAll('Math.min(devicePixelRatio,1.5)','Math.min(devicePixelRatio,isTouchLayout()?1.1:1.5)');
      s=replaceExactly(s,"new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'})","new THREE.WebGLRenderer({antialias:!isTouchLayout(),powerPreference:'high-performance'})",'mobile antialias budget');
      s=replaceExactly(s,'try{await document.fonts.load(\'150px "BookRealm CJK"\');}', 'try{if(!isTouchLayout())await document.fonts.load(\'150px "BookRealm CJK"\');}', 'mobile system font startup');
      s=replaceExactly(s,'renderer.render(scene,camera);',"if(!isTouchLayout()||!phone.active)renderer.render(scene,camera);",'phone background render suspension');
      s=replaceExactly(s,'function input(){',"function input(){if(campusTouch?.active&&Math.hypot(campusTouchMove.x,campusTouchMove.y)>.01)return {x:campusTouchMove.x,z:campusTouchMove.y};",'touch movement');
      s=replaceExactly(s,'function updateControllerHints(){',`function updateControllerHints(){
 if(isTouchLayout()&&inputMode!=='gamepad'){
  $('#finding-hint').textContent='唯一的密钥是一个日期';
  $('#control-hint').innerHTML='左侧摇杆移动 · 拖动画面环顾<br>对准书脊点「翻书」·「闪避」躲开障碍<br>顶部「手机」查看消息 ·「暂停」打开菜单';
  $('#phone-button').title='查看手机';$('#controller-status').textContent='触屏操作已启用';
  $('#book-menu-controls').textContent='轻点选项，继续阅读或返回图书馆';return;
 }`,'mobile control guidance');
      s=replaceExactly(s,"(!pointerInside&&inputMode!=='gamepad')","(!pointerInside&&inputMode!=='gamepad'&&!campusTouch?.active)",'touch book focus');
      s=replaceExactly(s,"const centered=document.pointerLockElement===canvas||inputMode==='gamepad';","const centered=document.pointerLockElement===canvas||inputMode==='gamepad'||campusTouch?.active;",'touch book ray');
      s=replaceExactly(s,"(!pointerLock.locked&&inputMode!=='gamepad')","(!pointerLock.locked&&inputMode!=='gamepad'&&!campusTouch?.active)",'touch crosshair');
      s=replaceExactly(s,'function capture(event){pointerLock.request(event);}',"function capture(event){if(!campusTouch?.enabled)pointerLock.request(event);}",'touch lock avoidance');
      s=replaceExactly(s,'function stop(){keys.clear();',"function stop(){campusTouch?.release();keys.clear();",'touch release');
      s=replaceExactly(s,'function controlBoundary(){pointerLock.release();',"function controlBoundary(){campusTouch?.release();pointerLock.release();",'touch boundary');
      s=replaceExactly(s,'last=now;pollController(now,dt);','last=now;if(campusSuspended)return;pollController(now,dt);if(campusTouch?.enabled)updateAim();','library loop');
      s=replaceExactly(s,'onUnlock:()=>pause()','onUnlock:()=>{if(!campusSuspended)pause();}','pointer unlock');
      s=replaceExactly(s,"window.addEventListener('blur',()=>{stop();", "window.addEventListener('blur',()=>{if(campusSuspended)return;stop();",'blur boundary');
      s=replaceExactly(s,"document.documentElement.dataset.libraryReady='true';", "document.documentElement.dataset.libraryReady='true';window.campusWorkAdapter?.ready('runtime_ready');",'library readiness');
      s=replaceExactly(s,'function sendGameControls(suspended){','function sendGameControls(suspended){suspended=suspended||campusSuspended;','nested game pause');
      s=replaceExactly(s,"modelLoadFailed=true;console.error(err);", "modelLoadFailed=true;window.campusWorkAdapter?.fail('图书馆模型未能载入');console.error(err);",'library loading failure');
      s=replaceExactly(s,"throw error;}\nconst gamepads", "window.campusWorkAdapter?.fail('图书馆剧情资源未能载入');throw error;}\nconst gamepads",'library story failure');
      s+=await readFile(path.join(here,'library-hooks.txt'),'utf8');
      s+=await readFile(path.join(here,'library-touch-hooks.txt'),'utf8');
    }
    return s;
  });
  await tree(`${app}/viewer/vendor`,'library/vendor',name=>!name.endsWith('.map')&&!name.endsWith('.DS_Store'));
  await copy(`${app}/exports/Library_Optimized.glb`,'library/model.glb');
  await copy(hero,'library/hero.glb');
  await copy(`${app}/portal_books.json`,'library/portal-books.json',rebaseLibraryText);
  // Never copy the gift's story configuration, portraits, private memory, or authoring tree.
  await put('library/story/config.json',await readFile(path.join(here,'public-story.json')));
  await put('library/api/games.json',JSON.stringify({isaacReady:true,wanyanReady:true,mapping:{I921:'isaac',J921:'wanyan'}}));
  for(const file of ['story.css','story.js','birthday.js','gamepad-controller.mjs'])await copy(`${isaac}/运行验证/${file}`,`library/isaac-source/运行验证/${file}`,source=>{
    let s=rebaseLibraryText(source);
    if(file==='story.js')s=s.replace(/你的好友[^。\n']*帮你杀死了boss，并祝你今日开心。/g,'一位同行者帮你击败了对手，并祝你探索愉快。');
    if(file==='birthday.js')s=replaceExactly(s,"else location.replace(location.port==='8194'?'http://127.0.0.1:8195/?from=isaac':'/?from=isaac');",`else location.replace('${LIBRARY}?from=isaac');`,'Isaac standalone return');
    return s;
  });
  await copy(`${isaac}/运行验证/index.html`,'library/games/isaac/index.html',source=>mobileAssets(rebaseLibraryText(source
    .replace('<meta charset="utf-8">',`<meta charset="utf-8"><base href="${LIBRARY}isaac-source/运行验证/">`)
    .replaceAll("'../",`'${LIBRARY}isaac-source/`)) ,LIBRARY)
    .replace("import { GamepadInput }",`import { attachIsaacTouch } from '${LIBRARY}isaac-touch.mjs';\nimport { GamepadInput }`)
    .replace("watchBirthday(player); player.dataset.ready = 'true';", "watchBirthday(player); player.dataset.ready = 'true'; attachIsaacTouch(player, requestMenu);")
    .replace("else location.assign('/');",`else location.assign('${LIBRARY}');`));
  await tree(`${isaac}/运行验证/node_modules/@ruffle-rs/ruffle`,'library/isaac-source/运行验证/node_modules/@ruffle-rs/ruffle',name=>/\.(?:js|wasm)$/.test(name)||name.startsWith('LICENSE'));
  for(const file of ['剧情扩展/Isaac-High-Damage.swf','SWF运行样本/The Binding of Isaac.swf'])await copy(`${isaac}/${file}`,`library/isaac-source/${file}`);
  for(const [file,bytes]of unityRuntime.files)await put(`wanyan/${file}`,file.endsWith('.data')?publicWanyanData(bytes):bytes);
  transforms.push('Activity Unity copy adds a read-only native skill-state bridge; original gift project is untouched. Four sanctuary labels are renamed from 归心 to 圣所 with equal UTF-8 lengths in the rebuilt data.');
  await tree(`${app}/games/wanyan/TemplateData`,'wanyan/TemplateData',name=>/\.(?:css|png|ico)$/.test(name));
  await copy(`${app}/games/wanyan/index.html`,'wanyan/index.html',source=>{
    let s=mobileAssets(injectAdapter(source,'wanyan'),WANYAN);
    s=replaceExactly(s,'dataUrl: buildUrl + "/wanyan.data"',`dataUrl: buildUrl + "/wanyan.data?campus-text=sanctum-v1&skill-bridge=${unityVersion}"`,'Unity public wording cache version');
    for(const ext of ['framework.js','wasm','loader.js'])s=s.replaceAll(`/wanyan.${ext}"`,`/wanyan.${ext}?skill-bridge=${unityVersion}"`);
    s=s.replace(`${WANYAN}touch-controls.css"`,`${WANYAN}touch-controls.css?skill-ready=1"`);
    s=replaceExactly(s,'</head>',`<script type="module" src="${WANYAN}wanyan-touch.mjs?skill-ready=1"></script></head>`,'Unity touch script');
    s=replaceExactly(s,'return Math.min(Math.max(1, nativeRatio || 1), 2, budgetRatio);',"var mobile=matchMedia('(pointer: coarse)').matches||navigator.maxTouchPoints>0||innerWidth<=900;return Math.min(Math.max(1, nativeRatio || 1), mobile?1.1:2, budgetRatio);",'Unity mobile pixel budget');
    s=s.replace("var meta = document.createElement('meta');","var meta = document.querySelector('meta[name=viewport]') || document.createElement('meta');")
      .replace("meta.content = 'width=device-width, height=device-height, initial-scale=1.0, user-scalable=no, shrink-to-fit=yes';","meta.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';")
      .replace("document.getElementsByTagName('head')[0].appendChild(meta);","if (!meta.parentNode) document.head.appendChild(meta);");
    s=replaceExactly(s,'</head>',`<script src="${WANYAN}pointer-lock-compat.js"></script></head>`,'pointer lock compatibility script');
    s=replaceExactly(s,'createUnityInstance(canvas, config, (progress) => {',`window.campusPointerLock?.install(canvas);window.campusPointerLock?.install(document.body);
        createUnityInstance(canvas, config, (progress) => {`,'Unity pointer lock compatibility');
    s=replaceExactly(s,'window.bookrealmAttachRenderQuality(unityInstance);',`window.bookrealmAttachRenderQuality(unityInstance);
          window.campusWorkAdapter?.register({setPaused(value){window.bookrealmControlsSuspended=value;document.documentElement.dataset.controlsSuspended=String(value);},dispose(){window.bookrealmControlsSuspended=true;unityInstance.Quit?.();}});
          window.campusWorkAdapter?.ready('runtime_ready');
          window.campusWanyanTouchReady?.();`,'Unity readiness');
    s=replaceExactly(s,"script.onerror = () => unityShowBanner('游戏资源未能载入，请返回图书馆后重试。', 'error');", "script.onerror = () => {window.campusWorkAdapter?.fail('晚言引擎未能载入');unityShowBanner('游戏资源未能载入，请返回图书馆后重试。', 'error');};",'Unity loader failure');
    s=replaceExactly(s,"errorHandler: function(message) { unityShowBanner(String(message), 'error'); return true; },", "errorHandler: function(message) { if(window.campusPointerLock?.handleRuntimeError(message))return true;window.campusWorkAdapter?.fail('晚言运行出现异常，请重试或返回校园');unityShowBanner(String(message), 'error'); return true; },",'Unity runtime errors');
    s=replaceExactly(s,"}).catch((message) => {\n                unityShowBanner(String(message), 'error');", "}).catch((message) => {\n                window.campusWorkAdapter?.fail('晚言游戏资源未能载入');unityShowBanner(String(message), 'error');",'Unity resource failure');
    return s;
  });
  for(const prefix of ['library','wanyan','library/games/isaac']){
    const entry=entries.find(e=>e.file===`${prefix}/index.html`);entries.push({...entry,url:`/works/${prefix}/`});
  }
  const games=entries.find(e=>e.file==='library/api/games.json');entries.push({...games,url:LIBRARY+'api/games'});
  transforms.push('Runtime root URLs rebased to /works/library/ and /works/wanyan/', 'Public neutral story preserves original step types, delays, reply counts and completion conditions; original story/avatars excluded', 'Library save and camera preferences use campus-only storage keys', 'Activity bridge adds pause and real readiness signals; no completion or victory is synthesized', 'Isaac runtime helper personal attribution anonymized; its menu and real victory bridge retained', 'Unity activity canvas catches known pointer-lock platform refusals and keeps ordinary mouse input; unrelated Unity errors still fail');
  transforms.push('Campus mobile controls share original movement or keyboard inputs, release on pause/cancel/resize, and never modify game completion', 'Mobile library phone uses full viewport and native text input; mobile rendering caps DPR at 1.1 and suspends the library background while the phone is open');
  const manifest={schemaVersion:1,generatedAt:new Date().toISOString(),sourceVersion:project.version,prefixes:[LIBRARY,WANYAN],entries,transforms,sourceChecks,unityRuntime:unityRuntime.provenance};
  await writeFile(path.join(outputRoot,'library-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  // Re-read source hashes after copying so concurrent edits cannot silently create a mixed release.
  for(const entry of sourceChecks)if(sha(await readFile(path.join(sourceRoot,entry.source)))!==entry.sha256)throw new Error(`Source changed during build: ${entry.source}`);
  return {outputRoot,manifest:'library-manifest.json',files:new Set(entries.map(e=>e.file)).size,bytes:[...new Map(entries.map(e=>[e.file,e.bytes])).values()].reduce((a,b)=>a+b,0)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  const result=await buildLibrary({sourceRoot:value('--source')||process.env.BOOKREALM_SOURCE,outputRoot:value('--output'),wanyanBuildRoot:value('--wanyan-build')||process.env.WANYAN_ACTIVITY_BUILD});
  console.log(JSON.stringify(result));
}
