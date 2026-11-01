import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCommuteSimulation} from '../src/commute-simulation.js';
import {sweepScenarios,runSweepScenario} from './fixtures/commute-sweep-scenarios.mjs';

// Recorded from the independent pre-optimization 169d89c implementation. Hash
// includes every state's field and retained completion record after each step,
// not only a final position or aggregate traffic count.
const baseline=JSON.parse(readFileSync(new URL('./fixtures/commute-sweep-169d89c.json',import.meta.url)));
for(const scenario of sweepScenarios())test(`sweep caching preserves baseline history: ${scenario.id}`,()=>{
  const expected=baseline.scenarios.find(s=>s.id===scenario.id);assert.ok(expected);
  const actual=runSweepScenario(createCommuteSimulation,scenario);assert.deepEqual(actual,expected);
  assert.ok(actual.coverage.arrivals>0,'finished actors are part of the history');
  if(scenario.route.bidirectional)assert.deepEqual(actual.coverage.directions,[-1,1]);
  if(scenario.player)assert.ok(actual.coverage.waitReasons.includes('player'),'nearby grounded player actually stops traffic');
  if(scenario.borrow)assert.ok(actual.coverage.dismounted>0,'dismount changes body kind and dimensions');
});
