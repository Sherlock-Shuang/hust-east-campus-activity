# 东校区互动活动整合验收记录

更新：2026-10-27 21:40（北京时间）。当前交付为**本地完整源码、可运行包及实际本地联调结果**。用户已明确停止继续尝试 GPT 平台部署，后续自行选择 Vercel 或其他托管；本轮不再把该平台公网验收作为继续执行的事项。没有将平台发布成功等同于观众可访问。运行步骤见 [ACTIVITY-RUNBOOK.md](ACTIVITY-RUNBOOK.md)。

## 交付内容与部署状态

| 内容 | 实际结果 |
|---|---|
| 完整校园源码 | `index.html → src/survey.js`，原校园、人物、碰撞、镜头与移动功能继续复用 |
| 主持人控制端 | `/admin`，沿用管理认证，增加阶段、观众搜索、个人明细与去重统计 |
| 三个真实作品 | `/works/library/`、`/works/wanyan/`、`/works/tasay/`，各自真实运行包和资源服务 |
| 可运行源码 ZIP | [`output/east-campus-activity-source.zip`](../output/east-campus-activity-source.zip)，约 226 MB、248 文件；精确体积与 SHA-256 以包外 [`east-campus-activity-source-verification.json`](../output/east-campus-activity-source-verification.json) 为准 |
| Node 统一启动 | 解压后 `npm ci`、`npm start`；已带 `dist` 与 `work-assets`，无需原作品工程 |
| 公网交付 | **没有经过本轮独立访问验收的可用公网入口**；部署由用户接管 |

历史平台记录保留：项目 `appgprj_6adb1308ace0819195294e83e0ecc3af` 的 public version 1 已由平台确认发布，源码 commit `34d28c382ebb8b6a5e0a7505d623e5523de2d8bf`，平台返回地址 `https://hust-dongjiu-morning.nutty-sage-4011.chatgpt.site`。当前网络终端访问出现 Cloudflare 403，浏览器公网流程未通过验收；该地址不是本轮承诺可用的观众入口。用户要求停止后，不再继续该平台尝试。

Node 本地采用原子写入的 `server-data/live-state.json` 和 `audiences.json`；Worker 分支使用 D1 `DB` 与 `ASSETS`。前者需单实例和持久磁盘，后者需正确迁移及服务绑定；静态上传 `dist` 不等于完整部署。

## 真实浏览器联调

环境为本机 macOS IAB 和 Chrome 两个独立浏览器环境，地址 `http://127.0.0.1:5178`，非公网、非 100 台设备。机器可读结果为 [`activity-browser-acceptance.json`](../output/activity-browser-acceptance.json)。以下为实际进入和操作的结果，不以测试事件或加载器代替游戏画面。Worker 5190 预览已停止，Node 5178 在本轮交付时继续运行。

| 场景 | 实际操作与结果 | 证据与边界 |
|---|---|---|
| 独立观众身份 | IAB 观众“青禾”和 Chrome 观众“白露”获得独立身份；白露刚加入时到访／打开为 0／0，刷新后身份及记录保留；管理员搜索白露，初始明细时间线为空 | 之后真实体验使白露记录增长，不能把初始 0／0 写成最终状态 |
| 同浏览器多标签页 | 21:40 新开 IAB 标签页，同 cookie 自动复用青禾，无需再次填写昵称；后台独立总人数保持 2、当前在线观众保持 1，额外标签正常关闭 | 实际浏览器与 API 去重测试均已覆盖，不能把标签数量计作人数 |
| 图书馆真实运行 | 打开实际三维馆内场景；Chrome 白露连续 3 次进入、3 次返回，关闭后校园 iframe 数为 0；实际暂停／恢复可操作 | [`library-browser.png`](../output/library-browser.png)。3 次 DOM 清理不等于测量了 GPU 内存无泄漏 |
| 晚言真实游戏 | Chrome 白露进入 Unity 实际战斗画面并使用 W／Enter／Esc；原游戏操作过程中保持游戏 iframe，返回校园后移除 | [`wanyan-browser.png`](../output/wanyan-browser.png)。没有将 Unity 加载器或实例建立冒称通关 |
| 过拟合恋人真实交互 | IAB 青禾从初始页开始聊天，输入“早上好，今天一起去校园散步吧。”，看到真实剧情回复“醒了吗？”及“你今天怎么忽然又想装不熟了？”；返回校园后 iframe 数为 0，W 移动恢复 | 21:39—21:40 验证；[`tasay-browser.png`](../output/tasay-browser.png) 已更新为真实回复画面。此原剧情回复不代表模型翻译／蒸馏已通过公网调用 |
| 最终个人记录 | 青禾：3 个到访、3 个作品已打开、已返回，当前体验 0。白露：图书馆 3 次、晚言 1 次，最终独立到访 2 个、打开作品 2 个 | [`activity-admin-browser.png`](../output/activity-admin-browser.png)。打开次数和独立作品数正确区分，没有显示虚构完成；较早的一次晚言运行失败仍如实保留在时间线 |
| 公告与阶段 | 主持人发布“下一站，东九”并切换 `gather`，IAB 同步显示且已有探索记录保留；随后恢复 `explore` 并撤回公告 | [`announcement-browser.png`](../output/announcement-browser.png)；阶段与个人游戏通关没有绑定 |
| 光柱与入口配置 | 在实际管理端调整光柱／入口位置，使用韵苑 27 附近临时测试点位完成定位操作 | 最终已恢复：图书馆在韵苑 27 栋北侧、晚言在教育超市外侧、过拟合恋人在东九 B/C 前场；三个作品开放，示例入口及独立集合光柱关闭。管理员开关集合光柱动作通过，但玩家当时在韵苑 27，未直接目视远处光柱；定时开始／结束视觉也未验 |

没有把“玩家互相可见”作为本轮功能。物理手柄无设备，未做本轮真机手柄验收；已有手柄逻辑和模拟输入测试保留。未对所有默认点位间的完整徒步路线进行逐段人工验收，地图位置配置使用既有坐标体系。

## 自动化、构建与原项目回归

各批次覆盖重叠，不能相加成一个新的测试总数。下列测试与真实浏览器结果分别记录。

| 批次 | 结果 | 证据与覆盖 |
|---|---|---|
| 活动整合回归 | **116/116** | [`activity-final-tests.txt`](../output/activity-final-tests.txt)：图书馆桥、ta-say 代理／桥、管理 DOM、观众、实时控制与原移动回归 |
| 最近修复复测 | **15/15** | [`activity-last-fixes-tests.txt`](../output/activity-last-fixes-tests.txt)：图书馆 9 项及观众可靠投递 6 项；包括打开后立即返回有序、丢失响应稳定 ID 重试、重载按旧 tab 顺序重放、D1 冲突保留事件、join 等待身份查询 |
| 玩家与返回姿态 | **55/55** | [`player-return-tests.txt`](../output/player-return-tests.txt)：移动、镜头、输入、暂停及返回相关回归 |
| Node／Worker 观众后端 | **15/15** | [`audience-final-tests.txt`](../output/audience-final-tests.txt)：D1 与 JSON 持久化、认证、多窗口、失败与重复事件、100 观众、模型配额 |
| 图书馆活动适配单独复测 | **9/9** | [`library-integration-tests.txt`](../output/library-integration-tests.txt)：白名单、哈希、公开剧情节点、真实资源／MIME／Range、可信来源／attempt、嵌套游戏控制、Unity pointer-lock 兼容 |
| 原生日礼物工程 | Node **206/206**，Python **10/10** | [`library-original-regression.txt`](../output/library-original-regression.txt)，原旅程、手机、通关条件、碰撞、视角等保留 |
| 校园生产构建 | 通过 | [`activity-final-build.txt`](../output/activity-final-build.txt)，不是浏览器或公网验收的替代 |
| Worker 构建 | 通过 | [`cloud-build.txt`](../output/cloud-build.txt)，生成真实 Worker／ASSETS／D1 发布产物；不代表终端能穿过当前公网 403 |
| 解压包完整性与服务 | 17 项检查通过 | [`east-campus-activity-source-verification.json`](../output/east-campus-activity-source-verification.json)，详见下节 |
| 最终 gzip Worker HTTP | **8/8** | [`worker-compressed-http-check.json`](../output/worker-compressed-http-check.json)，实际本地 Worker 和 ASSETS，详见下节 |

早期 84 项、后端 34 项、代理／管理 16 项日志仍保留供追溯，以表中对应的较新复测说明当前范围。历史 D1 配额测试曾因 `LIKE` 条件报错，后续原子配额测试已通过。没有宣称执行了项目中所有无关历史测试。

过拟合恋人原版基线为 **70 项中 60 通过、10 失败**，涉及既有剧情断言和旧翻译接口；原类型检查已有 **7 个错误**（正式页面 nullable 1 个、旧测试 6 个）。源 commit 为 `9d9d37df8bbb0a7fd67e95600688d99b94c7e052`，原 tracked 源码未改。本轮只在隔离副本修正正式页面 nullable 绑定，并增加 basename、代理与活动暂停桥；隔离副本正式源模块类型检查和构建通过，不冒称原版全部测试通过。

使用本机既有私有模型配置向真实服务发送过一次无个人信息的合成请求，HTTP 200 且有模型响应；没有输出密钥。它证明本机服务器至模型连通，不能证明未来托管环境已配置模型凭据。

## 干净解压运行包验证

验收记录见 [`east-campus-activity-source-verification.json`](../output/east-campus-activity-source-verification.json)。包内为校园源码、管理端、Node 服务及真实运行资源，不含 `node_modules`、`server-data`、`.env*`、`.dev.vars*`、Git、原制作工程或历史输出。

在独立解压目录完成校园生产构建、启动及实际 HTTP 检查：

- 校园、管理端、三个作品和 ta-say `/chat` 正式路由真实 GET 成功。
- 图书馆／晚言清单的 69 条路由 HEAD、MIME 和长度正确；GLB、角色 GLB、Unity wasm 的真实 Range 读取正确。
- 图书馆游戏 API、全部 ta-say 5 个运行文件、校园构建静态资源完整；7 个必要 Ruffle 运行／许可文件迁移至包内 vendor，原 URL 保持不变。
- 私有文件未公开，观众管理接口要求认证；合成身份和三作品事件生命周期核对到访、打开、返回与管理员统计。
- 启动仅依赖解压后的 `dist`、`work-assets`、服务源码及已安装 npm 依赖，不依赖原生日礼物或 ta-say 目录。

验收时临时复用了本机依赖链接以测试解压内容，ZIP 不含依赖；接收方执行 `npm ci`。合成 opened 事件只验证 API，不替代上节已经单独完成的真实浏览器作品体验。

## 压缩后真实 Worker 资源服务

最终 manifest v2 为 **117 条路由、124 个分块**，存储 **217,786,434 字节**，对应原始 **374,521,057 字节**；单个压缩块最大 **15,595,925 字节**。这是无损存储压缩，没有删除作品资源换取包体积。

2026-10-27 21:28，在 `127.0.0.1:5190` 的实际构建 Worker／真实 ASSETS 上验证：

| 检查 | 结果 |
|---|---|
| `/api/games` 与 `/works/library/api/games` | 200，真实 `isaacReady`／`wanyanReady` 和 I921／J921 映射 |
| 两个大文件跨 16 MiB 边界 Range | 206，32 字节逐字节匹配原文件 |
| 完整图书馆 `model.glb` | 127,924,180 字节，SHA-256 与原文件相同；本机读取 1483 ms |
| 完整晚言 `wanyan.data` | 103,399,842 字节，SHA-256 与原文件相同；本机读取 2184 ms |
| 越界 Range／ETag | 416／304 正确 |

动态图像／模型响应是原始内容，没有错误的 `Content-Encoding`；本地 workerd 对解压流使用合法 chunked 传输并省略 Content-Length，验收按实际接收长度和 SHA 核对。源码用单块 `DecompressionStream` 与 pull 背压，没有整模型 `arrayBuffer()` 或 `Buffer.concat()`；这属于源码检查和成功流式读取，**未做 isolate heap 剖析或多下载内存压力测试**。

## 约 100 名观众的服务并发

引用较新的 [`audience-final-tests.txt`](../output/audience-final-tests.txt)，不是旧跑次或聊天近似值。

| 条件 | Node | Worker 本地云运行时 |
|---|---|---|
| 环境 | 本机 HTTP／SSE，临时持久 JSON | 本机 Miniflare／workerd、实际本地 D1 SQLite |
| 独立观众／SSE 连接 | 100／100 | 100／100 |
| 事件请求 | 340 | 340 |
| 测试时段 | 1146 ms | 1678 ms |
| 事件 P95 | 272 ms | 231 ms |

测试断言三个点位独立到访人数 34／33／33，20 名加载失败不算打开，80 名成功打开、40 名仍在体验；覆盖去重、并行标签、暂停、重连和持久化。Node 该跑次观众文件为 122,515 字节。

这是连接、事件、持久化和统计汇总测试，**不是 100 台真实设备、100 个三维角色同屏或公网带宽测试**。未同时下载 100 份大模型／Unity 资源，也未据此承诺所有手机帧率。

## 私有数据与原工程保护

部署审计对 692 个源码／构建文件约 762 MB 与本机两个已知凭据值比对，没有发现混入；唯一需要私有保管的本地 `.dev.vars` 被 Git 忽略且未跟踪。原私人剧情 config 与两张头像的哈希不在运行 manifest，中性 `story/config.json` 与 `public-story.json` 一致；已知私人剧情文本比较仅命中源码测试中的排除路径字符串，没有命中私人正文或实际头像。私有／缺失路径实际 HTTP 返回 404，未登录观众管理接口返回 401。

图书馆保留原条件、节点、回复数、延时和真实胜利逻辑，活动副本使用中性引导及独立存档键。Unity／SWF 按原样复制，没有对编译内容声称完整语义隐私扫描。没有因进入、退出、刷新或统一观看伪造胜利。原工程桌面平台／签名状态未因本轮网页接入获得额外真机验证。

## 明确未验证范围与部署接管

- 没有经过本轮验收的公网观众入口、生产 D1 重连／持久化结果或独立设备／现场网络可用性结果。现有平台 public 发布为真实历史事实，但当前 403 未解决；用户已要求停止继续平台尝试并自行部署。
- 三个作品真实打开和返回已在本机浏览器完成；图书馆做了 3 次进出，晚言与过拟合恋人未分别完成 3 次重复进出压力验收。iframe 清理正确不等于 GPU、音频和长时间内存的完整性能报告。
- 独立 IAB／Chrome 身份、刷新及同 cookie 多标签页复用均已做实际浏览器检查；离线重放、失败重试主要由 API／自动化验证。物理手柄、全部默认点位间完整徒步路线、远处独立光柱和定时出现／消失视觉未做本轮人工验收。
- 原 ta-say 既有 10 个测试失败与 7 个类型错误仍如实保留；它们不等于活动隔离构建失败。未来托管的模型 secret、费用额度及网络需由接管部署者配置并验证。
- 短片、额外 HTML 分享和其他未定位工具没有伪造素材或入口。阶段“短片”只提供主持人阶段引导，不会把统一观看当通关。

源码、Node 运行包、Worker 适配分支和上述验证证据已保留。后续部署时使用运行手册中的完整服务要求，先验证真实 GET、API、SSE、管理认证及数据保存，再将最终地址发给现场观众。
