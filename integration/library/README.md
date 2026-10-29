# 书境与晚言 · 校园活动接入

本目录生成活动专用运行副本，不写入生日礼物原工程，不修改原礼物桌面包、真实通关条件、开门逻辑或存档。原工程的完整旅程继续保留。

## 构建与挂载

在校园项目根目录执行：

```sh
BOOKREALM_SOURCE="/持有完整资源的生日礼物工程目录" node integration/library/build.mjs --output work-assets
node --test integration/library/integration.test.mjs
```

`BOOKREALM_SOURCE` 只用于构建时读取本地资源，不进入网页源码或运行配置。输出 `work-assets/library`、`work-assets/wanyan` 和 `work-assets/library-manifest.json`。Node 服务导入 `createLibraryHandler({assetsRoot})`，对每个请求调用返回的异步 handler；返回 `true` 表示请求已处理。

| 入口／能力 | 活动访问路径 |
|---|---|
| 书境图书馆 | `/works/library/` |
| 黑神话.晚言 | `/works/wanyan/` |
| 馆内以撒入口 | `/works/library/games/isaac/` |
| 两款书中游戏可用性 | `/works/library/api/games` |
| 模型、角色、模块、字体与剧情 | `/works/library/model.glb`、`hero.glb`、`hub/`、`vendor/`、`story/config.json` |

仅复制正式运行引用的 72 个文件，约 360 MB。图书馆模型约 122 MB，人物约 25 MB，Unity WebGL 的 data 约 99 MB、wasm 约 41 MB；按进入作品时加载。没有复制 Unity 工程、Blender 制作文件、照片目录、历史构建、QA 页面或测试夹具。以撒保留原游戏 HTML、Ruffle 运行时、剧情桥与两种已有 SWF 选择；不复制整个以撒工作区。

manifest 的 `entries` 给出每条 URL、相对运行包路径、长度、SHA-256 和 MIME。Node handler 按该白名单提供资源，支持 HEAD、ETag 和单段 Range 请求。Worker 部署可读取同一 entries；大文件分块／合并由校园部署工具负责，本目录不假装这些文件能直接满足所有静态托管单文件限额。

## 活动副本的改动边界

1. 原运行层绝对 URL 重写为活动前缀；馆内 J921 改指向同一 `/works/wanyan/` 真实构建，I921 保持以撒入口。
2. `public-story.json` 使用“访客／书境向导”与中性活动文案，头像为空。没有复制原 `story/config.json` 或 `story/avatars`。保留 intro 的 8 步／2 次回复、birthday 的 4 步／1 次回复、原延时和原流程节点标识，因此条件判断没有改变。
3. 活动存档使用 `campus-library-save-v1`、`campus-library-view-mode`，不覆盖原礼物存档。原主角、原游戏玩法、原有真实胜利回调保持。
4. 以撒活动副本的 `story.js` 将一处作者真实姓名提示改为中性同行者提示；原脚本不变。Unity 可执行文件和 SWF 原样复制；Unity data 仅将四处场景称呼“归心”改为“圣所”（见下文）。没有从运行包导出原素材，也没有声称对编译内容做完整隐私扫描或另行授予再分发许可。
5. 图书馆活动副本新增外部暂停：冻结主循环和手柄轮询、停止输入、暂停手机及其音频，并向嵌套游戏发送已有 `bookrealm:controls`。原暂停／视角／游戏按键保留，Esc 没有被活动桥劫持。
6. 晚言通过已有 `bookrealmControlsSuspended` 接入原战斗暂停边界；退出时尝试 `unityInstance.Quit()`，父层移除 iframe 释放运行时。
7. 晚言活动画布对已知浏览器 Pointer Lock 拒绝作非致命降级，保留普通鼠标／键盘；同时捕获同步异常和 Promise 拒绝，不伪造锁定成功。真正的 Unity 运行错误和资源下载失败仍报告失败。降级只作用于活动副本，不修改编译游戏或原工程。

## 真实加载信号

父页面在 iframe 地址中传入 `campusParentOrigin` 和 `campusAttempt`。脚本只接受对应父窗口、准确来源及匹配 attempt 的活动消息。

- 收到 `campus:activity` 的 `paused` 后暂停／恢复。
- 文档完成构建时发 `campus:ready`，`level: "page_opened"`。
- 图书馆两个实际 GLB 完成解析后、晚言 `createUnityInstance()` 成功后，才发 `level: "runtime_ready"`。
- 加载错误发送 `campus:error`，由主场呈现重试／返回。模型下载进度或 HTML load 不能冒充 runtime_ready。
- 所有消息带 `workId` 和原 `attemptId`。返回使用 `campus:exit`，独立页面也显示返回校园链接。

这些信号只表示已打开／运行时就绪，绝不表示游戏完成。原游戏内部的胜利回调继续只服务原图书馆旅程，活动桥不会合成胜利事件。

## 验证范围

`integration.test.mjs` 校验运行包哈希、白名单排除、公共剧情节点、真实资源路由、MIME、Range、SDK 来源／attempt 校验、暂停和按键边界。实际三维与 Unity 浏览器验收由校园总流程单独记录，不能用这些接口测试替代。

因为生日礼物原运行源码和平台包没有被修改，本接入不重写原三平台桌面交付；原工程测试由 `python3 -B tools/project.py test` 回归，原 Windows 真机与签名状态保持原项目的已知边界。

## 2026-10-28 手机适配

触屏设备和 900px 以下窗口使用活动副本的触控层，电脑键鼠／手柄保留。

- 图书馆：左摇杆移动，画面拖动镜头，右侧翻书／闪避，顶部切视角与查看手机。直接调用原移动、碰撞和翻书函数，不跳过找书或通关条件。
- 剧情手机：移动端去掉装饰性手机外壳／手臂，改为全屏聊天；使用系统键盘、16px 输入字号和安全区，跟随 visualViewport 调整软键盘空间。
- 以撒：左摇杆 WASD、右摇杆方向射击，保留道具／炸弹／药丸；触控菜单可打开原书中返回菜单，确认键和返回标题分开。事件发送到原 Ruffle 容器，没有改写 SWF 状态。
- 晚言：按原游戏已有键位映射攻击 J、重击 F、技能 Q、回血 E、闪避空格、锁定 Tab。开始／暂停／强化／重开根据引擎原只读状态显示；战斗阶段才显示移动摇杆和拦截镜头拖动，阶段切换释放所有按住状态。没有替换 Unity 编译包。
- 触点取消、丢失 capture、旋转、后台和暂停均释放按住状态，双摇杆独立工作，软键盘期间不继续移动。
- 图书馆和晚言移动端 DPR 限制为 1.1；图书馆跳过首次强制加载整包中文字体，使用系统字体，打开全屏剧情手机时停止被遮住的三维背景渲染。模型和游戏数据仍按原包加载，大文件没有宣称已压缩。

实现源文件是本目录的 `touch-controls.mjs/css`、`library-touch-hooks.txt`、`isaac-touch.mjs`、`wanyan-touch.mjs`，由 `build.mjs` 注入并写入白名单。原生日礼物源文件和三平台桌面包均未修改，因此本轮不替它们重新打包。

`node --test integration/library/integration.test.mjs integration/library/touch-controls.test.mjs` 共 16 项通过，包含真实资源哈希不变、并行触点、取消和恢复、阶段切换、窄屏鼠标拖动、原生菜单输入、输出白名单及原暂停协议。根任务在 844×390 浏览器验收晚言：触控开始进入真实战斗、摇杆移动人物／场景、攻击触发蓝色挥击、暂停进入原菜单、重新开始回到开场；以撒：开始／确认进入选人和真实关卡，左摇杆右移人物、右摇杆向上连续射出泪弹。图书馆实际输入由根任务统一验收；这些测试不等于 iPhone／Android 真机性能验收。

## 晚言活动版场景称呼

`wanyan-public-text.mjs` 严格解析 UnityWebData 与 IL2CPP v108 字面量表，只将四处完整文案中的“归心”改成“圣所”，包括开场提示、进入按钮和原胜利提示。等长 UTF-8 替换保持容器及元数据偏移，整包仅20个字节变化；未知版本、异常边界或文案变化会拒绝构建。`.wasm`、战斗、胜利回调和存档不变，原礼物包不写入。原包哈希保留在 manifest.sourceChecks；测试把四个名称还原后，要求整包SHA256与原包完全一致。

活动HTML使用 `wanyan.data?campus-text=sanctum-v1` 避免旧缓存继续显示原称呼，资源路由仍为同一个data文件。字体已包含“圣”“所”，不增加字体下载。构建输出不能位于原工程内部。

## 2026-10-29 浮动摇杆与晚言战斗触控

左侧移动区扩大为画面左侧 46%，每次落指的位置就是本次摇杆中心，抬手后恢复；不会因首次按下偏离固定圆心而突然移动。移动输出保留 12% 中心死区，约 3–5 px 手指抖动不会让人物缓慢漂移，视觉圆钮仍跟手。图书馆、晚言和以撒共用该规则，以撒的右侧射击摇杆仍为独立固定摇杆。移动、镜头和按钮分别拥有触点；取消、失焦、旋转、暂停或切阶段会释放全部输入与 capture。

晚言旧镜头适配无效的根因在原 `EmberSoulsCamera`：鼠标镜头必须通过真实 Pointer Lock 检查，手机仅发送合成 `mousemove` 无法满足条件。活动版新增 `wanyan-touch-gamepad.mjs`，把触屏左右移动和战斗按钮接入 Unity 已有的标准手柄路径，右侧空白拖动转为原相机右杆输入，不伪造鼠标锁定，也不改 Unity wasm、framework、战斗或胜利条件。慢速拖动抵消原 `.20` 手柄死区；每帧生成一个稳定输入快照，Unity 和锁敌桥多次读取不会提前吃掉镜头位移。停指下一帧归零，抬手立即归零，短按保留 120 ms 供引擎采样，暂停时立即强制清零。

触控设备使用首个空手柄槽（通常为 0），启动枚举已经发现的虚拟设备不会重复注册。真实标准手柄存在时保留它的身份、原始输入及原生断开事件；触控按需合并为该设备的读取快照，触控静止时返回原浏览器对象，不修改真实设备对象。非标准物理手柄保持原校准与输入路径，活动层不猜测它的轴映射。桌面宽屏不安装虚拟手柄。

右下普攻为 86 px 圆按钮（较窄横屏 82 px）；闪避、重击与技能沿左上弧分布，回血和锁定为次级按钮。按钮之间的空隙可以继续拖动镜头。菜单、开始／确认、强化选择与重新开始继续按原阶段出现。5 Hz 的画布 `data-native-yaw`、`data-native-pitch` 等只读诊断来自 Unity 原生发布状态，供浏览器确认实际镜头和人物变化，不用于控制游戏。

本轮回归命令：

```sh
node --test integration/library/integration.test.mjs integration/library/touch-controls.test.mjs integration/library/wanyan-touch-gamepad.test.mjs integration/library/wanyan-public-text.test.mjs
```

测试包含首个空槽、逐帧多次读取、停指与抬手、并行移动／镜头／攻击、重新落指、取消／旋转／暂停、物理手柄合并与热插拔、恢复原浏览器 API，以及原 wasm／SWF 完全一致、Unity data 仅原四处“圣所”称呼转换。实际 Unity 浏览器运行和手机真机体验由校园主流程分别验收，不能用输入模拟测试冒充真机表现。
