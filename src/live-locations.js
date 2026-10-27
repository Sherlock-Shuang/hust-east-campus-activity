import { createLocalFrame, geoToLocal } from './geospatial.js';

export function createLiveMapFrame(manifest) {
  const origin = manifest.origin || manifest.suggestedLocalOrigin;
  const [longitude, latitude] = origin?.coordinates || [];
  return createLocalFrame({ longitude: origin?.longitude ?? longitude, latitude: origin?.latitude ?? latitude, coordinateSystem: 'EPSG:4326' });
}

// Locations are on/along the existing map geometry, in the same ENU frame as
// the campus. These are event placement presets, not surveyed building gates.
export function getLiveLocationPresets(fc, frame) {
  const features = new Map(fc.features.map(feature => [feature.id, feature]));
  const bounds = id => features.get(id)?.properties?.sourceGeometryBbox;
  const market = bounds('way/103814566');
  const sports = bounds('way/1023821172');
  const records = [
    { id: 'east-nine', label: '东九 B/C 前场', coordinates: [114.4218461, 30.5156001] },
    { id: 'dorm-27', label: '韵苑 27 栋北侧', coordinates: [114.42709366689655, 30.51880644016926] },
    ...(market ? [{ id: 'market', label: '教育超市外侧', coordinates: [market[0] - .00012, (market[1] + market[3]) / 2] }] : []),
    ...(sports ? [{ id: 'sports', label: '东操场', coordinates: [(sports[0] + sports[2]) / 2, (sports[1] + sports[3]) / 2] }] : []),
  ];
  return records.map(record => {
    const [longitude, latitude] = record.coordinates;
    const point = geoToLocal({ longitude, latitude, coordinateSystem: 'EPSG:4326' }, frame);
    return { ...record, x: Math.round(point.x * 100) / 100, z: Math.round(point.z * 100) / 100 };
  });
}
