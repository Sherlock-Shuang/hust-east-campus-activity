import test from 'node:test';
import assert from 'node:assert/strict';
import {controlHintParts} from '../src/control-hints.js';
test('movement keys are individual caps and descriptions remain readable text',()=>{
  const lines=controlHintParts('WASD 移动 · Shift 加速\n中键 / L 锁定 · V 切视角 · Esc 退出');
  assert.deepEqual(lines[0].filter(p=>p.key).map(p=>p.key),['W','A','S','D','Shift']);
  assert.deepEqual(lines[1].filter(p=>p.key).map(p=>p.key),['中键','L','V','Esc']);
  assert.equal(lines[0].map(p=>p.key??p.text).join(''),'WASD 移动 · Shift 加速');
  assert.deepEqual(controlHintParts('左侧拖动移动 · 右侧拖动视角'),[[{text:'左侧拖动移动 · 右侧拖动视角'}]]);
});
