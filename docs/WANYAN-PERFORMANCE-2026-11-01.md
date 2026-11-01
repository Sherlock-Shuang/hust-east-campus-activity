# 晚言活动副本性能优化与验证（2026-11-01）

本次在现有 PC Unity WebGL 包外侧减少像素工作量和后台渲染，未重建 Unity、改动战斗算法、存档或真实胜利条件。未将 128.8 MB 的可选 Mobile ASTC data 默认发送给手机；PC data 及对应 wasm/framework/loader 四文件保持现有版本。

## 已实施

- 活动 HTML 在创建 Unity 配置前同步载入 `wanyan-performance.js`。普通桌面初始上限从 DPR 2 / 1440p 超采样调整为 DPR 1.5 / 1080p 像素预算；触屏、低核心或低内存设备上限 DPR 1 / 1280×800。大屏也限制像素总量。
- 连续两段 2 秒窗口的持续负载才降低一档，稳定至少 20 秒才回升；启动、暂停、强化、结束界面和单次异常长帧不参与调整。只调整 canvas 像素密度，原输入、模型、光照与战斗时间步不变。
- 宿主暂停、图书馆菜单暂停和页面隐藏分别保留原因，使用当前真实编译包导出的 `Module.pauseMainLoop()` 停止 Unity 原生帧循环。
- 恢复先保持输入暂停，读取现有只读 NativeControls bridge，等两次真实 Unity `LateUpdate` 后再放行。按对象身份计数，原生 30 FPS 时不会把浏览器的两个 rAF 当成两个原生帧。
- 退出移除新增监听器、帧回调和尺寸定时器；已暂停的 Unity 先恢复循环以服务 `Quit()`。原生暂停菜单不被擅自关闭。

## 实际验证

环境：macOS Google Chrome，无头模式，1280×800 CSS viewport、DPR 2、现有完整 PC Unity 四文件；使用同源 iframe 活动协议及实际键盘事件，不修改原生玩家状态。

| 检查 | 结果 |
|---|---|
| 宿主暂停早于 Unity 初始化 | runtime_ready 后真实主循环仍暂停 |
| 暂停 600 ms | NativeControls 对象完全相同，角色位置、状态均不变，未发生一次新的 LateUpdate 发布 |
| 图书馆暂停与宿主暂停叠加 | 单独解除一方不会恢复引擎 |
| 从宿主暂停恢复 | 原生位置额外位移 0；等待两个真实 suspended 帧后放行 |
| 原游戏暂停菜单 | 宿主暂停/恢复后保持菜单；按原 Escape 退出菜单后键盘移动正常 |
| 已暂停时退出 | 删除适配器调度及监听器，并调用真实 Unity Quit；未伪造完成事件 |

实际 canvas 为 **1821×1138（2,072,298 像素）**，当前比率 1.423。旧公式在相同条件下对应约 2428×1517（3,683,276 像素）；像素工作量约少 **43.7%**。旧尺寸为保留的原公式推算，本报告未将其冒称实测 A/B，也不以像素减少比例代表 FPS 提升。

33 项相关 Node 测试通过，包括 10 项新增预算/恢复边界测试及原技能状态、真实运行包、质量选择、虚拟手柄、只读桥和源工程保护测试。真实浏览器报告 `artifacts/performance-20261101/wanyan-lifecycle/report.json` 记录 6 项验收、无 JavaScript pageerror，实际游戏截图为同目录 `actual-pc-gameplay.png`。报告中仍保留浏览器两条泛化的资源错误 console 记录（浏览器网络 response 观察未出现对应失败），没有隐藏该记录；三维场景和 Unity 运行成功。

这是实际引擎功能/生命周期与像素预算验证。未进行手机真机温度、电池、低端 GPU 帧率、长时间多波战斗或 CDN 首屏对照，因此不声称达到某个手机 FPS。

## 恢复契约审查

现有 `EmberGame.LateUpdate` 无 started/ended/paused/choosing 提前返回，始终调用 `gamepad.Publish`；JS 插件每次生成新的冻结状态对象。`Update` 在菜单/结束状态分支前处理 `SetLibraryControlsSuspended`，暂停时设置 Time.timeScale=0 仍保留 LateUpdate。因此开场、原生菜单、强化、结束/死亡均可完成两个真实帧的恢复等待。初始化之前的宿主暂停已由实际浏览器覆盖。未来若原生包删除该 bridge，需要更新适配契约；不能仅因计时结束就强行放行可能补算的位置更新。

## 构建与对照

- `build.mjs` 已接入严格、幂等的 `applyWanyanPerformance()` 转换，并导出新 JS。
- 增量运行资源仅 `wanyan/index.html`、`wanyan/wanyan-performance.js`；通过 `deploy-assets/update-work-assets.mjs` 与 `prepare-local.mjs` 同步发布白名单和 pack。无需重发 Unity 四个大文件。
- `?wanyanResolution=original` 保留原固定像素公式；`?wanyanResolution=fixed` 使用新固定预算；不带参数为自适应。`window.campusWanyanPerformance.snapshot()` 返回只读诊断。
- `node integration/library/verify-wanyan-lifecycle.mjs` 可重做上述真实引擎功能检查，测试服务器只覆盖活动 HTML/小脚本并复用白名单运行资源，不读私人剧情或写原生日工程。
