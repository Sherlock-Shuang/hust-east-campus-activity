# C118 大屏视频资产

制作日期：2026-10-29（Asia/Shanghai）。这些文件用于光电信息大楼 C118 报告厅现有大屏，媒体制作阶段不改变房间模型或播放逻辑。

## 文件

| 资源 | 路径 | 实测 |
|---|---|---|
| 游戏播放版 | `public/media/c118-vibe-coding-720p-v1.mp4` | 26,379,776 bytes（26.38 MB）；112.000 秒；1280×720；30 fps；3360 帧 |
| 加载封面 | `public/media/c118-vibe-coding-poster-v1.jpg` | 249,529 bytes；1280×720；取成片第 7 秒的游戏画面，保留来源水印 |

播放版使用 H.264 High / Level 3.1、yuv420p、AAC 48 kHz 立体声。双遍视频编码目标 1800 kbps、峰值上限 2400 kbps，音频编码目标 128 kbps；容器实测平均总码率 1884 kbps。原片约80.36 MB，游戏版约减少67%体积。统一背景音乐与完整112秒剪辑保留，未恢复任何原视频讲解声。

MP4 已启用 `faststart`：`moov` 位于偏移32，先于偏移121090的 `mdat`。部署时应使用独立媒体请求，并让服务器支持 HTTP Range；文件本身不需要加入校园首屏加载等待。

## 本地原片

`/Users/another_dimension/my_projects/AI俱乐部/讲座/输出/Vibe_Coding成果展示_20261029/Vibe_Coding成果展示_1分52秒_1080p.mp4`

原片不修改。原剪辑的来源、脚本、逐段时间线和原创配乐说明位于同目录的 `制作说明.md` 与 `edit/`。

来源视频：

- [《小王子》3D剧情游戏](https://www.bilibili.com/video/BV1vQpi6XE2z) — Sac_beflame。
- [Vibe Coding 交互简历](https://www.bilibili.com/video/BV1X9gy6gEbP) — 小郑还挺忙；只使用其原片前20秒。
- [空间感个人网站](https://www.bilibili.com/video/BV1tTun6hEbf) — Morningkk酱分享，作品作者 Tomasz Szmajda。
- [动态个人网站](https://www.bilibili.com/video/BV1hYceeGEuq) — JIEJOE_轻敲代码。

后两个网站在成片里标注为交互设计灵感，未断言其由 Vibe Coding 制作。

## 验证

- 完整视频和音轨解码通过，输出3360帧、112秒，无解码错误。
- 实际抽看4、35、55、83秒画面：章节标题和原片字幕可辨认，比例未拉伸；草地等复杂动态细节有压缩损失，属于本游戏轻量版取舍。
- 封面已目视检查，画面不是黑场，水印保留。
- `output/c118-video-qa/` 保存双遍编码命令、日志、完整解码日志、接触表、SHA-256及MP4结构核验。该目录是本地验证材料，不是运行依赖。
- 本文件记录资产验证；浏览器播放、暂停、声音按钮和现场设备帧率需随 C118 集成单独验证。

视频 SHA-256：`49028e3828902a5548e6314f46d363b0d8cbb222d574355ef9b8a8687b4ef020`。
