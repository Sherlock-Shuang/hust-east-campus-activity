const budgets=[
  {level:0,quality:'low'},
  {level:1,quality:'mobile'},
  {level:2,quality:'desktop'},
].map(Object.freeze);

// The level controls submitted visual work only. Event phase, wave placement
// and the CPU water spectrum remain independent of this table.
export function campusEffectBudget({level=2}={}){
  return budgets[Math.max(0,Math.min(2,Math.round(Number.isFinite(level)?level:2)))];
}
