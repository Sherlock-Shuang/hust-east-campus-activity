# 海啸演出与文明暂停

主持人仍使用原有“触发海啸／结束海啸”按钮，全场暂停继续优先。

- 光电楼室内使用独立的 2 倍速涌水节奏，不等待室外浪头：共享倒计时结束后约 0.75 秒出现门浪，约 9 秒达到高水位。水面、喷溅、浮力和状态提示共用同一室内时间。
- 室外保留原海浪间隔。第二股浪的弧形前沿抵达玩家所在位置时，本地冻结海浪、玩家和校园运动，并显示：

  > 第1036号文明在海浪中进入暂停，下一个文明的辉煌，就靠诸位了

- 右下角“继续遨游”只解除这位玩家的本地暂停，继续后追上主持人的海啸时间。同一事件继续后刷新不会再弹；新事件可以再次触发。
- 室内或作品体验期间不触发室外提示；在室外加入较晚、第二浪已经经过的观众会看到一次提示。结束海啸会清除暂停卡，不需要观众先点击继续。
- 主持人暂停期间，继续按钮不可用；不会修改主持状态或影响其他玩家。

验证：`TASAY_SOURCE=/持有源码的/ta-say node --test integration/tasay/activity-entry-ui.test.mjs tests/civilization-pause.test.mjs tests/campus-tsunami.test.mjs tests/c118-flood-effect.test.mjs tests/opto-connected-flood.test.mjs tests/c118-swimming.test.mjs tests/c118-audience-motion.test.mjs tests/c118-flood-state.test.mjs tests/c118-activity-sync.test.mjs tests/c118-activity-bridge.test.mjs`。
