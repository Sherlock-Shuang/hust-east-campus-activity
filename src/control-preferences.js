export const CONTROL_PREFERENCES_KEY='dongjiu.controls.v1';
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const number=(value,fallback,min,max)=>Number.isFinite(value)?clamp(value,min,max):fallback;

export function normalizeControlPreferences(value={},defaults={}){
  if(!value||typeof value!=='object')value={};
  return {
    sensitivity:number(value.sensitivity,defaults.sensitivity??1,.45,1.8),
    invertY:typeof value.invertY==='boolean'?value.invertY:!!defaults.invertY,
    joystickScale:number(value.joystickScale,defaults.joystickScale??1,.8,1.35),
    comfortableCamera:typeof value.comfortableCamera==='boolean'?value.comfortableCamera:!!defaults.comfortableCamera,
  };
}

/** Optional storage never prevents gameplay (private browsing and quota errors
 * are normal). Unknown/invalid fields are excluded from the persisted schema. */
export function createControlPreferences({storage,defaults={},onChange=()=>{}}={}){
  const initial=normalizeControlPreferences(defaults);let current=initial;
  try{current=normalizeControlPreferences(JSON.parse(storage?.getItem(CONTROL_PREFERENCES_KEY)||'null'),initial);}catch{}
  return {
    get value(){return {...current};},
    set(patch){
      const next=normalizeControlPreferences({...current,...patch},initial);
      if(Object.keys(next).every(key=>next[key]===current[key]))return {...current};
      current=next;try{storage?.setItem(CONTROL_PREFERENCES_KEY,JSON.stringify(current));}catch{}
      onChange({...current});return {...current};
    },
    reset(){return this.set(initial);},
  };
}

/** CSS viewport fractions, not device pixels: a tenth-screen finger movement
 * gives the same angle on each phone. The 844×390 baseline retains the previous
 * 1.5× touch feel; mouse / pointer-lock retain their original pixel gain. */
export function controlLookDelta(dx,dy,{touch=false,width=844,height=390,preferences={}}={}){
  const p=normalizeControlPreferences(preferences);
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return {x:0,y:0};
  const horizontal=touch?1.5*844/(Number.isFinite(width)&&width>0?width:844):1;
  const vertical=touch?1.5*390/(Number.isFinite(height)&&height>0?height:390):1;
  return {x:dx*.0032*p.sensitivity*horizontal,y:dy*.0025*p.sensitivity*vertical*(p.invertY?-1:1)};
}
