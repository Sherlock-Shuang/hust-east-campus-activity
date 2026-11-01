# 东校区 online 动态进入封面

首页先显示观众提供的晚霞银杏图，标题为「东校区online」，按钮为「开始体验」。沿用现有校园、昵称和主持人控制流程。

## 画面

- 原图压缩为 `public/images/entry-cover/east-campus-sunset-v1.webp`，1672×941，约 224 KiB，优先预加载；不增加视频和第二套 WebGL 场景。
- CSS 缓慢推镜与光照呼吸，轻量 2D canvas 绘制银杏落叶、少量空气光点与水面微光；指针带动细微视差。
- 手机横竖屏自适应，支持安全区。系统减少动态效果时保持静态图；隐藏页面暂停动画，进入后释放动画监听与绘制。

## 进入流程

- 数据和真实校园在封面后并行准备。加载完成不会自行跳过封面。
- 提前点击会等待真实 `campus:ready`；就绪后淡出 900ms，触发 `campus:entry-entered`。
- 封面期间角色、NPC、自动进室内、作品到访记录、配乐和灾变交互保持暂停。退出后仍遵循原昵称和主持人暂停状态。
- 首页每次访问均显示封面。错误与慢加载恢复面板保留在最上层；图形上下文丢失时不会误入无法使用的校园。

## 验证

`node --test tests/entry-cover.test.mjs tests/live-experience-sky-look.test.mjs tests/campus-music.test.mjs tests/campus-startup-data.test.mjs tests/civilization-pause.test.mjs tests/campus-tsunami.test.mjs`

发布构建使用 `npm run build:vercel`。浏览器验证新昵称、已有身份重访、点击进入，以及手机横竖屏。
