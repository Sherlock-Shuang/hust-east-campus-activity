# 东校区 online 场景配乐

配乐配置位于 `src/campus-music.js`，由校园页面统一持有播放器。原始音源只读，发布的是 AAC 128 kbps M4A 副本。当前四首合计 17,085,031 字节（16.3 MiB），按需流式加载；不阻塞模型和首次可玩画面，不将整首解码为 AudioBuffer。

| 场景 | 曲目 | 状态 |
| --- | --- | --- |
| 日间校园 | Forrest Gump Suite | 已接入 |
| 光电大楼（所有室内入口、C118） | Cornfield Chase | 已接入 |
| 特斯拉、飞行器、直升机 | Sunflower — Post Malone & Swae Lee | 已配置场景，缺完整音频文件 |
| 蜘蛛侠战衣 | Scared of the Dark — Lil Wayne & Ty Dolla $ign feat. XXXTENTACION | 已配置场景，缺完整音频文件 |
| 夕阳或夜晚校园 | Another Day of Sun | 已接入 |
| 过拟合恋人 | 只要为你活一天 — 黄英华 | 已接入 |

优先级：作品／楼内 > 战衣／载具 > 昼夜校园。书境图书馆、晚言及恋情分析室沿用自身声音，校园音乐暂停。离开光电楼／恋人游戏或下车／脱下战衣后恢复当前光照对应的校园配乐；同一背景音乐保留进度。日落与夜晚之间切换不重启同一首音乐。

双媒体元素在真实点击／按键时解锁，实际音频可播放后才作 850 ms 音量过渡。支持 Web Audio 增益（包括移动端）及普通媒体音量回退。快速切换、迟到的播放 Promise、后台恢复及重复状态更新均不应重启或叠加旧音乐。媒体失败仅回退一次，避免反复下载。静音与音量使用本浏览器 localStorage 保存。

左上角「♫ 配乐」可静音，再点展开箭头可调音量。输入昵称或进入体验时的首次交互会尝试解锁；浏览器拒绝自动播放时显示「开启配乐」，由玩家点击恢复。隐藏页面／离开页面、主持人暂停与文明暂停时立即停播；恢复后继续。C118 大屏视频有声且正在播放时暂停 BGM，关闭视频声音／暂停／转身停播后恢复。音频焦点只接受当前同源、attemptId 匹配的 C118 iframe；其他作品不可请求这个状态。

## 待补音源

找到的官方原版：

- [Sunflower 官方发行入口](https://postmalone.lnk.to/Sunflower)；[艺人 SoundCloud](https://soundcloud.com/postmalone/sunflower-spider-man-into-the)。2026-11-01 查询时 SoundCloud 返回 `downloadable:false`、`policy:BLOCK`，不能作为当前网站可靠的完整背景音源。
- [Scared of the Dark 官方艺人音源](https://www.youtube.com/watch?v=KCp_I6ZlfE4)。本轮找到官方播放页，未取得可直接托管的完整音频文件。

这两个配置的 `url` 暂为 `null`，实际驾驶／战衣场景继续当前昼夜校园音乐。取得文件后放入 `public/audio/`，分别补 `CAMPUS_TRACKS.vehicle.url` 和 `.spider.url` 即可。不使用预览、翻唱、盗版镜像或会失效的临时串流地址冒充完整音源。

## 验证

测试及音源指纹记录在工作副本 `artifacts/soundtrack-20261101/`。音频实际解码和播放、跨场景切换、静音及音量使用应用内浏览器验证；未声称已在所有安卓或 iOS 真机测试。部署后还需核验静态音源 HEAD／Range、构建版本和公开页面。
