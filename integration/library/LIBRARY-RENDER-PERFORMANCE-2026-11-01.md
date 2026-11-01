# 图书馆活动副本：渲染和书脊拾取优化

改动只通过 `library-performance.mjs` 注入活动副本。生日礼物原源码、GLB、模型材质、角色动画、碰撞、移动参数、I921/J921 映射、剧情和真实胜利条件均未改动。本轮不再次压缩或简化模型。

## 运行时改动

- 建筑 GLB 的固定局部／世界矩阵只算一次。检查到动画、骨骼、morph 或 `userData.libraryDynamic` 时拒绝冻结整个 GLB。真实文件有 762 个 glTF 节点；Three 拆分多材质 primitive 后，运行时冻结 1,277 个 Object3D。角色、大门、烟花是独立对象，未被冻结。
- 输入、物理、故事和手柄仍按原 rAF 更新。实际画面无变化时停止反复提交相同场景，只保留约每秒一次的静帧重绘；移动、环顾、第三人称动画、烟花、材质高亮、切视角和缩放立即重绘。低静帧提交频率不是低操作帧率。
- 镜头参数未变时跳过相同的相机碰撞扫掠和 DOM 写入。第三人称可见时动画照常；回到第一人称、或手机全屏剧情界面遮住场景时停止隐藏角色 mixer。
- 书脊遮挡先用固定世界 AABB 剔除不可能命中的物体，再运行原 Three 三角形精确 raycast。原近远范围、排序和遮挡判定保留。动态对象不使用静态边界。
- 全部 occluder 和 portal 确认冻结后，才缓存完全相同的书脊查询结果。键包含 ray origin、direction、near、far 和玩家平面位置。看向其他位置、移动、暂停、打开游戏／手机或离开可读范围会重新判断。缓存命中仍调用原 highlight，保持材质反馈。

## 复现与验收

```sh
node --test integration/library/library-render-runtime.test.mjs integration/library/library-performance.test.mjs integration/library/activity-door.test.mjs integration/library/activity-lifecycle.test.mjs
node integration/library/benchmark-library-browser.mjs --baseline-root ../performance-20261101-baseline --cpu 4 --duration 2500
```

浏览器脚本只在本地 HTTP 响应中插入计数，不把测试控制代码写入运行包；两组共用同一套 GLB、材质和资源配置。基线是 169d89c 的 assets-v2，初次 v3 的完整四轮结果在 `artifacts/performance-20261101/library-browser/report.json`。随后追加静态拾取 memo 的两轮优化版结果保存在 `library-browser-memo/report.json`，没有覆盖初次 A/B。

测试使用本机 Chrome，桌面 1280×720、手机布局 844×390、DPR 1、CDP CPU 4 倍降速，各阶段约 2.5 秒。它是真实 WebGL 运行和手机布局模拟，不是真手机温度、GPU 内存或长时间稳定性测试。计数来自实际 `renderer.render` 提交，不使用 rAF 冒充帧率；提交次数也不等于屏幕最终呈现帧率或 GPU 耗时。

初次严格顺序对照的结果：

| 场景 | 原版 | 初次优化版 |
| --- | --- | --- |
| 桌面暂停背景，2.5 秒绘制次数 | 151 | 2 |
| 手机布局暂停背景，2.5 秒绘制次数 | 151 | 2 |
| 桌面第一人称行走，实际提交/秒 | 60.14 | 59.94 |
| 手机布局第一人称行走，实际提交/秒 | 60.12 | 60.19 |
| 桌面第三人称动画，实际提交/秒 | 24.09 | 27.21 |
| 手机布局第三人称动画，实际提交/秒 | 31.45 | 32.53 |
| 桌面已加载角色但第一人称隐藏，mixer 更新/2.5秒 | 148 | 0 |
| 手机全屏剧情，mixer 更新/2.5秒 | 150 | 0 |
| 桌面 J921 静止注视，精确拾取累计 CPU/2.5秒 | 2,182 ms | 968 ms |

初次优化的 J921 查询由每轮 1,149 个遮挡候选缩到 20 个，实际高亮保持 `wanyan`。补充 memo 后，相同射线只精确求值一次；稳定测量段不再重复 raycast。转身后高亮消失、转回后重新精确命中；手机布局、第三人称恢复和全屏剧情返回也一并验收。

桌面和手机布局的第一人称静止画面、J921 近景共四组截图，与基线逐像素比较均为 0 个不同像素（`library-browser-memo/pixel-comparison.json`）。已实际查看书架近景及第三人称截图。两批浏览器运行均无页面错误或失败资源响应。

第一人称行走已接近本机 60Hz 上限，没有把这一项写成帧率提升。第二次优化版完整样本还受新加转身检查、缓存预热和机器状态影响，不拿其第三人称数值与旧基线计算收益百分比。所有对应场景的模型调用数与三角形保持一致；截图、来源 hash、原始指标和错误记录在各报告目录。

## 打包边界

`build.mjs` 复制新增 `library-render-runtime.mjs`，图书馆主脚本查询版本为 `render-v3-20261101`。现有已物化的 v2 运行包可从 v2 `hub/main.mjs` 经过 `applyLibraryPerformance` 生成；本轮开发中的 v3 多次更新应从该 v2 基线重生成，不能对带幂等标记的旧 v3 再调用并期待自动更新。最终由根任务统一更新 `work-assets` 白名单、哈希、压缩包、路由和本地运行副本。
