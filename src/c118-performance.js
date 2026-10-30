import {createPerformanceQuality} from './performance-quality.js';

const audienceRates=[15,20,25];

/** The hall shares the campus pixel/pressure policy, but its budgets only touch
 * authored visual work. Water height, swimmers and the host event clock never
 * depend on this quality level. */
export function createC118Performance(options={}){
  const quality=createPerformanceQuality(options);
  let budget;
  function current(){
    const source=quality.budget;
    if(!budget||budget.revision!==source.revision)budget=Object.freeze({
      ...source,audienceHz:audienceRates[source.level],waterLevel:source.level,
    });
    return budget;
  }
  return {
    get budget(){return current();},
    get state(){return quality.state;},
    update(sample){quality.update(sample);return current();},
    setMode(mode){quality.setMode(mode);return current();},
    setViewport(width,height){quality.setViewport(width,height);return current();},
    resetSamples(){quality.resetSamples();},
  };
}
