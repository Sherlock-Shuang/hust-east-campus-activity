// Vercel reads config before buildCommand; changing only routes.generated.json
// during materialization cannot update the deployed headers.
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRoutes} from './materialize.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(path.join(root,'asset-source/manifest.json'),'utf8'));
const configPath=path.join(root,'vercel.json'),config=JSON.parse(await readFile(configPath,'utf8'));
const {routes}=createRoutes(manifest);
if(process.argv.includes('--check')){
  if(JSON.stringify(config.routes)!==JSON.stringify(routes))throw new Error('Vercel routes are stale. Run npm run sync:routes and commit vercel.json before deployment.');
  console.log('Vercel runtime routes match the asset manifest.');
}else{
  await writeFile(configPath,JSON.stringify({...config,routes},null,2)+'\n');
  console.log('Updated vercel.json routes; service settings were preserved.');
}
