/** Photo-informed Yu-Dai bridge cross-section. Metres are display estimates,
 * not a bridge survey. The three OSM ways remain separate source records. */
export const YUDAI_BRIDGE_PROFILE=Object.freeze({
  id:'yudai-bridge',mainId:'way/1228820957',
  sidewalkIds:Object.freeze(['way/1483567144','way/1483567158']),
  approachIds:Object.freeze(['way/1228820956','way/1228820973']),
  carriagewayWidth:20,sidewalkWidth:4.4,elevation:0,deckDepth:.55,
  railingHeight:1.12,sidewalkRise:.10,
  imageUrl:'https://k.sinaimg.cn/n/spider20201211/87/w1080h607/20201211/2661-kffctca2847416.jpg/w700d1q75cms.jpg?by=cms_fixed_width',
  sourceUrl:'https://news.sina.cn/gn/2020-12-11/detail-iiznctke6018801.d.html?wm=3049_0015',
  corroborationUrl:'https://ishare.ifeng.com/c/s/7wynhK8GEgo',
  widthEvidence:'photo-and-source-sidewalk-spacing-estimate',
  elevationEvidence:'photo-continuous-bank-road-datum',
});
export function getCampusBridgeProfile(featureOrId){
  const id=typeof featureOrId==='string'?featureOrId:featureOrId?.id??featureOrId?.properties?.sourceId??featureOrId?.properties?.osmId;
  const p=YUDAI_BRIDGE_PROFILE;
  const role=id===p.mainId?'main':p.sidewalkIds.includes(id)?'sidewalk':p.approachIds.includes(id)?'approach':null;
  if(!role)return null;
  return{...p,role,width:role==='sidewalk'?p.sidewalkWidth:p.carriagewayWidth,
    renderedByMainBridge:role==='sidewalk',
    description:'校方航拍与两侧源人行道中心线共同约束的宽桥断面；20 m 车行走廊、4.4 m 步道为建模估计，并非测量。',
    elevationDescription:'桥与两岸大道平接，共用地面显示基准；不将 OSM layer=1 换算成抬升 5.5 m。未提供桥梁测量高程。'};
}
