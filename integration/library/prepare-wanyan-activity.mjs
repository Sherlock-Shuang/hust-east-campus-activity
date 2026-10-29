import {readFile,writeFile,mkdir,mkdtemp,copyFile,readdir,access,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const hash=data=>createHash('sha256').update(data).digest('hex');
const exactly=(s,needle,replacement,label)=>{if(s.split(needle).length!==2)throw new Error(`Expected exactly one ${label}`);return s.replace(needle,replacement);};
const GAMEPAD='Assets/EmberSanctum/EmberGamepad.cs';
const PLUGIN='Assets/EmberSanctum/Plugins/CampusActivitySkill.jslib';
const BUILDER='Assets/EmberSanctum/Editor/CampusActivityWebBuild.cs';
const ORIGINAL_BUILDER='Assets/EmberSanctum/Editor/LibraryWebBuild.cs';
const FILES=['wanyan.data','wanyan.wasm','wanyan.framework.js','wanyan.loader.js'];

export function patchGamepad(source){
  const declaration='    [DllImport("__Internal")] static extern void BookRealm_PublishControls(int flags,float moveX,float moveY,float lookX,float lookY,float playerX,float playerZ,float yaw,float pitch,int dodges,float stamina,int selection,int targetId,int liveEnemies,int deviceId);';
  let result=exactly(source,declaration,declaration+'\n    [DllImport("__Internal")] static extern void BookRealm_PublishSkill(float focus,float maxEnergy,float cost,float cooldown,int flags);','existing controls declaration');
  const call='        BookRealm_PublishControls(flags,Move.x,Move.y,Look.x,Look.y,game.player?game.player.position.x:0,game.player?game.player.position.z:0,game.soulsCamera?game.soulsCamera.yaw:0,game.soulsCamera?game.soulsCamera.pitch:0,game.dodges,game.stamina,selection,locked?game.soulsCamera.lockedTarget.GetEntityId().GetHashCode():0,liveEnemies,DeviceId);';
  return exactly(result,call,call+'\n        BookRealm_PublishSkill(game.focus,EmberGame.MaxSkillEnergy,EmberGame.ActiveSkillEnergyCost,game.skillCD,(game.SkillCharged?1:0)|(game.CanCastNow?2:0)|((game.CombatActive&&!game.LibraryControlsSuspended&&Application.isFocused)?4:0));','existing controls publish');
}
export const skillPlugin=`// Activity-only observation: no gameplay mutation or completion event.
mergeInto(LibraryManager.library, {
  BookRealm_PublishSkill: function (focus, maxEnergy, cost, cooldown, flags) {
    window.bookrealmNativeSkill = Object.freeze({
      version: 1, focus: focus, maxEnergy: maxEnergy, cost: cost, cooldown: cooldown,
      charged: !!(flags & 1), canCast: !!(flags & 2), active: !!(flags & 4)
    });
  }
});
`;
export function activityBuilder(source){
  let result=exactly(source,'public static class LibraryWebBuild {','public static class CampusActivityWebBuild {','original build class');
  result=exactly(result,'  var root=Path.GetFullPath(Path.Combine(Application.dataPath,"../../.."));\n  var output=Path.Combine(root,"games/wanyan");','  var output=Environment.GetEnvironmentVariable("CAMPUS_WANYAN_OUTPUT");\n  if(string.IsNullOrEmpty(output)||!Path.IsPathRooted(output))throw new Exception("CAMPUS_WANYAN_OUTPUT must be an absolute isolated output directory.");\n  output=Path.GetFullPath(output);','original build output');
  result=exactly(result,'Path.Combine(root,"integration/webgl_build_report.json")','Path.Combine(output,"build-report.json")','original report output');
  result=exactly(result,'  Directory.CreateDirectory(output);','  Directory.CreateDirectory(output);\n  AuditSkillProperties(output);','build-time skill audit');
  result=exactly(result,' [Serializable]class Summary',`${skillAudit}\n [Serializable]class Summary`,'editor-only audit insertion');
  return result;
}
const skillAudit=` // This fixture exists only in the Editor assembly and never enters the WebGL player.
 static void AuditSkillProperties(string output) {
  var checks=new System.Collections.Generic.List<string>();
  Action<bool,string> check=(ok,label)=>{if(!ok)throw new Exception("Skill contract failed: "+label);checks.Add("PASS: "+label);};
  var previous=EmberSanctum.EmberGame.I;float previousScale=Time.timeScale;
  var owner=new GameObject("Activity read-only skill bridge audit / temporary");
  try {
   var g=owner.AddComponent<EmberSanctum.EmberGame>();g.started=true;g.paused=g.choosing=g.ended=g.bossIntro=false;
   g.stamina=EmberSanctum.EmberGame.MaxStamina;g.skillCD=g.hitStop=g.playerStun=g.dodgeTime=0;
   g.focus=49;check(!g.SkillCharged&&!g.CanCastNow,"49 energy is not charged or castable");
   g.focus=50;check(g.SkillCharged&&g.CanCastNow,"50 energy is genuinely charged and castable");
   g.stamina=27;check(g.SkillCharged&&!g.CanCastNow,"charged skill distinguishes insufficient stamina");g.stamina=100;
   g.skillCD=.5f;check(!g.SkillCharged&&!g.CanCastNow,"cooldown suppresses readiness");g.skillCD=0;
   g.playerStun=.2f;check(g.SkillCharged&&!g.CanCastNow,"stun blocks casting without losing charge");g.playerStun=0;
   g.dodgeTime=.1f;check(g.SkillCharged&&!g.CanCastNow,"dodge blocks casting without losing charge");g.dodgeTime=0;
   g.hitStop=.1f;check(g.SkillCharged&&!g.CanCastNow,"hit stop blocks casting");g.hitStop=0;
   g.paused=true;check(!g.CanCastNow&&!g.CombatActive,"pause blocks active casting");g.paused=false;
   g.choosing=true;check(!g.CanCastNow&&!g.CombatActive,"upgrade menu blocks active casting");g.choosing=false;
   g.bossIntro=true;check(!g.CanCastNow&&!g.CombatActive,"cinematic blocks active casting");g.bossIntro=false;
   g.ended=true;check(!g.CanCastNow&&!g.CombatActive,"end state blocks active casting");g.ended=false;
   g.SetLibraryControlsSuspended(true);check(!g.CanCastNow&&g.LibraryControlsSuspended,"activity suspension blocks casting");g.SetLibraryControlsSuspended(false);
   check(g.SkillCharged&&g.CanCastNow,"resume restores actual readiness");
   check(EmberSanctum.EmberGame.MaxSkillEnergy==100&&EmberSanctum.EmberGame.ActiveSkillEnergyCost==50,"published capacity and cost remain original constants");
   checks.Add("COMPLETE: "+checks.Count+" actual skill property boundary checks; Editor fixture only, no runtime test endpoint.");
  } finally {UnityEngine.Object.DestroyImmediate(owner);EmberSanctum.EmberGame.I=previous;Time.timeScale=previousScale;File.WriteAllLines(Path.Combine(output,"skill-audit.txt"),checks);}
 }
`;
async function run(command,args,options={}){
  await new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',...options});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${path.basename(command)} exited ${code}`)));});
}
async function fingerprints(root,files){const result=[];for(const file of files){const data=await readFile(path.join(root,file));result.push({file,bytes:data.length,sha256:hash(data)});}return result;}
async function assertNoLinks(root){for(const entry of await readdir(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isSymbolicLink())throw new Error(`Source symlink must be reviewed before cloning: ${file}`);if(entry.isDirectory())await assertNoLinks(file);}}
async function canonicalDestination(destination){
  const tail=[];let current=destination;
  for(;;){try{return path.join(await realpath(current),...tail.reverse());}catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(current);if(parent===current)throw error;tail.push(path.basename(current));current=parent;}}
}

export async function prepareWanyanActivity({sourceRoot,outputRoot,unityEditor}){
  if(!sourceRoot||!unityEditor)throw new Error('Pass --source and --unity-editor; both are build-time paths only.');
  sourceRoot=await realpath(path.resolve(sourceRoot));outputRoot=await canonicalDestination(path.resolve(outputRoot||path.join(here,'../../work-assets-source/wanyan-skill')));
  const relative=path.relative(sourceRoot,outputRoot);if(!relative||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'))throw new Error('Output must be outside the original gift project.');
  try{await access(outputRoot);throw new Error('Output already exists; choose a new output directory to preserve previous files.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const config=JSON.parse(await readFile(path.join(sourceRoot,'project.json'),'utf8'));
  const project=path.join(sourceRoot,config.paths.wanyanWebBuild),originalBuild=path.join(sourceRoot,config.paths.app,'games/wanyan');
  for(const dir of ['Assets','Packages','ProjectSettings'])await assertNoLinks(path.join(project,dir));
  const before=await fingerprints(project,[GAMEPAD,ORIGINAL_BUILDER,'Assets/EmberSanctum/EmberGame.cs','Assets/EmberSanctum/Plugins/BookRealmControls.jslib']);
  const baseline=await fingerprints(originalBuild,FILES.map(name=>`Build/${name}`));
  const scratch=await mkdtemp(path.join(os.tmpdir(),'campus-wanyan-activity-')),clone=path.join(scratch,'UnityPortalBuild'),compiled=path.join(scratch,'webgl/wanyan'),log=path.join(scratch,'unity-build.log');
  console.log(JSON.stringify({phase:'cloning',scratch,project:clone,output:outputRoot,log}));
  // APFS copy-on-write keeps existing import/IL2CPP caches without modifying the gift.
  if(process.platform==='darwin')await run('/bin/cp',['-cR',project,clone]);
  else await run('cp',['-R',project,clone]);
  const changes=[];
  async function put(file,content){let old=null;try{old=await readFile(path.join(clone,file));}catch(error){if(error.code!=='ENOENT')throw error;}await writeFile(path.join(clone,file),content);changes.push({file,beforeSha256:old?hash(old):null,afterSha256:hash(content)});}
  await put(GAMEPAD,patchGamepad(await readFile(path.join(clone,GAMEPAD),'utf8')));
  await put(PLUGIN,skillPlugin);
  await put(BUILDER,activityBuilder(await readFile(path.join(clone,ORIGINAL_BUILDER),'utf8')));
  await mkdir(path.dirname(compiled),{recursive:true});
  console.log(JSON.stringify({phase:'building',project:clone,compiled,log}));
  await run(unityEditor,['-batchmode','-quit','-nographics','-buildTarget','WebGL','-projectPath',clone,'-executeMethod','CampusActivityWebBuild.Build','-logFile',log],{env:{...process.env,CAMPUS_WANYAN_OUTPUT:compiled}});
  const report=JSON.parse(await readFile(path.join(compiled,'build-report.json'),'utf8'));
  if(report.result!=='Succeeded'||report.errors!==0)throw new Error(`Unity build did not succeed: ${JSON.stringify(report)}`);
  // All production runtime files come from this single build; no Editor/QA code is published.
  await mkdir(path.join(outputRoot,'Build'),{recursive:true});
  for(const name of FILES)await copyFile(path.join(compiled,'Build',name),path.join(outputRoot,'Build',name));
  const files=await fingerprints(outputRoot,FILES.map(name=>`Build/${name}`));
  const after=await fingerprints(project,before.map(entry=>entry.file));
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Original source changed during activity build. Do not publish this artifact.');
  if(JSON.stringify(baseline)!==JSON.stringify(await fingerprints(originalBuild,baseline.map(entry=>entry.file))))throw new Error('Original shipped runtime changed during activity build. Do not publish this artifact.');
  const wasm=await WebAssembly.compile(await readFile(path.join(outputRoot,'Build/wanyan.wasm')));
  if(!WebAssembly.Module.imports(wasm).some(entry=>entry.name==='BookRealm_PublishSkill'))throw new Error('Compiled player is missing the real skill bridge.');
  const framework=await readFile(path.join(outputRoot,'Build/wanyan.framework.js'),'utf8');
  if(!framework.includes('window.bookrealmNativeSkill=Object.freeze'))throw new Error('Framework does not contain the native skill snapshot.');
  const audit=await readFile(path.join(compiled,'skill-audit.txt'),'utf8');if(!audit.includes('COMPLETE: 14 actual skill property boundary checks'))throw new Error('Missing successful original skill property boundary audit.');
  const provenance={schemaVersion:1,bridgeVersion:1,createdAt:new Date().toISOString(),unityVersion:(await readFile(path.join(project,'ProjectSettings/ProjectVersion.txt'),'utf8')).split('\n')[0].replace('m_EditorVersion: ',''),files,sourceChanges:changes,baseline,sourceBaseline:before,build:{result:report.result,errors:report.errors,warnings:report.warnings,qualityProfile:report.qualityProfile,textureSubtarget:report.textureSubtarget},validation:{skillPropertyChecks:14,skillAuditSha256:hash(audit)},scope:'Activity-only read-only skill observation; original gameplay, original project and original desktop deliverables preserved.'};
  await writeFile(path.join(outputRoot,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
  // Local-only logs remain outside the runtime asset whitelist.
  await copyFile(log,path.join(scratch,'build-completed.log'));
  return {outputRoot,scratch,log,files,provenance:'provenance.json'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
  console.log(JSON.stringify(await prepareWanyanActivity({sourceRoot:value('--source')||process.env.BOOKREALM_SOURCE,outputRoot:value('--output'),unityEditor:value('--unity-editor')||process.env.UNITY_EDITOR})));
}
