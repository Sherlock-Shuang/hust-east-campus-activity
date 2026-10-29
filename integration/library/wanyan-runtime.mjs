import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const WANYAN_RUNTIME_FILES=Object.freeze(['Build/wanyan.data','Build/wanyan.wasm','Build/wanyan.framework.js','Build/wanyan.loader.js']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// Only compiled, fingerprinted activity files may replace the gift's runtime.
// Never silently fall back to a build without the real skill-state bridge.
export async function loadWanyanRuntime(directory){
  let root,provenance;
  try{root=await realpath(directory);provenance=JSON.parse(await readFile(path.join(root,'provenance.json'),'utf8'));}
  catch(error){throw new Error('Missing activity Unity build. Run prepare-wanyan-activity.mjs or supply --wanyan-build with its verified output.',{cause:error});}
  if(provenance.schemaVersion!==1||provenance.bridgeVersion!==1||!Array.isArray(provenance.files))throw new Error('Unsupported activity Unity provenance');
  const files=new Map();
  for(const name of WANYAN_RUNTIME_FILES){
    const entries=provenance.files.filter(entry=>entry.file===name);
    if(entries.length!==1)throw new Error(`Expected exactly one activity Unity file: ${name}`);
    const entry=entries[0],file=await realpath(path.join(root,name));
    if(!file.startsWith(root+path.sep))throw new Error('Activity Unity file escapes its build directory');
    const bytes=await readFile(file);
    if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw new Error(`Activity Unity fingerprint mismatch: ${name}`);
    files.set(name,bytes);
  }
  if(!files.get('Build/wanyan.framework.js').includes(Buffer.from('bookrealmNativeSkill')))throw new Error('Activity Unity skill bridge is missing');
  // No source paths or private source metadata are copied to the public runtime.
  return {files,provenance:{schemaVersion:1,bridgeVersion:1,files:WANYAN_RUNTIME_FILES.map(file=>{const bytes=files.get(file);return {file,bytes:bytes.length,sha256:sha(bytes)};})}};
}
