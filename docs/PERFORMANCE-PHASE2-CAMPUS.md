# 第二阶段校园构建与装饰驻留

本次不移动源地图，不改变楼体/门洞/桥/行走支撑面，也不更改蛛丝锚点规则。`survey.js` 由主集成接入；本说明聚焦校园构建、植被和实例缓冲。

## 运行接口

- `createCampus3DProgressive(THREE, model, {frame, geoToLocal}, {initialPosition, getPosition, signal, yieldTask, onProgress})`：基础世界与出生区准备好即返回。所有碰撞、光电三门、桥护栏、步道和前场保留位置已经完整，远处通用立面、森林、景石外观、东九前场人物/植物及水生植物随后补齐。出生点取 `getCampusPlayerSpawn(model)`，`getPosition` 返回玩家 `{x,z}`；后台近区优先随玩家移动重新排序。
- `campus.whenDetailedReady`：完成时 resolve `{cancelled:false}`；取消时 resolve `{cancelled:true}`；异步细节异常 resolve `{cancelled:false,error}`。调用端应显示细节状态并记录 error，不把可玩交接误作全细节完成。
- `campus.releaseDecorativeResources()`：暂停通用立面及森林各 LOD 的实例 GPU 缓冲。后台此时晚完成的森林继承暂停状态。
- `campus.resumeDecorativeResources()`：返回校园后允许下一次 `update(camera, budget)` 按当前机位恢复，先前位置不会变动。重复释放/恢复不会累积网格。
- `campus.decorationStats`：每批源实例数、如果全容量驻留所需的矩阵/颜色字节、当前矩阵/颜色字节、分配/回收次数。此数不是整个场景显存；共享几何、纹理、基础楼体、CPU 源矩阵不计入。
- `createCampus3D()` / `createCampus3DAsync()` 默认仍完整构建。`update(null)` 显式恢复导出全细节，绕过之前的视锥、画质与前台暂停缓存；导出结束后正常 `update(camera, budget)` 恢复运行预算。

## 实现边界

实例批次按当前空间候选/可见实例分配容量，容量上取 2 的幂且不超过源数量；空批次和过大容量在 1.5 秒滞回后释放或缩小。更换朝向不会立即反复销毁资源。轻量源矩阵、源 ID、共享几何/材质仍保留以重建与导出，不能将本实现描述为全校园几何/纹理分块下载或彻底卸载。

森林/路侧树可见性先查包含整棵树包围球的静态分区，再做原来的精确视锥、距离及 LOD 滞回判定。分区候选保留源顺序，未改变密度和分档距离。沿路树的动态/静态更新均接收画质距离预算。

基础逻辑仍需先完整构建。公共材质/铺装/景石纹理按像素行分片；种植规划按源覆盖范围与采样块、路缘按路段、树冠和绿篱按形态分片。东九地面纯逻辑、专用建筑等仍包含同步阶段，不保证每个任务都不超过 6 ms。首帧与可操作耗时、跨区长帧需由浏览器报告判断，不能用 Node 构建时间冒充。

## 验证与复跑

```sh
node --test tests/campus-staged-resources.test.mjs tests/resident-instance-batch.test.mjs tests/commute-render-cache.test.mjs tests/vegetation-lod-hysteresis.test.mjs
node --test tests/campus-progressive-build.test.mjs tests/campus-staged-build.test.mjs tests/campus-landcover.test.mjs
node scripts/verify-campus-plan-equivalence.mjs
node scripts/profile-campus-stages.mjs
node scripts/benchmark-campus-phase2.mjs
```

- 渐进交接时完整碰撞/步道/光电入口/桥结构/前场保留区与同步构建逐项等价。
- 全细节后几何属性、索引、实例变换/颜色、构建计数与同步导出等价；源数据不变。
- 森林驻留版与原全容量版逐机位、逐预算比对所有有效实例矩阵和源 ID。
- 分区边界跨出的树冠、资源缩小、前台暂停、晚完成安装、恢复、导出、取消均有专门测试。
- 最终基准从 Git `a432493` 导出独立只读 `src` 基线（含同期新照片建筑），双方使用同一地图，同进程暖机后交替旧/新执行相同机位序列，报告写入 `artifacts/performance-phase2-2026-10-30/campus-cpu-residency.json`。7800 棵规则树为可复现分类样本，不冒充真实校园植被空间分布。首屏部分使用真实源数据，单列可玩交接和细节完成；不包含网络、呈现和玩家模型建立。

最终 A/B 避开 Unity 编译及其他团队浏览器压力，2026-10-30 在 macOS arm64 / Node v25.9.0 同进程完成：

| 测量 | 基线 | 新实现 | 范围 |
| --- | ---: | ---: | --- |
| 真实校园构建中位数 | 1,210 ms 完整构建 | 689 ms 可玩交接，1,043 ms 细节完成 | 3 轮；交接减少 43.1%；不含网络/呈现/人物建立 |
| 7800 树 × 96 机位分类中位数 | 19.86 ms | 17.97 ms 空间筛选，18.53 ms 含驻留 | 暖机后交替 8 轮；分别减少 9.5% / 6.7%，不是 FPS |
| 出生机位 61 批目标装饰矩阵/颜色容量 | 37,490,048 B | 5,349,840 B；暂停为 0 | 减少 85.7%；CPU 源数据/共享几何/纹理保留 |
| 新构建最大任务 | — | 83 / 83 / 125 ms | 保留第三轮 125 ms，不能宣称完全消除长任务 |

之前定位中前场组合任务约 380 ms、公共材质约 140 ms；已拆片的纹理像素及完整几何、种植/草坪/水生植物位置与基线逐项相等。`source-plan-equivalence.json` 对照 `a120315` 的具体生成函数（使用当前源地图）验证，仅用于证明本轮规划/材质算法未改造型；正式性能基线是 `a432493`。

原始试次、环境说明和真实限制随报告保留。不将 Node 构建、分类 CPU 或实例字节变化称为浏览器首帧/FPS 收益。硬件手机热稳定与真实 GPU 驱动峰值仍以整体验收报告为准。
