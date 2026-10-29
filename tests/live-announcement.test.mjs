import test from 'node:test';
import assert from 'node:assert/strict';
import {mountAnnouncementNotice} from '../src/live-announcement.js';

const notice = (extra = {}) => ({id:'notice-1', title:'集合通知', body:'前往图书馆', tone:'info', ...extra});
function fixture() {
  let time = 0, serial = 0, dismissals = 0;
  const timers = new Map(), nodes = new Map();
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
    onDismiss:() => dismissals++,
  });
  return {element, controller, close:nodes.get('.live-announcement-close'), nodes, timers,
    get dismissals() { return dismissals; },
    advance(ms) {
      time += ms;
      for (const [id, task] of [...timers]) if (task.at <= time) {timers.delete(id);task.fn();}
    },
  };
}

test('each viewer gets five seconds before the close button works, without auto-dismissal', () => {
  const f = fixture(); f.controller.update(notice({startAt:1}));
  assert.equal(f.element.hidden, false); assert.equal(f.close.hidden, true);
  f.close.click(); assert.equal(f.element.hidden, false);
  f.advance(4999); assert.equal(f.close.hidden, true);
  f.advance(1); assert.equal(f.close.hidden, false); assert.equal(f.close.disabled, false);
  f.advance(30000); assert.equal(f.element.hidden, false);
  f.close.click(); assert.equal(f.element.hidden, true); assert.equal(f.dismissals, 1);
});

test('repeated state updates neither restart the delay nor reopen a dismissed notice', () => {
  const f = fixture(); f.controller.update(notice()); f.advance(3000);
  f.controller.update({...notice()}); f.advance(2000); assert.equal(f.close.hidden, false);
  f.close.click(); f.controller.update({...notice()}); assert.equal(f.element.hidden, true);
  f.controller.update(null); f.controller.update(notice()); assert.equal(f.element.hidden, true);
});

test('new announcements and content edits show again with their own full delay', () => {
  const f = fixture(); f.controller.update(notice()); f.advance(5000); f.close.click();
  f.controller.update(notice({body:'改到食堂集合'})); assert.equal(f.element.hidden, false); assert.equal(f.close.hidden, true);
  f.advance(4000); f.controller.update(notice({id:'notice-2'}));
  f.advance(1000); assert.equal(f.close.hidden, true);
  f.advance(4000); assert.equal(f.close.hidden, false);
});

test('dismissing an announcement does not affect another viewer or mutate shared data', () => {
  const a = fixture(), b = fixture(), shared = Object.freeze(notice());
  a.controller.update(shared); b.controller.update(shared); a.advance(5000); b.advance(5000);
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
