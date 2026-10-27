# Vercel 部署与验收记录

日期：2026-10-27。首个生产源码提交：`2dbcfcd`。实际部署到 Sherlock_Zeng's projects，项目 `hust-east-campus-activity`，GitHub 私有仓库自动构建 main。

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
| 新源码 npm test | 8/8 通过 | 本地真实 SQLite，含 Node HTTP 与自动恢复作品缓存 |
| 全新目录 npm start | 33/33 HTTP 检查通过 | 5185 临时服务已停止；原 5178 未修改 |
| 本地连接并发 | 100 观众、100 SSE、340 事件；约 580 ms，事件 P95 83 ms | 两个本地 libSQL 客户端；不是 100 台 WebGL 设备或公网压测 |
| Vercel 构建 | Production Ready | Git 自动构建约 26 秒 |
| 公网静态资源 | 30/30 通过 | 三作品、控制端、深路由、缺失资源 404、MIME、HEAD、Range |
| 大型模型与 Unity 数据 | 127,924,180-byte GLB、103,399,842-byte data 首／中／尾各 64 字节逐字节匹配；206 与 Content-Range 正确 | 采样验证，未声称本轮完整下载 370 MB 或真实进入游戏画面 |
| 公网观众与鉴权 | 8/8 场景、40 次请求通过 | 两名明确标记的合成观众；同人多标签、重复事件、位置越界、失败／打开／返回分别检查 |
| 公网主持人控制 | 两条真实 SSE 同步收到公告、暂停、光柱、入口开关、阶段变更 | 3.7 秒后恢复原自由探索状态，revision 2；未清空探索记录 |
| 公网 SSE 生命周期 | 实际持续 240.6 秒，16 次时钟帧；重新连接 513 ms 收到 revision 2 | 真实墙钟测试，区别于单元测试的注入时钟 |
| 公网模型代理 | default 流式、fast JSON 各一次，分别约 7.0 秒／5.7 秒，都返回真实文本 | API 真调用，不是浏览器游戏流程或通关验收 |
| 保密与原项目保护 | 280 个首次追踪文件、124 个压缩块审查；已知密钥零匹配，原头像与私人剧情不在资源清单 | 活动副本匿名化；原校园源码、生日礼物、ta-say 原项目保留 |

## 当前访问限制与未完成项

在本机网络中，直接连接 `vercel.app` 的 HTTP 和浏览器都超时；通过电脑已有代理的独立 HTTP 客户端可访问公开域名并完成以上公网检查。没有修改系统代理、DNS、证书设置或关闭安全检查。

因此目前是**已部署、通过公网接口与资源验证的试用站点**，不能称已经通过现场网络或公网浏览器的完整游玩验收。本轮尚未在公开域名里实际完成校园走动、图书馆场景、Unity 战斗画面、恋人交互和返回的整段浏览器验收；此前本地版实际浏览器验收结果保存在原工程的 ACTIVITY-ACCEPTANCE 文档，不能替代这项公网结果。物理手柄、另一台真实设备、现场网络和 100 台客户端 GPU 性能也未验证。

现场若使用当前域名，应先由组织者用实际网络和普通观众设备测试能否直连。若不能，需接入自有域名或调整托管位置后重新验证；本轮未购买域名、付费服务器或付费数据库套餐。

## 运维与复现

运行、环境变量、Turso 初始化和作品配置见根目录 README。GitHub main 的后续提交会自动部署；数据库与部署函数分离，不能用重新部署当作清空场次数据的手段。Preview 未连接生产密钥／数据库。

本轮产生两名昵称以“验收-API-”开头的合成观众和一名“验收-模型”观众；这些记录不代表真实活动参与者。后台能区分已打开、加载失败和已返回，合成事件从未伪称通关。全场已恢复未暂停、自由探索、原有三个入口开放、无测试公告或额外光柱。

完整不含凭据的原始验收 JSON 存于原校园工程 output/：vercel-local-smoke、vercel-api-public-acceptance、vercel-static-public-acceptance、vercel-controls-public-acceptance、vercel-model-public-acceptance、vercel-sse-public-acceptance。数据库密钥、管理密码、cookie 与上游模型配置没有进入这些报告或 GitHub。
