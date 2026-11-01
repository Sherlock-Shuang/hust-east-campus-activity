export const CONTROL_PREFERENCES_KEY='dongjiu.controls.v1';
// Applied on first visit/reset; persisted choices continue to take precedence.
export const COMFORT_CONTROL_DEFAULTS=Object.freeze({comfortableCamera:true,sensitivity:.75});
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const number=(value,fallback,min,max)=>Number.isFinite(value)?clamp(value,min,max):fallback;

export function normalizeControlPreferences(value={},defaults={}){
  if(!value||typeof value!=='object')value={};
  return {
    sensitivity:number(value.sensitivity,defaults.sensitivity??1,.45,1.8),
    fovOffset:number(value.fovOffset,defaults.fovOffset??0,-10,12),
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

/** Finger travel uses the short CSS edge in either orientation. Equal physical
 * swipes turn equally on both axes; a wide landscape viewport no longer makes
 * yaw sluggish. This is displacement, never scaled by a frame delta. */
export function controlLookDelta(dx,dy,{touch=false,width=844,height=390,preferences={}}={}){
  const p=normalizeControlPreferences(preferences);
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return {x:0,y:0};
  const w=Number.isFinite(width)&&width>0?width:844,h=Number.isFinite(height)&&height>0?height:390;
  const touchGain=Math.PI/(Math.max(240,Math.min(w,h))*.6);
  return {x:dx*(touch?touchGain:.0032)*p.sensitivity,y:dy*(touch?touchGain*.65:.0025)*p.sensitivity*(p.invertY?-1:1)};
}
