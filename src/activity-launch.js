import {getTasayPortal,isTasayLinkedPortal,synchronizeActivityPortals} from './activity-catalog.js';
// One persisted portal flag controls both its gathering beacon and admission.
// Hosts can open several activities in one revision without touching the stage.
export function activitySelectionSignature(portals) {
  return JSON.stringify(portals.map(({id, enabled, startAt, endAt, url, x, z, radius}) =>
    [id, enabled, startAt, endAt, url, x, z, radius]));
}

export function selectActivitiesNow(portals, selectedIds) {
  const selected = new Set(selectedIds);
  if ([...selected].some(id => !portals.some(portal => portal.id === id))) {
    throw new Error('所选活动已被删除，请重新选择。');
  }
  const master=getTasayPortal(portals);
  if(portals.some(portal=>isTasayLinkedPortal(portal)&&selected.has(portal.id))&&(!master||!selected.has(master.id)))throw new Error('该入口随过拟合恋人开放，请选择过拟合恋人。');
  return synchronizeActivityPortals(portals.map(portal => selected.has(portal.id)
    ? {...portal, enabled: true, startAt: null, endAt: null}
    : {...portal, enabled: false}));
}
