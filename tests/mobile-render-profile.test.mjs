import test from 'node:test';
import assert from 'node:assert/strict';
import { createMobileRenderProfile } from '../src/mobile-render-profile.js';
import { createTraversalResolution } from '../src/render-performance.js';

function advance(quality, milliseconds, traversing, elapsedMs = 1000 / 60) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += elapsedMs) quality.update({elapsedMs, traversing});
  return quality.ratio;
}

test('a phone keeps its render budget through orientation changes and a fine pointer fallback', () => {
  const device = {coarsePointer: true, maxTouchPoints: 5, devicePixelRatio: 3};
  const portrait = createMobileRenderProfile({...device, width: 390, height: 844});
  const landscape = createMobileRenderProfile({...device, width: 844, height: 390});
  const touchFallback = createMobileRenderProfile({...device, coarsePointer: false, width: 844, height: 390});
  assert.equal(portrait.handheld, true);
  assert.deepEqual(landscape, portrait);
  assert.deepEqual(touchFallback, portrait);
  assert.equal(landscape.shadowMapSize, 1024);
  assert.equal(landscape.reflection, false);
  assert.equal(createMobileRenderProfile({...device, width: 1024, height: 1366}).handheld, true);
});

test('a high-density phone cannot restore excess resolution after movement or a sustained stop', () => {
  const profile = createMobileRenderProfile({coarsePointer: true, width: 844, height: 390, devicePixelRatio: 3});
  const quality = createTraversalResolution({deviceRatio: profile.deviceRatio});
  assert.equal(quality.ratio, 1.25);
  assert.equal(advance(quality, 1500, true, 25), 1, 'sustained frame pressure can still lower the moving budget');
  assert.equal(advance(quality, 2000, false), 1.25, 'idle recovery respects the phone cap');
  assert.equal(advance(quality, 6000, true), 1.25, 'healthy frames cannot recover past the phone cap');
  assert.equal(advance(quality, 2000, false), 1.25);
});

test('desktop, resized mouse windows and large touch displays retain the desktop quality budget', () => {
  for (const display of [
    {width: 1920, height: 1080},
    {width: 844, height: 390},
    {maxTouchPoints: 10, width: 1280, height: 800},
    {coarsePointer: true, maxTouchPoints: 10, width: 1920, height: 1080},
  ]) {
    const profile = createMobileRenderProfile({...display, devicePixelRatio: 2});
    assert.equal(profile.handheld, false);
    assert.equal(profile.shadowMapSize, 2048);
    assert.equal(profile.reflection, true);
    const quality = createTraversalResolution({deviceRatio: profile.deviceRatio});
    assert.equal(advance(quality, 500, true), 1.25);
    assert.equal(advance(quality, 2000, false), 1.75);
  }
});

test('unknown dimensions do not misclassify the device and lower density screens are never supersampled', () => {
  for (const width of [0, -1, NaN, Infinity]) {
    assert.equal(createMobileRenderProfile({coarsePointer: true, width, height: 390}).handheld, false);
  }
  const profile = createMobileRenderProfile({coarsePointer: true, width: 844, height: 390, devicePixelRatio: .8});
  const quality = createTraversalResolution({deviceRatio: profile.deviceRatio});
  assert.equal(advance(quality, 2000, true, 25), .8);
  assert.equal(advance(quality, 2000, false), .8);
  for (const devicePixelRatio of [0, -1, NaN, Infinity]) {
    assert.equal(createMobileRenderProfile({devicePixelRatio}).deviceRatio, 1);
  }
});
