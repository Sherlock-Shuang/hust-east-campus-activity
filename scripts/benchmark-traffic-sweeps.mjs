// Exact seeded state histories and CPU-only fixed-step timings against a Git
// revision. Does not change physics frequency, population or rendering LOD.
// node scripts/benchmark-traffic-sweeps.mjs --baseline-ref 169d89c --output artifacts/performance-20261101/traffic-sweeps.json
import assert from 'node:assert/strict';
import {writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {createCommuteSimulation as optimized} from '../src/commute-simulation.js';
import {sweepScenarios,runSweepScenario,scenarioInput,scenarioSnapshot} from '../tests/fixtures/commute-sweep-scenarios.mjs';
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const ref=option('--baseline-ref','169d89c'),root=fileURLToPath(new URL('..',import.meta.url));
const baselineFile=path.join(root,'src',`.traffic-sweeps-baseline-${process.pid}.mjs`);
const results={baselineRef:ref,node:process.version,scope:'Pure Node CPU. Every public state field and retained completed actor compared after every step, including borrowing/restore transitions; renderer/FPS not measured.',equivalence:[],timings:[]};
try{
  writeFileSync(baselineFile,execFileSync('git',['show',`${ref}:src/commute-simulation.js`],{cwd:root}));
  const {createCommuteSimulation:baseline}=await import(pathToFileURL(baselineFile));
  const scenarios=sweepScenarios();
  for(const scenario of scenarios){
    const a=baseline(structuredClone(scenario.route),scenario.options),b=optimized(structuredClone(scenario.route),scenario.options),knownA=new Set(),knownB=new Set(),controlA={},controlB={};
    assert.equal(scenarioSnapshot(b,knownB),scenarioSnapshot(a,knownA),`${scenario.id} initial state`);
    for(let tick=0;tick<scenario.steps;tick++){
      const dtA=scenarioInput(a,scenario,tick,controlA),dtB=scenarioInput(b,scenario,tick,controlB);a.step(dtA);b.step(dtB);
      assert.equal(scenarioSnapshot(b,knownB),scenarioSnapshot(a,knownA),`${scenario.id} step ${tick}`);
    }
    const reference=runSweepScenario(baseline,scenario);results.equivalence.push(reference);
    console.log(JSON.stringify({scenario:scenario.id,equivalentSteps:scenario.steps,coverage:reference.coverage}));
  }
  // Alternate before/after per tick. Timing excludes state serialization and
  // uses 100 warmups + 500 fixed 20 Hz updates with the real peak campus route.
  const scenario=scenarios[0],options={...scenario.options,peakAgents:420,maxAgents:600};
  const pairs=[['before',baseline(structuredClone(scenario.route),options)],['after',optimized(structuredClone(scenario.route),options)]];
  const values={before:[],after:[]};
  for(let tick=0;tick<600;tick++)for(const [name,sim]of tick%2?[...pairs].reverse():pairs){const start=performance.now();sim.step(.05);if(tick>=100)values[name].push(performance.now()-start);}
  assert.deepEqual(pairs[1][1].state,pairs[0][1].state);
  for(const [name,samples]of Object.entries(values)){samples.sort((a,b)=>a-b);results.timings.push({name,samples:samples.length,meanMs:samples.reduce((n,v)=>n+v,0)/samples.length,medianMs:samples[Math.floor(samples.length*.5)],p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1)});}
  if(process.argv.includes('--write-fixture'))writeFileSync(path.join(root,'tests/fixtures/commute-sweep-169d89c.json'),JSON.stringify({baselineRef:ref,scenarios:results.equivalence},null,2)+'\n');
  const output=option('--output');if(output){mkdirSync(path.dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(results,null,2)+'\n');}
  console.log(JSON.stringify(results,null,2));
}finally{try{unlinkSync(baselineFile);}catch{}}
