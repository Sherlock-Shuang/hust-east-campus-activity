import {cp,readFile,writeFile,mkdir,rm,symlink,readdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const here=dirname(fileURLToPath(import.meta.url));
const campus=resolve(here,'../..');
const args=process.argv.slice(2);
const value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const source=resolve(value('--source')||process.env.TASAY_SOURCE||'');
if(!value('--source')&&!process.env.TASAY_SOURCE)throw new Error('Supply --source <ta-say checkout>; source is read-only.');
const output=resolve(value('--output')||join(campus,'work-assets/tasay'));
const stage=join(here,'.staging');
const origins=(value('--campus-origins')||'').split(',').filter(Boolean).map(x=>new URL(x).origin);
await readFile(join(source,'src/main.tsx'),'utf8');
// A fixed staging directory owned by this adapter; never clear the source or output parent.
await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
for(const name of ['src','index.html','package.json','tsconfig.app.json','66c8ec9cf7b1f1e882d92c7f0c2e8d73.png','c57832db96fa00de7e7da50eb070bd31.png']){
  await cp(join(source,name),join(stage,name),{recursive:true,filter:path=>!path.endsWith('.test.ts')&&!path.endsWith('.test.tsx')});
}
await mkdir(join(stage,'public'),{recursive:true});
await cp(join(source,'public'),join(stage,'public'),{recursive:true,filter:path=>!path.endsWith('.md')});
await symlink(join(source,'node_modules'),join(stage,'node_modules'),'dir');
// Keep restored narrative and mobile UI reproducible without changing the upstream checkout.
await cp(join(here,'ui-overrides'),stage,{recursive:true});
await mkdir(join(stage,'.empty-env'),{recursive:true});
let entry=await readFile(join(stage,'src/main.tsx'),'utf8');
if(!entry.includes('<BrowserRouter>'))throw new Error('BrowserRouter entry changed; review adapter before rebuilding.');
entry='import "./campus-adapter.js";\n'+entry.replace('<BrowserRouter>','<BrowserRouter basename={import.meta.env.BASE_URL}>');
if(entry.split('ReactDOM.createRoot(document.getElementById("root")!).render(').length!==2)throw new Error('React root entry changed; review disposal adapter.');
entry=entry.replace('ReactDOM.createRoot(document.getElementById("root")!).render(', `const campusReactRoot=ReactDOM.createRoot(document.getElementById("root")!);
window.addEventListener('campus:dispose',()=>campusReactRoot.unmount(),{once:true});
if(document.documentElement.dataset.campusDisposed!=='true')campusReactRoot.render(`);
entry+='\nimport "./campus-mobile.css";\n';
await writeFile(join(stage,'src/main.tsx'),entry);
let llm=await readFile(join(stage,'src/services/api/llmClient.ts'),'utf8');
const old='return (import.meta.env[key] as string | undefined)?.trim() ?? "";';
if(!llm.includes(old))throw new Error('LLM configuration changed; review adapter before rebuilding.');
llm=llm.replace(old,`return ({
  VITE_LLM_API_KEY: "campus-proxy-enabled", VITE_FAST_LLM_API_KEY: "campus-proxy-enabled",
  VITE_LLM_BASE_URL: "/api/works/tasay/default", VITE_FAST_LLM_BASE_URL: "/api/works/tasay/fast",
  VITE_LLM_MODEL: "default", VITE_FAST_LLM_MODEL: "fast"
} as Record<string,string>)[key] ?? "";`);
llm=llm.replaceAll('      Authorization: `Bearer ${modelConfig.apiKey}`,','');
await writeFile(join(stage,'src/services/api/llmClient.ts'),llm);
const translator=join(stage,'src/pages/TranslatorPage/index.tsx');
let translatorSource=await readFile(translator,'utf8');
translatorSource=translatorSource.replace('report={activeReport}','report={activeReport ?? undefined}');
await writeFile(translator,translatorSource);
const adapter=(await readFile(join(here,'activity-adapter.js'),'utf8')).replace('__CAMPUS_ALLOWED_ORIGINS__',JSON.stringify(origins));
await writeFile(join(stage,'src/campus-adapter.js'),adapter);
await writeFile(join(stage,'tsconfig.activity.json'),JSON.stringify({extends:'./tsconfig.app.json',include:['src'],exclude:['**/*.test.ts','**/*.test.tsx']},null,2));
const childEnv={...process.env};for(const key of Object.keys(childEnv))if(key.startsWith('VITE_'))delete childEnv[key];
const typecheck=spawnSync(process.execPath,[join(source,'node_modules/typescript/bin/tsc'),'-p','tsconfig.activity.json','--noEmit','--pretty','false'],{cwd:stage,env:childEnv,stdio:'inherit'});
if(typecheck.status!==0)throw new Error('Activity-copy source typecheck failed.');
for(const key of Object.keys(process.env))if(key.startsWith('VITE_'))delete process.env[key];
const {build}=await import(pathToFileURL(join(source,'node_modules/vite/dist/node/index.js')).href);
const {default:react}=await import(pathToFileURL(join(source,'node_modules/@vitejs/plugin-react/dist/index.js')).href);
await build({configFile:false,root:stage,envDir:join(stage,'.empty-env'),base:'/works/tasay/',plugins:[react()],build:{outDir:output,emptyOutDir:true,sourcemap:false}});
// Verify no private .env value has accidentally reached the emitted assets.
const privateValues=[];
try{for(const line of (await readFile(join(source,'.env'),'utf8')).split(/\r?\n/)){const m=line.match(/^\s*[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*\s*=\s*(.*?)\s*$/);if(m){const value=m[1].replace(/^['"]|['"]$/g,'');if(value.length>12)privateValues.push(value);}}}catch(error){if(error.code!=='ENOENT')throw error;}
async function scan(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())await scan(path);else if(/\.(js|json|html|css)$/.test(entry.name)){const content=await readFile(path,'utf8');if(privateValues.some(value=>content.includes(value)))throw new Error('Build contains a private configuration value; do not deploy.');}}}
await scan(output);
const revision=spawnSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).stdout?.trim()||null;
await writeFile(join(output,'activity-build.json'),JSON.stringify({workId:'tasay',name:'过拟合恋人',base:'/works/tasay/',sourceRevision:revision,storyRevision:"original-9d9d37d",adapterVersion:2,level:'page_opened',privateEnvIncluded:false},null,2)+'\n');
console.log(JSON.stringify({workId:'tasay',output,sourceRevision:revision,sourcePreserved:true,privateEnvIncluded:false}));
