# 活动作品资源审计（2026-10-30）

本轮先只读检查活动副本、构建/服务代码和当前公开站点响应头；随后修复下述两个接入层生命周期边界，并仅更新对应的两个小型 JS gzip 分片。未修改生日礼物原工程、GLB、Unity 编译包或作品存档。数据文件见 `artifacts/optimization-2026-10-30/work-resource-audit.json` 与 `work-resource-public-headers.json`。

## 实测体积与构成

下表的 MB 均为十进制原文件大小，不是网络压缩后流量、解码后内存或 GPU 内存。

| 文件 | 原文件字节 | 构成与判断 |
|---|---:|---|
| library/model.glb | 127,924,180 | 几何 bufferView 120,442,400 B（94.15%）；图像 6,591,751 B（5.15%）。主模型主要成本是几何，不是贴图。 |
| library/hero.glb | 25,788,452 | 图像 20,507,244 B（79.52%）；几何 5,117,744 B。角色纹理值得单独评估。 |
| wanyan/Build/wanyan.data | 103,399,966 | UnityWebData 内 7 项，data.unity3d 87,719,351 B；IL2CPP metadata 7,840,818 B；resources.resource 6,198,736 B；Unity 默认资源 1,631,680 B。 |
| wanyan/Build/wanyan.wasm | 42,562,040 | 执行代码；压缩减小下载体积，不等于减少 wasm 初始化与运行内存。 |

主 GLB 有 638 个 mesh、1,035 个 primitive、172 个 material、54 张内嵌图像。已有 `KHR_mesh_quantization`。检查全部 917 个 bufferView 的字节内容后，没有完全相同的重复块可直接无损去重。所有 primitive 的 POSITION accessor 数量合计 6,261,819，索引三角形合计 3,137,837；这是文件中的几何累计数，不是实机单帧可见三角形。

源码资产清单中的 gzip 分片总大小分别为：主模型 43,086,400 B、角色 23,497,987 B、Unity data 89,134,274 B、wasm 11,736,817 B。`deploy-assets/materialize.mjs` 在构建时解压这些分片，输出原始运行文件；这些数字不能当作公网实际传输量。

## 压缩、缓存和按需加载

2026-10-30 经已有代理对当前公开站点四个大资源执行 HEAD：均返回 HTTP 200、`Content-Encoding: br`、`Cache-Control: public, max-age=3600`，wasm MIME 正确为 `application/wasm`。因此公开部署已经提供 Brotli。该检查没有完整下载四个文件，不能报告 Brotli 的实际传输字节或手机首开用时。它也不是对本轮尚未发布代码的验收。

本地 `integration/library/handler.mjs` 按 manifest 白名单流式提供原文件，支持 ETag、HEAD、单段 Range、304/206/416，并在连接关闭时销毁读取流；它没有自行加 gzip/Brotli。若另一个部署平台不提供压缩，应在反向代理或静态托管层确认响应头，并保留 Range 行为，不能直接把打包分片当浏览器内容编码发送。

静态部署中指纹 assets 使用长期 immutable，HTML/JS/CSS/JSON 为 no-cache，其余二进制为 1 小时。大模型使用稳定路径，盲目改成一年 immutable 会让旧模型无法更新；需要先形成内容版本地址。晚言已有编译版本查询参数。

校园仅进入作品时创建 iframe，没有在校园首屏同时取三个作品。图书馆打开时会并行下载主 GLB 与角色 GLB，需两者解析后才报告运行时就绪；仅靠传输压缩无法解决约 153.7 MB 原始模型解析和后续 GPU 资源分配。图书馆进入书中游戏后停止本身渲染；离开整个作品时父页面移除 iframe。晚言和图书馆移动端 DPR 已限制为 1.1，不能将此作为本次新增成果。

## 退出与手机运行边界

已存在的正确行为：图书馆外部暂停停止输入、主循环重计算及手机音频，并向内嵌游戏传递暂停；晚言接入原引擎的 `bookrealmControlsSuspended` 战斗边界。触控层处理多指、旋转、blur、visibilitychange 和阶段变化，释放按键、指针 capture、虚拟手柄输入。退出 Unity 尝试调用 `Quit()`，随后父页面移除 iframe。

接入层生命周期修复与保留边界：

1. `integration/library/activity-adapter.js` 如果先收到 dispose、Unity 稍后初始化并 register，新的 controller 只被暂停，没有执行 dispose。现已让迟到 register 立即暂停并清理，每个 controller 最多清理一次，退出 promise 拒绝不会成为未处理异常。
2. `integration/library/wanyan-touch.mjs` 的 250 ms 手柄宣布 timeout 没有保存/取消，5 Hz 诊断 interval 和触控销毁只绑定 pagehide。现已订阅经过来源与 attempt 校验的活动 dispose，显式清理 timeout、interval、触控、虚拟手柄与 pagehide 监听；迟到 ready 不能恢复这些资源。父层立即移除 iframe 通常会释放上下文，因此这是生命周期边界修复，不能未经持续进出测试就说原来存在永久泄漏。
3. 晚言 render-quality 注册 resize/fullscreenchange 时没有返回卸载函数；被移除 iframe 会整体释放。若未来复用隐藏 iframe，应与引擎生命周期一起清理，当前不建议为此保留重型 iframe。

## 优先顺序

1. 主 GLB：先做分区/可见范围与几何预算评估，保留碰撞、门、书籍交互、角色动作和剧情。逐项记录面数、draw call、解析耗时和低端移动机实测，再生成活动专用 LOD；不要删除原模型的业务节点。几何简化可能改变外观，不能称无损。
2. 无损几何编码（例如 meshopt）可以作为受控试验，但需要匹配解码器、加载器以及完整交互回归；当前包已经量化且没有重复 bufferView，不能保证简单一条命令就能显著减少运行时成本。传输变小与解码后面数/GPU 内存是不同指标。
3. hero：按实际屏幕占比评估纹理尺寸与活动专用压缩；纹理降分辨率、纹理有损编码同样需要外观验收，不能未经对照直接替换素材。
4. Unity：data 中约 84.8% 是 data.unity3d，需要活动副本 Unity 导出阶段按场景、纹理/音频和资源引用分析；只切网页 loader 不会把整个 data 变成按区块流式游戏。须保留原战斗/存档/真实胜利桥，禁止直接删容器内容碰运气。
5. 在手机真机上测首开、回访和连续 5 次进入/退出，分别记录下载、模型解析、引擎初始化、峰值内存、输入恢复。当前审计只有文件结构、代码和公网 HEAD 证据，没有声称完成 iPhone/Android 真机验收。

## 本轮接入层修复验收

- `integration/library/activity-lifecycle.test.mjs` 新增 7 项，覆盖早退/迟到引擎、重复销毁、错误来源/旧 attempt、清理异常、触控持有键释放、活动退出/pagehide、迟到 timer 和发货包一致性。
- `node --test integration/library/activity-lifecycle.test.mjs integration/library/integration.test.mjs integration/library/wanyan-touch-gamepad.test.mjs`：23/23 通过。日志 `artifacts/optimization-2026-10-30/work-lifecycle-tests.log`。
- 初次一并运行现有 `touch-controls.test.mjs` 时，其 7 个输入测试通过，最后一个原编译产物溯源测试因 `prepare-local` 生成的 manifest 没有 `sourceChecks`/`unityRuntime` 而失败。未伪造这两个原构建字段，也未把该项算通过。完整资源路由、模型/Unity 字节与 manifest 哈希检查在上面的 integration 测试通过。
- 以下同步和物化命令仅在 `deployment/optimization-release-20261030` 或线上 Git 部署仓库执行；主目录保持原本直接构建 `work-assets` 的 Node 流程，不建立不完整的 `asset-source` 包。
- 新增 `node integration/library/sync-activity-adapters.mjs`：只更新现有包中的 library/activity-adapter.js、wanyan/activity-adapter.js、wanyan/wanyan-touch.mjs。两份 adapter 共用同一内容哈希分片；保留旧分片。随后 `node deploy-assets/prepare-local.mjs` 已重新物化本地工作副本，manifest 指纹及字节记录见 `work-lifecycle-materialize.json`。今后 source wrapper 变更须执行这两条命令，构建发布仍走原 `npm run build:vercel`。
- 以上是源码、生命周期模拟、打包/本地 HTTP 验收；没有声称 Unity 真机连续进出或新代码公网已发布。已启动的服务需要重启，以重新读取更新后的 manifest/ETag。
