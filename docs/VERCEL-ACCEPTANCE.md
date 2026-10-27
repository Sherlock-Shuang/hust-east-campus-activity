# Vercel 部署与验收记录

日期：2026-10-27。首个生产源码提交：`2dbcfcd`；浏览器回归后的代码提交：`17965ea`。实际部署到 Sherlock_Zeng's projects，项目 `hust-east-campus-activity`，GitHub 私有仓库自动构建 main。

## 已发布地址

- 观众：https://hust-east-campus-activity.vercel.app/
- 主持人：https://hust-east-campus-activity.vercel.app/admin
- 图书馆：https://hust-east-campus-activity.vercel.app/works/library/
- 晚言：https://hust-east-campus-activity.vercel.app/works/wanyan/
- 过拟合恋人：https://hust-east-campus-activity.vercel.app/works/tasay/
- 源码：https://github.com/Sherlock-Shuang/hust-east-campus-activity

作品应从校园点位进入以保留观众身份与返回上下文。观众页面无需 Vercel 登录；管理 API 使用独立密码与 CSRF 校验。数据库由 Vercel Marketplace 的 Turso Starter 提供，服务端函数运行于 hnd1、Node.js 24。构建实际成功，API bundle 172.2 KB，大文件独立存于静态 CDN。

## 本轮实测

| 范围 | 结果 | 边界 |
| --- | --- | --- |
| 新源码 npm test | 12/12 通过 | 本地真实 SQLite、Node HTTP、自动恢复作品缓存、4 项坐标表单回归 |
| 全新目录 npm start | 33/33 HTTP 检查通过 | 5185 临时服务已停止；原 5178 未修改 |
| 本地连接并发 | 100 观众、100 SSE、340 事件；约 580 ms，事件 P95 83 ms | 两个本地 libSQL 客户端；不是 100 台 WebGL 设备或公网压测 |
| Vercel 构建 | Production Ready | Git 自动构建约 26 秒 |
| 公网静态资源 | 30/30 通过 | 三作品、控制端、深路由、缺失资源 404、MIME、HEAD、Range |
| 大型模型与 Unity 数据 | 127,924,180-byte GLB、103,399,842-byte data 首／中／尾各 64 字节逐字节匹配；206 与 Content-Range 正确 | 采样验证，未声称本轮完整下载 370 MB 或真实进入游戏画面 |
| 公网实际浏览器 | IAB 与独立 Chrome 各一观众，同人第二标签未增加人数；刷新／重新打开保留身份 | 同一台 Mac 的两个浏览器环境，不是另一台物理设备 |
| 三个作品实际内容 | 图书馆真实三维场景与手机剧情、晚言 Unity 战斗画面和移动、恋人正式聊天与回复均已操作 | 三者均从校园进入并返回，每次返回 iframe 数为 0，不声称通关 |
| 浏览器主持人联动 | 公告同时显示于两个观众端及作品覆盖层；集合／自由探索、暂停／恢复正确显示 | 临时坐标用于快速抵达三个作品；结束后精确恢复原点位 |
| 坐标表单修复 | 505.8 / -79.4 输入后立即保存，公开 API 返回正确坐标 | 保存改为读取当前输入；旧值缓存问题已修复并真实浏览器复测 |
| 跨重新部署持久化 | 青禾 3 个作品各 1 次打开与返回，当前体验 0，完成事件 0；白露 ID 独立 | 记录由 Turso 保存；图书馆／晚言是 runtime_ready，恋人保持 page_opened |
| 公网观众与鉴权 | 8/8 场景、40 次请求通过 | 两名明确标记的合成观众；同人多标签、重复事件、位置越界、失败／打开／返回分别检查 |
| 公网主持人控制 | 两条真实 SSE 同步收到公告、暂停、光柱、入口开关、阶段变更 | 3.7 秒后恢复原自由探索状态，revision 2；未清空探索记录 |
| 公网 SSE 生命周期 | 实际持续 240.6 秒，16 次时钟帧；重新连接 513 ms 收到 revision 2 | 真实墙钟测试，区别于单元测试的注入时钟 |
| 公网模型代理 | default 流式、fast JSON 各一次，分别约 7.0 秒／5.7 秒，都返回真实文本 | API 真调用，不是浏览器游戏流程或通关验收 |
| 保密与原项目保护 | 280 个首次追踪文件、124 个压缩块审查；已知密钥零匹配，原头像与私人剧情不在资源清单 | 活动副本匿名化；原校园源码、生日礼物、ta-say 原项目保留 |

## 当前访问限制与未完成项

在本机网络中，直接连接 `vercel.app` 的 HTTP 和浏览器都超时；通过电脑已有代理的独立 HTTP 客户端可访问公开域名并完成以上公网检查。没有修改系统代理、DNS、证书设置或关闭安全检查。

用户开启现有代理后，本轮已经在公开域名完成上表所列实际浏览器验收。此前网络失败是真实限制，并没有因构建成功而消失；因此目前是**经过公网接口、资源及两浏览器游玩验证的试用站点**，不代表已通过活动现场网络验收。

校园返回后键盘移动、第一／第三视角切换和 iframe 清理已实际操作。自动化浏览器请求鼠标锁定时显示未锁定提示，直接鼠标环视的降级路径可用；本轮不能声称原生鼠标锁定已成功，需普通浏览器人工点击验证。物理手柄、另一台真实设备、现场网络和 100 台客户端 GPU 性能也未验证。

现场若使用当前域名，应先由组织者用实际网络和普通观众设备测试能否直连。若不能，需接入自有域名或调整托管位置后重新验证；本轮未购买域名、付费服务器或付费数据库套餐。

## 运维与复现

运行、环境变量、Turso 初始化和作品配置见根目录 README。GitHub main 的后续提交会自动部署；数据库与部署函数分离，不能用重新部署当作清空场次数据的手段。Preview 未连接生产密钥／数据库。

本轮产生两名昵称以“验收-API-”开头的合成观众、一名“验收-模型”，以及“验收-青禾”“验收-白露”两个实际浏览器验收身份，共 5 个测试参与者；这些记录不代表现场真实观众。后台能区分已打开、加载失败和已返回，合成事件从未伪称通关。最终核对 revision 17：全场已恢复未暂停、自由探索、原有三个入口精确坐标与开放状态、无测试公告或额外光柱。

完整不含凭据的原始验收 JSON 存于原校园工程 output/：vercel-local-smoke、vercel-api-public-acceptance、vercel-static-public-acceptance、vercel-controls-public-acceptance、vercel-model-public-acceptance、vercel-sse-public-acceptance、vercel-browser-records-check、vercel-browser-acceptance。浏览器截图包括 vercel-library-browser.png、vercel-library-interaction.png、vercel-wanyan-browser.png、vercel-tasay-browser.png、vercel-announcement-browser.png、vercel-admin-browser.png。数据库密钥、管理密码、cookie 与上游模型配置没有进入这些报告或 GitHub。
