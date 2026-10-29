import {getCampusBridgeProfile} from './bridge-profile.js';
import {getCampusLandmarkProfile} from './campus-landmarks.js';
import {getYunyuanBuildingProfile} from './yunyuan-details.js';
import {resolveEastNineArcadeScale} from './east-nine-scale.js';
/** Display-only profiles for the 3D campus. No function mutates source GeoJSON.
 * Heights, floor modules, colours and road widths without explicit source tags
 * are modelling assumptions, not surveys. height is the roof's total elevation
 * above local ground; extrude height - baseHeight, then lift by baseHeight.
 * Tag semantics: https://wiki.openstreetmap.org/wiki/Key:building:min_level
 * and https://wiki.openstreetmap.org/wiki/Key:min_height
 */

const BUILDING_PRESETS = Object.freeze({
  dormitory: {levels:6,floorHeight:3.15,wallColor:'#e5ddc9',roofColor:'#6e726d',windowColor:'#738b8d',facadeModuleWidth:3.6},
  residential: {levels:6,floorHeight:3.1,wallColor:'#d8c4ab',roofColor:'#7a7166',windowColor:'#597780',facadeModuleWidth:3.4},
  teaching: {levels:5,floorHeight:4.0,wallColor:'#dddcd4',roofColor:'#718687',windowColor:'#477984',facadeModuleWidth:3.6},
  academic: {levels:5,floorHeight:3.8,wallColor:'#d5d2c9',roofColor:'#707d7f',windowColor:'#4b7582',facadeModuleWidth:3.6},
  research: {levels:4,floorHeight:4.2,wallColor:'#c9d2d2',roofColor:'#687d83',windowColor:'#4a7484',facadeModuleWidth:4.2},
  office: {levels:5,floorHeight:3.6,wallColor:'#c9ccc9',roofColor:'#6e797a',windowColor:'#4e7480',facadeModuleWidth:3.6},
  sports: {levels:2,floorHeight:5.0,wallColor:'#c5d2d0',roofColor:'#778e91',windowColor:'#50838c',facadeModuleWidth:5.0},
  dining: {levels:3,floorHeight:4.2,wallColor:'#ece8dc',roofColor:'#8b9187',windowColor:'#526e70',facadeModuleWidth:4.8},
  commercial: {levels:2,floorHeight:3.8,wallColor:'#dac9b5',roofColor:'#7d7770',windowColor:'#557c83',facadeModuleWidth:3.3},
  industrial: {levels:2,floorHeight:5.0,wallColor:'#bfc9ca',roofColor:'#71848d',windowColor:'#577681',facadeModuleWidth:5.4},
  utility: {levels:1,floorHeight:4.0,wallColor:'#b7c3c3',roofColor:'#65777b',windowColor:'#506d76',facadeModuleWidth:4.0},
  roof: {levels:1,floorHeight:3.2,wallColor:'#c6cbca',roofColor:'#788581',windowColor:'#536f77',facadeModuleWidth:4.0},
  generic: {levels:3,floorHeight:3.5,wallColor:'#d0cdc3',roofColor:'#79817e',windowColor:'#587985',facadeModuleWidth:3.5},
});

// Read-only associations checked against the captured source polygons. These
// are geometric containment associations, not claimed OSM parent relations.
const PART_GROUPS = Object.freeze([
  {outlineId:'way/1228689191',kind:'academic',partIds:Array.from({length:26},(_,i)=>`way/${1484333087+i}`)},
  {outlineId:'way/1484333085',kind:'sports',partIds:['way/103488139','way/1484333086']},
  {outlineId:'relation/20970638',kind:'academic',partIds:['relation/20970584','way/1528757572','way/1528757573','way/1528757574','way/1528757575','way/1528757576','way/1539686910']},
  {outlineId:'way/1023544717',kind:'teaching',partIds:['way/1528957937']},
]);
const GROUP_KIND = new Map(PART_GROUPS.flatMap(g=>[g.outlineId,...g.partIds].map(id=>[id,g.kind])));
const PART_PARENT = new Map(PART_GROUPS.flatMap(g=>g.partIds.map(id=>[id,g.outlineId])));
// A numbered name alone does not establish use. This identified building has
// teaching laboratories documented by its school; that proves use, not height
// or a five-storey count. Do not generalise this association to all 东/西 N 楼.
const IDENTIFIED_BUILDING_USES=new Map([
  ['way/98867867',Object.freeze({kind:'teaching',name:'东十七楼',
    basis:'identified-campus-use',sourceUrl:'https://ei.hust.edu.cn/info/1196/7752.htm',
    description:'校方2024年教学实验中心报道确认东十七楼F区含实验教室；用途支持教学类展示，未提供整栋层数或楼高。'})],
]);

function fields(feature) {
  const properties=feature?.properties??feature??{};
  return {properties,tags:properties.tags??properties,id:String(feature?.id??properties.osmId??properties.id??'')};
}
function nonnegative(value) {
  if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
  if(typeof value!=='string'||!/^\s*\d+(?:\.\d+)?\s*$/.test(value))return null;
  return Number(value);
}
function positive(value) {const n=nonnegative(value);return n>0?n:null;}
function metres(value) {
  if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
  if(typeof value!=='string')return null;
  const match=value.trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|'|cm)?$/i);
  if(!match)return null;
  const unit=(match[2]??'m').toLowerCase();
  return Number(match[1])*(['ft','feet',"'"].includes(unit)?.3048:unit==='cm'?.01:1);
}
function sourcedDimension(properties,tags,key) {
  const direct=metres(tags[key]);
  if(direct!==null)return direct;
  const status=properties[`${key}Status`]??properties.provenance?.[key]?.status;
  return ['source','measured'].includes(status)?metres(properties[`${key}Meters`]):null;
}
function sourceColor(value,fallback) {
  return typeof value==='string'&&/^(#[\da-f]{3}(?:[\da-f]{3})?|[a-z]+)$/i.test(value)?value:fallback;
}
function classifyBuilding(tags,id,name) {
  if(GROUP_KIND.has(id))return GROUP_KIND.get(id);
  const use=String(tags['building:use']??tags.building??'').toLowerCase();
  if(tags['building:part']==='roof'||use==='roof')return 'roof';
  if(/食堂|餐厅|餐饮/.test(name)||['食堂','canteen'].includes(use)||['restaurant','fast_food','food_court'].includes(tags.amenity))return 'dining';
  if(/体育馆|球馆|游泳馆|健身/.test(name)||['sports_hall','stadium','sports_centre'].includes(use))return 'sports';
  if(/动力站|配电|变电|泵房|水站|锅炉/.test(name)||['transformer_tower','service','utility'].includes(use))return 'utility';
  if(/宿舍|学生公寓|韵苑.*[栋幢]/.test(name)||use==='dormitory'||['university','student'].includes(tags.residential)&&['residential','apartments'].includes(use))return 'dormitory';
  // Explicit shops must precede lexical matches such as 喻园 and 教育.
  if(/营业厅|商店|超市|接待/.test(name)||['commercial','retail','kiosk'].includes(use)||tags.shop)return 'commercial';
  if(/喻园|博士后公寓/.test(name)||['residential','apartments','house','detached','terrace'].includes(use))return 'residential';
  if(/教学楼|成教楼/.test(name)||use==='school')return 'teaching';
  if(/实验|研究|实训/.test(name)||['laboratory','research'].includes(use))return 'research';
  if(/学院|教育|计算机|人工智能|图书馆/.test(name)||['university','college'].includes(use)||tags.amenity==='library')return 'academic';
  if(/办公|行政|会议/.test(name)||use==='office'||tags.amenity==='conference_centre')return 'office';
  if(['industrial','warehouse','hangar'].includes(use))return 'industrial';
  if(IDENTIFIED_BUILDING_USES.has(id))return IDENTIFIED_BUILDING_USES.get(id).kind;
  return 'generic';
}

/** Pure display profile. `levels` preserves a valid source count when present;
 * `sourceLevels` is null when levels is a use-based modelling assumption.
 * building:levels includes skipped levels below an elevated building part.
 */
export function getBuildingProfile(feature) {
  const {properties,tags,id}=fields(feature),name=String(properties.name??tags.name??'');
  const kind=classifyBuilding(tags,id,name),landmark=getYunyuanBuildingProfile(feature)??getCampusLandmarkProfile(feature),preset={...BUILDING_PRESETS[kind],...(landmark??{})};
  const identifiedUse=IDENTIFIED_BUILDING_USES.get(id);
  const useEvidence=identifiedUse?.kind===kind?{...identifiedUse}:null;
  const sourceLevels=positive(tags['building:levels'])??positive(properties.levels);
  const levels=sourceLevels??preset.levels,minLevel=nonnegative(tags['building:min_level'])??0;
  const sourceHeight=sourcedDimension(properties,tags,'height');
  const floorHeight=sourceHeight>0&&sourceLevels?sourceHeight/sourceLevels:preset.floorHeight;
  let height=sourceHeight>0?sourceHeight:levels*floorHeight;
  let heightEvidence=sourceHeight>0?'source-height':sourceLevels?'estimated-levels':'estimated-use';
  const explicitBase=metres(tags.min_height);
  let baseHeight=explicitBase??minLevel*floorHeight;
  let baseHeightEvidence=explicitBase!==null?'source-min-height':minLevel>0?'estimated-min-level':'assumed-ground';
  const warnings=[];
  const arcadeScale=id==='way/1528957937'?resolveEastNineArcadeScale(height,{explicitMinHeight:explicitBase,sourceMinLevel:minLevel,floorHeight}):null;
  if(arcadeScale){
    baseHeight=arcadeScale.clearHeight;baseHeightEvidence=arcadeScale.basis;
    if(explicitBase===null)warnings.push(arcadeScale.explanation);
  }
  const isRoof=tags['building:part']==='roof'||tags.building==='roof';
  if(isRoof&&explicitBase===null&&minLevel===0){
    baseHeight=Math.max(0,height-.35);baseHeightEvidence='estimated-roof-slab';
    warnings.push('Roof-only part displayed as an open 0.35 m canopy slab; thickness and clearance are display assumptions.');
  }
  if(!(height>baseHeight)){
    warnings.push('Source top/bottom tags conflict; 0.45 m display slab replaces the invalid zero/negative extrusion. Source tags remain unchanged.');
    if(sourceHeight>0){baseHeight=Math.max(0,height-.45);baseHeightEvidence='estimated-conflict-fallback';}
    else{height=baseHeight+.45;heightEvidence='estimated-conflicting-levels';}
  }
  let heightDescription=heightEvidence==='source-height'?`源 height 标签：屋顶高 ${height.toFixed(2)} m。`
    :heightEvidence==='estimated-levels'?`源楼层 ${sourceLevels} 层 × 展示假设层高 ${floorHeight} m，屋顶约 ${height.toFixed(2)} m。`
    :heightEvidence==='estimated-conflicting-levels'?`源楼层与起始层均为 ${levels}，数据冲突；仅以 ${baseHeight.toFixed(2)} m 高处的 0.45 m 薄板作连廊示意。`
    :`缺少楼高及楼层：按 ${kind} 用途采用 ${levels} 层 × ${floorHeight} m，屋顶约 ${height.toFixed(2)} m，属于建模估计。`;
  if(useEvidence&&heightEvidence==='estimated-use')heightDescription+=` ${useEvidence.description}`;
  if(minLevel>0&&heightEvidence!=='estimated-conflicting-levels')heightDescription+=arcadeScale&&explicitBase===null
    ?` 源起始层 ${minLevel} 保留；其通用层高换算与正面照片冲突，弧廊按照片约36%总高估计净空 ${baseHeight.toFixed(2)} m，上部保留三排正常层高窗带。`
    :` 源起始层 ${minLevel}，底面高度约 ${baseHeight.toFixed(2)} m。`;
  const isPart=Boolean(properties.isBuildingPart||(tags['building:part']&&tags['building:part']!=='no'));
  const effectiveFloorHeight=sourceHeight>0&&sourceLevels?sourceHeight/sourceLevels:floorHeight;
  const pitchedRoof=['way/110398525','way/110398519','way/110398543'].includes(id);
  if(pitchedRoof)heightDescription=heightDescription.replace(/屋顶(?:约|高)\s*[\d.]+\s*m/,`主体檐口约 ${height.toFixed(2)} m`)+` 斜屋顶脊约 ${(height+1.25).toFixed(2)} m（起拱 1.25 m 为估计）；斜屋面形式见 2022 年公开工程答疑。`;
  // Unidentified dormitory photos do not establish a balcony, stair tower or
  // entrance on every dorm. Plain openings preserve scale without false detail.
  const facadeStyle=landmark?.id??(kind==='dormitory'?'plain-dorm':kind==='dining'?'open-canteen':kind==='research'?'laboratory':kind);
  const facadeFeatures={balconies:false,stairTower:false,inferredEntrance:kind!=='dormitory',airConditioners:true,...landmark?.facadeFeatures};
  const roofRise=pitchedRoof?1.25:landmark?.roofRise??0,roofForm=pitchedRoof?'pitched':landmark?.roofForm??'flat';
  if(landmark?.roofRise)heightDescription+=landmark.id==='yunyuan-five'?` 源楼层与街景可见层数存在差异，保留源5层；圆拱女儿墙最高约 ${(height+roofRise).toFixed(2)} m，尺寸为估计。`:landmark.id==='yunyuan-canteen'?` 按本地街景估计两层主体檐高 ${height.toFixed(2)} m，主门塔薄壳雨盖最高约 ${(height+roofRise).toFixed(2)} m；弧线与尺寸非实测。`:` 实拍可见低坡斜屋顶；屋脊展示最高约 ${(height+roofRise).toFixed(2)} m，起坡 ${roofRise} m 为估计。`;
  return {
    facadeStyle,facadeFeatures,landmarkId:landmark?.id??null,landmarkEvidence:landmark?{observed:landmark.observed,uncertainty:landmark.uncertainty,sourceUrl:landmark.sourceUrl,photos:landmark.photos}:null,
    roofForm,roofRise,roofRidgeHeight:height+roofRise,
    roofSourceUrl:pitchedRoof?'https://www.hbbidcloud.cn/hubei/jyxx/004003/004003006/20220308/8039081a-036f-43b9-afff-686d5635eb3f.html':landmark?.roofRise?landmark.sourceUrl:null,
    roofEvidence:pitchedRoof?'2022 public works clarification confirms sloping roofs at Yunyuan 14/18/23; pitch, material and ridge inferred':landmark?.id==='yunyuan-five'?'Local street photograph and identified school photograph support the arched parapet; source 5 floors retained despite visible-floor conflict':landmark?.id==='yunyuan-canteen'?'Local street photographs show curved cornices and a thin butterfly canopy; silhouette dimensions and hidden roof surface are estimated':landmark?.roofRise?'2025 school photograph confirms low sloping roofs and deep eaves; rise and exact pitches estimated':'not surveyed',
    facadeEvidence:landmark?`${landmark.observed} ${landmark.uncertainty}`:'Generic display openings; individual facade not verified. No automatic dorm balcony or stair-tower assignment.',
    height,baseHeight,extrusionHeight:height-baseHeight,levels,sourceLevels,minLevel,isRoof,arcadeScale,
    occupiedLevels:Math.max(0,levels-minLevel),floorHeight:effectiveFloorHeight,kind,type:kind,isPart,useEvidence,
    parentOutlineId:PART_PARENT.get(id)??null,
    wallColor:sourceColor(tags['building:colour'],preset.wallColor),roofColor:sourceColor(tags['roof:colour'],preset.roofColor),
    windowColor:preset.windowColor,facadeModuleWidth:preset.facadeModuleWidth,windowSpacing:preset.facadeModuleWidth,
    windowWidth:preset.windowWidth??Math.min(2.4,preset.facadeModuleWidth*.55),windowHeight:preset.windowHeight??Math.min(2.2,effectiveFloorHeight*.48),
    heightEvidence,heightSource:heightEvidence,heightDescription,baseHeightEvidence,
    levelsEvidence:sourceLevels?'source-levels':'estimated-use',estimated:heightEvidence!=='source-height'||baseHeightEvidence.startsWith('estimated-'),
    materialEvidence:tags['building:colour']||tags['roof:colour']?'mixed-source-and-display-palette':'display-palette',
    sourceUrl:properties.sourceUrl??null,warnings,
  };
}

const ROAD_WIDTHS=Object.freeze({motorway:12,trunk:10.5,trunk_link:6.5,primary:10,primary_link:6.5,secondary:8,secondary_link:6.5,tertiary:7,tertiary_link:5.5,unclassified:6,residential:6,service:4.5,living_street:5,pedestrian:6,cycleway:3,footway:2.4,path:1.8,steps:2,track:3,road:5});
/** Width and bridge/underpass elevation are visual assumptions unless a width
 * or min_height tag supplies metres. `layer` alone is not a surveyed height.
 */
export function getRoadProfile(feature) {
  const {properties,tags}=fields(feature),kind=String(tags.highway??'road');
  const campusBridge=getCampusBridgeProfile(feature);
  const lakesideApproach=String(feature?.id)==='way/97080595';
  const motor=!['footway','path','steps','pedestrian','cycleway','track'].includes(kind);
  const lanes=positive(tags.lanes),sourceWidth=sourcedDimension(properties,tags,'width');
  let width=sourceWidth>0?sourceWidth:lanes&&motor?lanes*3.25+.5:ROAD_WIDTHS[kind]??5;
  let evidence=sourceWidth>0?'source-width':lanes&&motor?'estimated-lanes':'estimated-road-class';
  if(!(sourceWidth>0)&&!lanes&&tags.service==='parking_aisle')width=4.2;
  if(!(sourceWidth>0)&&!lanes&&tags.service==='alley')width=3.3;
  if(campusBridge&&!(sourceWidth>0)){width=campusBridge.width;evidence='estimated-photo-cross-section';}
  if(lakesideApproach&&!(sourceWidth>0)){width=10;evidence='estimated-photo-lakeside-road';}
  const bridge=Boolean(tags.bridge&&tags.bridge!=='no'),tunnel=Boolean(tags.tunnel&&tags.tunnel!=='no');
  const layer=Number.isFinite(Number(tags.layer))?Number(tags.layer):0;
  const explicitElevation=metres(tags.min_height);
  let elevation=bridge?(explicitElevation??Math.max(1,layer)*5.5):tunnel?-Math.max(1,Math.abs(layer))*4.5:layer*4.5;
  let elevationEvidence=bridge&&explicitElevation!==null?'source-min-height':bridge||tunnel||layer?'estimated-layer':'assumed-level-ground';
  // A passage beneath a building/entrance beam is not a subterranean tunnel.
  // Keep the shared surface datum unless the road actually carries a height or
  // an explicit non-ground level/layer. The east gate is tagged this way.
  if(!bridge&&tags.tunnel==='building_passage'){
    if(explicitElevation!==null){elevation=explicitElevation;elevationEvidence='source-min-height';}
    else if(layer===0&&(!tags.level||Number(tags.level)===0)){elevation=0;elevationEvidence='assumed-level-ground';}
  }
  if(campusBridge&&explicitElevation===null){elevation=campusBridge.elevation;elevationEvidence=campusBridge.elevationEvidence;}
  const color=['footway','path','pedestrian','steps'].includes(kind)?'#b8b7aa':kind==='cycleway'?'#839d95':['unpaved','dirt','compacted'].includes(tags.surface)?'#aaa18a':'#727b7d';
  const description=evidence==='estimated-photo-lakeside-road'?'校方东九湖畔实拍显示双向道路及外侧骑行空间；展示宽度 10 m 为照片尺度估计，非测量。':evidence==='estimated-photo-cross-section'?campusBridge.description:evidence==='source-width'?`源 width 标签 ${width.toFixed(2)} m。`
    :evidence==='estimated-lanes'?`源车道数 ${lanes}；按每车道 3.25 m 加 0.5 m 边缘余量，展示宽度 ${width.toFixed(2)} m。`
    :`源道路类别 ${kind}；展示宽度 ${width.toFixed(2)} m，属于建模估计。`;
  return {width,kind,type:kind,evidence,widthSource:evidence,description,bridge,tunnel,layer,elevation,elevationEvidence,color,
    campusBridge,reserveMotorCenter:lakesideApproach||!!campusBridge&&campusBridge.role!=='sidewalk',cycleBandWidth:lakesideApproach?2:campusBridge&&campusBridge.role!=='sidewalk'?2.6:null,
    estimated:evidence!=='source-width'||!['source-min-height','assumed-level-ground'].includes(elevationEvidence),
    lanes,oneway:tags.oneway==='yes'||tags.oneway==='1'||tags.oneway==='-1',motor,
    sourceUrl:properties.sourceUrl??null,
    elevationDescription:campusBridge?campusBridge.elevationDescription:elevation===0?'使用共同地面显示基准，未提供DEM。':`源 bridge/tunnel/layer 仅确定层次；展示高程 ${elevation.toFixed(1)} m${elevationEvidence==='source-min-height'?' 来自 min_height。':' 为估计，非测量高程。'}`,
  };
}

/** Available group members only, so a later/partial data file is safe to load. */
export function getBuildingPartGroups(featureCollection) {
  const features=Array.isArray(featureCollection)?featureCollection:featureCollection?.features??[];
  const ids=new Set(features.map(f=>fields(f).id));
  return PART_GROUPS.filter(g=>ids.has(g.outlineId)).map(g=>({outlineId:g.outlineId,partIds:g.partIds.filter(id=>ids.has(id)),kind:g.kind,
    associationEvidence:'geometric-containment',description:'Source part vertices lie within the outline; association is geometric, not an explicit OSM parent relation.'})).filter(g=>g.partIds.length);
}
