# 作品资产与生命周期优化（2026-10-30）

范围是活动副本与整合运行层。生日礼物原工程、ta-say 原工程、剧情节点、通关逻辑、存档均保留。以下数据来自本机实际产物；不代表手机 FPS、GPU 显存或公网下载速度。

## 已实施及量化

| 资源 | 原文件 | 活动优化文件 | 说明 |
| --- | ---: | ---: | --- |
| 图书馆建筑 GLB | 127,924,180 B | 38,608,840 B | 文件减少69.8%，不是显存减少69.8% |
| 角色 GLB | 25,788,452 B | 12,987,388 B | 仅降低7张大贴图尺寸、编码压缩；皮肤/骨架/动画/三角形保留 |
| 建筑源三角形 | 3,137,837 | 2,451,542 | 减少21.9%，不是计划中尚未达到的40–60% |
| 建筑去重 accessor 数组字节 | 96,850,848 B | 70,988,808 B | 约26.7%减少，不等于驱动最终 GPU 分配 |
| 角色源三角形 | 116,178 | 116,178 | 不简化人物拓扑 |

建筑只对喷泉水滴与树冠做有损简化，其他可处理物体仅焊接完全相同的顶点。地砖、建筑、门窗、天花板、楼梯及交互 portal 共51个网格保护原属性；写出后重新解码验证位置、法线、UV逐字节一致，三角索引仅允许 meshopt 编码器的循环重排（顶点与绕向不变）。节点名称、extras、父子图保持；矩阵只允许写出浮点舍入误差≤1e-6。初版候选地砖反光退化已拒绝，不在最终资源路由中。

角色9张图像总像素从94,371,840降至25,165,824。按RGBA8完整mipmap估算从503,316,480 B降至134,217,728 B；这是理论预算，未测实际GPU内存。建筑54张图像未改（43,057,152像素，理论229,638,144 B）。本轮未强行加入KTX2，也未把透明材质合图导致排序/采样改变。

本地 Brotli quality=5 实际编码字节：建筑32,973,227→14,107,891；角色23,365,528→12,323,719。CDN可能使用不同压缩设置，因此这些不是HTTP实测传输量。

## 图书馆加载与缓存

第一人称只等建筑；角色从初始下载链移除，V或菜单切第三人称才触发一次共享加载。准备期间继续用第一人称；角色失败可重试，建筑不会因此判失败。返回校园会中止未完成下载，迟到的GLTF解析结果释放几何、材质、纹理与ImageBitmap；已经载入的资源亦释放。默认模型URL与meshopt decoder都使用完整SHA256路径，只有匹配路径与内容hash的资源返回一年immutable；配置/HTML no-cache，原版路径保持原缓存策略。decoder随包本地提供，不依赖外部CDN。

入口 `/works/library/`；保留的原模型对照 `/works/library/?assets=original`。角色懒加载和活动身份在两条入口都相同。原版GLB不覆盖。

## 晚言真实移动质量候选

用已有 Unity 6000.6.0f1，在活动副本工程实际构建 Mobile + ASTC。不是仅缩canvas。构建Succeeded、0 errors、31 warnings，14项原生技能边界验证通过；4个运行文件来自同一次构建。质量为renderScale0.85、MSAA1、主阴影1024、1 cascade、shadowDistance30。wasm与PC相同42,562,040 B（逻辑未改），Mobile data128,784,620 B，PC data103,399,966 B。

ASTC data 的本地Brotli q5是114,121,371 B，PC为88,149,125 B，约多29.5%，所以**不默认给所有手机切大包**。正常入口继续使用保留PC包；`/works/wanyan/?quality=mobile` 是显式候选，而且仍需GPU真实支持ASTC。不支持时选完整PC包，不混搭两包文件。`?quality=desktop` 可明确选择原包。本机Chrome/Apple M5实际支持ASTC并进入第1波游戏，原生started=true、零pageerror；尚无iOS/Android真机性能、发热、耗电数据，不能声称移动更快。Mobile+Generic未构建，不能当作已完成的通用低档包。

## 过拟合恋人退出泄漏修复

真实反复进入测试发现，useChatViewport在父窗口注册的监听不会随iframe移除自动消失，React未unmount使旧Document逐轮保留。活动构建入口现在在受校验的dispose或pagehide明确root.unmount，并清理计时器、动画帧、观察器、音频与ready握手。暂停只冻结，不触发unmount。BFCache持久化返回时刷新已卸载的活动iframe重建React，保留存档与活动context；增加对应回归。原剧情与存档未改。

修复前十轮Documents逐轮增长到11、Nodes每轮约+250；修复后独立十轮Documents每次为1、Nodes2092–2097、GC后JS heap224.77–226.76MB，没有线性累积。随后严格复用根任务正式脚本又验十轮：Documents全部1、GC heap224.73–225.87MB，warm7平台断言通过。数据含校园本身；不是显存数据。所有模型API在测试中被拦截，没有制造回答或胜利。

## 重现与部署资源

正式Git部署只需已有依赖与资源pack，不安装资产制作工具：

```sh
node deploy-assets/prepare-local.mjs
npm run build:vercel
```

从原作品重建活动副本时，先按各integration README构建；图书馆build本身保留第一人称懒角色。制作优化资源另外执行：

```sh
npm install --prefix .tools/asset-optimizer --no-audit --no-fund @gltf-transform/core@4.2.1 @gltf-transform/extensions@4.2.1 @gltf-transform/functions@4.2.1 meshoptimizer@0.23.0 sharp@0.35.5
node integration/library/optimize-library-assets.mjs
node integration/library/prepare-library-performance.mjs
```

`optimize`仅生成`.staging/library-optimized`可回退候选，人工视觉与结构检查通过后才`prepare`更新白名单与pack。不要提交.tools、.staging、Unity制作工程或原礼物资料。默认生产依赖不变。

真实Unity候选的重建命令（构建输出目录必须是尚不存在的独立目录）：

```sh
node integration/library/prepare-wanyan-activity.mjs --source /absolute/path/to/gift --unity-editor /absolute/path/to/Unity --output work-assets-source/wanyan-mobile --scratch-root .staging/unity --mobile
node integration/library/prepare-wanyan-performance.mjs
```

`prepare-wanyan-performance`只接收带匹配hash、原生bridge与真实Mobile/ASTC报告的构建，不回退冒用旧包。会保留PC文件及版本路径。

## 同步回非Git本地主项目

本地主目录采用Node + work-assets，不能只拷manifest/chunks。生成精确更新计划：

```sh
node deploy-assets/export-work-update.mjs --base a120315 --output artifacts/work-assets-update.json
```

先备份计划中已有目标文件；逐一核对目标SHA256等于expectedPreviousSha256（或已等于新版），其他情况停下做差异合并。只从本工作区已物化的work-assets复制计划files，原model.glb、hero.glb和生日项目不覆盖。将libraryManifestEntries按url合并到本地work-assets/library-manifest.json，保留原sourceChecks、unityRuntime、transforms和其他entries；tasay按真实生成index及资源文件接入。不要把本工作区整个library-manifest.json覆盖本地主目录原始来源元数据，不创建半套asset-source。同步integration/deploy-assets的源码改动按正常逐文件审查，父任务另行负责。

## 验证与边界

- 34项资产、来源保护、HTTP缓存/Range/ETag、延迟加载、销毁、实际Unity bridge回归通过；17项tasay生命周期、视口与原剧情独立入口回归通过。
- 本机真实Chrome对照原/新版图书馆第一、第三人称，首人称无hero网络请求、第三人称重复触发只请求一次；两个作品portal共10个可射线命中的网格相同。场景原GLB中4个带portal标记节点完整保留。
- `integration/library/verify-library-browser.mjs` 和 `verify-wanyan-browser.mjs` 生成真实画面与请求证据；这些是功能/画面对照，不作并行构建下的FPS比较。
- 根任务 `scripts/verify-performance-works.mjs` 验证真实校园十轮进出、强制GC后文档/堆平台与全场记录。下一步仍需真机长时与公网压缩响应验收，未把这些写成通过。
- 证据在`artifacts/performance-phase2-20261030/`；这些不含模型凭据，不作为生产运行资源发布。
