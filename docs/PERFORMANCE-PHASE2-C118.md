# C118 与室外活动效果：第二阶段验收

2026-10-30。本记录对应 `deployment/performance-phase2-20261030`，仅本地隔离环境；没有部署或改写生产活动数据。

## 已实现

- C118 采用共享 `render-cadence`：手机、流畅档和无洪水的沉浸观影按 30 Hz 提交绘制，其余上限 60 Hz。步行、游泳、活动时钟、输入和相机仍按活跃 RAF 更新，不因限绘制速度改变玩法速度。主动暂停、隐藏、页面恢复和 context 恢复不会把空白间隔当成长帧。
- 每次实际绘制累计此前被跳过的 RAF CPU 工作；短窗指标与有界会话报告分别提供。`?diagnostics=1&gpu=1` 才启用非阻塞 WebGL2 GPU 查询，context 恢复重置查询，退出释放；普通观众不运行 GPU 查询。
- `c118-resource-scope` 逆序释放已成功创建的资源，单个清理失败不阻止后续清理。视频构造期间发生异常也会撤销媒体和监听器。初始化／绘制失败保留真实返回入口，销毁运行时，不把失败页面视作体验成功。
- `live-experience` 进入其他作品时释放校园室外洪水资源；低档同时通过 `onRuntimeBudgetChange` 请求校园装饰释放。返回时恢复到当前活动时钟。回调 `foreground` 指校园是否在前台，未销毁校园 renderer 或改变参与者位置。
- 开发期间主分支新增了新版 Bezier 卷浪、背面水体、instanced 喷雾、水面解析梯度及雾效；已完整合入，没有退回旧外观。本轮在其上加入包含卷浪、边缘、弹道喷雾和 billboard 角点的保守包围范围，并接入门户资源回收。原有 desktop/mobile/low 画质预算保持不变；停止事件保留已构建资源供重启复用，进入作品时明确释放。

## 实际浏览器验收

命令：`node scripts/verify-c118-browser.mjs`。

使用安装的 Google Chrome headless、1280×720、DPR 1、Node 24、当前生产 `dist`，临时本地活动服务及临时数据目录。通过既有 `?place=opto-east` 导览入口，实际按 W 穿越门槛；没有修改内部玩家坐标。根代理的其他作品功能浏览器部分时间并行，因此本轮不是安静条件 CPU/GPU A/B。

- 实际完成 **20 轮** 校园 → C118 → 校园；每轮退出后已登记资源所有者为 **0**，`video/audio` 为 **0**，校园 iframe 为 **0**，主 canvas 解除 inert。
- 首轮实际选座并播放电影，检查视频时间推进；沉浸观影目标绘制频率为 30 Hz，起身和移动正常。
- 实际 `WEBGL_lose_context` 丢失和恢复成功。
- 第 20 轮通过认证控制端 API 开启洪水，验证流畅／清晰两档、下潜到水下 3 米、暂停时钟不推进、恢复和重置。相关截图均已目视检查。
- 第 21 次进入故意让实际 WebGL draw 抛异常；状态显示 failed、资源和媒体清零，实际返回按钮仍成功回到校园。
- **0 个 pageerror**。两条 console 404 经短测定位均为 `/favicon.ico`，没有电影、模型或着色器资源错误。
- 每轮返回后显式执行 GC 再采样的 JS heap：第 1 轮 222.697 MB，第 20 轮 224.395 MB；第 3–20 轮范围 223.693–225.645 MB，没有随轮数单调上升。这是浏览器 JS heap，不能当作 VRAM 或普通无 GC 条件的内存承诺。

原始记录：`artifacts/performance-phase2/c118/browser/report.json`、`browser-run.log` 和 `browser/*.png`。

新增 GPU 接口后另外执行 `node scripts/verify-c118-browser.mjs --quick-gpu`，重复一次观影、context 恢复、洪水低高档、水下、退出与故障返回。全部通过。计时扩展确实支持并产生样本，disjoint 为 0。该短测样本混有干燥／洪水阶段且不同画质绘制节奏不同，不用其累计分位数声称低档 GPU 提升。

## 自动回归与复现

```sh
npm run build
node --test tests/campus-effect-budget.test.mjs tests/campus-floodwater.test.mjs tests/campus-tsunami.test.mjs tests/c118-*.test.mjs tests/opto-c118-interior.test.mjs
node scripts/benchmark-campus-effects.mjs
node scripts/verify-c118-browser.mjs
```

合并新版室外效果后，定向合集 **114/114** 通过（`artifacts/performance-phase2/c118/behavior-tests-merged.log`）。包含 30/60 Hz 绘制对同一游泳输入轨迹的一致性、主动 30 Hz 不触发错误降档、构造失败清理、新 Bezier 曲面／背面／弹道喷雾及 billboard 角点的包围范围、所有画质相同水位和时间、重复释放／重建。合并后再次执行 GPU 快速真实浏览器流程，仍全部通过，记录于 `browser-gpu-merged.log` 和 `browser-gpu/report.json`。

`benchmark-campus-effects.mjs` 固定 Three.js、同一活动第 25 秒、相同相机裁剪前统计，输出最新外观 baseline `a432493` 与各档 typed-array 容量／几何数量，计入 instanced 喷雾与透明面 pass。它不测显存、GPU 耗时或帧率收益。下列画质预算来自已合入的主分支，不能再次算作本轮新增收益；进入作品后效果已持有的几何／材质／typed array 数量降到 0 是本轮生命周期增量。

| 档位 | typed-array 容量 | 几何三角形（含喷雾实例） | 喷雾实例 | draw calls |
| --- | ---: | ---: | ---: | ---: |
| desktop（清晰／桌面均衡） | 1,890,972 B | 114,224 | 2,200 | 9 |
| mobile（移动设备均衡） | 953,180 B | 57,216 | 960 | 9 |
| low（流畅） | 483,484 B | 29,040 | 440 | 9 |

实际浏览器另执行 `node scripts/verify-campus-flood-browser.mjs`：新版室外巨浪的流畅、清晰档均已显示并截图；相同站位的水下采样均为 6.46 米，水下雾效呈现，重置后遮罩消失。0 pageerror、0 着色器错误，仅 favicon 404。四张截图均已目视检查。记录位于 `artifacts/performance-phase2/c118/exterior-browser/`。

## 实际边界

- 未以真手机连续运行 30 分钟测热降频，桌面 Chrome 不能替代手机热测试。
- 保守裁剪针对可见性正确性；未将大水面拆成空间分块，也未保证室外洪水只消耗视野内片元。
- 已登记 owner 的清理有回归保护；一个工厂在返回 owner 前抛异常时仍需自身回收内部部分创建资源，视频工厂已补齐此路径。
- 未改变室内门口拓扑、游泳物理、电影镜头或主持人活动语义。
