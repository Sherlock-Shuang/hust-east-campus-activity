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

仅复制正式运行引用的 65 个文件，约 360 MB。图书馆模型约 122 MB，人物约 25 MB，Unity WebGL 的 data 约 99 MB、wasm 约 41 MB；按进入作品时加载。没有复制 Unity 工程、Blender 制作文件、照片目录、历史构建、QA 页面或测试夹具。以撒保留原游戏 HTML、Ruffle 运行时、剧情桥与两种已有 SWF 选择；不复制整个以撒工作区。

manifest 的 `entries` 给出每条 URL、相对运行包路径、长度、SHA-256 和 MIME。Node handler 按该白名单提供资源，支持 HEAD、ETag 和单段 Range 请求。Worker 部署可读取同一 entries；大文件分块／合并由校园部署工具负责，本目录不假装这些文件能直接满足所有静态托管单文件限额。

## 活动副本的改动边界

1. 原运行层绝对 URL 重写为活动前缀；馆内 J921 改指向同一 `/works/wanyan/` 真实构建，I921 保持以撒入口。
2. `public-story.json` 使用“访客／书境向导”与中性活动文案，头像为空。没有复制原 `story/config.json` 或 `story/avatars`。保留 intro 的 8 步／2 次回复、birthday 的 4 步／1 次回复、原延时和原流程节点标识，因此条件判断没有改变。
3. 活动存档使用 `campus-library-save-v1`、`campus-library-view-mode`，不覆盖原礼物存档。原主角、原游戏玩法、原有真实胜利回调保持。
4. 以撒活动副本的 `story.js` 将一处作者真实姓名提示改为中性同行者提示；原脚本不变。编译的 Unity/SWF 游戏资源原样复制，没有从运行包导出原素材，也没有声称对编译内容做完整隐私扫描或另行授予再分发许可。
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
