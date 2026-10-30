import {readFile} from 'node:fs/promises';

// Server-only importer. Never pass the resulting object into Vite define/env.
export async function loadTasayServerEnv({env=process.env,envFile=env.TASAY_ENV_FILE}={}){
  let fromFile={};
  if(envFile){const content=await readFile(envFile,'utf8');for(const line of content.split(/\r?\n/)){const match=line.match(/^\s*(?:export\s+)?((?:VITE_|TASAY_)(?:(?:FAST|VISION)_)?LLM_(?:API_KEY|BASE_URL|MODEL))\s*=\s*(.*?)\s*$/);if(match)fromFile[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2');}}
  return {...fromFile,...env};
}
