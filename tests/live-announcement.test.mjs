import test from 'node:test';
import assert from 'node:assert/strict';
import {mountAnnouncementNotice} from '../src/live-announcement.js';

const notice = (extra = {}) => ({id:'notice-1', title:'集合通知', body:'前往图书馆', tone:'info', ...extra});
function fixture() {
  let time = 0, serial = 0, dismissals = 0;
  const timers = new Map(), nodes = new Map(), dismissalReasons = [];
  const element = {hidden:true, dataset:{}, querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden:true, disabled:true, textContent:'', events:new Map(),
      addEventListener(type, fn) { this.events.set(type, fn); },
      removeEventListener(type) { this.events.delete(type); },
      click() { this.events.get('click')?.({stopPropagation(){}}); },
    });
    return nodes.get(selector);
  }};
  const controller = mountAnnouncementNotice(element, {
    now:() => time,
    schedule:(fn, delay) => { const id = ++serial; timers.set(id, {fn, at:time+delay}); return id; },
    cancel:id => timers.delete(id),
    onDismiss:reason => { dismissals++; dismissalReasons.push(reason); },
  });
  return {element, controller, close:nodes.get('.live-announcement-close'), nodes, timers, dismissalReasons,
    get dismissals() { return dismissals; },
    advance(ms) {
      time += ms;
      for (const [id, task] of [...timers]) if (task.at <= time) {timers.delete(id);task.fn();}
    },
  };
}

test('the close button is immediately available and an untouched notice expires at six seconds', () => {
  const f = fixture(); f.controller.update(notice({startAt:1}));
  assert.equal(f.element.hidden, false); assert.equal(f.close.hidden, false); assert.equal(f.close.disabled, false);
  f.advance(5999); assert.equal(f.element.hidden, false);
  f.advance(1); assert.equal(f.element.hidden, true); assert.equal(f.dismissals, 1);
  assert.equal(f.close.hidden, true); assert.equal(f.close.disabled, true); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.dismissalReasons, [{automatic:true,hadFocus:false}]);
  f.advance(30000); f.close.click(); assert.equal(f.dismissals, 1);
});

test('immediate manual close cancels automatic expiry and does not reopen on refresh', () => {
  const f = fixture(); f.controller.update(notice()); f.close.click();
  assert.equal(f.element.hidden, true); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.dismissalReasons, [{automatic:false,hadFocus:false}]);
  f.controller.update({...notice()}); f.advance(6000);
  assert.equal(f.element.hidden, true); assert.equal(f.dismissals, 1);
});

test('state refreshes do not extend six seconds or reopen an automatically expired notice', () => {
  const f = fixture(), value = Object.freeze(notice());
  f.controller.update(value); f.advance(3000); f.controller.update({...value});
  f.advance(2999); assert.equal(f.element.hidden, false);
  f.controller.update({...value}); f.advance(1); assert.equal(f.element.hidden, true);
  f.controller.update({...value}); f.controller.update(null); f.controller.update({...value});
  assert.equal(f.element.hidden, true); assert.equal(f.timers.size, 0); assert.equal(f.dismissals, 1);
  assert.deepEqual(value, notice());
});

test('focus inside the notice is captured before hiding can clear it', () => {
  const f = fixture(); f.controller.update(notice());
  f.element.ownerDocument = {activeElement:f.close};
  f.element.contains = node => node === f.close;
  let hidden = false;
  Object.defineProperty(f.element, 'hidden', {
    get:() => hidden,
    set:value => { hidden = value; if (value) f.element.ownerDocument.activeElement = null; },
  });
  f.advance(6000);
  assert.equal(f.element.ownerDocument.activeElement, null);
  assert.deepEqual(f.dismissalReasons, [{automatic:true,hadFocus:true}]);
});

test('edits and new ids replace the old expiry with a full six-second reading period', () => {
  const f = fixture(); f.controller.update(notice()); f.advance(5500);
  f.controller.update(notice({body:'改到食堂集合'}));
  f.advance(500); assert.equal(f.element.hidden, false);
  f.advance(5499); assert.equal(f.element.hidden, false);
  f.advance(1); assert.equal(f.element.hidden, true);
  f.controller.update(notice({id:'notice-2'})); f.advance(5999); assert.equal(f.element.hidden, false);
  f.advance(1); assert.equal(f.element.hidden, true); assert.equal(f.dismissals, 2);
});

test('a delayed timer expires immediately and viewer timers remain independent', () => {
  const a = fixture(), b = fixture(), shared = Object.freeze(notice());
  a.controller.update(shared); b.controller.update(shared);
  a.advance(30000); assert.equal(a.element.hidden, true); assert.equal(a.timers.size, 0);
  b.advance(5999); assert.equal(b.element.hidden, false);
  b.advance(1); assert.equal(b.element.hidden, true);
  assert.equal(a.dismissals, 1); assert.equal(b.dismissals, 1); assert.deepEqual(shared, notice());
});

test('repeated state updates neither restart the delay nor reopen a dismissed notice', () => {
  const f = fixture(); f.controller.update(notice()); f.advance(3000);
  f.controller.update({...notice()}); f.advance(2000); assert.equal(f.close.hidden, false);
  f.close.click(); f.controller.update({...notice()}); assert.equal(f.element.hidden, true);
  f.controller.update(null); f.controller.update(notice()); assert.equal(f.element.hidden, true);
});

test('new announcements and content edits remain immediately dismissible', () => {
  const f = fixture(); f.controller.update(notice()); f.close.click();
  for (const next of [notice({body:'改到食堂集合'}), notice({id:'notice-2'})]) {
    f.controller.update(next); assert.equal(f.element.hidden, false); assert.equal(f.close.hidden, false);
    assert.equal(f.close.disabled, false); f.close.click(); assert.equal(f.element.hidden, true);
  }
});

test('dismissing an announcement does not affect another viewer or mutate shared data', () => {
  const a = fixture(), b = fixture(), shared = Object.freeze(notice());
  a.controller.update(shared); b.controller.update(shared);
  a.close.click(); assert.equal(a.element.hidden, true); assert.equal(b.element.hidden, false);
  assert.deepEqual(shared, notice());
});

test('withdrawal and teardown cancel pending controls; announcement content stays plain text', () => {
  const f = fixture(); f.controller.update(notice({body:'<img src=x onerror=alert(1)>'}));
  assert.equal(f.nodes.get('p').textContent, '<img src=x onerror=alert(1)>');
  f.controller.update(null); f.advance(5000); assert.equal(f.close.hidden, true); assert.equal(f.timers.size, 0);
  f.controller.update(notice({id:'new'})); f.controller.dispose(); f.advance(5000);
  assert.equal(f.timers.size, 0); assert.equal(f.close.hidden, true); assert.equal(f.close.events.size, 0);
});
