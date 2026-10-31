# 通往光电楼沿线的场景载具

沿启明路南段、南端横向道路、湖溪路和光电楼北侧连接路新增 6 个可使用的停放载具：3 辆电动车、1 辆喷气跑车、2 架飞行器。靠近后按 F 使用，落地停稳后 F 下车。它们是游戏活动摆放，不表示真实校园有这些车位或飞行器。

## 分布与接入

`src/opto-road-transport.js` 依据 `way/98831423`、`way/98831435`、`way/98831408`、`way/1483567206` 做有界路边搜索，返回固定 ID、来源、位置、可步行接近的位置和上车位置。避开完整道路/人行道宽度、桥、水域、入口、台阶、建筑及实际植被；不改原始 GeoJSON。

`src/survey.js` 传入本次实际生成的树/灌木列表，只在创建交通层时规划。`src/commute-experience.js` 将 3 辆电动车作为活动停车接入 `commute-scene.js` 的实例批次与既有 F 交互；另外 3 个载具在 `world-transport.js` 的原始 21 个道具之后追加。所有旧 ID 和位置保持，仍只有 1 架原韵苑草坪直升机。新增载具不增加在线观众，也不需要后台同步位置。

新增电动车沿用独立地面高度和 180 m × 画质比例的距离隐藏，跑车/飞行器沿用原有 220 m 隐藏和按材质合并的共享静态模型。没有新增模型下载、贴图或灯光；少量可见载具仍有绘制开销，不代表实体手机帧率保证。

## 验证

`tests/opto-road-transport.test.mjs` 检查真实源道路、完整重建校园、植被净空、可到达的上下车位置和安全降级；`tests/opto-road-transport-integration.test.mjs` 验证实际停车与世界载具接入、原 21 个道具保持、每个新增载具的真实适配器上下车、共享几何与远距剔除。

浏览器验收使用隔离生产构建和临时活动数据：

```sh
node scripts/verify-opto-transport-browser.mjs --root . --output artifacts/opto-road-transport-20261031/browser-desktop
node scripts/verify-opto-transport-browser.mjs --root . --output artifacts/opto-road-transport-20261031/browser-mobile --profile mobile
```

手机横屏项是桌面 Chrome 触控视口模拟，不能代替实体手机性能测试。验收脚本的临时诊断接口不发布到网站。

本轮结果：相关回归 268 项通过、0 失败；补充的两架飞行器原位升高超过 2 m、降落并下车检查也通过。最终桌面、手机横屏模拟均完成六处步行视角截图，三种载具各两次真实按键取还、移动、飞行器起落、停车去重与远距隐藏，页面错误 0，原有 20 名支线行人/骑手和 5 个空中/湖面 NPC 保留。生产构建、路由与 93 项作品资源校验通过。记录为 `tests.txt`、`flight-integration-tests.txt`、`final-desktop/`、`final-mobile/` 和 `build.txt`。

首次浏览器起飞断言使用固定 750 ms 按键，在低帧率和旋翼启动期间升高不足；改为持续按 Q 并等待实际升高超过 0.35 m（上限 8 秒）后通过，没有降低高度断言或改变游戏飞行物理。
