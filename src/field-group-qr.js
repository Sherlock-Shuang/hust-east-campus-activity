import {createCampusWallPoster} from './east-nine-builders-poster.js';
import {planEastNineGroupPoster} from './east-nine-group-poster-placement.js';

export const FIELD_GROUP_QR_IMAGE='/images/activity/hust-ai-builders-group.jpg';
export const FIELD_SOURCE_ID='way/1023544717';
export const planFieldGroupQr=planEastNineGroupPoster;

// The existing QQ card now lives on East Nine's north wall. Keep the exact
// original file and its established card/quiet-zone UVs; no rooftop duplicate.
export function createFieldGroupQr(options){
  const {model,frame,geoToLocal}=options;
  return createCampusWallPoster({...options,placement:planFieldGroupQr(model,{frame,geoToLocal}),
    imagePath:FIELD_GROUP_QR_IMAGE,groupName:'east-nine-group-poster',panelName:'hust-ai-builders-group-qr',
    linkClass:'east-nine-builders-original east-nine-group-original',linkLabel:'HUST AI Builders · QQ 群原图',
    statusKey:'eastNineGroupPoster',uvRepeat:[.84,.59],uvOffset:[.08,.25]});
}
