# 高架桥上下层碰撞修复

## 问题与处理

光谷大道高架的 source roadSurfaces 在同一 X/Z 位置覆盖桥下道路。旧地面查询只取桥顶，未使用角色高度；中心/车轮和带半径的阻挡查询还可能在不同帧选中不同层。真实 way/1337362138 横向接近时，步行高度会从 0.14 跳到 11.14 米，电动车约升至 5.487 米并倾斜约 84 度，随后卡在桥边。相机独立存在同样的抬高问题。

- 地面查询接受 referenceY，角色、车轮、飞行器足点、蜘蛛侠及相机按当前高度选择可达支撑层。
- 默认不传 referenceY 仍是自上而下的地图查询，保持模型放置等既有接口用途。
- 高架桥面按渲染厚度注册为实体板，飞行可从桥下经过，上升受桥底限制，从上方下降落在桥面。
- 整个车辆轮廓在接近桥边时检查高度断层，避免前轮先探出导致车身竖起或俯冲。
- 桥面实体和相机查询使用空间索引，保留高空镜头的快速排除。
- 不修改源 GeoJSON、桥型/高程、原有移动按键、速度、手动换蛛丝规则或活动服务。

## 验证方法

```sh
npm run dev
node --test tests/player-bridge-layers.test.mjs tests/player-camera.test.mjs tests/player-surface-query.test.mjs tests/player-motion.test.mjs tests/web-swing-bridge.test.mjs tests/web-swing-motion.test.mjs
npm run build
```

新增回归覆盖两座真实高架下四种移动方式、飞行器撞桥底与桥顶降落、桥上车辆侧边保护、叠层桥面、镜头上下穿越及蜘蛛侠低空挂丝。旧坡道、喻岱桥、围栏、台阶、载具与摆荡测试一起复核。

本地浏览器验收页及修复前后数值保存在 `artifacts/bridge-motion-fix-2026-10-29/`；该目录不属于生产构建，不新增线上传送或调试接口。验收页使用真实校园模型与正式运动/镜头函数，按钮发送正常移动输入。
