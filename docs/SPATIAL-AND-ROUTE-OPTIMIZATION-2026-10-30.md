# 建筑查询、植被切换与路线回归

此轮不修改 GeoJSON、坐标、碰撞形状、移动速度或 120 Hz 固定物理步长；蛛丝仍须玩家主动松手后再次挂接。

## 共享建筑索引

`src/building-spatial-index.js` 为静态建筑建立 32 m XZ 网格；步行/飞行碰撞、镜头射线、蛛丝候选和遮挡复用同一个索引。它仅筛选可能相交的建筑，原多边形、内院、高度、扫掠判定保持不变，返回顺序与原建筑数组一致。超长查询回退为边界扫描，巨型建筑另存，避免遍历无限网格。

缓存按建筑数组身份弱引用。地图重建必须创建新数组；若未来有原地编辑建筑轮廓的功能，编辑后调用 `invalidateBuildingSpatialIndex(buildings)`。目前地图为静态，未新增每帧维护成本。

`spatial-benchmark.json` 记录同一 Node 进程前后交替测量、五处真实校园位置、每处 240 帧/查询、七轮中位数以及结果哈希。初轮：步行 CPU -22.9%、飞行 -33.5%、蜘蛛侠 -30.8%、镜头 -72.0%、蛛丝线遮挡 -67.1%；平均射线候选由 325 栋缩至 2.30 栋。各模式前后状态哈希一致。此结果是本机 Node CPU 查询基准，没有 GPU、绘制、NPC 交通或低配手机，不代表 FPS 改善百分比。若复测覆盖 JSON，以该文件实际数值为准。

## 植被距离滞回

树冠与灌木每个实例保存单一距离档位。越过当前边界 10% 才换档，防止镜头在阈值附近摇晃时反复切换；快速跨越多个档位可立即追上。不会同时绘制两个或三个树冠。视锥规则、植被源数量和位置不变。

质量距离系数变化立即清空档位历史，按新预算重选；全细节导出 `update(null)` 同样清空历史并显示全量近景。允许的 10% 距离带会略多保留一些近景实例，未以双层混合方式放大绘制数量。相关测试覆盖树 100/280 m 和灌木 65/260 m 边界往返、快速跨档、静止镜头改画质、导出后恢复。

## 固定路线矩阵

`scripts/verify-campus-route-matrix.mjs` 使用当前完整渲染模型生成的建筑、桥墩、栏杆、门廊和步行表面。17 段包括学生食堂三组台阶往返、店廊上下层、CBD 三条源道路、喻岱桥车行面及两侧步道、高架桥墩旁、东九台阶与柱廊、光电楼三条 C118 入口路径。

每段以 20/30/60 Hz 输入分别运行正常帧和混入 100/250 ms 的帧序列，共 102 项；结果全部通过，阻挡帧为零。普通终点误差小于 0.14 m；入口场景检查实际内门触发 ID 及返回位置安全，不将触发门视为室内加载成功。

这是分段 CPU 步行回放：每段独立出生，段内不传送位置；转角松开控制。未假设不同区域可任意直连，也未声称覆盖 NPC 交通、所有载具、真实浏览器或完整人工游玩路线。回归未发现需修改运动逻辑的问题。

复跑命令（项目根目录）：

```sh
node scripts/verify-campus-route-matrix.mjs
node --test tests/campus-route-matrix.test.mjs tests/vegetation-lod-hysteresis.test.mjs tests/static-instance-lod.test.mjs
node --test tests/building-spatial-index.test.mjs
SPATIAL_BASELINE="$PWD/artifacts/optimization-2026-10-30/spatial-baseline" node scripts/benchmark-building-queries.mjs
```

报告保存在 `artifacts/optimization-2026-10-30/spatial-*`。定向路线/LOD 测试 7 项通过，先前植被/土地覆盖组合 20 项通过；测试组有重叠，不相加。建筑等价、相关运动/镜头/蛛丝和真实校园通行测试结果分别见 `spatial-equivalence.log`、`spatial-regression.log`、`spatial-campus-regression.log`。
